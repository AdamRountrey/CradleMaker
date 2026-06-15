@echo off
setlocal

set ROOT=%~dp0..\..
set EMSDK=%ROOT%\tools\emsdk
call "%EMSDK%\emsdk_env.bat" >NUL

if not exist "%ROOT%\cradlemaker-web\src\wasm" mkdir "%ROOT%\cradlemaker-web\src\wasm"

emcc "%ROOT%\cradlemaker-web\wasm\CradlemakerCore.cpp" ^
  "%ROOT%\cradlemaker-web\wasm\SupportCore.cpp" ^
  "%ROOT%\cradlemaker-web\wasm\OrcaSupportBridge.cpp" ^
  -I"%ROOT%\cradlemaker-web\wasm" ^
  --bind ^
  -O2 ^
  -s MODULARIZE=1 ^
  -s EXPORT_ES6=1 ^
  -s EXPORT_NAME=createCradlemakerCore ^
  -s ENVIRONMENT=web,worker ^
  -s ALLOW_MEMORY_GROWTH=1 ^
  -o "%ROOT%\cradlemaker-web\src\wasm\cradlemaker-core.js"

if errorlevel 1 exit /b %errorlevel%

"%ROOT%\tools\strawberry-perl\c\bin\cmake.exe" ^
  -DINPUT="%ROOT%\cradlemaker-web\src\wasm\cradlemaker-core.js" ^
  -P "%ROOT%\cradlemaker-web\wasm\CompatEmscriptenWrapper.cmake"

endlocal
