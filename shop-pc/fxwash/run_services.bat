@echo off
chcp 65001 >nul
title 私享家 LINE 官方客服背景服務
cd /d "C:\LaundryStores\fxwash"

echo [私享家] 正在以完全隱蔽背景模式檢查並啟動 LINE 官方帳號客服系統...

:: 透過 pythonw.exe 呼叫守護程序，完全無黑窗、不干擾螢幕畫面
"C:\LaundryStores\python-portable\pythonw.exe" "C:\LaundryStores\fxwash\watchdog.py"

echo [私享家] 服務已在背景穩定運行！
