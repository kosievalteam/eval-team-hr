@echo off
rem Open a dedicated Chrome window to log in to SIMS once; the login is reused by the daily collection.
chcp 65001 >nul
cd /d "%~dp0.."
title SIMS 로그인 (HR앱 자동 수집용)
python tools\sims_browser.py login
pause
