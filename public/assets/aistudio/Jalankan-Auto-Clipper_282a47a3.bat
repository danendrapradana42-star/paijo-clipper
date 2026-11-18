@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1 || (echo Node.js belum terpasang. Pasang Node.js terlebih dahulu.& pause & exit /b 1)
where npm >nul 2>&1 || (echo npm belum tersedia. Periksa instalasi Node.js.& pause & exit /b 1)
if not exist "%~dp0node_modules\electron\dist\electron.exe" (
  echo Menyiapkan Auto Clipper untuk pertama kali. Ini perlu internet dan beberapa menit.
  call npm install
  if errorlevel 1 (echo Pemasangan gagal. Periksa koneksi internet lalu coba lagi.& pause & exit /b 1)
)
call npm start
if errorlevel 1 pause