@echo off
setlocal
echo ====================================================================
echo       TI AWR1843BOOST - RADAR TACHOMETER WEB AVIONICS HUD
echo ====================================================================

set PYTHON_EXE=C:\Users\dellb\AppData\Local\Programs\Python\Python312\python.exe
if not exist "%PYTHON_EXE%" (
    set PYTHON_EXE=python
)

"%PYTHON_EXE%" "%~dp0dashboard\app.py" %*
