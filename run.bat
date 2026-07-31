@echo off
rem Bench — запуск двойным кликом. Нужен установленный Python 3.
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py serve.py
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  python serve.py
  goto :eof
)
echo.
echo Python 3 не найден. Установите его с https://www.python.org/downloads/
echo (при установке поставьте галочку "Add Python to PATH") и снова запустите run.bat
echo.
pause
