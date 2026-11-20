# Panduan Build Aplikasi Desktop Windows (.exe) — Paijo Clip

Konfigurasi desktop menggunakan **Electron** + **electron-builder** dengan server API lokal tersemat (*embedded Express server*), ikon aplikasi `Paijo Clip`, serta dua format hasil build untuk Windows 64-bit (`x64`):
1. **Installer NSIS** (`Paijo Clip-1.5.0-win-x64.exe`) — memasang aplikasi beserta pintasan *Desktop* dan *Start Menu*.
2. **Portable EXE** (`Paijo Clip-1.5.0-win-x64.exe` / portable) — dapat langsung dijalankan tanpa proses instalasi.

---

## Prasyarat Build di Windows (Lokal)
- **Node.js 20+** (disarankan Node.js 22 LTS)
- **npm**
- (Opsional saat pemakaian) `yt-dlp.exe` di `PATH` Windows jika ingin mengaktifkan unduhan YouTube langsung di desktop.

---

## Perintah Penting

### 1. Jalankan Mode Desktop Development
Menjalankan server web/API (`port 3000`) sekaligus membuka jendela desktop Electron:
```bash
npm run electron:dev
```
*(Jalankan `npm run dev` di terminal terpisah, lalu jalankan `npm run electron:dev` dengan `ELECTRON_START_URL=http://localhost:3000`, atau langsung jalankan build produksi di bawah.)*

### 2. Kompilasi Bundle Desktop & UI
Membangun frontend (`dist/`) dan entrypoint Electron (`dist-electron/main.cjs` & `dist-electron/preload.cjs`):
```bash
npm run electron:build
```

### 3. Build File `.exe` Windows
Jalankan pada PC/laptop Windows atau melalui GitHub Actions (`.github/workflows/build-windows-exe.yml`):
```bash
npm run dist:win
```
Hasil installer & executable Windows akan tersimpan di folder:
```text
release/
```

---

## Konfigurasi `GEMINI_API_KEY` di Aplikasi Desktop
Agar fitur AI (Transkripsi AI, Deteksi Momen Viral, & Pembuatan Video AI) berfungsi saat `.exe` dijalankan di komputer pengguna:
- Letakkan file `.env` berisi `GEMINI_API_KEY=...` di **salah satu** lokasi berikut:
  1. Folder sebelah file `.exe` (untuk mode *portable*), atau
  2. Folder data aplikasi Windows: `%APPDATA%\Paijo Clip\.env`.
