@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 정책평가팀 HR관리앱
python server.py
if errorlevel 1 (
  echo.
  echo [오류] 실행에 실패했습니다. Python과 openpyxl 설치 여부를 확인하세요:  pip install openpyxl
  pause
)
