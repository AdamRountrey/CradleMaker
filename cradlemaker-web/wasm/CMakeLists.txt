option(CRADLEMAKER_ENABLE_PTHREADS "Build Cradlemaker WASM with pthread support" OFF)

add_library(cradlemaker_support_core STATIC
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
    -sINITIAL_MEMORY=3221225472
    -sMAXIMUM_MEMORY=4294967296
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
