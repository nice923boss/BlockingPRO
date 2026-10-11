@echo off
REM BlockingPRO launcher (needs Python 3). Pure ASCII only.
cd /d "%~dp0"
where python 1>nul 2>nul
if errorlevel 1 (
    echo [error] Python not found in PATH. Install Python 3 from https://www.python.org/
    pause
    exit /b 1
)
echo [start] http://127.0.0.1:38940/index.html
echo [start] Close this window or press Ctrl+C to stop.
python tools/serve.py --open
if errorlevel 1 pause
