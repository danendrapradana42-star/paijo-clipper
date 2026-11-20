# Panduan Deploy Online ke Vercel (`*.vercel.app`)

Aplikasi **Auto Clipper Studio** sudah dikonfigurasi agar dapat berjalan penuh di **Vercel** sebagai frontend Vite React + Serverless API Express (`/api/index.ts`) sekaligus tetap kompatibel di server Node lokal (`npm run dev` / `npm run start`).

## Arsitektur Konfigurasi

- **`vercel.json`** — Mengatur build Vite (`npm run build` -> `dist/`), routing SPA (`/*` -> `/index.html`), routing API (`/api/*` -> `/api/index.ts`), header keamanan & cache aset (`/assets/*`), serta batas eksekusi serverless (`maxDuration: 60`, `memory: 1024`).
- **`api/index.ts`** — Entrypoint Vercel Serverless Function yang mengekspor instance Express dari `server/apiApp.ts`.
- **`server/apiApp.ts`** — Seluruh endpoint backend (`/api/health`, `/api/app/version`, `/api/app/check-update`, `/api/transcribe`, `/api/ai-video/text`, `/api/ai-video/voice`, `/api/clips/highlights`, `/api/youtube/*`).
- **`src/utils/audioAnalyzer.ts`** — Transkripsi audio AI otomatis memecah audio menjadi bagian maksimal 60 detik (`~2,56 MB` base64 per permintaan) agar selalu lolos batas payload `4,5 MB` milik Vercel Serverless Functions.

---

## Langkah Deploy via GitHub + Dashboard Vercel (Disarankan)

1. Push seluruh kode proyek ini ke repositori GitHub Anda (`.env` dan `.vercel` otomatis diabaikan oleh `.gitignore`).
2. Buka [vercel.com/new](https://vercel.com/new) dan pilih repositori GitHub proyek ini.
3. Pengaturan Build otomatis terbaca dari `vercel.json`:
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Masuk ke menu **Environment Variables** dan tambahkan:
   - `GEMINI_API_KEY` = API key Gemini milik Anda (wajib untuk Transkripsi AI, Deteksi Momen Viral AI, Naskah Video AI, dan Suara AI).
5. Klik **Deploy** dan tunggu hingga domain `https://<nama-project>.vercel.app` aktif.

## Alternatif: Deploy Langsung via Vercel CLI

```bash
npm i -g vercel
vercel login
vercel env add GEMINI_API_KEY production
vercel --prod
```

---

## Pengaturan Wajib Setelah Online

1. **Aktifkan Domain Vercel di Firebase Authentication**
   Agar fitur Login Google Admin di menu **Versi & Update** (Firestore Release Staging) berfungsi di domain online:
   - Buka **Firebase Console** -> pilih project `positive-sprite-bvxch` -> **Authentication** -> **Settings** -> **Authorized domains**.
   - Klik **Add domain**, lalu masukkan domain Vercel Anda (misalnya `autoclipper-studio.vercel.app`).
2. **Catatan Fitur di Mode Serverless (`*.vercel.app`)**
   - Pemotongan video 9:16, Subtitle, AI Video Composer, pratinjau suara bawaan, dan **Unduh Sekaligus (.zip)** berjalan **100% di browser pengguna**, sehingga cepat dan tidak terbebani kuota bandwidth server.
   - Impor YouTube langsung via `yt-dlp` tidak tersedia di runtime serverless; pengguna di web online cukup mengunggah file `.mp4` / `.webm` / `.mov` lokal seperti biasa.
   - Jika Anda memakai paket **Vercel Hobby** yang membatasi `maxDuration`, Anda dapat menyesuaikan nilai `functions["api/index.ts"].maxDuration` di `vercel.json` sesuai kuota paket akun Vercel Anda.
