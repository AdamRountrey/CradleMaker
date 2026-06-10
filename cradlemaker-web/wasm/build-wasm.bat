@echo off
setlocal

set ROOT=%~dp0..\..
set EMSDK=%ROOT%\tools\emsdk
call "%EMSDK%\emsdk_env.bat" >NUL

if not exist "%ROOT%\cradlemaker-web\src\wasm" mkdir "%ROOT%\cradlemaker-web\src\wasm"

emcc "%ROOT%\cradlemaker-web\wasm\CradlemakerCore.cpp" ^
  --bind ^
  -O2 ^
  -s MODULARIZE=1 ^
  -s EXPORT_ES6=1 ^
  -s EXPORT_NAME=createCradlemakerCore ^
  -s ENVIRONMENT=web,worker ^
  -s ALLOW_MEMORY_GROWTH=1 ^
  -o "%ROOT%\cradlemaker-web\src\wasm\cradlemaker-core.js"

endlocal
