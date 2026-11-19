@echo off
setlocal DisableDelayedExpansion

set "SCHANORA_NODE_EXE=%SCHANORA_NODE%"
if defined SCHANORA_NODE_EXE goto run

for %%I in (node.exe) do set "SCHANORA_NODE_EXE=%%~$PATH:I"
if not defined SCHANORA_NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "SCHANORA_NODE_EXE=%ProgramFiles%\nodejs\node.exe"

:run
if not defined SCHANORA_NODE_EXE goto missing
if not exist "%SCHANORA_NODE_EXE%" goto missing

"%SCHANORA_NODE_EXE%" "%~dp0scripts\start-weknora.mjs" %*
exit /b %errorlevel%

:missing
echo Schanora needs Node.js 24. Install it and reopen your terminal, 1>&2
echo or set SCHANORA_NODE to the full path to an approved node.exe. 1>&2
echo See README.md for Windows setup. No npm is needed. 1>&2
exit /b 1
