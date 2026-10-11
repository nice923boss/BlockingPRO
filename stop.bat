@echo off
REM Stops the BlockingPRO server on port 38940. Pure ASCII only.
set FOUND=0
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr ":38940 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%P 1>nul 2>nul && set FOUND=1
)
if "%FOUND%"=="0" (echo [stop] No server on port 38940.) else (echo [stop] Server stopped.)
timeout /t 2 1>nul
