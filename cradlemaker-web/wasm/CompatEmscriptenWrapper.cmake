if(NOT DEFINED INPUT)
    message(FATAL_ERROR "CompatEmscriptenWrapper.cmake requires -DINPUT=<generated-js>")
endif()

file(READ "${INPUT}" contents)

string(REPLACE
    "globalThis.process?.versions?.node&&globalThis.process?.type!=\"renderer\""
    "(globalThis.process&&globalThis.process.versions&&globalThis.process.versions.node&&globalThis.process.type!=\"renderer\")"
    contents "${contents}"
)
string(REPLACE
    "Module[\"onAbort\"]?.(what);"
    "if(Module[\"onAbort\"]){Module[\"onAbort\"](what)}"
    contents "${contents}"
)
string(REPLACE
    "readyPromiseReject?.(e);"
    "if(readyPromiseReject){readyPromiseReject(e)}"
    contents "${contents}"
)
string(REPLACE
    "wasmBinaryFile??=findWasmBinary();"
    "if(wasmBinaryFile==null){wasmBinaryFile=findWasmBinary()}"
    contents "${contents}"
)
string(REPLACE
    "class ExitStatus{name=\"ExitStatus\";constructor(status){this.message="
    "class ExitStatus{constructor(status){this.name=\"ExitStatus\";this.message="
    contents "${contents}"
)
string(REPLACE
    "instType?.toWireType.bind(instType)"
    "(instType==null?undefined:instType.toWireType.bind(instType))"
    contents "${contents}"
)
string(REPLACE
    "maxBytesToWrite??=2147483647;"
    "if(maxBytesToWrite==null){maxBytesToWrite=2147483647}"
    contents "${contents}"
)
string(REPLACE
    "globalThis.navigator?.language??\"C\""
    "(globalThis.navigator&&globalThis.navigator.language||\"C\")"
    contents "${contents}"
)
string(REPLACE
    "readyPromiseResolve?.(Module);"
    "if(readyPromiseResolve){readyPromiseResolve(Module)}"
    contents "${contents}"
)
string(REPLACE
    "Module[\"onRuntimeInitialized\"]?.();"
    "if(Module[\"onRuntimeInitialized\"]){Module[\"onRuntimeInitialized\"]()}"
    contents "${contents}"
)

if(contents MATCHES "\\?\\.|\\?\\?=|&&=|\\|\\|=")
    message(FATAL_ERROR "Generated Emscripten wrapper still contains unsupported modern assignment/optional syntax")
endif()

file(WRITE "${INPUT}" "${contents}")
