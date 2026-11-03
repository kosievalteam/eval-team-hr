@echo off
rem Weekly Excel -> HR web, one-time import. Messages are printed by import_weekly.py.
chcp 65001 >nul
cd /d "%~dp0"
python import_weekly.py %*
pause
