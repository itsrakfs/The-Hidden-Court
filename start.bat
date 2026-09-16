@echo off
title THE HIDDEN COURT - Padel Ranking
cd /d "%~dp0"
echo.
echo  ============================================
echo      THE HIDDEN COURT - Padel Ranking
echo  ============================================
echo   Public page : http://127.0.0.1:5000
echo   Admin panel : http://127.0.0.1:5000/admin
echo   Press Ctrl+C to stop the server.
echo  ============================================
echo.
python server.py
pause