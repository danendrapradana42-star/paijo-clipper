import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AiTheme } from '../src/types/clipper';

const execFileAsync = promisify(execFile);

export type LocalAiProvider =
  | 'local_auto'
  | 'local_builtin'
  | 'local_ollama'
  | 'local_openai'
  | 'gemini';

export interface GeneratedSceneItem {
  index: number;
  visualTitle: string;
  narration: string;
  captionText: string;
  imagePrompt: string;
  durationSec: number;
  timestampLabel: string;
}

export interface LocalBinaryStatus {
  available: boolean;
  command?: string;
  binaryName?: string;
  version?: string;
  optimized?: boolean;
  accelerators?: string[];
}

export interface LocalSystemBinaries {
  ffmpeg: LocalBinaryStatus;
  whisper: LocalBinaryStatus;
}

export interface LocalAiEngineStatus {
  builtinStory: { available: boolean; label: string };
  ollama: { available: boolean; endpoint: string; models: string[] };
  openaiLocal: { available: boolean; endpoint: string; models: string[] };
  cloudGemini: { available: boolean };
  binaries: LocalSystemBinaries;
}

function buildBinaryCandidates(names: string[], customPath?: string): string[] {
  const dirs = [
    process.env.PAIJO_EXE_DIR || '',
    process.env.PAIJO_USER_DATA || '',
    process.env.PAIJO_APP_ROOT || '',
    process.cwd(),
  ].filter(Boolean);

  const out: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (p: string) => {
    const trimmed = String(p || '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(trimmed);
    }
  };

  const cleanCustom = String(customPath || '').trim().replace(/^["']|["']$/g, '');
  if (cleanCustom) {
    addCandidate(cleanCustom);
    // Also support passing a directory containing the binary
    for (const name of names) {
      const exeName = process.platform === 'win32' && !name.endsWith('.exe') ? `${name}.exe` : name;
      addCandidate(path.join(cleanCustom, exeName));
      if (exeName !== name) {
        addCandidate(path.join(cleanCustom, name));
      }
    }
  }

  for (const dir of dirs) {
    for (const name of names) {
      const exeName = process.platform === 'win32' && !name.endsWith('.exe') ? `${name}.exe` : name;
      addCandidate(path.join(dir, exeName));
      addCandidate(path.join(dir, 'bin', exeName));
    }
  }
  for (const name of names) {
    if (process.platform === 'win32' && !name.endsWith('.exe')) {
      addCandidate(`${name}.exe`);
    }
    addCandidate(name);
  }
  return out;
}

async function probeFfmpegBinary(customPath?: string): Promise<LocalBinaryStatus> {
  if (process.env.VERCEL) {
    return { available: false, optimized: false, accelerators: [] };
  }
  const candidates = buildBinaryCandidates(['ffmpeg'], customPath);
  for (const cmd of candidates) {
    const isPathCandidate = path.isAbsolute(cmd) || cmd.includes(path.sep) || cmd.includes('/');
    if (isPathCandidate) {
      try {
        if (!fs.existsSync(cmd) || !fs.statSync(cmd).isFile()) continue;
      } catch {
        continue;
      }
    }
    try {
      const { stdout } = await execFileAsync(cmd, ['-version'], { timeout: 1400 });
      const firstLine = String(stdout || '').split(/\r?\n/)[0] || '';
      const verMatch = /ffmpeg version\s+([^\s]+)/i.exec(firstLine);
      const version = verMatch ? verMatch[1] : undefined;

      let accelerators: string[] = [];
      try {
        const hw = await execFileAsync(cmd, ['-hide_banner', '-hwaccels'], { timeout: 1200 });
        accelerators = String(hw.stdout || '')
          .split(/\r?\n/)
          .map((l) => l.trim().toLowerCase())
          .filter((l) => l && !l.includes('hardware acceleration methods'));
      } catch {
        accelerators = [];
      }

      const hwAccelPriority = ['cuda', 'nvenc', 'qsv', 'd3d11va', 'dxva2', 'videotoolbox', 'vaapi', 'vulkan'];
      const hasHw = accelerators.some((a) => hwAccelPriority.includes(a));
      const hasSimd = /--enable-(avx|sse|libx264|libvpx|gpl)/i.test(stdout || '');

      return {
        available: true,
        binaryName: path.basename(cmd),
        command: cmd,
        version,
        optimized: hasHw || hasSimd,
        accelerators: accelerators.slice(0, 8),
      };
    } catch {
      // try next candidate
    }
  }
  return { available: false, optimized: false, accelerators: [] };
}

async function probeWhisperBinary(customPath?: string): Promise<LocalBinaryStatus> {
  if (process.env.VERCEL) {
    return { available: false };
  }
  const names = ['whisper-cli', 'whisper-cpp', 'whisper', 'faster-whisper'];
  const candidates = buildBinaryCandidates(names, customPath);
  for (const cmd of candidates) {
    const isPathCandidate = path.isAbsolute(cmd) || cmd.includes(path.sep) || cmd.includes('/');
    if (isPathCandidate) {
      try {
        if (!fs.existsSync(cmd) || !fs.statSync(cmd).isFile()) continue;
      } catch {
        continue;
      }
    }
    for (const flag of ['--version', '-h']) {
      try {
        const { stdout, stderr } = await execFileAsync(cmd, [flag], { timeout: 1400 });
        const output = `${stdout || ''}\n${stderr || ''}`.trim();
        const verMatch = /(\d+\.\d+(?:\.\d+)?)/.exec(output);
        return {
          available: true,
          binaryName: path.basename(cmd),
          command: cmd,
          version: verMatch ? verMatch[1] : undefined,
          optimized: /whisper-cli|whisper-cpp|faster-whisper/i.test(cmd) || /cuda|gpu|cublas|metal|avx/i.test(output),
        };
      } catch {
        // try next flag / candidate
      }
    }
  }
  return { available: false };
}

let binariesCache: { key: string; expiresAt: number; data: LocalSystemBinaries } | null = null;

export async function probeSystemAiBinaries(
  options: boolean | { forceRefresh?: boolean; ffmpegPath?: string; whisperPath?: string } = false
): Promise<LocalSystemBinaries> {
  if (process.env.VERCEL) {
    return {
      ffmpeg: { available: false, optimized: false, accelerators: [] },
      whisper: { available: false },
    };
  }
  const opts = typeof options === 'boolean' ? { forceRefresh: options } : options;
  const ffmpegPath = String(opts.ffmpegPath || '').trim();
  const whisperPath = String(opts.whisperPath || '').trim();
  const cacheKey = `${ffmpegPath}|${whisperPath}`;

  if (!opts.forceRefresh && binariesCache && binariesCache.key === cacheKey && binariesCache.expiresAt > Date.now()) {
    return binariesCache.data;
  }
  const [ffmpeg, whisper] = await Promise.all([
    probeFfmpegBinary(ffmpegPath || undefined),
    probeWhisperBinary(whisperPath || undefined),
  ]);
  const data = { ffmpeg, whisper };
  binariesCache = { key: cacheKey, expiresAt: Date.now() + 60_000, data };
  return data;
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

async function fetchJsonWithTimeout<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${txt ? `: ${txt.slice(0, 140)}` : ''}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeLocalAiEngines(
  customOpenAiUrl?: string,
  options: boolean | { forceRefresh?: boolean; ffmpegPath?: string; whisperPath?: string } = false
): Promise<LocalAiEngineStatus> {
  const ollamaEndpoint = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const openAiCandidates = [
    customOpenAiUrl ? customOpenAiUrl.replace(/\/+$/, '') : '',
    process.env.LOCAL_OPENAI_URL ? process.env.LOCAL_OPENAI_URL.replace(/\/+$/, '') : '',
    'http://127.0.0.1:1234/v1',
    'http://127.0.0.1:8080/v1',
  ].filter(Boolean);

  const probeOllama = async () => {
    try {
      const data = await fetchJsonWithTimeout<{ models?: Array<{ name?: string; model?: string }> }>(
        `${ollamaEndpoint}/api/tags`,
        { method: 'GET' },
        900
      );
      const models = (data.models || [])
        .map((m) => String(m.name || m.model || '').trim())
        .filter(Boolean);
      return { available: true, models };
    } catch {
      return { available: false, models: [] as string[] };
    }
  };

  const probeOpenAi = async () => {
    for (const ep of openAiCandidates) {
      try {
        const cleanEp = ep.endsWith('/v1') ? ep : `${ep}/v1`;
        const data = await fetchJsonWithTimeout<{ data?: Array<{ id?: string }> }>(
          `${cleanEp}/models`,
          { method: 'GET' },
          900
        );
        const models = (data.data || []).map((m) => String(m.id || '').trim()).filter(Boolean);
        return { available: true, endpoint: cleanEp, models };
      } catch {
        // Try next candidate
      }
    }
    return {
      available: false,
      endpoint: openAiCandidates[0] || 'http://127.0.0.1:1234/v1',
      models: [] as string[],
    };
  };

  const [ollamaRes, openAiRes, binaries] = await Promise.all([
    probeOllama(),
    probeOpenAi(),
    probeSystemAiBinaries(options),
  ]);

  const cloudGemini = Boolean(
    process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
  );

  return {
    builtinStory: {
      available: true,
      label: 'Paijo Built-in Story AI (Offline)',
    },
    ollama: {
      available: ollamaRes.available,
      endpoint: ollamaEndpoint,
      models: ollamaRes.models,
    },
    openaiLocal: {
      available: openAiRes.available,
      endpoint: openAiRes.endpoint,
      models: openAiRes.models,
    },
    cloudGemini: { available: cloudGemini },
    binaries,
  };
}

function extractKeywords(prompt: string, maxWords = 4): string[] {
  const stop = new Set([
    'yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'dengan', 'pada', 'adalah', 'atau',
    'dalam', 'secara', 'tentang', 'cara', 'panduan', 'lengkap', 'membuat', 'membangun',
    'the', 'and', 'for', 'with', 'how', 'to', 'guide', 'complete', 'about', 'from',
    'into', 'your', 'that', 'this', 'agar', 'serta', 'beserta', 'oleh',
  ]);
  const words = prompt
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !stop.has(w.toLowerCase()));
  const uniq: string[] = [];
  for (const w of words) {
    if (!uniq.some((u) => u.toLowerCase() === w.toLowerCase())) {
      uniq.push(w);
    }
    if (uniq.length >= maxWords) break;
  }
  return uniq;
}

function capitalizeTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Topik Pilihan';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

interface SceneBlueprint {
  title: string;
  narration: string;
  visualCue: string;
}

function buildIndonesianStoryActs(
  topic: string,
  shortTopic: string,
  kw: string[],
  videoType: string,
  theme: AiTheme
): SceneBlueprint[] {
  const k1 = kw[0] || shortTopic;
  const k2 = kw[1] || 'strategi inti';
  const k3 = kw[2] || 'konsistensi eksekusi';
  const k4 = kw[3] || 'evaluasi hasil';

  const moodCue =
    theme === 'tech'
      ? 'antarmuka futuristik bernuansa biru neon dan garis data presisi'
      : theme === 'editorial'
        ? 'tipografi majalah modern berlatar gelap kontras tinggi'
        : theme === 'minimal'
          ? 'komposisi minimalis bersih dengan fokus ruang negatif'
          : 'pencahayaan sinematik dramatis dengan kedalaman ruang tajam';

  if (videoType === 'finance') {
    return [
      {
        title: `Realita Pahit Soal ${capitalizeTitle(k1)}`,
        narration: `Banyak orang merasa penghasilan mereka selalu habis tanpa jejak setiap akhir bulan. Padahal masalah utamanya sering kali bukan soal besar kecilnya pemasukan, melainkan cara kita menata ${topic} sejak hari pertama menerima uang.`,
        visualCue: `Grafik arus kas menurun berubah menjadi sorotan angka kunci, ${moodCue}`,
      },
      {
        title: 'Kenapa Kebiasaan Lama Menghambat',
        narration: `Selama pola pikir lama masih dipertahankan, kenaikan gaji hanya akan diikuti kenaikan gaya hidup. Sebelum melangkah lebih jauh ke teknik ${k2}, kita perlu membongkar jebakan pengeluaran impulsif yang terlihat kecil tetapi menggerogoti tabungan.`,
        visualCue: `Ilustrasi kebocoran anggaran harian secara visual, ${moodCue}`,
      },
      {
        title: 'Peta Jalan Finansial Dari Nol',
        narration: `Hari ini kita akan membedah kerangka praktis mengenai ${topic} dalam langkah yang terukur. Tidak perlu modal besar atau rumus rumit, karena yang paling menentukan adalah sistem otomatis yang bekerja bahkan saat Anda sibuk.`,
        visualCue: `Diagram alur 4 pilar pengelolaan dana pribadi, ${moodCue}`,
      },
      {
        title: 'Langkah 1: Audit Arus Kas 7 Hari',
        narration: `Mulailah dengan mencatat setiap rupiah yang keluar selama satu minggu penuh. Anda akan terkejut melihat berapa persen dana yang lari ke pos tidak prioritas dibandingkan kebutuhan pokok dan pengembangan ${k1}.`,
        visualCue: `Tampilan daftar kategori pengeluaran dengan persentase, ${moodCue}`,
      },
      {
        title: 'Rumus Alokasi Yang Realistis',
        narration: `Lupakan rasio kaku yang sulit dijalankan di dunia nyata. Gunakan pembagian fleksibel antara kebutuhan hidup, dana darurat, dan porsi ${k2} yang langsung dipisahkan di rekening berbeda begitu gaji masuk.`,
        visualCue: `Tiga kantong alokasi dana beranimasi rapi, ${moodCue}`,
      },
      {
        title: 'Membangun Benteng Dana Darurat',
        narration: `Sebelum mengejar imbal hasil tinggi, pastikan Anda punya penyangga minimal tiga bulan biaya hidup. Dana darurat menjaga rencana ${topic} Anda tetap aman ketika ada kebutuhan mendadak tanpa harus berutang konsumtif.`,
        visualCue: `Perisai pelindung di atas ilustrasi tabungan stabil, ${moodCue}`,
      },
      {
        title: 'Studi Kasus: Gaji Pas-Pasan',
        narration: `Bayangkan seseorang dengan pendapatan setara upah minimum kota besar. Dengan memangkas langganan pasif dan menerapkan aturan tunggu dua puluh empat jam sebelum belanja, ia berhasil menyisihkan dua belas persen pendapatan secara rutin.`,
        visualCue: `Simulasi pertumbuhan saldo bulanan dari nol, ${moodCue}`,
      },
      {
        title: 'Membedakan Aset Dan Kewajiban',
        narration: `Prinsip terpenting dalam ${k1} adalah memahami apa yang menambah arus kas masuk dan apa yang diam-diam menyedot biaya perawatan. Keputusan pembelian besar selalu dinilai dari dampaknya lima tahun ke depan.`,
        visualCue: `Perbandingan neraca aset produktif vs beban cicilan, ${moodCue}`,
      },
      {
        title: 'Automasi Sebelum Mengeluarkan Uang',
        narration: `Jangan menunggu sisa uang di akhir bulan untuk berinvestasi pada ${k3}. Atur transfer otomatis tepat satu hari setelah tanggal gajian agar disiplin terbentuk oleh sistem, bukan mengandalkan motivasi sesaat.`,
        visualCue: `Roda gigi sistem transfer otomatis terhubung ke portofolio, ${moodCue}`,
      },
      {
        title: 'Mengelola Utang Secara Cerdas',
        narration: `Jika masih ada cicilan berbunga tinggi, prioritaskan metode pelunasan terstruktur dari bunga terbesar atau saldo terkecil. Setiap utang yang lunas langsung membebaskan arus kas untuk mempercepat target ${topic}.`,
        visualCue: `Grafik penurunan beban cicilan berjenjang, ${moodCue}`,
      },
      {
        title: 'Meningkatkan Nilai Keterampilan Diri',
        narration: `Berhemat punya batas bawah, sedangkan meningkatkan kapasitas penghasilan tidak punya batas atas. Sisihkan sebagian anggaran belajar untuk mengasah keahlian yang relevan dengan industri dan memperkuat ${k4}.`,
        visualCue: `Tangga peningkatan kompetensi dan pendapatan, ${moodCue}`,
      },
      {
        title: 'Menghindari Efek FOMO Investasi',
        narration: `Banyak pemula kehilangan hasil kerja keras bertahun-tahun karena tergoda janji keuntungan instan. Selalu pahami instrumen yang Anda pilih, cek profil risikonya, dan sesuaikan dengan jangka waktu tujuan finansial Anda.`,
        visualCue: `Peringatan grafik volatilitas ekstrem vs pertumbuhan stabil, ${moodCue}`,
      },
      {
        title: 'Kekuatan Efek Majemuk Jangka Panjang',
        narration: `Perubahan kecil yang dilakukan konsisten jauh lebih dahsyat daripada langkah besar yang cuma bertahan dua minggu. Ketika imbal hasil ikut menghasilkan nilai baru, kurva pertumbuhan akan menanjak tajam di tahun kelima dan seterusnya.`,
        visualCue: `Kurva eksponensial jangka panjang berwarna kontras, ${moodCue}`,
      },
      {
        title: 'Review Bulanan Dalam 15 Menit',
        narration: `Luangkan waktu singkat di akhir bulan untuk meninjau progres ${topic}. Cek pos mana yang melebihi batas, rayakan target kecil yang tercapai, lalu sesuaikan rencana bulan berikutnya tanpa menyalahkan diri sendiri.`,
        visualCue: `Checklist evaluasi bulanan yang terstruktur, ${moodCue}`,
      },
      {
        title: 'Menjaga Keseimbangan Hidup',
        narration: `Tujuan mengatur keuangan bukanlah hidup serba kekurangan, melainkan membeli ketenangan pikiran dan kebebasan memilih. Sisakan ruang anggaran hiburan yang sehat agar perjalanan ${k1} terasa menyenangkan dan berkelanjutan.`,
        visualCue: `Ilustrasi keseimbangan kerja, tabungan, dan waktu santai, ${moodCue}`,
      },
      {
        title: 'Kesalahan Umum Saat Pendapatan Naik',
        narration: `Saat bonus atau kenaikan gaji datang, tahan keinginan langsung mengganti gaya hidup. Arahkan minimal setengah dari tambahan pendapatan tersebut untuk mempertebal aset agar kebebasan finansial makin cepat tercapai.`,
        visualCue: `Pembagian cerdas dana bonus tahunan, ${moodCue}`,
      },
      {
        title: 'Rencana Aksi Minggu Pertama',
        narration: `Agar materi ini tidak berhenti sebagai wawasan, lakukan tiga hal hari ini: pisahkan rekening tabungan, catat seluruh tagihan rutin, dan tentukan satu target ${k2} yang realistis dalam sembilan puluh hari ke depan.`,
        visualCue: `Tiga kartu aksi langsung untuk minggu pertama, ${moodCue}`,
      },
      {
        title: 'Komitmen Jangka Panjang Anda',
        narration: `Keberhasilan dalam ${topic} dibangun dari keputusan harian yang tampak sederhana. Mulai dari nominal yang sanggup Anda jaga hari ini, evaluasi tiap bulan, dan biarkan waktu bekerja memihak kepada konsistensi Anda.`,
        visualCue: `Penutup inspiratif dengan ringkasan poin utama, ${moodCue}`,
      },
    ];
  }

  if (videoType === 'prehistoric') {
    return [
      {
        title: `Misteri Di Balik ${capitalizeTitle(shortTopic)}`,
        narration: `Pernahkah Anda membayangkan bagaimana peristiwa besar dalam ${topic} mengubah arah sejarah manusia hingga hari ini? Di balik catatan buku pelajaran, tersimpan detail menakjubkan yang jarang diceritakan secara utuh.`,
        visualCue: `Siluet arsip sejarah dengan cahaya dramatis menembus kabut waktu, ${moodCue}`,
      },
      {
        title: 'Jejak Awal Yang Terlupakan',
        narration: `Semua berawal dari kondisi sosial dan geografi yang sangat berbeda dengan zaman modern. Para peneliti menemukan bahwa faktor ${k1} memainkan peran jauh lebih besar daripada yang selama ini diperkirakan.`,
        visualCue: `Peta kuno dan artefak penanda era awal, ${moodCue}`,
      },
      {
        title: 'Titik Balik Sebelum Krisis',
        narration: `Selama puluhan tahun ketegangan terus menumpuk di bawah permukaan. Keputusan kecil para tokoh kunci saat menghadapi kelangkaan dan perubahan ${k2} menjadi pemicu rangkaian peristiwa tak terduga.`,
        visualCue: `Garis waktu kronologis dengan penanda momen kritis, ${moodCue}`,
      },
      {
        title: 'Fakta Lapangan Dan Bukti Nyata',
        narration: `Catatan arsip kontemporer memperlihatkan betapa cepat situasi berubah ketika ${topic} memasuki fase puncaknya. Masyarakat saat itu harus beradaptasi dalam hitungan hari menghadapi tatanan baru.`,
        visualCue: `Rekonstruksi adegan sejarah berlatar arsitektur era tersebut, ${moodCue}`,
      },
      {
        title: 'Peran Tokoh Di Balik Layar',
        narration: `Bukan hanya pemimpin terkenal yang menentukan hasil akhir. Jaringan komunikasi, pengrajin, dan pemikir lokal turut menggerakkan roda perubahan melalui inovasi sederhana pada ${k3}.`,
        visualCue: `Potret siluet tokoh penggerak sejarah yang saling terhubung, ${moodCue}`,
      },
      {
        title: 'Mitos Populer Vs Realita Sejarah',
        narration: `Banyak kisah populer menyederhanakan fakta menjadi hitam dan putih. Padahal bukti arkeologis dan dokumen resmi menunjukkan dinamika negosiasi, kompromi, dan ketahanan luar biasa di tengah keterbatasan.`,
        visualCue: `Layar terbelah membandingkan mitos populer dan bukti dokumen, ${moodCue}`,
      },
      {
        title: 'Dampak Ekonomi Dan Budaya',
        narration: `Gelombang perubahan akibat ${topic} segera merembet ke jalur perdagangan, bahasa, hingga kebiasaan sehari-hari. Tradisi lama bercampur dengan gagasan baru membentuk warisan budaya yang bertahan berabad-abad.`,
        visualCue: `Rute jalur dagang dan pertukaran budaya antarkota, ${moodCue}`,
      },
      {
        title: 'Pelajaran Besar Untuk Era Modern',
        narration: `Ketika kita menengok kembali pola sejarah tersebut, tampak jelas bahwa ketangguhan sebuah peradaban selalu bertumpu pada kemampuan belajar dari krisis dan menjaga ${k4} untuk generasi berikutnya.`,
        visualCue: `Transisi visual dari masa lampau menuju lanskap kota modern, ${moodCue}`,
      },
    ];
  }

  if (videoType === 'pov') {
    return [
      {
        title: `Hari Pertama Memulai ${capitalizeTitle(shortTopic)}`,
        narration: `Bayangkan Anda terbangun di pagi hari dan memutuskan tidak lagi menunda perjalanan ${topic}. Rasanya campur aduk antara ragu dan bersemangat, karena langkah pertama selalu terlihat paling berat sebelum dijalani.`,
        visualCue: `Sudut pandang orang pertama menatap layar kerja di pagi hari, ${moodCue}`,
      },
      {
        title: 'Saat Keraguan Mulai Datang',
        narration: `Di minggu pertama, hampir semua terasa membingungkan. Anda membandingkan progres diri sendiri dengan orang lain yang sudah jauh di depan dalam hal ${k1}, hingga hampir menyerah di tengah jalan.`,
        visualCue: `Suasana ruangan sunyi dengan catatan kecil penuh coretan evaluasi, ${moodCue}`,
      },
      {
        title: 'Momen Mengubah Cara Pandang',
        narration: `Titik baliknya muncul saat Anda berhenti mengejar hasil instan dan mulai fokus membenahi satu kebiasaan harian terkait ${k2}. Dari situ beban terasa jauh lebih ringan dan arah langkah mulai terlihat jelas.`,
        visualCue: `Meja rapi dengan satu target prioritas yang dilingkari terang, ${moodCue}`,
      },
      {
        title: 'Tantangan Tak Terduga Di Minggu Ketiga',
        narration: `Tentu perjalanan ${topic} tidak selalu mulus. Ada hari ketika rencana berantakan dan energi habis. Bedanya, kali ini Anda memilih beristirahat sejenak lalu kembali melanjutkan ${k3} keesokan paginya.`,
        visualCue: `Kalender progres dengan tanda centang yang tetap berlanjut, ${moodCue}`,
      },
      {
        title: 'Hasil Kecil Yang Mengubah Segalanya',
        narration: `Memasuki bulan kedua, perubahan mulai terasa nyata dari hal-hal sederhana. Apa yang dulu terasa rumit kini berjalan otomatis, dan orang-orang terdekat mulai melihat dampak positif dari komitmen Anda pada ${k4}.`,
        visualCue: `Kilas balik perubahan dari hari pertama hingga progres stabil, ${moodCue}`,
      },
      {
        title: 'Pesan Untuk Diri Sendiri Hari Ini',
        narration: `Jika saat ini Anda berada di garis start ${topic}, percayalah bahwa Anda tidak harus sempurna untuk memulai. Cukup jalani satu langkah kecil hari ini, lalu ulangi besok hingga menjadi bagian dari diri Anda.`,
        visualCue: `Langkah kaki menuju cahaya pagi dengan teks pengingat utama, ${moodCue}`,
      },
    ];
  }

  // General Educational / Storytelling high-retention acts
  return [
    {
      title: `Hook: Kenapa ${capitalizeTitle(shortTopic)} Penting`,
      narration: `Pernahkah Anda merasa sudah berusaha keras mempelajari ${topic}, tetapi hasilnya tetap jalan di tempat? Ternyata sembilan dari sepuluh pemula melewatkan satu fondasi penting sebelum mulai praktik.`,
      visualCue: `Visual pembuka kontras tajam menyorot inti topik, ${moodCue}`,
    },
    {
      title: 'Kesalahpahaman Terbesar Pemula',
      narration: `Banyak orang mengira keberhasilan di bidang ${k1} hanya ditentukan oleh bakat atau alat mahal. Faktanya, pemahaman alur kerja yang benar jauh lebih menentukan daripada seberapa canggih perlengkapan yang dipakai.`,
      visualCue: `Perbandingan mitos vs fakta dengan tipografi tegas, ${moodCue}`,
    },
    {
      title: 'Peta Besar Materi Hari Ini',
      narration: `Dalam beberapa menit ke depan kita akan membahas ${topic} secara runtut dari dasar, studi kasus nyata, kesalahan yang sering menjebak, sampai langkah konkret yang bisa langsung Anda tiru hari ini.`,
      visualCue: `Peta jalur belajar 5 tahap yang tersusun vertikal, ${moodCue}`,
    },
    {
      title: `Memahami Akar Konsep ${capitalizeTitle(k1)}`,
      narration: `Sebelum masuk ke teknik lanjutan, pahami dulu prinsip dasar mengapa ${k1} bekerja seperti itu. Begitu Anda paham logikanya, Anda tidak perlu lagi menghafal cara karena bisa menyesuaikan dengan situasi apa pun.`,
      visualCue: `Diagram konsep sederhana dengan panah hubungan sebab akibat, ${moodCue}`,
    },
    {
      title: `Pilar Pertama: Menata ${capitalizeTitle(k2)}`,
      narration: `Langkah awal yang paling berdampak adalah merapikan ${k2}. Buat standar sederhana yang mudah diulang setiap hari, karena sistem yang sederhana akan selalu mengalahkan rencana rumit yang tidak pernah dijalankan.`,
      visualCue: `Blok fondasi bertumpuk stabil dengan ikon checklist, ${moodCue}`,
    },
    {
      title: 'Cara Memulai Tanpa Overthinking',
      narration: `Musuh terbesar saat memulai ${topic} bukanlah kurangnya informasi, melainkan menumpuk teori tanpa eksekusi. Terapkan aturan dua puluh menit pertama: kerjakan versi paling sederhana hari ini juga.`,
      visualCue: `Stopwatch 20 menit dan catatan aksi pertama yang ringkas, ${moodCue}`,
    },
    {
      title: `Pilar Kedua: Strategi ${capitalizeTitle(k3)}`,
      narration: `Setelah fondasi terbentuk, barulah kita optimalkan ${k3}. Di tahap ini fokus utama Anda adalah menjaga kualitas tetap stabil sambil memangkas langkah yang tidak memberi nilai tambah nyata.`,
      visualCue: `Ilustrasi penyaringan langkah efektif vs langkah pemborosan, ${moodCue}`,
    },
    {
      title: 'Studi Kasus Nyata Di Lapangan',
      narration: `Mari lihat contoh penerapan ${topic} di kondisi sehari-hari. Seseorang yang awalnya kewalahan membagi waktu berhasil meraih progres terukur dalam tiga puluh hari hanya dengan mengubah urutan prioritasnya.`,
      visualCue: `Kartu studi kasus sebelum dan sesudah perbaikan alur, ${moodCue}`,
    },
    {
      title: 'Memecah Target Besar Jadi Harian',
      narration: `Target besar sering membuat mental kewalahan di awal. Pecahlah tujuan utama menjadi target harian berdurasi singkat sehingga otak Anda selalu merasakan kemenangan kecil setiap kali satu tugas selesai.`,
      visualCue: `Tangga progres beranak tangga kecil yang mudah didaki, ${moodCue}`,
    },
    {
      title: 'Mengenali Sinyal Penurunan Kualitas',
      narration: `Saat menjalankan ${k1}, perhatikan tanda awal ketika hasil mulai stagnan. Biasanya itu bukan berarti Anda gagal, melainkan sinyal bahwa metode lama perlu disesuaikan dengan tantangan tahap berikutnya.`,
      visualCue: `Indikator radar sinyal evaluasi dan penyesuaian cepat, ${moodCue}`,
    },
    {
      title: 'Jebakan Umum Yang Harus Dihindari',
      narration: `Hindari kebiasaan sering berganti metode sebelum memberi waktu cukup bagi sebuah sistem bekerja. Beri diri Anda minimal empat minggu pengujian jujur sebelum memutuskan mengganti strategi ${topic}.`,
      visualCue: `Tanda rambu peringatan jalur memutar vs jalur fokus lurus, ${moodCue}`,
    },
    {
      title: `Optimasi Berbasis ${capitalizeTitle(k4)}`,
      narration: `Data kecil jauh lebih berharga daripada asumsi besar. Catat apa yang bekerja dan apa yang gagal dalam penerapan ${k4}, lalu gandakan porsi aktivitas yang terbukti memberi dampak paling besar.`,
      visualCue: `Dasbor metrik sederhana menyorot 20% aktivitas paling berdampak, ${moodCue}`,
    },
    {
      title: 'Membangun Lingkungan Yang Mendukung',
      narration: `Disiplin tidak hanya soal kekuatan tekad. Atur lingkungan kerja, alat bantu, serta pengingat rutin di sekitar Anda agar menjalankan kebiasaan baik terkait ${topic} terasa jauh lebih mudah.`,
      visualCue: `Meja kerja teratur bebas gangguan visual, ${moodCue}`,
    },
    {
      title: 'Checklist Implementasi 7 Hari',
      narration: `Untuk seminggu pertama, tetapkan tiga fokus saja: siapkan alat utama, jadwalkan jam eksekusi tetap setiap hari, dan lakukan tinjauan singkat di akhir minggu untuk melihat perkembangan nyata Anda.`,
      visualCue: `Kalender 7 hari dengan target harian yang terisi bertahap, ${moodCue}`,
    },
    {
      title: 'Penutup & Langkah Selanjutnya',
      narration: `Sekarang Anda sudah memiliki gambaran lengkap tentang ${topic}. Jangan tunggu waktu sempurna—ambil langkah pertama hari ini, simpan catatan ini sebagai panduan, dan buktikan progresnya dalam satu bulan ke depan.`,
      visualCue: `Ringkasan 3 poin utama dan ajakan aksi di layar penutup, ${moodCue}`,
    },
  ];
}

function buildEnglishStoryActs(
  topic: string,
  shortTopic: string,
  kw: string[],
  videoType: string,
  theme: AiTheme
): SceneBlueprint[] {
  const k1 = kw[0] || shortTopic;
  const k2 = kw[1] || 'core strategy';
  const k3 = kw[2] || 'daily execution';
  const k4 = kw[3] || 'continuous review';

  const moodCue =
    theme === 'tech'
      ? 'futuristic blue neon interface with crisp data lines'
      : theme === 'editorial'
        ? 'high-contrast editorial typography on dark canvas'
        : theme === 'minimal'
          ? 'clean minimalist composition with focused negative space'
          : 'dramatic cinematic lighting with shallow depth of field';

  const roleNote =
    videoType === 'finance'
      ? 'financial decision and compounding leverage'
      : videoType === 'prehistoric'
        ? 'historical turning point and primary evidence'
        : videoType === 'pov'
          ? 'first-person daily transformation'
          : 'practical mastery and real execution';

  return [
    {
      title: `The Truth About ${capitalizeTitle(shortTopic)}`,
      narration: `Most people spend months consuming advice about ${topic} yet see almost zero real progress. The hidden bottleneck is rarely a lack of effort—it is starting in the wrong order without a clear ${roleNote}.`,
      visualCue: `Sharp opening visual spotlighting the core challenge, ${moodCue}`,
    },
    {
      title: 'Why Common Advice Falls Short',
      narration: `Generic tips sound inspiring for five minutes, then break down under real schedules. Before optimizing ${k1}, you need to spot the hidden friction points that quietly drain momentum in week one.`,
      visualCue: `Split comparison between fragile habits and resilient systems, ${moodCue}`,
    },
    {
      title: 'The Complete Step-By-Step Map',
      narration: `Today we are walking through ${topic} from zero to reliable execution. Every stage builds directly on the previous one so you never feel stuck wondering what to do next.`,
      visualCue: `Vertical roadmap connecting core milestones cleanly, ${moodCue}`,
    },
    {
      title: `Foundation: Mastering ${capitalizeTitle(k1)}`,
      narration: `Everything starts with getting ${k1} right at small scale. Once you understand the underlying cause and effect, you can adapt quickly instead of copying rigid templates blindly.`,
      visualCue: `Clean structural diagram showing core cause and effect, ${moodCue}`,
    },
    {
      title: `Phase One: Simplifying ${capitalizeTitle(k2)}`,
      narration: `Complexity is the enemy of consistency. Strip ${k2} down to a repeatable fifteen-minute routine you can finish even on your busiest days without burning out.`,
      visualCue: `Minimal checklist highlighting one repeatable daily block, ${moodCue}`,
    },
    {
      title: 'Breaking Through Analysis Paralysis',
      narration: `Waiting for perfect tools or perfect timing keeps most people on the sidelines forever. Ship a simple draft version of ${topic} today, gather real feedback, and refine while moving forward.`,
      visualCue: `Timer ticking into focused action on clean workspace, ${moodCue}`,
    },
    {
      title: `Phase Two: Scaling ${capitalizeTitle(k3)}`,
      narration: `Once your baseline habit feels natural, shift focus toward ${k3}. Eliminate low-impact busywork and double down on the specific actions that drive measurable progress.`,
      visualCue: `Filter funnel turning scattered effort into focused output, ${moodCue}`,
    },
    {
      title: 'Real-World Case Study Breakdown',
      narration: `Look at how this plays out in practice. By changing the order of operations around ${topic} and tracking just two weekly numbers, consistent beginners outperform burnt-out perfectionists within thirty days.`,
      visualCue: `Before-and-after timeline chart showing steady compounding gains, ${moodCue}`,
    },
    {
      title: 'Avoiding The Mid-Journey Slump',
      narration: `Around week three, early excitement fades while results are still forming. Expect that dip ahead of time, keep sessions short, and rely on calendar cues rather than willpower alone.`,
      visualCue: `Steady progress line crossing the patience valley, ${moodCue}`,
    },
    {
      title: `Smart Feedback With ${capitalizeTitle(k4)}`,
      narration: `Small weekly reviews prevent months of wasted effort. Spend ten minutes every Sunday checking what worked in ${k4}, cut what stalled, and set one concrete adjustment for Monday.`,
      visualCue: `Clean metric scorecard highlighting top 20% levers, ${moodCue}`,
    },
    {
      title: 'Your 7-Day Action Checklist',
      narration: `Start with three steps this week: pick one daily anchor time, remove your biggest distraction, and track your streak for seven consecutive days. Small daily wins build unstoppable confidence.`,
      visualCue: `Seven-day action grid filling step by step, ${moodCue}`,
    },
    {
      title: 'Closing & Next Step Today',
      narration: `You now have the full blueprint for ${topic}. Do not let this stay another saved idea—take your first concrete step right after watching and watch consistency compound over the next month.`,
      visualCue: `Summary callout card with key takeaways, ${moodCue}`,
    },
  ];
}

function expandBlueprintsToTargetCount(
  base: SceneBlueprint[],
  targetScenes: number,
  topic: string,
  language: string,
  theme: AiTheme
): SceneBlueprint[] {
  if (base.length >= targetScenes) {
    return base.slice(0, targetScenes);
  }
  const isEn = language !== 'id';
  const result: SceneBlueprint[] = [];
  const totalBase = base.length;
  // Distribute base scenes and insert rich contextual deep-dive beats so every scene feels distinct
  let extraNeeded = targetScenes - totalBase;
  const phaseNotesId = [
    (t: string, n: number) => ({
      title: `Pendalaman #${n}: Detail Praktis`,
      narration: `Mari perjelas bagian teknis dari ${t} agar mudah langsung dipraktikkan. Perhatikan urutan pengerjaannya dari langkah ringan terlebih dahulu sebelum meningkatkan intensitas ke level berikutnya.`,
      visualCue: `Sorotan langkah teknis bernomor urut dengan kontras aksen tema ${theme}`,
    }),
    (t: string, n: number) => ({
      title: `Contoh Penerapan #${n}`,
      narration: `Dalam situasi nyata saat mengerjakan ${t}, kendala paling sering muncul ketika waktu terbatas. Kuncinya adalah menyiapkan daftar periksa singkat supaya keputusan penting tidak diambil secara terburu-buru.`,
      visualCue: `Simulasi skenario lapangan dengan poin keputusan utama`,
    }),
    (t: string, n: number) => ({
      title: `Tips Percepatan #${n}`,
      narration: `Satu trik sederhana untuk mempercepat progres ${t} adalah mengevaluasi hambatan kecil setiap tiga hari. Perbaikan lima persen di titik krusial akan terasa jauh lebih ringan dan berdampak jangka panjang.`,
      visualCue: `Grafik peningkatan bertahap dengan penanda optimasi 5%`,
    }),
  ];
  const phaseNotesEn = [
    (t: string, n: number) => ({
      title: `Deep Dive #${n}: Practical Breakdown`,
      narration: `Let us zoom in on the practical mechanics behind ${t}. Focus on sequencing the smallest high-leverage step first so momentum stays steady even when schedules get busy.`,
      visualCue: `Close-up numbered step layout styled in ${theme} theme`,
    }),
    (t: string, n: number) => ({
      title: `Real Scenario Check #${n}`,
      narration: `In real-world conditions around ${t}, unexpected friction usually hits when energy runs low. Keeping a concise two-minute checklist keeps execution accurate without second-guessing.`,
      visualCue: `Practical scenario card with concise decision cues`,
    }),
    (t: string, n: number) => ({
      title: `Momentum Tip #${n}`,
      narration: `One underrated shortcut in ${t} is fixing minor bottlenecks every few days instead of waiting for a major overhaul. Tiny course corrections save hours and protect long-term consistency.`,
      visualCue: `Incremental trend chart highlighting small compounding adjustments`,
    }),
  ];

  let extraSeq = 1;
  for (let i = 0; i < totalBase; i++) {
    result.push(base[i]);
    if (extraNeeded > 0 && i < totalBase - 1) {
      const remainingSlots = totalBase - 1 - i;
      const insertHere = Math.ceil(extraNeeded / remainingSlots);
      const count = Math.min(extraNeeded, Math.max(1, insertHere));
      for (let k = 0; k < count; k++) {
        const pool = isEn ? phaseNotesEn : phaseNotesId;
        const fn = pool[(extraSeq - 1) % pool.length];
        result.push(fn(topic, extraSeq));
        extraSeq++;
        extraNeeded--;
      }
    }
  }
  return result.slice(0, targetScenes);
}

export function generateBuiltinLocalScript(params: {
  prompt: string;
  targetScenes: number;
  targetTotalSec: number;
  language: string;
  visualTheme: AiTheme;
  videoType: string;
}): {
  title: string;
  summary: string;
  totalDurationSec: number;
  scenes: GeneratedSceneItem[];
  engineUsed: string;
} {
  const cleanPrompt = params.prompt.trim();
  const shortTopic = cleanPrompt.split(/[.,;:!?]/)[0].trim().slice(0, 64) || cleanPrompt.slice(0, 64);
  const kw = extractKeywords(cleanPrompt, 4);
  const lang = String(params.language || 'id').toLowerCase();

  const baseActs =
    lang === 'id'
      ? buildIndonesianStoryActs(cleanPrompt, shortTopic, kw, params.videoType, params.visualTheme)
      : buildEnglishStoryActs(cleanPrompt, shortTopic, kw, params.videoType, params.visualTheme);

  const expanded = expandBlueprintsToTargetCount(
    baseActs,
    params.targetScenes,
    shortTopic,
    lang,
    params.visualTheme
  );

  const perSceneSec = Math.max(11, Math.round((params.targetTotalSec / expanded.length) * 10) / 10);
  let cursor = 0;
  const scenes: GeneratedSceneItem[] = expanded.map((bp, idx) => {
    const startSec = cursor;
    const isLast = idx === expanded.length - 1;
    const dur = isLast
      ? Math.max(11, Math.round((params.targetTotalSec - startSec) * 10) / 10)
      : perSceneSec;
    const endSec = startSec + dur;
    cursor = endSec;
    return {
      index: idx,
      visualTitle: bp.title.slice(0, 72),
      narration: bp.narration.trim(),
      captionText: bp.narration.trim(),
      imagePrompt: bp.visualCue,
      durationSec: dur,
      timestampLabel: `${formatClock(startSec)} – ${formatClock(endSec)}`,
    };
  });

  const title =
    lang === 'id'
      ? `${capitalizeTitle(shortTopic)} — Panduan Lengkap`
      : `${capitalizeTitle(shortTopic)} — Complete Guide`;
  const summary =
    lang === 'id'
      ? `Video vertikal ${scenes.length} adegan yang membahas ${shortTopic} secara terstruktur menggunakan Built-in Local AI.`
      : `${scenes.length}-scene structured vertical video covering ${shortTopic} powered by Built-in Local AI.`;

  return {
    title,
    summary,
    totalDurationSec: cursor,
    scenes,
    engineUsed: 'builtin-local',
  };
}

function parseJsonFromLlmText(rawText: string): {
  title?: string;
  summary?: string;
  scenes?: Array<{ visualTitle?: string; narration?: string; imagePrompt?: string; durationSec?: number }>;
} {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const slice = firstBrace >= 0 && lastBrace > firstBrace ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned;
  return JSON.parse(slice);
}

function finalizeLocalLlmScenes(
  raw: {
    title?: string;
    summary?: string;
    scenes?: Array<{ visualTitle?: string; narration?: string; imagePrompt?: string; durationSec?: number }>;
  },
  fallbackPrompt: string,
  targetScenes: number,
  targetTotalSec: number,
  language: string,
  visualTheme: AiTheme,
  videoType: string,
  engineUsed: string
) {
  const validRaw = (Array.isArray(raw.scenes) ? raw.scenes : []).filter(
    (s) => s && (String(s.narration || '').trim() || String(s.visualTitle || '').trim())
  );

  if (!validRaw.length) {
    throw new Error('Model lokal tidak menghasilkan daftar adegan JSON yang valid.');
  }

  // If local LLM produced fewer scenes than target, smoothly pad with built-in scenes so duration/scene targets match
  let combined = validRaw.map((s, idx) => ({
    visualTitle: String(s.visualTitle || `Scene ${idx + 1}`).trim(),
    narration: String(s.narration || s.visualTitle || '').trim(),
    imagePrompt: String(s.imagePrompt || s.visualTitle || '').trim(),
    durationSec: Number(s.durationSec) || Math.round(targetTotalSec / targetScenes),
  }));

  if (combined.length < targetScenes) {
    const pad = generateBuiltinLocalScript({
      prompt: fallbackPrompt,
      targetScenes,
      targetTotalSec,
      language,
      visualTheme,
      videoType,
    });
    const extra = pad.scenes.slice(combined.length).map((s) => ({
      visualTitle: s.visualTitle,
      narration: s.narration,
      imagePrompt: s.imagePrompt,
      durationSec: s.durationSec,
    }));
    combined = combined.concat(extra);
  } else if (combined.length > targetScenes) {
    combined = combined.slice(0, targetScenes);
  }

  const perSceneFallback = Math.max(12, Math.round(targetTotalSec / combined.length));
  const baseDurations = combined.map((sc) =>
    Math.max(11, Math.min(28, Number(sc.durationSec) || perSceneFallback))
  );
  const rawSum = baseDurations.reduce((a, b) => a + b, 0);
  const requiredMinSec = Math.max(300, targetTotalSec);
  const scale = rawSum < requiredMinSec ? requiredMinSec / Math.max(1, rawSum) : 1;

  let cursor = 0;
  const scenes: GeneratedSceneItem[] = combined.map((sc, idx) => {
    const dur = Math.round(baseDurations[idx] * scale * 10) / 10;
    const startSec = cursor;
    const endSec = cursor + dur;
    cursor = endSec;
    return {
      index: idx,
      visualTitle: sc.visualTitle,
      narration: sc.narration,
      captionText: sc.narration,
      imagePrompt: sc.imagePrompt,
      durationSec: dur,
      timestampLabel: `${formatClock(startSec)} – ${formatClock(endSec)}`,
    };
  });

  return {
    title: String(raw.title || fallbackPrompt).trim(),
    summary: String(raw.summary || '').trim(),
    totalDurationSec: cursor,
    scenes,
    engineUsed,
  };
}

export async function generateOllamaScript(params: {
  prompt: string;
  targetScenes: number;
  targetTotalSec: number;
  safeMinutes: number;
  language: string;
  langLabel: string;
  visualTheme: AiTheme;
  videoType: string;
  endpoint?: string;
  model?: string;
}) {
  const ep = (params.endpoint || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  let model = (params.model || '').trim();
  if (!model) {
    const tags = await fetchJsonWithTimeout<{ models?: Array<{ name?: string; model?: string }> }>(
      `${ep}/api/tags`,
      { method: 'GET' },
      2000
    );
    model = String(tags.models?.[0]?.name || tags.models?.[0]?.model || '').trim();
  }
  if (!model) {
    throw new Error('Tidak ada model Ollama lokal yang terpasang.');
  }

  const perSceneTarget = Math.max(12, Math.round(params.targetTotalSec / params.targetScenes));
  const systemPrompt =
    'You are a vertical 9:16 documentary scriptwriter. Output strictly valid JSON matching { "title": string, "summary": string, "scenes": [{ "visualTitle": string, "narration": string, "imagePrompt": string, "durationSec": number }] }.';
  const userPrompt = `Create a vertical 9:16 video script about: "${params.prompt}".
Language: ${params.langLabel}. Style: ${params.videoType}, visual mood: ${params.visualTheme}.
Target total duration: ${params.safeMinutes} minutes (${params.targetTotalSec} seconds).
Generate ${params.targetScenes} sequential scenes (Hook -> Context -> Deep Dive -> Examples -> Conclusion).
Each scene ~${perSceneTarget}s (~30-45 spoken words in narration), concise visualTitle (3-6 words), and descriptive imagePrompt. Return ONLY JSON.`;

  const data = await fetchJsonWithTimeout<{ message?: { content?: string }; response?: string }>(
    `${ep}/api/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    },
    120_000
  );

  const rawText = data.message?.content || data.response || '{}';
  const parsed = parseJsonFromLlmText(rawText);
  return finalizeLocalLlmScenes(
    parsed,
    params.prompt,
    params.targetScenes,
    params.targetTotalSec,
    params.language,
    params.visualTheme,
    params.videoType,
    `ollama:${model}`
  );
}

export async function generateOpenAiCompatScript(params: {
  prompt: string;
  targetScenes: number;
  targetTotalSec: number;
  safeMinutes: number;
  language: string;
  langLabel: string;
  visualTheme: AiTheme;
  videoType: string;
  endpoint?: string;
  model?: string;
}) {
  const rawEp = (params.endpoint || process.env.LOCAL_OPENAI_URL || 'http://127.0.0.1:1234/v1').replace(/\/+$/, '');
  const ep = rawEp.endsWith('/v1') ? rawEp : `${rawEp}/v1`;

  let model = (params.model || '').trim();
  if (!model) {
    try {
      const modelsRes = await fetchJsonWithTimeout<{ data?: Array<{ id?: string }> }>(
        `${ep}/models`,
        { method: 'GET' },
        2000
      );
      model = String(modelsRes.data?.[0]?.id || '').trim();
    } catch {
      model = 'local-model';
    }
  }
  if (!model) model = 'local-model';

  const perSceneTarget = Math.max(12, Math.round(params.targetTotalSec / params.targetScenes));
  const systemPrompt =
    'You are a vertical 9:16 documentary scriptwriter. Return ONLY valid JSON matching { "title": string, "summary": string, "scenes": [{ "visualTitle": string, "narration": string, "imagePrompt": string, "durationSec": number }] }.';
  const userPrompt = `Create a vertical 9:16 video script about: "${params.prompt}".
Language: ${params.langLabel}. Style: ${params.videoType}, visual mood: ${params.visualTheme}.
Target total duration: ${params.safeMinutes} minutes (${params.targetTotalSec} seconds).
Generate ${params.targetScenes} sequential scenes (Hook -> Context -> Deep Dive -> Examples -> Conclusion).
Each scene ~${perSceneTarget}s (~30-45 spoken words in narration), concise visualTitle (3-6 words), and descriptive imagePrompt. Output strictly valid JSON.`;

  const data = await fetchJsonWithTimeout<{
    choices?: Array<{ message?: { content?: string } }>;
  }>(
    `${ep}/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    },
    120_000
  );

  const rawText = data.choices?.[0]?.message?.content || '{}';
  const parsed = parseJsonFromLlmText(rawText);
  return finalizeLocalLlmScenes(
    parsed,
    params.prompt,
    params.targetScenes,
    params.targetTotalSec,
    params.language,
    params.visualTheme,
    params.videoType,
    `local-openai:${model}`
  );
}
