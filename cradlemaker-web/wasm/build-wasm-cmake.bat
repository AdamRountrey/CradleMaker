@echo off
setlocal

set ROOT=%~dp0..\..
set BUILD_DIR=%ROOT%\build-wasm-cmake
if not "%~1"=="" set BUILD_DIR=%~1

set EMSDK=%ROOT%\tools\emsdk
call "%EMSDK%\emsdk_env.bat" >NUL
set PATH=%ROOT%\tools\strawberry-perl\c\bin;%PATH%

"%ROOT%\tools\strawberry-perl\c\bin\cmake.exe" ^
  --build "%BUILD_DIR%" ^
  --target cradlemaker_wasm ^
  --config Release

endlocal
