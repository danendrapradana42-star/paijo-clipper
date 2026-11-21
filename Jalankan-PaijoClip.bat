@echo off
setlocal
cd /d "%~dp0"
title Paijo Clip Studio

if not exist "package.json" (
  echo File ini harus berada di folder yang sama dengan package.json.
  pause & exit /b 1
)

where node >nul 2>&1 || (echo Node.js belum terpasang. Pasang Node.js dari nodejs.org.& pause & exit /b 1)
where npm >nul 2>&1 || (echo npm belum tersedia. Periksa instalasi Node.js.& pause & exit /b 1)

if not exist "node_modules\.bin\tsx.cmd" (
  echo Memasang dependensi...
  call npm install
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo File .env dibuat dari .env.example.
  echo Masukkan GEMINI_API_KEY di file .env untuk fitur AI.
)

set PORT=3000
set NODE_ENV=development

echo Menjalankan Paijo Clip Studio di http://localhost:%PORT%
echo Tutup jendela ini untuk menghentikan aplikasi.
start "" /b cmd /c "timeout /t 5 /nobreak >nul & start http://localhost:%PORT%"
call npm run dev
if errorlevel 1 pause
