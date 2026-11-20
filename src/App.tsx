import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  Download,
  Film,
  LayoutGrid,
  Menu,
  RefreshCw,
  Sliders,
  Sparkles,
  Type as TypeIcon,
  UserCheck,
  X,
} from 'lucide-react';
import { AiVideoView } from './components/AiVideoView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ExportsView } from './components/ExportsView';
import { HomeView } from './components/HomeView';
import { StudioView } from './components/StudioView';
import { CLIENT_APP_VERSION, UpdatesView } from './components/UpdatesView';
import type {
  AppView,
  AudioEnvelopeData,
  BatchQueueItem,
  CaptionSettings,
  ClipCandidate,
  ExportFormat,
  ExportedClipRecord,
  FramingMode,
  StudioTab,
  SubtitleCue,
  SubtitleMode,
  YoutubePreviewInfo,
} from './types/clipper';
import {
  decodeVideoAudioEnvelope,
  extractWavChunksForTranscription,
  findGap,
} from './utils/audioAnalyzer';
import { analyzeCues, buildAudioEnvelopeClips } from './utils/clipSelector';
import {
  FIREBASE_PROJECT_ID,
  FIRESTORE_DATABASE_ID,
  auth,
  signInWithGoogle,
  signOutFirebase,
  testFirestoreConnection,
} from './utils/firebase';
import {
  cleanCues,
  cuesToPreviewText,
  cuesToSrt,
  formatClock,
  parseEditedTranscript,
  parseSubs,
  retimeCues,
} from './utils/subtitles';
import { exportSingleClip, supportedExportMime } from './utils/videoExporter';

const PREFS_KEY = 'autoclipper.studio.prefs.v2';

const DEFAULT_CAPTION_SETTINGS: CaptionSettings = {
  showCaptions: true,
  fontFamily: '"Montserrat", "Plus Jakarta Sans", sans-serif',
  style: 'capcut',
  fontSize: 43,
  position: 'bottom',
  highlightColor: '#c7ff55',
  caps: false,
  italic: false,
  fontWeight: '800',
};

function loadSavedPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<{
      captionSettings: CaptionSettings;
      clipLengthRange: string;
      clipLimit: number;
      framingMode: FramingMode;
      exportFormat: ExportFormat;
    }>;
  } catch {
    return null;
  }
}

function isSupportedVideoFile(file: File): boolean {
  return Boolean(
    file &&
      (file.type.startsWith('video/') ||
        /\.(mp4|webm|mov|m4v|mkv|avi|mpeg|mpg|mts|m2ts|ts|3gp)$/i.test(file.name))
  );
}

function extractYoutubeId(raw: string): string {
  try {
    const u = new URL(String(raw || '').trim());
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') return (u.pathname.split('/').filter(Boolean)[0] || '').slice(0, 20);
    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      const v = u.searchParams.get('v');
      if (v) return v.slice(0, 20);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') {
        return (parts[1] || '').slice(0, 20);
      }
    }
  } catch {
    return '';
  }
  return '';
}

function parseClipLengthRange(val: string): { minDur: number; maxDur: number } {
  const parts = val.split('-').map(Number);
  return {
    minDur: parts[0] || 60,
    maxDur: parts[1] || 90,
  };
}

