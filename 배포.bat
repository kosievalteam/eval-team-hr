@echo off
chcp 65001 >nul
cd /d "%~dp0"
python publish.py
if errorlevel 1 (
  echo.
  echo [오류] 배포에 실패했습니다. 위 메시지를 확인하세요.
  if not "%1"=="/auto" pause
  exit /b 1
)
if not "%1"=="/auto" pause
