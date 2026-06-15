@echo off
setlocal

set ROOT=%~dp0..\..
set BUILD_DIR=%ROOT%\build-wasm-cmake
if not "%~1"=="" set BUILD_DIR=%~1

set EMSDK=%ROOT%\tools\emsdk
call "%EMSDK%\emsdk_env.bat" >NUL
set PATH=%ROOT%\tools\strawberry-perl\c\bin;%PATH%

"%EMSDK%\python\3.13.3_64bit\python.exe" ^
  "%EMSDK%\upstream\emscripten\emcmake.py" ^
  "%ROOT%\tools\strawberry-perl\c\bin\cmake.exe" ^
  -S "%ROOT%" ^
  -B "%BUILD_DIR%" ^
  -G Ninja

endlocal
