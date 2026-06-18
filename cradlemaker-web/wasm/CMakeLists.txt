set(CRADLEMAKER_DEFAULT_ORCA_LIBSLIC3R_DIR "${CMAKE_SOURCE_DIR}/src/libslic3r")
if(NOT EXISTS "${CRADLEMAKER_DEFAULT_ORCA_LIBSLIC3R_DIR}/PrintObject.cpp" AND
   EXISTS "${CMAKE_SOURCE_DIR}/orca-upstream/OrcaSlicer/src/libslic3r/PrintObject.cpp")
    set(CRADLEMAKER_DEFAULT_ORCA_LIBSLIC3R_DIR "${CMAKE_SOURCE_DIR}/orca-upstream/OrcaSlicer/src/libslic3r")
endif()

set(ORCA_LIBSLIC3R_DIR "${CRADLEMAKER_DEFAULT_ORCA_LIBSLIC3R_DIR}" CACHE PATH
    "Path to upstream OrcaSlicer src/libslic3r for the optional support probe")
option(CRADLEMAKER_ENABLE_PTHREADS "Build Cradlemaker WASM with pthread support" OFF)

include(OrcaSupportSources.cmake)

set(SLIC3R_APP_NAME "Cradlemaker")
set(SLIC3R_APP_KEY "cradlemaker")
set(SLIC3R_VERSION "0.0.0")
set(SoftFever_VERSION "0.0.0")
set(SLIC3R_BUILD_ID "cradlemaker-wasm")
set(BBL_INTERNAL_TESTING 0)
set(ORCA_CHECK_GCODE_PLACEHOLDERS 0)

set(CRADLEMAKER_HAS_ORCA_SUPPORT_SOURCES TRUE)
foreach(source_candidate IN LISTS CRADLEMAKER_ORCA_SUPPORT_SOURCE_CANDIDATES)
    if(NOT EXISTS "${source_candidate}")
        set(CRADLEMAKER_HAS_ORCA_SUPPORT_SOURCES FALSE)
    endif()
endforeach()
if(NOT EXISTS "${ORCA_LIBSLIC3R_DIR}/libslic3r_version.h.in")
    set(CRADLEMAKER_HAS_ORCA_SUPPORT_SOURCES FALSE)
endif()

if(CRADLEMAKER_HAS_ORCA_SUPPORT_SOURCES)
    set(CRADLEMAKER_GENERATED_LIBSLIC3R_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated/libslic3r")
    file(MAKE_DIRECTORY "${CRADLEMAKER_GENERATED_LIBSLIC3R_DIR}")
    configure_file(
        "${ORCA_LIBSLIC3R_DIR}/libslic3r_version.h.in"
        "${CRADLEMAKER_GENERATED_LIBSLIC3R_DIR}/libslic3r_version.h"
        @ONLY
    )

    file(GLOB CRADLEMAKER_WASM_BOOST_INCLUDE_DIRS
        "${CMAKE_SOURCE_DIR}/deps/build-wasm/dep_Boost-prefix/src/dep_Boost/libs/*/include"
    )

    add_library(cradlemaker_orca_support_probe OBJECT EXCLUDE_FROM_ALL
        ${CRADLEMAKER_ORCA_SUPPORT_SOURCE_CANDIDATES}
    )

    target_compile_features(cradlemaker_orca_support_probe PRIVATE cxx_std_17)

    target_compile_definitions(cradlemaker_orca_support_probe PRIVATE
        USE_TBB
        TBB_USE_CAPTURED_EXCEPTION=0
        CRADLEMAKER_WASM_ORCA_PROBE=1
    )

    target_compile_options(cradlemaker_orca_support_probe PRIVATE
        -pthread
        -Wno-missing-template-arg-list-after-template-kw
    )

    get_filename_component(ORCA_SOURCE_DIR "${ORCA_LIBSLIC3R_DIR}/.." ABSOLUTE)
    target_include_directories(cradlemaker_orca_support_probe
        PRIVATE
            "${ORCA_SOURCE_DIR}"
            "${ORCA_LIBSLIC3R_DIR}"
            "${CRADLEMAKER_GENERATED_LIBSLIC3R_DIR}"
            "${CMAKE_SOURCE_DIR}/deps_src"
            "${CMAKE_SOURCE_DIR}/deps_src/eigen"
            "${CMAKE_SOURCE_DIR}/deps_src/libigl"
            "${CMAKE_SOURCE_DIR}/deps_src/libnest2d/include"
            "${CMAKE_SOURCE_DIR}/deps/build/dep_Cereal-prefix/src/dep_Cereal/include"
            "${CMAKE_SOURCE_DIR}/deps/build-wasm/dep_OpenSSL-prefix/src/dep_OpenSSL/include"
            "${CMAKE_SOURCE_DIR}/deps/build/dep_OpenSSL-prefix/src/dep_OpenSSL/include"
            "${CMAKE_SOURCE_DIR}/deps/build/dep_OCCT-prefix/src/dep_OCCT-build/include/occt"
            "${CMAKE_SOURCE_DIR}/deps/build-wasm/OrcaSlicer_dep/usr/local/include"
            ${CRADLEMAKER_WASM_BOOST_INCLUDE_DIRS}
            "${CMAKE_CURRENT_SOURCE_DIR}"
    )
else()
    message(STATUS "Orca libslic3r support sources not found at ${ORCA_LIBSLIC3R_DIR}; skipping cradlemaker_orca_support_probe.")
endif()

add_library(cradlemaker_support_core STATIC
    OrcaSupportBridge.cpp
    OrcaSupportBridge.hpp
    SupportCore.cpp
    SupportCore.hpp
)

target_compile_features(cradlemaker_support_core PUBLIC cxx_std_17)

target_include_directories(cradlemaker_support_core
    PUBLIC
        "${CMAKE_CURRENT_SOURCE_DIR}"
)

if(CRADLEMAKER_ENABLE_PTHREADS)
    target_compile_options(cradlemaker_support_core PRIVATE -pthread)
endif()

add_executable(cradlemaker_wasm CradlemakerCore.cpp)

target_compile_features(cradlemaker_wasm PRIVATE cxx_std_17)

target_link_libraries(cradlemaker_wasm PRIVATE cradlemaker_support_core)

if(CRADLEMAKER_ENABLE_PTHREADS)
    target_compile_options(cradlemaker_wasm PRIVATE -pthread)
endif()

target_link_options(cradlemaker_wasm PRIVATE
    --bind
    -sMODULARIZE=1
    -sEXPORT_ES6=1
    -sEXPORT_NAME=createCradlemakerCore
    -sENVIRONMENT=web,worker
    -sALLOW_MEMORY_GROWTH=1
)

if(CRADLEMAKER_ENABLE_PTHREADS)
    target_link_options(cradlemaker_wasm PRIVATE
        -pthread
        -sUSE_PTHREADS=1
        -sPTHREAD_POOL_SIZE=8
    )
endif()

set_target_properties(cradlemaker_wasm PROPERTIES
    OUTPUT_NAME "cradlemaker-core"
    SUFFIX ".js"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/cradlemaker-web/src/wasm"
)

add_custom_command(TARGET cradlemaker_wasm POST_BUILD
    COMMAND ${CMAKE_COMMAND}
        -DINPUT=$<TARGET_FILE:cradlemaker_wasm>
        -P "${CMAKE_CURRENT_SOURCE_DIR}/CompatEmscriptenWrapper.cmake"
)
