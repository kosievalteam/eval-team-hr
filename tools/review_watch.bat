@echo off
rem OneDrive review-opinion folder watcher for the HR app (run at logon). Usage: review_watch.bat
chcp 65001 >nul
cd /d "%~dp0.."
title 정책평가팀 HR 검토의견서 감시
python tools\review_watch.py
