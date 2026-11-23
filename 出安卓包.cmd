@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo  Zenith  -  Android APK builder
echo ============================================
echo.

if not exist ".env.local" (
  echo [X] .env.local not found in this folder.
  echo     Create it here with one single line:
  echo     EXPO_TOKEN=your_token_here
  echo.
  pause
  exit /b 1
)

set "TOKEN="
for /f "usebackq tokens=1,* delims==" %%A in (".env.local") do (
  if /i "%%A"=="EXPO_TOKEN" set "TOKEN=%%B"
)
rem Trim spaces / accidental quotes only when there is something to trim.
rem (%VAR: =% on an undefined variable leaves the literal text behind - do not touch it.)
if defined TOKEN set "TOKEN=%TOKEN: =%"
if defined TOKEN set TOKEN=%TOKEN:"=%

if not defined TOKEN (
  echo [X] EXPO_TOKEN is empty in .env.local
  echo     Open .env.local and put your Expo token right after the "=" sign.
  echo.
  pause
  exit /b 1
)

set "EXPO_TOKEN=%TOKEN%"

echo [1/2] Checking token ...
call npx eas-cli whoami
if errorlevel 1 (
  echo.
  echo [X] Token invalid or expired.
  echo     Get a new one at: expo.dev - Settings - Access tokens
  echo.
  pause
  exit /b 1
)

echo.
echo [2/2] Building APK. About 10-20 minutes. Keep this window open.
echo.
call npx eas-cli build -p android --profile preview --non-interactive
set "CODE=%errorlevel%"
echo.
if not "%CODE%"=="0" (
  echo [X] Build failed. Copy the red lines above and send them to me.
  echo.
  pause
  exit /b %CODE%
)
echo [OK] Build finished. The .apk download link is printed above.
echo      Send that link to me and I will put the file into the build folder.
echo.
pause
