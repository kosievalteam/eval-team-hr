@echo off
rem Review data auto-update for the HR app (Task Scheduler). Usage: review_update.bat sims^|onedrive
chcp 65001 >nul
cd /d "%~dp0.."
python tools\review_update.py %1
