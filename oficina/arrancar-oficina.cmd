@echo off
rem Oficina de las IAs: arranca el servidor local (solo lectura) si no esta ya y abre el navegador.
rem Doble clic. Para pararlo: cerrar la ventana minimizada "oficina-ias".
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:4317/api/estado | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "oficina-ias" /min node "%~dp0server.js"
  timeout /t 3 /nobreak >nul
)
start "" http://127.0.0.1:4317/
