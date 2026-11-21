# Panduan Build & Distribusi Desktop Windows (.exe) — Paijo Clip

Konfigurasi desktop menggunakan **Electron** + **electron-builder** dengan server API lokal tersemat (*embedded Express server*), ikon aplikasi **Paijo Clip**, serta dua format hasil build untuk Windows 64-bit (`x64`):
1. **Setup Installer (`Paijo Clip-1.5.0-Setup-x64.exe`)** — memasang aplikasi lengkap dengan pintasan *Desktop* dan *Start Menu*.
2. **Portable EXE (`Paijo Clip-1.5.0-Portable-x64.exe`)** — satu file siap jalan tanpa proses instalasi.

---

## Distribusi Otomatis ke Web Online (GitHub Releases)

Aplikasi web **Paijo Clip** (termasuk saat di-deploy ke **Vercel**) mendeteksi file `.exe` secara otomatis dari dua sumber:
1. **Build Lokal**: folder `release/` atau `public/downloads/` jika dijalankan di server Node lokal.
2. **GitHub Releases Terbaru**: otomatis membaca aset `*Setup*.exe` dan `*Portable*.exe` dari rilis terbaru GitHub repo Anda.

### Cara Menerbitkan `.exe` Otomatis via GitHub Actions
1. Push kode proyek ini ke repositori GitHub Anda.
2. Jalankan workflow **Build & Publish Windows EXE (Paijo Clip)** melalui tab **Actions** di GitHub, atau buat tag rilis:
   ```bash
   git tag v1.5.0
   git push origin v1.5.0
   ```
3. GitHub Actions (`windows-latest`) akan membangun **Setup Installer (.exe)** + **Portable (.exe)** dan otomatis menerbitkannya ke **GitHub Releases**.
4. Pada Vercel, repositori GitHub yang terhubung otomatis terdeteksi (`VERCEL_GIT_REPO_OWNER`/`VERCEL_GIT_REPO_SLUG`), atau Anda dapat mengisi Environment Variable `DESKTOP_GITHUB_REPO=pemilik/nama-repo`.

---

## Build Lokal di PC Windows
```bash
npm install
npm run dist:win
```
Hasil kedua file `.exe` tersimpan di folder `release/`.

## Konfigurasi `GEMINI_API_KEY` di Aplikasi Desktop
Agar fitur AI (Transkripsi AI, Deteksi Momen Viral, & Pembuatan Video AI) berfungsi saat `.exe` dijalankan di komputer pengguna, letakkan file `.env` berisi `GEMINI_API_KEY=...` di **salah satu** lokasi berikut:
1. Folder sebelah file `.exe` (untuk mode *portable*), atau
2. Folder data aplikasi Windows: `%APPDATA%\Paijo Clip\.env`.
