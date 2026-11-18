# Arsitektur Auto Clipper

## Kondisi sekarang

Ini aplikasi lokal tanpa framework/build step. `Jalankan-Aplikasi.bat` memulai `whisper-local/server.js`, yang menyajikan aplikasi di `http://127.0.0.1:8767`. Server membatasi file yang bisa diakses melalui daftar `pages`.

`main.js` menjalankan jendela Electron dan menyediakan `preload.js` untuk menyimpan Gemini API key melalui Electron `safeStorage`, serta membuka situs resmi Google Flow di browser default melalui URL tetap. Login Google Flow dilakukan manual di browser; aplikasi tidak membaca sesi login. Server lokal menyediakan `/api/ai-video/text` dan `/api/ai-video/image` sebagai proxy Gemini serta `/api/voice-studio/*` sebagai proxy ke VoiceStudio lokal (`127.0.0.1:3900`).

`Auto-Vertical-Fix.html` masih berisi HTML/CSS, UI state, serta sebagian besar JavaScript aplikasi dalam satu berkas. Whisper menggunakan `whisper-local/main.js` dan `libmain.wasm`; helper `loadRemote()` berada di `whisper-local/helpers.js`. Model transkripsi diunduh dari Hugging Face dan disimpan di browser. Mode podcast memuat MediaPipe Face Landmarker dari internet saat dipakai pertama kali.

## Peta tanggung jawab kode saat ini

| Area | Elemen/fungsi saat ini | Tanggung jawab |
|---|---|---|
| UI dan state | markup, `choose`, `setProgress`, `status` | Input video, pilihan model/mode, daftar klip, pesan/progres |
| Transkripsi dan impor subtitle | `ensureWhisperModel`, `transcribeAndAnalyze`, `printWhisper`, `parseSubs`, `useImportedSubtitles` | Memakai SRT/VTT lokal bila tersedia; pilihan model Whisper multibahasa/English-only dan bahasa tersedia setelah video dimuat, sebelum transkripsi; menghasilkan cues bertimecode secara lokal |
| Pemilihan klip | `parseSubs`, `analyzeCues` | Menyusun kandidat sesuai rentang durasi dan batas jumlah yang dipilih pengguna, dengan alasan berbasis transkrip |
| Crop dan pembicara | `draw`, `detectMotion`, `detectPodcastSpeaker`, `ensureFaceLandmarker` | Bingkai 9:16, fokus gerakan/wajah |
| Subtitle dan preview | `drawCaption`, `configurePreview`, `previewLoop` | Subtitle karaoke, playback preview, seek dan pilihan klip |
| Ekspor | `supportedMime`, `seekTo`, `renderNext`, `exportFrameLoop` | Rekam kanvas per klip menjadi WebM dan sediakan unduhan |
| Server lokal | `whisper-local/server.js` | Sajikan hanya rute eksplisit dengan header cross-origin isolation untuk WASM |
| Pembuatan video AI | `ai-pipeline/TextGenerator.js`, `ImageCreator.js`, `VoiceRecorder.js` | Naskah dan gambar menggunakan Gemini bila pengguna memilihnya; suara memakai API VoiceStudio lokal; renderer video tetap di perangkat |
| Rahasia Gemini | `main.js`, `preload.js` | Simpan kunci melalui Electron safeStorage dan IPC terbatas |

Untuk Video AI berdurasi panjang, `/api/ai-video/text` menerima `durationMinutes` bernilai 10 atau 15, lalu meminta tepat 40 atau 60 adegan (15 detik per adegan) dengan sedikitnya 120 kata narasi per menit. `VideoEditor.buildTimeline()` memakai durasi adegan sebagai batas minimum untuk tiap segmen. Mode Flow manual hanya menyiapkan prompt dan frame lokal; pengguna login ke situs Flow, mengunduh gambar, lalu mengimpornya per adegan. `main.js` hanya membuka domain Flow resmi yang tetap, dan server tidak memiliki rute Google Flow atau useapi.net.

## Kontrak data yang dipakai

```js
// Cue subtitle (hasil normalisasi Whisper atau impor subtitle di masa depan)
{ start: Number, end: Number, text: String }

// Kandidat klip yang saat ini dibuat analyzeCues()
{
  start: Number,
  end: Number,
  title: String,
  reasons: String[],
  quote: String
}
```

