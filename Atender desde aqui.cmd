@echo off
rem Pasa el turno de atender Slack a ESTE equipo. El otro deja de escuchar en 1 minuto como mucho.
"%LOCALAPPDATA%\Programs\Git\bin\bash.exe" "%~dp0herramientas\turno.sh"
if errorlevel 1 if exist "%ProgramFiles%\Git\bin\bash.exe" "%ProgramFiles%\Git\bin\bash.exe" "%~dp0herramientas\turno.sh"
pause
