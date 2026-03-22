@echo off
setlocal enabledelayedexpansion

echo ==========================================
echo   Building Real-Time Teacher EXE
echo ==========================================

REM 1) venv yo'q bo'lsa yaratamiz
if not exist ".venv" (
  python -m venv .venv
)

call .venv\Scripts\activate

REM 2) build uchun keraklilar
pip install --upgrade pip
pip install pyinstaller
pip install -r backend\requirements.txt

REM 3) PyInstaller build (1 exe)
REM --add-data format: "SOURCE;DEST"  (Windowsda ; ishlatiladi)
pyinstaller ^
  --noconfirm ^
  --onefile ^
  --name "RealTimeTeacher" ^
  --add-data "frontend;frontend" ^
  --add-data "backend\.env;backend\.env" ^
  launcher.py

echo.
echo ✅ DONE: dist\RealTimeTeacher.exe
echo.
pause