Pertahankan bentuk ini saat menambah implementasi lain, atau buat adapter/migrasi terencana. UI dan ekspor mengandalkan nilai detik untuk `start`/`end`.

## Batasan produk yang perlu diketahui

- Pemilihan momen belum memakai model bahasa atau penilaian semantik; `analyzeCues()` adalah heuristik lokal. Karena itu kualitas kandidat bisa kurang bagus dan alasan klip berasal dari aturan kode.
- Whisper di browser memakai CPU pada konfigurasi yang dilihat di sesi sebelumnya; transkrip video 10 menit dapat memerlukan waktu lama. Status progres dihitung dari timestamp audio, bukan persentase kerja internal Whisper.
- Whisper memberi timing per segmen/frasa, bukan timing fonem/kata yang presisi. Sorotan karaoke membagi durasi frasa sebagai perkiraan.
- Peralihan pembicara memakai gerak mulut/landmark wajah sebagai pendekatan, bukan diarization audio.
- Ekspor saat ini bergantung pada `MediaRecorder` browser dan menghasilkan WebM pada tipe MIME yang didukung, bukan jaminan MP4.
- Aplikasi memerlukan internet untuk unduhan model pertama kali dan pemuatan MediaPipe pertama kali. Pemrosesan media lokal.
- Pipeline Gemini hanya mengirim topik/naskah adegan yang diminta pengguna dan prompt gambar; tidak mengirim video/audio/subtitle sumber. Fitur ini butuh API key Google dan koneksi internet.
- VoiceStudio harus berjalan lokal pada port 3900. Impor sampel suara memerlukan centang izin pengguna dan mengirim MP3 sampel ke VoiceStudio lokal untuk membuat profil; teks narasi juga dikirim ke API lokal tersebut.

## Arah pemisahan modul

Pemisahan dapat dilakukan bertahap tanpa framework:

```text
src/
  app.js                 # wiring UI dan alur kerja
  state.js               # state sesi dan pembatalan job
  transcription/
    whisper-wasm.js      # adapter engine Whisper
    providers.js         # kontrak provider transkripsi + registrasi
  clips/
    heuristic-selector.js
    providers.js         # kontrak pemilih klip + registrasi
  video/
    crop.js
    podcast-tracking.js
    renderer.js
  subtitles/
    parse.js
    karaoke.js
  export/
    recorder.js
  ui/
    progress.js
    preview.js
    clip-list.js
```

Jangan pindahkan seluruh kode sekaligus. Mulai dari fungsi murni (`parseSubs`, `analyzeCues`, formatter timecode), lalu adapter engine, baru renderer/ekspor. Selama transisi, UI lama tetap bisa menjadi entry point.

## Menambah beberapa engine/model AI

Provider adalah adapter dengan input/output seragam. UI tidak boleh mengetahui rincian vendor/model. Provider berjalan lokal menjadi pilihan bawaan; provider cloud harus dinonaktifkan secara default, menjelaskan data yang dikirim, dan meminta persetujuan sebelum mengirim audio atau transkrip.

```js
// Kontrak transcriber yang disarankan
{
  id: 'whisper-wasm',
  label: 'Whisper lokal',
  models: [{ id: 'tiny-q5_1', label: 'Tiny cepat' }],
  async transcribe({ file, model, language, signal, onProgress }) {
    // return Array<{ start, end, text }>
  }
}

// Kontrak clip selector yang disarankan
{
  id: 'local-heuristic',
  label: 'Heuristik lokal',
  async select({ cues, minDuration, maxDuration, signal, onProgress }) {
    // return Array<{ start, end, title, reasons, quote }>
  }
}
```

Setiap provider AI tambahan harus mencantumkan kebutuhan jaringan, ukuran model, memori/kecepatan perkiraan, bahasa, format output, batas durasi, dan fallback. Rahasia API tidak boleh ditanam di HTML/browser; provider yang memerlukan API key butuh server proxy dan persetujuan desain privasi tersendiri.

## Menjalankan

Klik dua kali `Jalankan-Aplikasi.bat`, lalu gunakan halaman yang dibuka di browser. Jangan buka `file://` untuk alur transkripsi otomatis; aplikasi membutuhkan server lokal agar Whisper WASM berjalan dengan header yang sesuai.
