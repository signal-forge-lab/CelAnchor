@echo off
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  start "" index.html
  exit /b 0
)
start "CelAnchor Server" cmd /c "python -m http.server 8765"
timeout /t 1 /nobreak >nul
start "" http://localhost:8765
