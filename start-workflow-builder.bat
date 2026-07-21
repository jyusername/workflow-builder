@echo off
setlocal

cd /d "%~dp0"

call :is_url_ready "http://127.0.0.1:8001/"
if errorlevel 1 (
  start "Workflow Builder API" cmd /k "cd /d backend\app && ..\venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8001"
) else (
  echo Backend API is already running on port 8001.
)

start "Workflow Builder Runner" cmd /k "cd /d backend && venv\Scripts\python.exe runner.py"

call :is_url_ready "http://127.0.0.1:5173/"
if errorlevel 1 (
  start "Workflow Builder Frontend" cmd /k "cd /d frontend && npm run dev -- --host 127.0.0.1 --port 5173 --strictPort"
) else (
  echo Frontend is already running on port 5173.
)

echo Waiting for backend API...
call :wait_for_url "http://127.0.0.1:8001/" 60
if errorlevel 1 (
  echo Backend API did not become ready in time.
  pause
  exit /b 1
)

echo Waiting for frontend...
call :wait_for_url "http://127.0.0.1:5173/" 90
if errorlevel 1 (
  echo Frontend did not become ready in time.
  pause
  exit /b 1
)

set "CHROME_PATH="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_PATH if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME_PATH=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_PATH if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME_PATH=%LocalAppData%\Google\Chrome\Application\chrome.exe"

echo Opening Workflow Builder in Chrome...
if defined CHROME_PATH (
  start "" "%CHROME_PATH%" --new-tab "http://127.0.0.1:5173/"
) else (
  start "" "http://127.0.0.1:5173/"
)

endlocal
exit /b 0

:is_url_ready
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri '%~1' -TimeoutSec 2; if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { exit 0 } } catch { exit 1 }"
exit /b %errorlevel%

:wait_for_url
set "URL=%~1"
set /a "MAX_SECONDS=%~2"
set /a "ELAPSED=0"

:wait_loop
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri '%URL%' -TimeoutSec 2; if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { exit 0 } } catch { exit 1 }"
if not errorlevel 1 exit /b 0

set /a "ELAPSED+=1"
if %ELAPSED% GEQ %MAX_SECONDS% exit /b 1
timeout /t 1 /nobreak >nul
goto wait_loop
