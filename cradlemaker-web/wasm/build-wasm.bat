@echo off
setlocal

set ROOT=%~dp0..\..
set EMSDK=%ROOT%\tools\emsdk
call "%EMSDK%\emsdk_env.bat" >NUL

if not exist "%ROOT%\cradlemaker-web\src\wasm" mkdir "%ROOT%\cradlemaker-web\src\wasm"

set PTHREAD_FLAGS=
set OUTPUT_BASENAME=cradlemaker-core
if "%CRADLEMAKER_ENABLE_PTHREADS%"=="1" (
  set PTHREAD_FLAGS=-pthread -s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=8
  set OUTPUT_BASENAME=cradlemaker-core-threaded
)

set OUTPUT_JS=%ROOT%\cradlemaker-web\src\wasm\%OUTPUT_BASENAME%.js
set OUTPUT_WASM=%ROOT%\cradlemaker-web\src\wasm\%OUTPUT_BASENAME%.wasm
if exist "%OUTPUT_JS%" del /f /q "%OUTPUT_JS%"
if exist "%OUTPUT_WASM%" del /f /q "%OUTPUT_WASM%"

emcc "%ROOT%\cradlemaker-web\wasm\CradlemakerCore.cpp" ^
  "%ROOT%\cradlemaker-web\wasm\SupportCore.cpp" ^
  "%ROOT%\cradlemaker-web\wasm\OrcaSupportBridge.cpp" ^
  -I"%ROOT%\cradlemaker-web\wasm" ^
  %PTHREAD_FLAGS% ^
  --bind ^
  -O3 ^
  -s MODULARIZE=1 ^
  -s EXPORT_ES6=1 ^
  -s EXPORT_NAME=createCradlemakerCore ^
  -s ENVIRONMENT=web,worker ^
  -s ALLOW_MEMORY_GROWTH=1 ^
  -s INITIAL_MEMORY=3221225472 ^
  -s MAXIMUM_MEMORY=4294967296 ^
  -o "%OUTPUT_JS%"

if errorlevel 1 exit /b %errorlevel%

"%ROOT%\tools\strawberry-perl\c\bin\cmake.exe" ^
  -DINPUT="%OUTPUT_JS%" ^
  -P "%ROOT%\cradlemaker-web\wasm\CompatEmscriptenWrapper.cmake"

if errorlevel 1 exit /b %errorlevel%

if "%CRADLEMAKER_SKIP_ICACLS%"=="1" goto build_complete

icacls "%OUTPUT_JS%" /inheritance:e >NUL

if errorlevel 1 exit /b %errorlevel%

:build_complete
endlocal
