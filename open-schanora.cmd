@echo off
call "%~dp0start-web.cmd" --open %*
if errorlevel 1 pause
