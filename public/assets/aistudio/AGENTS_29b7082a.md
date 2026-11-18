# Panduan pengembangan Auto Clipper

## Tujuan produk

Auto Clipper adalah aplikasi desktop-lokal berbasis browser untuk mengubah video panjang menjadi kandidat klip vertikal 1–1,5 menit. Audio/video pengguna tetap di perangkat. Whisper.cpp WebAssembly membuat transkrip lokal; logika saat ini memilih kandidat dari teks subtitle; kanvas menangani crop, subtitle, preview, dan ekspor.

## File utama

- `Auto-Vertical-Fix.html`: antarmuka, alur aplikasi, subtitle, deteksi pembicara, preview, pemilihan klip, dan ekspor. Implementasi saat ini masih satu berkas HTML dengan JavaScript inline.
- `whisper-local/`: mesin Whisper WASM, helper pemuatan model, dan server lokal.
- `Jalankan-Aplikasi.bat`: menjalankan server lokal dan membuka aplikasi.
- `ARCHITECTURE.md`: peta modul, batasan, rencana pemisahan kode, dan kontrak antarmodul.

## Batasan penting

- Jangan unggah video, audio, transkrip, atau model ke layanan eksternal. Unduhan model dan MediaPipe boleh memakai URL publik yang sudah dipakai aplikasi.
- Jangan menyebut pemilih klip sekarang sebagai AI semantik: `analyzeCues()` adalah heuristik berbasis subtitle. Usulan integrasi model LLM harus opsional, punya fallback lokal, dan tidak mengirim data tanpa persetujuan eksplisit pengguna.
- Pertahankan aplikasi yang bisa dijalankan lokal di Windows tanpa langganan hosting.
- Hindari mengubah isi `whisper-local/main.js` atau `whisper-local/libmain.wasm` kecuali tugas memang menyentuh mesin Whisper. Keduanya adalah aset upstream/biner.
- Jangan menghapus atau mengganti perilaku yang sudah ada tanpa memetakan dampaknya pada transkripsi, preview, subtitle, crop podcast, dan ekspor.
- Gunakan teks UI Bahasa Indonesia yang jelas. Pertahankan pemrosesan video pada sisi perangkat.

## Alur kerja

1. Baca `ARCHITECTURE.md` dan telusuri bagian yang akan diubah.
2. Buat perubahan sekecil mungkin dan jaga kompatibilitas launcher lokal.
3. Jika memindahkan fungsi keluar dari HTML, perbarui daftar file yang diizinkan di `whisper-local/server.js`; server saat ini hanya menyajikan path yang terdaftar.
4. Laporkan file yang berubah, cara menjalankan, dan pemeriksaan yang benar-benar dilakukan. Jangan klaim browser/render sudah diuji bila hanya pemeriksaan statis yang dilakukan.

## Kolaborasi beberapa AI

Setiap AI/kontributor sebaiknya mengambil satu area yang tidak tumpang tindih: transkripsi, pemilihan klip, preview/subtitle, crop podcast, atau ekspor. Sebelum mengedit, tulis kontrak input/output modulnya di `ARCHITECTURE.md`. Hindari dua kontributor mengubah blok fungsi yang sama secara bersamaan.