export default function App() {
  const saved = loadSavedPrefs();
  const videoRef = useRef<HTMLVideoElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const transcribeTimerRef = useRef<number>(0);
  const batchStopRef = useRef(false);
  const ytInspectTimerRef = useRef<number>(0);

  const [view, setView] = useState<AppView>('home');
  const [studioTab, setStudioTab] = useState<StudioTab>('clips');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Media & Analysis State
  const [activeFile, setActiveFile] = useState<File | null>(null);
  const [activeLabel, setActiveLabel] = useState('');
  const [videoReady, setVideoReady] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoDims, setVideoDims] = useState({ w: 0, h: 0 });
  const [audioEnv, setAudioEnv] = useState<AudioEnvelopeData | null>(null);

  // Subtitle & Transcription State
  const [subtitleMode, setSubtitleMode] = useState<SubtitleMode>('auto');
  const [importedSubName, setImportedSubName] = useState('');
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [transcriptEditorText, setTranscriptEditorText] = useState('');
  const [aiTranscribeConsent, setAiTranscribeConsent] = useState(false);
  const [aiTranscribeLang, setAiTranscribeLang] = useState('id');
  const [aiTranscribing, setAiTranscribing] = useState(false);
  const [transcribeProgressPct, setTranscribeProgressPct] = useState(0);
  const [transcribeElapsedSec, setTranscribeElapsedSec] = useState(0);
  const [transcribeEstimatedSec, setTranscribeEstimatedSec] = useState(0);
  const [transcribeStageLabel, setTranscribeStageLabel] = useState('');
  const [transcribeError, setTranscribeError] = useState('');

  // Clip Selection State
  const [clipLengthRange, setClipLengthRange] = useState(saved?.clipLengthRange || '60-90');
  const [clipLimit, setClipLimit] = useState(saved?.clipLimit || 10);
  const [clips, setClips] = useState<ClipCandidate[]>([]);
  const [aiFindingHighlights, setAiFindingHighlights] = useState(false);

  // Styling & Framing State
  const [captionSettings, setCaptionSettings] = useState<CaptionSettings>(
    saved?.captionSettings ? { ...DEFAULT_CAPTION_SETTINGS, ...saved.captionSettings } : DEFAULT_CAPTION_SETTINGS
  );
  const [framingMode, setFramingMode] = useState<FramingMode>(saved?.framingMode || 'fit');
  const [manualPanX, setManualPanX] = useState(0.5);
  const [exportFormat, setExportFormat] = useState<ExportFormat>(saved?.exportFormat || 'webm');

  // Export & Gallery State
  const [activeProjectId, setActiveProjectId] = useState(() => `proj-${Date.now()}`);
  const [exporting, setExporting] = useState(false);
  const [exportProgressPct, setExportProgressPct] = useState(0);
  const [exportProgressLabel, setExportProgressLabel] = useState('Siap');
  const [statusMessage, setStatusMessage] = useState('Pilih file video di Beranda untuk memulai.');
  const [latestDownloads, setLatestDownloads] = useState<
    Array<{ url: string; filename: string; rangeText: string; ext: string }>
  >([]);
  const [latestExportRecords, setLatestExportRecords] = useState<ExportedClipRecord[]>([]);
  const [exportedRecords, setExportedRecords] = useState<ExportedClipRecord[]>([]);

  // YouTube State
  const [ytPreview, setYtPreview] = useState<YoutubePreviewInfo | null>(null);
  const [ytStatusMsg, setYtStatusMsg] = useState('');
  const [ytStatusTone, setYtStatusTone] = useState<'idle' | 'ok' | 'error'>('idle');
  const [ytImporting, setYtImporting] = useState(false);

  // Batch Processing Queue State
  const [batchQueue, setBatchQueue] = useState<BatchQueueItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchGoal, setBatchGoal] = useState<'auto-export' | 'analyze-only'>('auto-export');
  const [batchBannerText, setBatchBannerText] = useState('');
  const [batchGlobalPct, setBatchGlobalPct] = useState(0);

  // Firebase Auth & Firestore Connection Status (dedicated to App Updates)
  const [fbUser, setFbUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState('');
  const [firestoreStatus, setFirestoreStatus] = useState<{
    reachable: boolean;
    offline: boolean;
    message: string;
  }>({ reachable: false, offline: false, message: 'Memeriksa koneksi Firestore…' });

  // Test Firestore connection on startup & listen to Firebase Auth state
  useEffect(() => {
    testFirestoreConnection().then(setFirestoreStatus);
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setFbUser(user);
      setAuthReady(true);
      if (user && !user.emailVerified) {
        setAuthError('Email akun Google belum terverifikasi untuk akses Firestore.');
      } else {
        setAuthError('');
      }
    });
    return () => unsubAuth();
  }, []);

  // Persist Studio Preferences locally
  useEffect(() => {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          captionSettings,
          clipLengthRange,
          clipLimit,
          framingMode,
          exportFormat,
        })
      );
    } catch {}
  }, [captionSettings, clipLengthRange, clipLimit, framingMode, exportFormat]);

  const handleSignInGoogle = async () => {
    setAuthError('');
    try {
      await signInWithGoogle();
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setAuthError('Login Google dibatalkan.');
      } else if (code === 'auth/popup-blocked') {
        setAuthError('Popup login diblokir browser. Izinkan popup untuk situs ini.');
      } else {
        setAuthError(err instanceof Error ? err.message : 'Gagal masuk dengan Google.');
      }
    }
  };

  const handleSignOutGoogle = async () => {
    setAuthError('');
    try {
      await signOutFirebase();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Gagal keluar dari akun.');
    }
  };

  // Clean up object URLs and active subtitle timers/requests on unmount
  useEffect(() => {
    return () => {
      window.clearInterval(transcribeTimerRef.current);
      transcribeAbortRef.current?.abort();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const recomputeClips = useCallback(
    (params: {
      duration: number;
      currentCues: SubtitleCue[];
      subMode: SubtitleMode;
      env: AudioEnvelopeData | null;
      lenRange: string;
      limit: number;
    }) => {
      const { minDur, maxDur } = parseClipLengthRange(params.lenRange);
      if (params.subMode !== 'none' && params.currentCues.length > 0) {
        const found = analyzeCues(params.currentCues, {
          minDur,
          maxDur,
          limit: params.limit,
          videoDuration: params.duration,
          audioEnv: params.env,
        });
        if (found.length > 0) return found;
      }
      return buildAudioEnvelopeClips(params.duration, {
        minDur,
        maxDur,
        limit: params.limit,
        audioEnv: params.env,
      });
    },
    []
  );

  const loadVideoIntoStudio = useCallback(
    async (
      file: File,
      opts?: { label?: string; stayInHome?: boolean; initialCues?: SubtitleCue[] }
    ): Promise<{ ok: boolean; duration: number; env: AudioEnvelopeData | null; clips: ClipCandidate[]; error?: string }> => {
      const vid = videoRef.current;
      if (!vid) return { ok: false, duration: 0, env: null, clips: [], error: 'Elemen video belum siap.' };

      vid.pause();
      window.clearInterval(transcribeTimerRef.current);
      transcribeAbortRef.current?.abort();
      transcribeAbortRef.current = null;
      setAiTranscribing(false);
      setTranscribeProgressPct(0);
      setTranscribeElapsedSec(0);
      setTranscribeStageLabel('');
      setTranscribeError('');
      setVideoReady(false);
      setActiveFile(file);
      const nextLabel = opts?.label || file.name;
      setActiveLabel(nextLabel);
      setActiveProjectId(`proj-${nextLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)}-${Date.now()}`);
      setLatestDownloads([]);
      setLatestExportRecords([]);
      setExportProgressPct(0);
      setStatusMessage('Memuat metadata video…');

      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      const nextUrl = URL.createObjectURL(file);
      objectUrlRef.current = nextUrl;

      const metaRes = await new Promise<{ ok: boolean; duration: number; w: number; h: number; error?: string }>(
        (resolve) => {
          let done = false;
          const finish = (res: { ok: boolean; duration: number; w: number; h: number; error?: string }) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            vid.removeEventListener('loadedmetadata', onLoaded);
            vid.removeEventListener('error', onError);
            resolve(res);
          };
          const onLoaded = () => {
            finish({
              ok: true,
              duration: Number.isFinite(vid.duration) ? vid.duration : 0,
              w: vid.videoWidth || 1280,
              h: vid.videoHeight || 720,
            });
          };
          const onError = () => {
            finish({
              ok: false,
              duration: 0,
              w: 0,
              h: 0,
              error: 'Browser gagal membuka format video ini. Gunakan MP4 H.264 atau WebM.',
            });
          };
          const timer = window.setTimeout(
            () => finish({ ok: false, duration: 0, w: 0, h: 0, error: 'Timeout memuat metadata video.' }),
            25000
          );
          vid.addEventListener('loadedmetadata', onLoaded, { once: true });
          vid.addEventListener('error', onError, { once: true });
          vid.src = nextUrl;
          vid.load();
        }
      );

      if (!metaRes.ok) {
        setStatusMessage(metaRes.error || 'Video gagal dibuka.');
        return { ok: false, duration: 0, env: null, clips: [], error: metaRes.error };
      }

      setVideoReady(true);
      setVideoDuration(metaRes.duration);
      setVideoDims({ w: metaRes.w, h: metaRes.h });
      if (!opts?.stayInHome) {
        setView('studio');
        setStudioTab('clips');
      }

      setStatusMessage('Menganalisis gelombang audio & jeda alami…');
      const env = await decodeVideoAudioEnvelope(file);
      setAudioEnv(env);

      const usedCues = opts?.initialCues ?? cues;
      if (opts?.initialCues) {
        setCues(usedCues);
        setTranscriptEditorText(cuesToPreviewText(usedCues));
      }

      const generatedClips = recomputeClips({
        duration: metaRes.duration,
        currentCues: usedCues,
        subMode: subtitleMode,
        env,
        lenRange: clipLengthRange,
        limit: clipLimit,
      });
      setClips(generatedClips);

      if (generatedClips.length > 0) {
        vid.currentTime = generatedClips[0].start;
        setStatusMessage(`${generatedClips.length} kandidat klip siap. Tekan Putar untuk pratinjau atau langsung ekspor.`);
      } else {
        setStatusMessage('Video dimuat. Sesuaikan durasi klip jika belum ada potongan yang cocok.');
      }

      return { ok: true, duration: metaRes.duration, env, clips: generatedClips };
    },
    [cues, subtitleMode, clipLengthRange, clipLimit, recomputeClips]
  );

  const handleEnqueueFiles = (fileList: FileList | File[]) => {
    const valid = Array.from(fileList).filter(isSupportedVideoFile);
    if (!valid.length) {
      setStatusMessage('Pilih minimal satu file video yang didukung (MP4, WebM, MOV, MKV).');
      return;
    }

    const hadQueue = batchQueue.length > 0;
    const added: BatchQueueItem[] = [];
    for (const f of valid) {
      const dup = batchQueue.find(
        (it) => it.name === f.name && it.size === f.size && it.status !== 'done'
      );
      if (dup) continue;
      added.push({
        id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file: f,
        name: f.name,
        size: f.size,
        status: 'queued',
        statusText: 'Menunggu antrean',
        progress: 0,
        clipsCount: 0,
        exportedCount: 0,
      });
    }

    if (!added.length) return;
    setBatchQueue((prev) => [...prev, ...added]);

    if (added.length === 1 && !hadQueue && !batchRunning) {
      loadVideoIntoStudio(added[0].file);
    }
  };

  const handlePickSubtitleFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = retimeCues(cleanCues(parseSubs(text)), audioEnv);
      if (!parsed.length) {
        setStatusMessage('File subtitle tidak berisi baris timecode yang terbaca.');
        return;
      }
      setImportedSubName(file.name);
      setCues(parsed);
      setTranscriptEditorText(cuesToPreviewText(parsed));
      if (subtitleMode === 'none') setSubtitleMode('external');

      if (videoReady && videoDuration > 0) {
        const nextClips = recomputeClips({
          duration: videoDuration,
          currentCues: parsed,
          subMode: 'external',
          env: audioEnv,
          lenRange: clipLengthRange,
          limit: clipLimit,
        });
        setClips(nextClips);
        setStatusMessage(`Subtitle ${file.name} (${parsed.length} baris) diterapkan · ${nextClips.length} klip siap.`);
      } else {
        setStatusMessage(`Subtitle ${file.name} (${parsed.length} baris) siap dipakai.`);
      }
    } catch (err) {
      setStatusMessage(`Gagal membaca file subtitle: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCancelAiTranscribe = () => {
    window.clearInterval(transcribeTimerRef.current);
    transcribeTimerRef.current = 0;
    if (transcribeAbortRef.current) {
      transcribeAbortRef.current.abort();
      transcribeAbortRef.current = null;
    }
    setAiTranscribing(false);
    setTranscribeProgressPct(0);
    setTranscribeElapsedSec(0);
    setTranscribeStageLabel('');
    setTranscribeError('');
    setStatusMessage('Pembuatan subtitle dibatalkan. Klik Buat Subtitle Otomatis / Buat Ulang kapan saja.');
  };

  const handleRunAiTranscribe = async () => {
    if (!activeFile || !aiTranscribeConsent || aiTranscribing) return;

    window.clearInterval(transcribeTimerRef.current);
    transcribeAbortRef.current?.abort();

    const ctrl = new AbortController();
    transcribeAbortRef.current = ctrl;

    const est = Math.max(8, Math.round((videoDuration || 60) * 0.16));
    setTranscribeError('');
    setTranscribeElapsedSec(0);
    setTranscribeEstimatedSec(est);
    setTranscribeProgressPct(8);
    setTranscribeStageLabel('Mengekstrak audio lokal…');
    setAiTranscribing(true);
    setStatusMessage('Mengekstrak audio 16kHz untuk transkripsi AI…');

    let elapsed = 0;
    let phase: 'extract' | 'upload' = 'extract';
    transcribeTimerRef.current = window.setInterval(() => {
      elapsed += 1;
      setTranscribeElapsedSec(elapsed);
      setTranscribeProgressPct((prev) => {
        const cap = phase === 'extract' ? 34 : 94;
        if (prev >= cap) return prev;
        const step = phase === 'extract' ? 4 : Math.max(1.2, (cap - prev) / Math.max(3, est - elapsed));
        return Math.min(cap, prev + step);
      });
    }, 1000);

    try {
      const { chunks } = await extractWavChunksForTranscription(activeFile, ctrl.signal, 60);
      if (ctrl.signal.aborted) {
        throw new DOMException('Pembuatan subtitle dibatalkan.', 'AbortError');
      }

      phase = 'upload';
      const combinedCues: SubtitleCue[] = [];
      for (let i = 0; i < chunks.length; i++) {
        if (ctrl.signal.aborted) {
          throw new DOMException('Pembuatan subtitle dibatalkan.', 'AbortError');
        }
        const chunk = chunks[i];
        const partProgress = 36 + Math.round((i / Math.max(1, chunks.length)) * 56);
        setTranscribeProgressPct((prev) => Math.max(prev, partProgress));
        setTranscribeStageLabel(
          chunks.length > 1
            ? `Mentranskrip bagian ${i + 1}/${chunks.length} (Gemini AI)…`
            : 'Mentranskrip ucapan (Gemini AI)…'
        );
        setStatusMessage(
          chunks.length > 1
            ? `Mengirim bagian audio ${i + 1} dari ${chunks.length} ke Gemini Transcribe…`
            : 'Mengirim audio ke server untuk transkripsi AI (Gemini Transcribe)…'
        );

        const res = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64: chunk.base64,
            mimeType: chunk.mimeType,
            language: aiTranscribeLang,
            durationSec: chunk.durationSec,
            consentConfirmed: true,
          }),
          signal: ctrl.signal,
        });

        const rawText = await res.text();
        let data: { cues?: SubtitleCue[]; error?: string } = {};
        try {
          data = JSON.parse(rawText);
        } catch {
          throw new Error(
            res.ok
              ? 'Respons server tidak valid saat membaca hasil subtitle.'
              : `Server mengembalikan error (${res.status}). Silakan coba buat ulang.`
          );
        }
        if (!res.ok) throw new Error(data.error || 'Transkripsi AI gagal.');

        for (const cue of data.cues || []) {
          combinedCues.push({
            start: Math.max(0, Number(cue.start) || 0) + chunk.offsetSec,
            end: Math.max(0.2, Number(cue.end) || 0) + chunk.offsetSec,
            text: String(cue.text || '').trim(),
          });
        }
      }

      const cleaned = retimeCues(cleanCues(combinedCues), audioEnv);
      if (!cleaned.length) {
        throw new Error('Tidak ada ucapan yang terdeteksi dari audio. Coba ulangi atau unggah .srt/.vtt.');
      }

      setTranscribeProgressPct(100);
      setTranscribeError('');
      setImportedSubName('Transkripsi AI (Gemini)');
      setCues(cleaned);
      setTranscriptEditorText(cuesToPreviewText(cleaned));
      const nextClips = recomputeClips({
        duration: videoDuration,
        currentCues: cleaned,
        subMode: 'auto',
        env: audioEnv,
        lenRange: clipLengthRange,
        limit: clipLimit,
      });
      setClips(nextClips);
      setStatusMessage(`Transkripsi AI selesai (${cleaned.length} baris) · ${nextClips.length} klip ditemukan.`);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || ctrl.signal.aborted) {
        setTranscribeError('');
        setStatusMessage('Pembuatan subtitle dibatalkan.');
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setTranscribeError(msg);
        setStatusMessage(msg);
      }
    } finally {
      window.clearInterval(transcribeTimerRef.current);
      transcribeTimerRef.current = 0;
      if (transcribeAbortRef.current === ctrl) {
        transcribeAbortRef.current = null;
      }
      setAiTranscribing(false);
    }
  };

  const handleInspectYoutube = (rawUrl: string) => {
    window.clearTimeout(ytInspectTimerRef.current);
    const id = extractYoutubeId(rawUrl);
    if (!id) {
      setYtPreview(null);
      setYtStatusMsg('');
      setYtStatusTone('idle');
      return;
    }

    setYtPreview({
      id,
      url: rawUrl,
      title: 'Memeriksa metadata YouTube…',
      channel: 'YouTube',
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      duration: 0,
      canDownloadDirect: false,
      state: 'loading',
    });

    ytInspectTimerRef.current = window.setTimeout(async () => {
      try {
        const res = await fetch('/api/youtube/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: rawUrl }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memeriksa video YouTube.');
        setYtPreview({
          id: data.id,
          url: rawUrl,
          title: data.title,
          channel: data.channel,
          thumbnail: data.thumbnail,
          duration: Number(data.duration) || 0,
          canDownloadDirect: Boolean(data.canDownloadDirect),
          state: 'ready',
        });
        if (data.canDownloadDirect) {
          setYtStatusMsg('Video YouTube ditemukan. Klik tombol ↑ untuk mengunduh ke sesi lokal.');
          setYtStatusTone('ok');
        } else {
          setYtStatusMsg(
            'Metadata YouTube ditemukan. Server web ini belum memiliki yt-dlp untuk unduh stream langsung — gunakan tab Upload File Lokal (.mp4 / .webm) untuk klip instan.'
          );
          setYtStatusTone('idle');
        }
      } catch (err) {
        setYtStatusMsg(err instanceof Error ? err.message : String(err));
        setYtStatusTone('error');
      }
    }, 350);
  };

  const handleImportYoutube = async (rawUrl: string, quality: string) => {
    const id = extractYoutubeId(rawUrl);
    if (!id) {
      setYtStatusMsg('Link YouTube tidak valid. Gunakan link youtube.com atau youtu.be.');
      setYtStatusTone('error');
      return;
    }
    setYtImporting(true);
    setYtStatusMsg('Mengunduh video YouTube ke sesi lokal…');
    setYtStatusTone('idle');
    try {
      const res = await fetch('/api/youtube/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawUrl, quality }),
      });
      const data = await res.json();
      if (!res.ok || !data.fileUrl) {
        throw new Error(data.error || 'Gagal mengunduh video YouTube.');
      }
      const fileRes = await fetch(data.fileUrl);
      if (!fileRes.ok) throw new Error('Gagal membaca stream file hasil unduhan.');
      const blob = await fileRes.blob();
      const videoFile = new File([blob], data.filename || 'youtube-video.mp4', {
        type: blob.type || 'video/mp4',
      });
      setYtStatusMsg('Video YouTube dimuat ke Studio!');
      setYtStatusTone('ok');
      await loadVideoIntoStudio(videoFile, { label: data.title || videoFile.name });
    } catch (err) {
      setYtStatusMsg(err instanceof Error ? err.message : String(err));
      setYtStatusTone('error');
    } finally {
      setYtImporting(false);
    }
  };

  const handleFindAiHighlights = async () => {
    if (!videoReady || cues.length < 3 || aiFindingHighlights) return;
    const { minDur, maxDur } = parseClipLengthRange(clipLengthRange);
    setAiFindingHighlights(true);
    setStatusMessage('Menganalisis momen viral, hook pembuka & payoff dengan AI…');
    try {
      const res = await fetch('/api/clips/highlights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cues,
          minDur,
          maxDur,
          limit: clipLimit,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Deteksi momen viral AI gagal.');
      const rawClips = Array.isArray(data.clips) ? data.clips : [];
      if (!rawClips.length) {
        setStatusMessage('AI tidak menemukan segmen viral baru di transkrip ini. Coba ubah rentang durasi.');
        return;
      }

      const maxVideoDur = videoDuration > 0 ? videoDuration : Infinity;
      const mapped: ClipCandidate[] = [];
      for (let i = 0; i < rawClips.length; i++) {
        const item = rawClips[i] as {
          startCueIndex: number;
          endCueIndex: number;
          title: string;
          hook: string;
          score: number;
          reason: string;
        };
        const sc = cues[item.startCueIndex];
        const ec = cues[item.endCueIndex];
        if (!sc || !ec) continue;

        const leadGap = findGap(audioEnv, Math.max(0, sc.start - 0.6), sc.start);
        const tailGap = findGap(audioEnv, ec.end, ec.end + 0.7);
        const start = Math.max(
          0,
          leadGap ? Math.max(leadGap.a + 0.04, leadGap.b - 0.12) : sc.start - 0.12
        );
        const end = Math.min(
          maxVideoDur,
          tailGap ? Math.min(tailGap.b - 0.04, tailGap.a + 0.28) : ec.end + 0.28
        );
        if (end - start < 5) continue;

        const quote = cues
          .slice(item.startCueIndex, item.endCueIndex + 1)
          .map((c) => c.text)
          .join(' ')
          .slice(0, 180);

        mapped.push({
          id: `ai-clip-${i + 1}-${Math.round(start * 10)}`,
          start: Math.round(start * 100) / 100,
          end: Math.round(end * 100) / 100,
          title: item.title,
          hook: item.hook,
          reasons: [item.reason],
          quote,
          score: item.score,
          aiScored: true,
          selected: true,
        });
      }

      if (mapped.length) {
        mapped.sort((a, b) => a.start - b.start);
        setClips(mapped);
        setStatusMessage(`${mapped.length} momen viral terbaik ditemukan & diselaraskan dengan jeda napas.`);
      } else {
        setStatusMessage('Hasil momen viral AI terlalu pendek; daftar klip sebelumnya tetap dipertahankan.');
      }
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setAiFindingHighlights(false);
    }
  };

  const handleStartExport = async () => {
    const vid = videoRef.current;
    const chosen = clips.filter((c) => c.selected);
    const mime = supportedExportMime(exportFormat);
    if (!vid || !chosen.length || !mime || exporting) return;

    const ctrl = new AbortController();
    exportAbortRef.current = ctrl;
    setExporting(true);
    setLatestDownloads([]);
    setLatestExportRecords([]);
    setExportProgressPct(0);
    setExportProgressLabel('Menyiapkan ekspor klip');

    const totalClipDur = chosen.reduce((acc, c) => acc + Math.max(0.5, c.end - c.start), 0);
    let doneDur = 0;
    const projectName = activeLabel || activeFile?.name || 'Projek Auto Clipper';
    const stem = projectName
      .replace(/\.[^.]+$/, '')
      .replace(/[\\/:*?"<>|]/g, '-');

    try {
      for (let i = 0; i < chosen.length; i++) {
        if (ctrl.signal.aborted) break;
        const cut = chosen[i];
        const res = await exportSingleClip({
          videoEl: vid,
          cut,
          mime,
          framingMode,
          manualPanX,
          cues: subtitleMode === 'none' ? [] : cues,
          captionSettings: {
            ...captionSettings,
            showCaptions: subtitleMode !== 'none' && captionSettings.showCaptions,
          },
          audioEnv,
          signal: ctrl.signal,
          onProgress: (ratio, clockText) => {
            const pct = Math.min(
              99,
              ((doneDur + ratio * Math.max(0.5, cut.end - cut.start)) / Math.max(0.5, totalClipDur)) * 100
            );
            setExportProgressPct(pct);
            setExportProgressLabel(`Mengekspor klip ${i + 1}/${chosen.length}`);
            setStatusMessage(`Klip ${i + 1}/${chosen.length} · ${clockText}`);
          },
        });

        doneDur += res.durationSec;
        const filename = `${stem}-clip-${String(i + 1).padStart(2, '0')}.${res.ext}`;
        const rangeText = `${formatClock(cut.start)}–${formatClock(cut.end)}`;
        const record: ExportedClipRecord = {
          id: `exp-${Date.now()}-${i}`,
          projectId: activeProjectId,
          projectName,
          url: res.url,
          filename,
          ext: res.ext,
          rangeText,
          durationSec: res.durationSec,
          sizeBytes: res.blob.size,
          label: cut.title,
          sourceLabel: projectName,
          hook: cut.hook,
          captionText: cut.quote,
          createdAt: Date.now(),
        };
        setLatestDownloads((prev) => [...prev, { url: res.url, filename, rangeText, ext: res.ext }]);
        setLatestExportRecords((prev) => [...prev, record]);
        setExportedRecords((prev) => [record, ...prev]);
      }

      if (!ctrl.signal.aborted) {
        setExportProgressPct(100);
        setExportProgressLabel('Ekspor selesai · semua klip siap');
        setStatusMessage(`Selesai · ${chosen.length} klip masuk ke folder "${projectName}" & siap diunduh.`);
      }
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : String(err));
    } finally {
      exportAbortRef.current = null;
      setExporting(false);
    }
  };

  const handleStartBatch = async () => {
    if (batchRunning || exporting) return;
    const pending = batchQueue.filter(
      (it) => it.status === 'queued' || it.status === 'stopped' || it.status === 'error'
    );
    if (!pending.length) return;

    const mime = supportedExportMime(exportFormat);
    if (batchGoal === 'auto-export' && !mime) {
      setBatchBannerText('Browser belum mendukung MediaRecorder untuk ekspor otomatis.');
      return;
    }

    batchStopRef.current = false;
    setBatchRunning(true);
    setBatchGlobalPct(0);
    setBatchBannerText(`Memulai antrean batch (${pending.length} video)…`);

    const updateItem = (id: string, patch: Partial<BatchQueueItem>) => {
      setBatchQueue((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    };

    let completed = 0;
    for (let idx = 0; idx < pending.length; idx++) {
      if (batchStopRef.current) break;
      const item = pending[idx];
      const basePct = (idx / pending.length) * 100;
      const stepSpan = 100 / pending.length;

      updateItem(item.id, { status: 'loading', statusText: 'Memuat video…', progress: 12 });
      setBatchBannerText(`Video ${idx + 1}/${pending.length}: memuat ${item.name}`);
      setBatchGlobalPct(basePct + stepSpan * 0.1);

      const loadRes = await loadVideoIntoStudio(item.file, {
        label: item.name,
        stayInHome: true,
        initialCues: [],
      });

      if (!loadRes.ok || batchStopRef.current) {
        updateItem(item.id, {
          status: batchStopRef.current ? 'stopped' : 'error',
          statusText: batchStopRef.current ? 'Dihentikan' : loadRes.error || 'Gagal memuat video',
        });
        if (batchStopRef.current) break;
        continue;
      }

      updateItem(item.id, {
        status: 'analyzing',
        statusText: `${loadRes.clips.length} klip disiapkan`,
        clipsCount: loadRes.clips.length,
        progress: 45,
      });

      if (batchGoal === 'auto-export' && loadRes.clips.length > 0) {
        const vid = videoRef.current;
        if (!vid || !mime) continue;
        const ctrl = new AbortController();
        exportAbortRef.current = ctrl;
        const stem = item.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '-');
        let expOk = 0;

        for (let ci = 0; ci < loadRes.clips.length; ci++) {
          if (batchStopRef.current || ctrl.signal.aborted) break;
          const cut = loadRes.clips[ci];
          updateItem(item.id, {
            status: 'exporting',
            statusText: `Mengekspor klip ${ci + 1}/${loadRes.clips.length}`,
            progress: 45 + ((ci + 1) / loadRes.clips.length) * 50,
          });
          setBatchBannerText(
            `Video ${idx + 1}/${pending.length}: mengekspor klip ${ci + 1}/${loadRes.clips.length} (${item.name})`
          );

          try {
            const res = await exportSingleClip({
              videoEl: vid,
              cut,
              mime,
              framingMode,
              manualPanX,
              cues: [],
              captionSettings: { ...captionSettings, showCaptions: false },
              audioEnv: loadRes.env,
              signal: ctrl.signal,
              onProgress: (ratio) => {
                const subPct = ((ci + ratio) / loadRes.clips.length) * 0.55;
                setBatchGlobalPct(basePct + stepSpan * (0.45 + subPct));
              },
            });
            expOk++;
            const filename = `${stem}-clip-${String(ci + 1).padStart(2, '0')}.${res.ext}`;
            const rangeText = `${formatClock(cut.start)}–${formatClock(cut.end)}`;
            setExportedRecords((prev) => [
              {
                id: `batch-exp-${Date.now()}-${idx}-${ci}`,
                projectId: `batch-${item.id}`,
                projectName: item.name,
                url: res.url,
                filename,
                ext: res.ext,
                rangeText,
                durationSec: res.durationSec,
                sizeBytes: res.blob.size,
                label: cut.title,
                sourceLabel: item.name,
                hook: cut.hook,
                captionText: cut.quote,
                createdAt: Date.now(),
              },
              ...prev,
            ]);
          } catch (err) {
            if (batchStopRef.current) break;
            updateItem(item.id, {
              status: 'error',
              statusText: err instanceof Error ? err.message : 'Gagal ekspor',
            });
          }
        }
        exportAbortRef.current = null;
        if (batchStopRef.current) {
          updateItem(item.id, { status: 'stopped', statusText: 'Dihentikan pengguna' });
          break;
        }
        updateItem(item.id, {
          status: 'done',
          progress: 100,
          exportedCount: expOk,
          statusText: `Selesai · ${expOk} klip diekspor`,
        });
      } else {
        updateItem(item.id, {
          status: 'done',
          progress: 100,
          statusText: `Siap di Studio · ${loadRes.clips.length} klip`,
        });
      }

      completed++;
      setBatchGlobalPct(((idx + 1) / pending.length) * 100);
    }

    setBatchRunning(false);
    if (batchStopRef.current) {
      setBatchBannerText(`Antrean dihentikan · ${completed} dari ${pending.length} video selesai.`);
    } else {
      setBatchBannerText(`Batch selesai · ${completed} dari ${pending.length} video berhasil diproses.`);
    }
  };

  const handleStopBatch = () => {
    batchStopRef.current = true;
    exportAbortRef.current?.abort();
    setBatchBannerText('Menghentikan antrean batch…');
  };

  const navigateStudio = (tab: StudioTab) => {
    setView('studio');
    setStudioTab(tab);
    setMobileMenuOpen(false);
  };

  const breadcrumbMap: Record<AppView, [string, string]> = {
    home: ['Beranda', 'Upload video lokal, batch queue, atau link YouTube'],
    aivideo: ['Video AI Otomatis', 'Naskah, visual 9:16, narasi suara AI, dan render lokal'],
    studio: [
      studioTab === 'style'
        ? 'Font & Gaya Subtitle'
        : studioTab === 'export'
          ? 'Framing & Ekspor 9:16'
          : 'Studio Editor 9:16',
      activeLabel || 'Atur subtitle, potongan klip, dan pratinjau',
    ],
    exports: ['Hasil Ekspor', `${exportedRecords.length} klip selesai di sesi ini`],
    updates: ['Versi & Pembaruan', `Auto Clipper Studio v${CLIENT_APP_VERSION}`],
  };

  const [crumbTitle, crumbSub] = breadcrumbMap[view];

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#08090c] text-[#f3f5f8] grid grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)]">
        {/* Hidden shared media element for preview & export */}
        <video
          ref={videoRef}
          playsInline
          preload="auto"
          className="fixed left-0 bottom-0 w-1 h-1 opacity-0 pointer-events-none -z-10"
        />

        {/* Mobile Drawer Backdrop */}
        {mobileMenuOpen && (
          <div
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 bg-black/65 z-40 lg:hidden"
          />
        )}

        {/* Sidebar Navigation */}
        <aside
          className={`fixed lg:sticky top-0 left-0 h-screen w-[248px] bg-[#0b0d12] border-r border-[#1e2432] flex flex-col p-4 z-50 transition-transform duration-200 ${
            mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          }`}
        >
          <div className="flex items-center justify-between px-2 pb-5">
            <div className="flex items-center gap-2.5 font-extrabold text-base tracking-tight text-white whitespace-nowrap">
              <span className="w-7 h-7 rounded-lg bg-[#ff5436] text-white grid place-items-center text-xs font-extrabold">
                ▶
              </span>
              Auto Clipper
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden p-1 text-[#8f98a8] hover:text-white"
              aria-label="Tutup menu"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav aria-label="Navigasi Studio" className="space-y-1 flex-1">
            <button
              type="button"
              onClick={() => {
                setView('home');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer ${
                view === 'home'
                  ? 'bg-[#181c27] text-white border border-[#2d3548]'
                  : 'text-[#8f98a8] hover:bg-[#11141c] hover:text-white border border-transparent'
              }`}
            >
              <LayoutGrid className={`w-4 h-4 ${view === 'home' ? 'text-[#ff5436]' : ''}`} />
              <span>Beranda</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setView('aivideo');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer ${
                view === 'aivideo'
                  ? 'bg-[#181c27] text-white border border-[#2d3548]'
                  : 'text-[#8f98a8] hover:bg-[#11141c] hover:text-white border border-transparent'
              }`}
            >
              <Sparkles className={`w-4 h-4 ${view === 'aivideo' ? 'text-[#ff5436]' : ''}`} />
              <span>Video AI Otomatis</span>
            </button>

            <button
              type="button"
              onClick={() => navigateStudio('clips')}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer ${
                view === 'studio' && studioTab === 'clips'
                  ? 'bg-[#181c27] text-white border border-[#2d3548]'
                  : 'text-[#8f98a8] hover:bg-[#11141c] hover:text-white border border-transparent'
              }`}
            >
              <Sliders
                className={`w-4 h-4 ${view === 'studio' && studioTab === 'clips' ? 'text-[#ff5436]' : ''}`}
              />
              <span>Studio Editor 9:16</span>
            </button>

            <button
              type="button"
              onClick={() => navigateStudio('style')}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer ${
                view === 'studio' && studioTab === 'style'
                  ? 'bg-[#181c27] text-white border border-[#2d3548]'
                  : 'text-[#8f98a8] hover:bg-[#11141c] hover:text-white border border-transparent'
              }`}
            >
              <TypeIcon
                className={`w-4 h-4 ${view === 'studio' && studioTab === 'style' ? 'text-[#ff5436]' : ''}`}
              />
              <span>Font &amp; Gaya Subtitle</span>
            </button>

            <button
              type="button"
              onClick={() => navigateStudio('export')}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer ${
                view === 'studio' && studioTab === 'export'
                  ? 'bg-[#181c27] text-white border border-[#2d3548]'
                  : 'text-[#8f98a8] hover:bg-[#11141c] hover:text-white border border-transparent'
              }`}
            >
              <UserCheck
                className={`w-4 h-4 ${view === 'studio' && studioTab === 'export' ? 'text-[#ff5436]' : ''}`}
              />
              <span>Framing &amp; Ekspor</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setView('exports');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer ${
                view === 'exports'
                  ? 'bg-[#181c27] text-white border border-[#2d3548]'
                  : 'text-[#8f98a8] hover:bg-[#11141c] hover:text-white border border-transparent'
              }`}
            >
              <Download className={`w-4 h-4 ${view === 'exports' ? 'text-[#ff5436]' : ''}`} />
              <span>Hasil Ekspor</span>
              <span className="ml-auto font-mono tabular-nums text-[11px] text-[#8f98a8]">
                {exportedRecords.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setView('updates');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer ${
                view === 'updates'
                  ? 'bg-[#181c27] text-white border border-[#2d3548]'
                  : 'text-[#8f98a8] hover:bg-[#11141c] hover:text-white border border-transparent'
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${view === 'updates' ? 'text-[#ff5436]' : ''}`} />
              <span>Versi &amp; Update</span>
              <span className="ml-auto font-mono tabular-nums text-[11px] text-[#8f98a8]">
                v{CLIENT_APP_VERSION}
              </span>
            </button>
          </nav>

          {/* Session Summary Footer */}
          <div className="bg-[#11141c] border border-[#1e2432] rounded-xl p-3 space-y-2">
            <div className="text-[11px] text-[#8f98a8] font-medium">Ringkasan Sesi</div>
            <div className="flex items-center justify-between text-xs font-bold text-white">
              <span className="inline-flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5 text-[#ff5436]" />
                9:16 · 30fps
              </span>
              <span className="font-mono tabular-nums text-[#c7ff55]">{clips.length} klip</span>
            </div>
            <div className="text-[11px] text-[#8f98a8] truncate">
              {activeFile ? activeLabel || activeFile.name : 'Menunggu video lokal'}
            </div>
          </div>
        </aside>

        {/* Main Workspace */}
        <div className="min-w-0 flex flex-col">
          {/* Compact Mobile Header */}
          <div className="lg:hidden flex items-center justify-between px-4 py-2.5 border-b border-[#1e2432] bg-[#0b0d12]/95 sticky top-0 z-30">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="px-2.5 py-1.5 rounded-lg bg-[#181c27] border border-[#2d3548] text-xs font-semibold text-white inline-flex items-center gap-1.5"
            >
              <Menu className="w-3.5 h-3.5" />
              Menu
            </button>
            <span className="font-bold text-sm text-white">Auto Clipper</span>
            <button
              type="button"
              onClick={() => navigateStudio('clips')}
              className="px-2.5 py-1.5 rounded-lg bg-[#ff5436] text-xs font-bold text-white"
            >
              Studio
            </button>
          </div>

          {/* Desktop Top Bar */}
          <header className="hidden lg:flex items-center justify-between gap-6 px-7 py-3.5 border-b border-[#1e2432] bg-[#08090c]/90 backdrop-blur-md sticky top-0 z-20">
            <div className="flex items-center gap-2 text-xs text-[#8f98a8] min-w-0">
              <strong className="text-white font-bold whitespace-nowrap">{crumbTitle}</strong>
              <span aria-hidden="true">/</span>
              <span className="truncate">{crumbSub}</span>
            </div>
            <div className="shrink-0">
              {view === 'studio' ? (
                <button
                  type="button"
                  onClick={() => setView('exports')}
                  className="px-3.5 py-1.5 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-xs font-semibold text-white whitespace-nowrap cursor-pointer"
                >
                  Hasil Ekspor ({exportedRecords.length})
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => navigateStudio('clips')}
                  className="px-3.5 py-1.5 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-xs font-semibold text-white whitespace-nowrap cursor-pointer"
                >
                  Buka Studio 9:16
                </button>
              )}
            </div>
          </header>

          <main className="w-full max-w-[1240px] mx-auto px-4 sm:px-7 py-6 sm:py-7 flex-1 min-w-0">
            {view === 'home' && (
              <HomeView
                activeFile={activeFile}
                activeLabel={activeLabel}
                clipsCount={clips.length}
                subtitleMode={subtitleMode}
                onChangeSubtitleMode={(mode) => {
                  setSubtitleMode(mode);
                  if (videoReady && videoDuration > 0) {
                    const next = recomputeClips({
                      duration: videoDuration,
                      currentCues: cues,
                      subMode: mode,
                      env: audioEnv,
                      lenRange: clipLengthRange,
                      limit: clipLimit,
                    });
                    setClips(next);
                  }
                }}
                clipLengthRange={clipLengthRange}
                onEnqueueFiles={handleEnqueueFiles}
                onPickSubtitleFile={handlePickSubtitleFile}
                subtitleFileName={importedSubName}
                ytPreview={ytPreview}
                ytStatusMsg={ytStatusMsg}
                ytStatusTone={ytStatusTone}
                onInspectYoutube={handleInspectYoutube}
                onImportYoutube={handleImportYoutube}
                ytImporting={ytImporting}
                batchQueue={batchQueue}
                batchRunning={batchRunning}
                batchGoal={batchGoal}
                onChangeBatchGoal={setBatchGoal}
                batchBannerText={batchBannerText}
                batchGlobalPct={batchGlobalPct}
                exportedCount={exportedRecords.length}
                onStartBatch={handleStartBatch}
                onStopBatch={handleStopBatch}
                onClearDoneBatch={() =>
                  setBatchQueue((prev) =>
                    prev.filter((i) => i.status !== 'done' && i.status !== 'error' && i.status !== 'stopped')
                  )
                }
                onOpenBatchItem={(id) => {
                  const found = batchQueue.find((i) => i.id === id);
                  if (found) loadVideoIntoStudio(found.file, { label: found.name });
                }}
                onRemoveBatchItem={(id) =>
                  setBatchQueue((prev) => prev.filter((i) => i.id !== id))
                }
                onGoStudio={() => navigateStudio('clips')}
                onGoExports={() => setView('exports')}
                onGoAiVideo={() => setView('aivideo')}
              />
            )}

            {view === 'studio' && (
              <StudioView
                activeTab={studioTab}
                onChangeTab={setStudioTab}
                videoElRef={videoRef}
                videoReady={videoReady}
                videoDuration={videoDuration}
                videoDims={videoDims}
                activeLabel={activeLabel}
                ytPreview={ytPreview}
                subtitleMode={subtitleMode}
                onChangeSubtitleMode={(mode) => {
                  setSubtitleMode(mode);
                  if (videoReady && videoDuration > 0) {
                    const next = recomputeClips({
                      duration: videoDuration,
                      currentCues: cues,
                      subMode: mode,
                      env: audioEnv,
                      lenRange: clipLengthRange,
                      limit: clipLimit,
                    });
                    setClips(next);
                  }
                }}
                importedSubName={importedSubName}
                onPickSubtitleFile={handlePickSubtitleFile}
                onResetSubtitleFile={() => {
                  setImportedSubName('');
                  setCues([]);
                  setTranscriptEditorText('');
                  if (videoReady && videoDuration > 0) {
                    const next = recomputeClips({
                      duration: videoDuration,
                      currentCues: [],
                      subMode: subtitleMode,
                      env: audioEnv,
                      lenRange: clipLengthRange,
                      limit: clipLimit,
                    });
                    setClips(next);
                  }
                }}
                cues={cues}
                transcriptEditorText={transcriptEditorText}
                onChangeTranscriptEditorText={setTranscriptEditorText}
                onApplyTranscriptEdit={() => {
                  const { cues: parsed, bad } = parseEditedTranscript(transcriptEditorText);
                  if (!parsed.length) {
                    setStatusMessage('Tidak ada baris subtitle bertimecode yang valid.');
                    return;
                  }
                  setCues(parsed);
                  setStatusMessage(
                    `Subtitle diperbarui (${parsed.length} baris${bad ? `, ${bad} baris dilewati` : ''}).`
                  );
                }}
                onDownloadSrt={() => {
                  if (!cues.length) return;
                  const blob = new Blob(['\uFEFF' + cuesToSrt(cues)], {
                    type: 'application/x-subrip;charset=utf-8',
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'subtitle-autoclipper.srt';
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
                aiTranscribeConsent={aiTranscribeConsent}
                onChangeAiTranscribeConsent={setAiTranscribeConsent}
                aiTranscribeLang={aiTranscribeLang}
                onChangeAiTranscribeLang={setAiTranscribeLang}
                aiTranscribing={aiTranscribing}
                transcribeProgressPct={transcribeProgressPct}
                transcribeElapsedSec={transcribeElapsedSec}
                transcribeEstimatedSec={transcribeEstimatedSec}
                transcribeStageLabel={transcribeStageLabel}
                transcribeError={transcribeError}
                onRunAiTranscribe={handleRunAiTranscribe}
                onCancelAiTranscribe={handleCancelAiTranscribe}
                clipLengthRange={clipLengthRange}
                onChangeClipLengthRange={(val) => {
                  setClipLengthRange(val);
                  if (videoReady && videoDuration > 0) {
                    setClips(
                      recomputeClips({
                        duration: videoDuration,
                        currentCues: cues,
                        subMode: subtitleMode,
                        env: audioEnv,
                        lenRange: val,
                        limit: clipLimit,
                      })
                    );
                  }
                }}
                clipLimit={clipLimit}
                onChangeClipLimit={(lim) => {
                  setClipLimit(lim);
                  if (videoReady && videoDuration > 0) {
                    setClips(
                      recomputeClips({
                        duration: videoDuration,
                        currentCues: cues,
                        subMode: subtitleMode,
                        env: audioEnv,
                        lenRange: clipLengthRange,
                        limit: lim,
                      })
                    );
                  }
                }}
                onReanalyzeClips={() => {
                  if (!videoReady || videoDuration <= 0) return;
                  const next = recomputeClips({
                    duration: videoDuration,
                    currentCues: cues,
                    subMode: subtitleMode,
                    env: audioEnv,
                    lenRange: clipLengthRange,
                    limit: clipLimit,
                  });
                  setClips(next);
                  setStatusMessage(`${next.length} kandidat klip diperbarui.`);
                }}
                aiFindingHighlights={aiFindingHighlights}
                onFindAiHighlights={handleFindAiHighlights}
                clips={clips}
                onToggleClip={(id) =>
                  setClips((prev) =>
                    prev.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c))
                  )
                }
                onNudgeClip={(id, edge, delta) =>
                  setClips((prev) =>
                    prev.map((c) => {
                      if (c.id !== id) return c;
                      if (edge === 'start') {
                        const nextStart = Math.max(0, Math.min(c.end - 2, c.start + delta));
                        return { ...c, start: Math.round(nextStart * 100) / 100 };
                      }
                      const maxDur = videoDuration > 0 ? videoDuration : c.end + 10;
                      const nextEnd = Math.min(maxDur, Math.max(c.start + 2, c.end + delta));
                      return { ...c, end: Math.round(nextEnd * 100) / 100 };
                    })
                  )
                }
                onSetClipRange={(id, nextStart, nextEnd) =>
                  setClips((prev) =>
                    prev.map((c) => {
                      if (c.id !== id) return c;
                      const maxDur = videoDuration > 0 ? videoDuration : nextEnd;
                      const safeStart = Math.max(0, Math.min(maxDur - 2, nextStart));
                      const safeEnd = Math.min(maxDur, Math.max(safeStart + 2, nextEnd));
                      return {
                        ...c,
                        start: Math.round(safeStart * 100) / 100,
                        end: Math.round(safeEnd * 100) / 100,
                      };
                    })
                  )
                }
                captionSettings={captionSettings}
                onChangeCaptionSettings={(patch) =>
                  setCaptionSettings((prev) => ({ ...prev, ...patch }))
                }
                framingMode={framingMode}
                onChangeFramingMode={setFramingMode}
                manualPanX={manualPanX}
                onChangeManualPanX={setManualPanX}
                exportFormat={exportFormat}
                onChangeExportFormat={setExportFormat}
                exporting={exporting}
                exportProgressPct={exportProgressPct}
                exportProgressLabel={exportProgressLabel}
                statusMessage={statusMessage}
                onStartExport={handleStartExport}
                onStopExport={() => exportAbortRef.current?.abort()}
                latestDownloads={latestDownloads}
                latestExportRecords={latestExportRecords}
                audioEnv={audioEnv}
                onChangeSourceHome={() => setView('home')}
              />
            )}

            {view === 'aivideo' && (
              <AiVideoView
                captionSettings={captionSettings}
                onChangeCaptionSettings={(patch) =>
                  setCaptionSettings((prev) => ({ ...prev, ...patch }))
                }
                onRegisterExport={(rec) => setExportedRecords((prev) => [rec, ...prev])}
                onSendToStudio={async (file, srtText, title) => {
                  const parsed = parseSubs(srtText);
                  setImportedSubName('Subtitle Video AI');
                  setSubtitleMode('external');
                  await loadVideoIntoStudio(file, { label: title, initialCues: parsed });
                }}
              />
            )}

            {view === 'exports' && (
              <ExportsView
                records={exportedRecords}
                onBackToStudio={() => navigateStudio('clips')}
                onRemoveRecord={(id) => {
                  setExportedRecords((prev) => {
                    const target = prev.find((r) => r.id === id);
                    if (target) {
                      try {
                        URL.revokeObjectURL(target.url);
                      } catch {}
                    }
                    return prev.filter((r) => r.id !== id);
                  });
                }}
                onRemoveProject={(projectId) => {
                  setExportedRecords((prev) => {
                    prev
                      .filter((r) => (r.projectId || r.sourceLabel || 'projek-utama') === projectId)
                      .forEach((r) => {
                        try {
                          URL.revokeObjectURL(r.url);
                        } catch {}
                      });
                    return prev.filter(
                      (r) => (r.projectId || r.sourceLabel || 'projek-utama') !== projectId
                    );
                  });
                }}
                onClearAll={() => {
                  exportedRecords.forEach((r) => {
                    try {
                      URL.revokeObjectURL(r.url);
                    } catch {}
                  });
                  setExportedRecords([]);
                }}
              />
            )}

            {view === 'updates' && (
              <UpdatesView
                hasActiveMedia={Boolean(activeFile)}
                exportedCount={exportedRecords.length}
                firestoreStatus={firestoreStatus}
                firestoreProjectId={FIREBASE_PROJECT_ID}
                firestoreDatabaseId={FIRESTORE_DATABASE_ID}
                fbUser={fbUser}
                authReady={authReady}
                authError={authError}
                onSignInGoogle={handleSignInGoogle}
                onSignOutGoogle={handleSignOutGoogle}
                onBackHome={() => setView('home')}
              />
            )}
          </main>
        </div>
      </div>
    </ErrorBoundary>
  );
}
