import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  CloudUpload,
  Database,
  Download,
  ImagePlus,
  Mic,
  Pause,
  Play,
  Sparkles,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react';
import type {
  AiScene,
  AiTheme,
  AiTransitionStyle,
  AiVisualEffect,
  AiVoiceTrack,
  CaptionSettings,
  ExportFormat,
  ExportedClipRecord,
} from '../types/clipper';
import {
  buildTimeline,
  measureAudioDuration,
  renderAiVideo,
  renderSceneFrame,
  renderTimelineFrame,
  type RenderedSceneFrame,
} from '../utils/aiPipeline';
import type { SavedAiScript } from '../utils/firestoreSync';
import { buildSrtFromScenes, formatClock } from '../utils/subtitles';
import { CaptionStylePanel } from './CaptionStylePanel';

interface AiVideoViewProps {
  captionSettings: CaptionSettings;
  onChangeCaptionSettings: (patch: Partial<CaptionSettings>) => void;
  onRegisterExport: (record: ExportedClipRecord) => void;
  onSendToStudio: (file: File, srtText: string, title: string) => void;
  fbSignedIn: boolean;
  onSignInGoogle: () => void;
  savedAiScripts: SavedAiScript[];
  onSaveScriptCloud: (payload: {
    scriptId?: string;
    title: string;
    prompt: string;
    durationMinutes: number;
    totalDurationSec: number;
    theme: AiTheme;
    language: 'id' | 'en';
    voiceName: string;
    scenes: AiScene[];
  }) => Promise<string | void>;
  onDeleteScriptCloud: (scriptId: string) => Promise<void>;
}

const VOICE_PRESETS: Array<{ id: string; label: string; shortName: string; previewUrl?: string }> = [
  {
    id: 'ricky',
    shortName: 'Ricky',
    label: 'Ricky · Lembut & Autentik (Indonesia)',
    previewUrl: '/assets/aistudio/voice_preview_ricky_-_soft___authentic_indonesian_e1eddf78.mp3',
  },
  {
    id: 'sikedewo',
    shortName: 'Sikedewo',
    label: 'Sikedewo · Lembut, Tenang & Jelas (Indonesia)',
    previewUrl: '/assets/aistudio/voice_preview_sikedewo_-_tender__calm_and_clear_67f5636e.mp3',
  },
  {
    id: 'todd',
    shortName: 'Todd',
    label: 'Todd · Jelas, Menarik & Edukatif',
    previewUrl: '/assets/aistudio/voice_preview_todd_-_clear__engaging_and_educational_1be6d861.mp3',
  },
  {
    id: 'nichalia',
    shortName: 'Nichalia Schwartz',
    label: 'Nichalia Schwartz · Cerah & Ramah',
    previewUrl: '/assets/aistudio/voice_preview_nichalia_schwartz_-_bright_and_friendly_0cd738b6.mp3',
  },
  { id: 'Kore', shortName: 'Kore', label: 'Kore · Natural & Jelas (Standar)' },
  { id: 'Puck', shortName: 'Puck', label: 'Puck · Cerah & Enerjik (Standar)' },
  { id: 'Charon', shortName: 'Charon', label: 'Charon · Berat & Berwibawa (Standar)' },
  { id: 'Fenrir', shortName: 'Fenrir', label: 'Fenrir · Tegas & Cepat (Standar)' },
  { id: 'Zephyr', shortName: 'Zephyr', label: 'Zephyr · Tenang & Hangat (Standar)' },
];

const DURATION_OPTIONS = [
  { minutes: 5, sceneCount: 15, label: '5 Menit · 15 Adegan (Minimal)' },
  { minutes: 6, sceneCount: 18, label: '6 Menit · 18 Adegan (Standar)' },
  { minutes: 7, sceneCount: 21, label: '7 Menit · 21 Adegan (Mendalam)' },
  { minutes: 8, sceneCount: 24, label: '8 Menit · 24 Adegan (Panjang)' },
  { minutes: 10, sceneCount: 28, label: '10 Menit · 28 Adegan (Lengkap)' },
];

export function AiVideoView({
  captionSettings,
  onChangeCaptionSettings,
  onRegisterExport,
  onSendToStudio,
  fbSignedIn,
  onSignInGoogle,
  savedAiScripts,
  onSaveScriptCloud,
  onDeleteScriptCloud,
}: AiVideoViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const micRecorderRef = useRef<{ recorder: MediaRecorder; chunks: BlobPart[]; stream: MediaStream } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const voiceSampleAudioRef = useRef<HTMLAudioElement | null>(null);

  const [prompt, setPrompt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(5);
  const [language, setLanguage] = useState<'id' | 'en'>('id');
  const [theme, setTheme] = useState<AiTheme>('cinematic');
  const [videoType, setVideoType] = useState('general');
  const [showGuide, setShowGuide] = useState(true);
  const [fontTick, setFontTick] = useState(0);

  const selectedDuration =
    DURATION_OPTIONS.find((opt) => opt.minutes === durationMinutes) || DURATION_OPTIONS[0];
  const sceneCount = selectedDuration.sceneCount;

  const [voiceName, setVoiceName] = useState('ricky');
  const [voiceStyle, setVoiceStyle] = useState('Clear, engaging short-form video narrator');
  const [playingSampleId, setPlayingSampleId] = useState<string | null>(null);

  const selectedVoicePreset =
    VOICE_PRESETS.find((vp) => vp.id === voiceName) || VOICE_PRESETS[0];

  const [visualEffect, setVisualEffect] = useState<AiVisualEffect>('kenburns');
  const [transitionStyle, setTransitionStyle] = useState<AiTransitionStyle>('fade');
  const [audioGainPct, setAudioGainPct] = useState(105);
  const [enhanceAudio, setEnhanceAudio] = useState(true);
  const [includeCaptions, setIncludeCaptions] = useState(true);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('webm');

  const [title, setTitle] = useState('');
  const [activeCloudScriptId, setActiveCloudScriptId] = useState<string | undefined>(undefined);
  const [savingScript, setSavingScript] = useState(false);
  const [scenes, setScenes] = useState<AiScene[]>([]);
  const [frames, setFrames] = useState<RenderedSceneFrame[]>([]);
  const [voices, setVoices] = useState<Array<AiVoiceTrack | null>>([]);
  const [busy, setBusy] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressLabel, setProgressLabel] = useState('Siap');
  const [statusText, setStatusText] = useState('Masukkan topik lalu jalankan Tahap 1 untuk menyusun naskah & adegan 9:16.');
  const [micSceneIdx, setMicSceneIdx] = useState<number | null>(null);

  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewSec, setPreviewSec] = useState(0);

  const [finalVideo, setFinalVideo] = useState<{
    blob: Blob;
    url: string;
    ext: string;
    durationSec: number;
    sizeBytes: number;
    renderMs: number;
    srtText: string;
  } | null>(null);

  const timeline = buildTimeline(scenes, frames, voices);
  const totalSec = timeline[timeline.length - 1]?.endSec || 0;

  // Draw preview frame
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d', { alpha: false });
    if (!ctx) return;

    if (!timeline.length) {
      ctx.fillStyle = '#07090d';
      ctx.fillRect(0, 0, 720, 1280);
      ctx.strokeStyle = '#1e2432';
      ctx.lineWidth = 2;
      ctx.strokeRect(36, 36, 648, 1208);
      ctx.fillStyle = '#cbd2de';
      ctx.font = '700 24px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Pratinjau Video AI 9:16', 360, 610);
      ctx.fillStyle = '#687285';
      ctx.font = '500 18px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Buat naskah & visual untuk pratinjau', 360, 652);
      return;
    }

    renderTimelineFrame(ctx, 720, 1280, timeline, Math.min(totalSec, previewSec), {
      visualEffect,
      transitionStyle,
      includeCaptions,
      captionSettings,
    });
  }, [timeline, totalSec, previewSec, visualEffect, transitionStyle, includeCaptions, captionSettings, fontTick]);

  // Animated playback loop
  useEffect(() => {
    if (!previewPlaying || totalSec <= 0) return;
    const startAt = performance.now() - previewSec * 1000;
    const timer = window.setInterval(() => {
      const elapsed = (performance.now() - startAt) / 1000;
      if (elapsed >= totalSec) {
        setPreviewSec(0);
        setPreviewPlaying(false);
      } else {
        setPreviewSec(elapsed);
      }
    }, 33);
    return () => clearInterval(timer);
  }, [previewPlaying, totalSec]);

  // Stop voice sample audio cleanly on unmount
  useEffect(() => {
    return () => {
      if (voiceSampleAudioRef.current) {
        voiceSampleAudioRef.current.pause();
        voiceSampleAudioRef.current = null;
      }
    };
  }, []);

  const stopVoiceSample = () => {
    if (voiceSampleAudioRef.current) {
      voiceSampleAudioRef.current.pause();
      voiceSampleAudioRef.current.currentTime = 0;
      voiceSampleAudioRef.current = null;
    }
    setPlayingSampleId(null);
  };

  const handleToggleVoiceSample = () => {
    if (!selectedVoicePreset.previewUrl) return;
    if (playingSampleId === selectedVoicePreset.id && voiceSampleAudioRef.current) {
      stopVoiceSample();
      return;
    }
    stopVoiceSample();
    const audio = new Audio(selectedVoicePreset.previewUrl);
    voiceSampleAudioRef.current = audio;
    setPlayingSampleId(selectedVoicePreset.id);
    audio.onended = () => {
      if (voiceSampleAudioRef.current === audio) {
        voiceSampleAudioRef.current = null;
        setPlayingSampleId(null);
      }
    };
    audio.onerror = () => {
      if (voiceSampleAudioRef.current === audio) {
        voiceSampleAudioRef.current = null;
        setPlayingSampleId(null);
      }
    };
    audio.play().catch(() => {
      setPlayingSampleId(null);
    });
  };

  const generateScript = async (): Promise<AiScene[] | null> => {
    if (!prompt.trim()) {
      setStatusText('Masukkan topik atau deskripsi video terlebih dahulu.');
      return null;
    }
    setBusy(true);
    setProgressPct(15);
    setProgressLabel('1/4 · Menyusun naskah & timestamp dengan Gemini');
    setStatusText('Menghubungi agen naskah AI…');
    try {
      const res = await fetch('/api/ai-video/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          sceneCount,
          targetDurationMin: durationMinutes,
          language,
          visualTheme: theme,
          videoType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyusun naskah AI.');

      voices.forEach((v) => {
        if (v?.url) {
          try {
            URL.revokeObjectURL(v.url);
          } catch {}
        }
      });

      const nextScenes: AiScene[] = data.scenes || [];
      setTitle(data.title || prompt.trim());
      setActiveCloudScriptId(undefined);
      setScenes(nextScenes);
      setFrames([]);
      setVoices(new Array(nextScenes.length).fill(null));
      setPreviewSec(0);
      setPreviewPlaying(false);
      setProgressPct(30);
      setProgressLabel('1/4 · Naskah siap');
      const totalDur = Number(data.totalDurationSec) || nextScenes.reduce((acc, s) => acc + (s.durationSec || 0), 0);
      setStatusText(
        `Naskah "${data.title}" selesai (${nextScenes.length} adegan · total ${formatClock(totalDur)}). Lanjutkan ke Tahap 2.`
      );
      return nextScenes;
    } catch (err) {
      setStatusText(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const generateFrames = async (targetScenes = scenes): Promise<RenderedSceneFrame[] | null> => {
    if (!targetScenes.length) {
      setStatusText('Buat naskah terlebih dahulu pada Tahap 1.');
      return null;
    }
    setBusy(true);
    setProgressPct(38);
    setProgressLabel('2/4 · Merender frame visual 9:16');
    setStatusText('Menyiapkan frame visual untuk tiap adegan…');
    try {
      const out: RenderedSceneFrame[] = [];
      for (let i = 0; i < targetScenes.length; i++) {
        const frame = await renderSceneFrame(targetScenes[i], i, targetScenes.length, theme);
        out.push(frame);
        setProgressPct(38 + ((i + 1) / targetScenes.length) * 18);
      }
      setFrames(out);
      setProgressPct(56);
      setProgressLabel('2/4 · Visual 9:16 siap');
      setStatusText(`${out.length} frame visual 9:16 siap. Anda dapat mengunggah gambar kustom per adegan.`);
      return out;
    } catch (err) {
      setStatusText(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const synthesizeOneVoice = async (sc: AiScene, signal?: AbortSignal): Promise<AiVoiceTrack> => {
    const res = await fetch('/api/ai-video/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: sc.narration || sc.visualTitle,
        voiceName,
        style: voiceStyle,
      }),
      signal,
    });
    const data = await res.json();
    if (!res.ok || !data.audioDataUrl) {
      throw new Error(data.error || 'Gagal membuat suara narasi AI.');
    }
    const resp = await fetch(data.audioDataUrl, { signal });
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const durationSec = await measureAudioDuration(url, sc.durationSec);
    return { url, durationSec, source: 'tts' };
  };

  const generateAllVoices = async (
    targetScenes = scenes
  ): Promise<{ tracks: Array<AiVoiceTrack | null>; aborted: boolean } | null> => {
    if (!targetScenes.length) return null;
    setBusy(true);
    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;
    setProgressPct(60);
    setProgressLabel(`3/4 · Membuat narasi AI (${selectedVoicePreset.shortName})`);
    setStatusText(`Menghasilkan suara narasi ${selectedVoicePreset.shortName} untuk ${targetScenes.length} adegan…`);
    let failedCount = 0;
    try {
      const nextVoices: Array<AiVoiceTrack | null> = new Array(targetScenes.length)
        .fill(null)
        .map((_, idx) => voices[idx] ?? null);

      for (let i = 0; i < targetScenes.length; i++) {
        if (ctrl.signal.aborted) break;
        setProgressPct(60 + ((i + 1) / targetScenes.length) * 18);
        setProgressLabel(`3/4 · Suara adegan ${i + 1}/${targetScenes.length}`);
        if (nextVoices[i]?.url) {
          try {
            URL.revokeObjectURL(nextVoices[i]!.url);
          } catch {}
        }
        try {
          nextVoices[i] = await synthesizeOneVoice(targetScenes[i], ctrl.signal);
          setVoices([...nextVoices]);
        } catch (err) {
          if ((err as { name?: string })?.name === 'AbortError' || ctrl.signal.aborted) {
            return { tracks: nextVoices, aborted: true };
          }
          failedCount++;
          nextVoices[i] = null;
        }
      }

      if (ctrl.signal.aborted) {
        setStatusText('Pembuatan suara narasi dibatalkan.');
        return { tracks: nextVoices, aborted: true };
      }

      setProgressPct(78);
      setProgressLabel('3/4 · Suara narasi AI siap');
      setStatusText(
        failedCount > 0
          ? `Narasi selesai dengan ${failedCount} adegan tanpa suara (Anda dapat klik "Suara AI" atau "Rekam Suara" pada adegan tersebut).`
          : 'Semua suara narasi siap dirangkai menjadi video.'
      );
      return { tracks: nextVoices, aborted: false };
    } finally {
      if (abortControllerRef.current === ctrl) {
        abortControllerRef.current = null;
      }
      setBusy(false);
    }
  };

  const renderFinalVideo = async (
    targetScenes = scenes,
    targetFrames = frames,
    targetVoices = voices
  ) => {
    const tl = buildTimeline(targetScenes, targetFrames, targetVoices);
    if (!tl.length) {
      setStatusText('Selesaikan Tahap 1 dan 2 terlebih dahulu sebelum merender.');
      return;
    }
    setPreviewPlaying(false);
    setBusy(true);
    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;
    setProgressPct(80);
    setProgressLabel('4/4 · Merangkai frame & audio');
    setStatusText('Merender video AI 9:16 secara real-time…');

    try {
      const result = await renderAiVideo({
        timeline: tl,
        visualEffect,
        transitionStyle,
        includeCaptions,
        captionSettings,
        audioGain: audioGainPct / 100,
        enhanceAudio,
        exportFormat,
        signal: ctrl.signal,
        onProgress: (pct, sec, tot) => {
          setProgressPct(80 + pct * 0.2);
          setProgressLabel(`4/4 · Merender ${sec.toFixed(1)}s / ${tot.toFixed(1)}s`);
          setPreviewSec(sec);
        },
      });

      const durations = tl.map((s) => s.durationSec);
      const srtText = buildSrtFromScenes(targetScenes, durations);
      setFinalVideo({ ...result, srtText });

      const slug =
        (title || 'ai-video')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 48) || 'ai-video';
      const filename = `${slug}-9x16.${result.ext}`;

      const projectTitle = title || 'Video AI Otomatis';
      onRegisterExport({
        id: `ai-${Date.now()}`,
        projectId: `ai-${slug}`,
        projectName: `Video AI · ${projectTitle}`,
        url: result.url,
        filename,
        ext: result.ext,
        rangeText: `0:00–${formatClock(result.durationSec)}`,
        durationSec: result.durationSec,
        sizeBytes: result.sizeBytes,
        label: projectTitle,
        sourceLabel: 'Video AI Otomatis',
        captionText: targetScenes.map((s) => s.narration).filter(Boolean).slice(0, 2).join(' '),
        createdAt: Date.now(),
      });

      setProgressPct(100);
      setProgressLabel('Selesai · Video AI siap diunduh');
      setStatusText('Video AI berhasil dibuat dan masuk ke Galeri Hasil Ekspor!');
    } catch (err) {
      setStatusText(err instanceof Error ? err.message : String(err));
    } finally {
      abortControllerRef.current = null;
      setBusy(false);
    }
  };

  const handleRunAll = async () => {
    const sc = await generateScript();
    if (!sc) return;
    const fr = await generateFrames(sc);
    if (!fr) return;
    const voiceRes = await generateAllVoices(sc);
    if (voiceRes?.aborted) return;
    const vc = voiceRes?.tracks || new Array(sc.length).fill(null);
    await renderFinalVideo(sc, fr, vc);
  };

  const handleSceneImageUpload = async (idx: number, file: File) => {
    const url = URL.createObjectURL(file);
    const nextScenes = scenes.map((sc, i) => {
      if (i !== idx) return sc;
      if (sc.customImageUrl) {
        try {
          URL.revokeObjectURL(sc.customImageUrl);
        } catch {}
      }
      return { ...sc, customImageUrl: url };
    });
    setScenes(nextScenes);
    const updatedFrame = await renderSceneFrame(nextScenes[idx], idx, nextScenes.length, theme);
    setFrames((prev) => {
      const next = [...prev];
      next[idx] = updatedFrame;
      return next;
    });
  };

  const handleToggleMic = async (idx: number) => {
    if (micSceneIdx === idx && micRecorderRef.current) {
      const { recorder, chunks, stream } = micRecorderRef.current;
      micRecorderRef.current = null;
      setMicSceneIdx(null);
      await new Promise<void>((resolve) => {
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          if (blob.size > 0) {
            const url = URL.createObjectURL(blob);
            const dur = await measureAudioDuration(url, scenes[idx]?.durationSec || 5);
            setVoices((prev) => {
              const next = [...prev];
              if (next[idx]?.url) {
                try {
                  URL.revokeObjectURL(next[idx]!.url);
                } catch {}
              }
              next[idx] = { url, durationSec: dur, source: 'microphone' };
              return next;
            });
            setStatusText(`Rekaman suara Adegan ${idx + 1} tersimpan (${dur.toFixed(1)} dtk).`);
          }
          resolve();
        };
        recorder.stop();
      });
      return;
    }

    if (micSceneIdx !== null) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      micRecorderRef.current = { recorder, chunks, stream };
      recorder.start();
      setMicSceneIdx(idx);
      setStatusText(`Merekam mikrofon untuk Adegan ${idx + 1}… klik Stop Rekam setelah selesai.`);
    } catch (err) {
      setStatusText(`Akses mikrofon gagal: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[316px_minmax(0,1fr)] gap-6 items-start">
      {/* Left Sticky 9:16 AI Video Preview */}
      <aside className="bg-[#11141c] border border-[#1e2432] rounded-xl p-4 flex flex-col items-center gap-3 lg:sticky lg:top-20">
        <div className="w-full text-center text-xs font-semibold truncate pb-2 border-b border-[#1e2432] text-[#c7ff55]">
          {title || 'Pembuat Video AI 9:16'}
        </div>

        <canvas
          ref={canvasRef}
          width={720}
          height={1280}
          className="w-full max-w-[264px] aspect-[9/16] bg-[#06080c] border border-[#2d3548] rounded-xl block"
        />

        <div className="w-full space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={!frames.length}
              onClick={() => {
                if (previewSec >= totalSec - 0.1) setPreviewSec(0);
                setPreviewPlaying((p) => !p);
              }}
              className="py-2 px-3 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
            >
              {previewPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {previewPlaying ? 'Jeda' : 'Pratinjau'}
            </button>
            <button
              type="button"
              disabled={!frames.length}
              onClick={() => {
                setPreviewPlaying(false);
                setPreviewSec(0);
              }}
              className="py-2 px-3 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-xs font-semibold text-[#cbd2de] disabled:opacity-40 cursor-pointer"
            >
              Awal
            </button>
          </div>
          <input
            type="range"
            min={0}
            max={1000}
            disabled={!frames.length || totalSec <= 0}
            value={totalSec ? Math.round((previewSec / totalSec) * 1000) : 0}
            onChange={(e) => {
              setPreviewPlaying(false);
              setPreviewSec((Number(e.target.value) / 1000) * totalSec);
            }}
            className="w-full cursor-pointer disabled:opacity-40"
          />
          <div className="text-[11px] font-mono tabular-nums text-[#8f98a8] text-center">
            {totalSec > 0
              ? `${formatClock(previewSec)} / ${formatClock(totalSec)}`
              : 'Buat naskah & gambar untuk pratinjau'}
          </div>
        </div>

        {finalVideo && (
          <div className="w-full pt-3 border-t border-[#1e2432] space-y-2.5">
            <div className="text-xs font-bold text-emerald-400">Video Final AI Siap</div>
            <video
              src={finalVideo.url}
              controls
              playsInline
              className="w-full aspect-[9/16] rounded-lg bg-[#05070a]"
            />
            <a
              href={finalVideo.url}
              download={`video-ai.${finalVideo.ext}`}
              className="w-full py-2 px-3 rounded-lg bg-[#c7ff55] hover:bg-[#d6ff7d] text-[#111507] text-xs font-bold inline-flex items-center justify-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Unduh ({(finalVideo.sizeBytes / (1024 * 1024)).toFixed(1)} MB)
            </a>
            <button
              type="button"
              onClick={() => {
                const file = new File([finalVideo.blob], `video-ai.${finalVideo.ext}`, {
                  type: finalVideo.blob.type || 'video/webm',
                });
                onSendToStudio(file, finalVideo.srtText, title || 'Video AI Otomatis');
              }}
              className="w-full py-2 px-3 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-xs font-semibold text-white cursor-pointer"
            >
              Edit Lanjut di Studio 9:16 →
            </button>
          </div>
        )}
      </aside>

      {/* Right 4-Stage Pipeline */}
      <div className="space-y-4 min-w-0">
        {/* Panduan & Langkah Penggunaan Video AI */}
        <section className="bg-[#11141c] border border-[#1e2432] rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowGuide((v) => !v)}
            className="w-full px-5 py-3.5 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-[#151924] transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <BookOpen className="w-4 h-4 text-[#c7ff55] shrink-0" />
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-white">
                  Panduan &amp; Langkah Penggunaan Video AI (Minimal 5 Menit)
                </h2>
                <p className="text-xs text-[#8f98a8] truncate">
                  Ikuti urutan 4 langkah berikut agar naskah, visual, suara narasi, dan render berjalan lancar.
                </p>
              </div>
            </div>
            <span className="text-xs font-semibold text-[#cbd2de] inline-flex items-center gap-1 shrink-0 whitespace-nowrap">
              {showGuide ? 'Sembunyikan' : 'Lihat Panduan'}
              {showGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </span>
          </button>

          {showGuide && (
            <div className="px-5 pb-4 pt-2 border-t border-[#1e2432] space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="bg-[#0d1017] border border-[#1e2432] rounded-lg p-3 space-y-1">
                  <div className="font-bold text-[#c7ff55]">01. Tulis Topik &amp; Pilih Durasi (5–10 Menit)</div>
                  <p className="text-[#aeb6c4] leading-relaxed">
                    Ketik topik video secara jelas, pilih durasi minimal <strong className="text-white">5 menit</strong> hingga <strong className="text-white">10 menit</strong>, gaya konten, dan tema visual. Klik <strong className="text-white">1. Buat Naskah</strong> atau <strong className="text-white">Jalankan Semua Tahap (1→4)</strong>.
                  </p>
                </div>
                <div className="bg-[#0d1017] border border-[#1e2432] rounded-lg p-3 space-y-1">
                  <div className="font-bold text-[#c7ff55]">02. Periksa Naskah &amp; Gambar Adegan</div>
                  <p className="text-[#aeb6c4] leading-relaxed">
                    Setelah naskah muncul, Anda dapat mengedit kalimat narasi tiap adegan atau mengunggah gambar kustom per adegan agar visual lebih variatif sebelum suara dan video dibuat.
                  </p>
                </div>
                <div className="bg-[#0d1017] border border-[#1e2432] rounded-lg p-3 space-y-1">
                  <div className="font-bold text-[#c7ff55]">03. Render Visual &amp; Buat Suara Narasi</div>
                  <p className="text-[#aeb6c4] leading-relaxed">
                    Klik <strong className="text-white">2. Render Visual 9:16</strong> lalu <strong className="text-white">3. Buat Suara Narasi AI</strong> (atau gunakan <strong className="text-white">Rekam Suara</strong> mikrofon). Cek kesesuaian urutan lewat tombol <strong className="text-white">Pratinjau</strong> di panel kiri.
                  </p>
                </div>
                <div className="bg-[#0d1017] border border-[#1e2432] rounded-lg p-3 space-y-1">
                  <div className="font-bold text-[#c7ff55]">04. Rangkai, Render &amp; Unduh Hasil</div>
                  <p className="text-[#aeb6c4] leading-relaxed">
                    Pilih efek gerak, transisi, dan format <strong className="text-white">WebM</strong> (disarankan untuk durasi 5–10 menit), lalu klik <strong className="text-white">4. Rangkai &amp; Render Video</strong>. Biarkan tab browser tetap terbuka hingga selesai; hasil otomatis masuk ke <strong className="text-white">Hasil Ekspor</strong>.
                  </p>
                </div>
              </div>
              <p className="text-[11.5px] text-[#8f98a8]">
                Catatan: Pembuatan video berdurasi 5–10 menit merangkai 15–28 adegan serta proses render real-time di browser sesuai total durasi video. Anda dapat menekan tombol <strong className="text-[#e8edf5]">Batal</strong> kapan saja saat render berlangsung.
              </p>
            </div>
          )}
        </section>

        {/* Stage 1: Script */}
        <section className="bg-[#11141c] border border-[#1e2432] rounded-xl p-5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-white">1. Naskah &amp; Adegan (Gemini AI)</h2>
              <p className="text-xs text-[#8f98a8] mt-0.5">
                Tulis topik video; AI menyusun naskah mendalam berdurasi minimal 5 hingga 10 menit lengkap dengan timestamp.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={handleRunAll}
              className="px-4 py-2 rounded-lg bg-[#ff5436] hover:bg-[#ff6b52] disabled:opacity-40 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Jalankan Semua Tahap (1→4)
            </button>
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="Contoh: Panduan lengkap membangun kebiasaan keuangan sehat dari nol untuk pekerja muda beserta studi kasus nyata"
            className="w-full bg-[#080a0f] text-[#f3f5f8] border border-[#2d3548] rounded-lg p-3 text-xs leading-relaxed focus:outline-none focus:border-[#ff5436]"
          />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div>
              <label className="block text-[11px] text-[#b7c0cf] mb-1">
                Target Durasi (Min. 5 Menit)
              </label>
              <select
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="w-full bg-[#0d1017] text-[#f3f5f8] border border-[#2d3548] rounded-lg px-2.5 py-2 text-xs"
              >
                {DURATION_OPTIONS.map((opt) => (
                  <option key={opt.minutes} value={opt.minutes}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[#b7c0cf] mb-1">Gaya Konten</label>
              <select
                value={videoType}
                onChange={(e) => setVideoType(e.target.value)}
                className="w-full bg-[#0d1017] text-[#f3f5f8] border border-[#2d3548] rounded-lg px-2.5 py-2 text-xs"
              >
                <option value="general">Edukasi &amp; Storytelling</option>
                <option value="finance">Bisnis &amp; Ekonomi</option>
                <option value="prehistoric">Sejarah &amp; Fakta</option>
                <option value="pov">Cerita POV</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[#b7c0cf] mb-1">Tema Visual</label>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as AiTheme)}
                className="w-full bg-[#0d1017] text-[#f3f5f8] border border-[#2d3548] rounded-lg px-2.5 py-2 text-xs"
              >
                <option value="cinematic">Sinematik</option>
                <option value="editorial">Editorial</option>
                <option value="tech">Teknologi</option>
                <option value="minimal">Minimalis</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[#b7c0cf] mb-1">Bahasa</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as 'id' | 'en')}
                className="w-full bg-[#0d1017] text-[#f3f5f8] border border-[#2d3548] rounded-lg px-2.5 py-2 text-xs"
              >
                <option value="id">Indonesia</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => generateScript()}
              className="px-3.5 py-2 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-xs font-semibold text-white disabled:opacity-40 cursor-pointer"
            >
              1. Buat Naskah &amp; Timestamp AI
            </button>
            {fbSignedIn ? (
              <button
                type="button"
                disabled={busy || scenes.length === 0 || savingScript}
                onClick={async () => {
                  if (!scenes.length) return;
                  setSavingScript(true);
                  try {
                    const computedTotal = Math.max(
                      300,
                      scenes.reduce((acc, s) => acc + (Number(s.durationSec) || 20), 0)
                    );
                    const savedId = await onSaveScriptCloud({
                      scriptId: activeCloudScriptId,
                      title: title || prompt.trim() || 'Naskah Video AI',
                      prompt: prompt.trim() || title || 'Topik Video AI',
                      durationMinutes,
                      totalDurationSec: computedTotal,
                      theme,
                      language,
                      voiceName,
                      scenes,
                    });
                    if (savedId) setActiveCloudScriptId(savedId);
                    setStatusText('Naskah Video AI tersimpan di Firestore!');
                  } catch (err) {
                    setStatusText(err instanceof Error ? err.message : String(err));
                  } finally {
                    setSavingScript(false);
                  }
                }}
                className="px-3.5 py-2 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] disabled:opacity-40 text-xs font-semibold text-[#c7ff55] inline-flex items-center gap-1.5 cursor-pointer"
              >
                <CloudUpload className="w-3.5 h-3.5" />
                {savingScript ? 'Menyimpan…' : 'Simpan Naskah ke Firestore'}
              </button>
            ) : (
              <button
                type="button"
                onClick={onSignInGoogle}
                className="px-3.5 py-2 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-xs font-semibold text-[#cbd2de] inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Database className="w-3.5 h-3.5 text-[#c7ff55]" />
                Masuk Google untuk Simpan Cloud
              </button>
            )}
            <span className="text-xs font-mono tabular-nums text-[#8f98a8]">
              {scenes.length > 0
                ? `${scenes.length} adegan siap · Total ${formatClock(totalSec)}`
                : 'Belum ada naskah (min. 5:00)'}
            </span>
          </div>

          {fbSignedIn && savedAiScripts.length > 0 && (
            <div className="pt-3 border-t border-[#1e2432] space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                <Database className="w-3.5 h-3.5 text-[#c7ff55]" />
                <span>Naskah Tersimpan di Firestore ({savedAiScripts.length})</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[180px] overflow-y-auto pr-1">
                {savedAiScripts.map((scItem) => (
                  <div
                    key={scItem.id}
                    className="bg-[#0d1017] border border-[#1e2432] rounded-lg px-3 py-2 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">{scItem.title}</div>
                      <div className="text-[11px] font-mono tabular-nums text-[#8f98a8]">
                        {scItem.durationMinutes} mnt · {scItem.scenes.length} adegan · {scItem.voiceName}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          voices.forEach((v) => {
                            if (v?.url) {
                              try {
                                URL.revokeObjectURL(v.url);
                              } catch {}
                            }
                          });
                          setActiveCloudScriptId(scItem.id);
                          setTitle(scItem.title);
                          setPrompt(scItem.prompt);
                          setDurationMinutes(scItem.durationMinutes);
                          setTheme(scItem.theme);
                          setLanguage(scItem.language);
                          setVoiceName(scItem.voiceName);
                          setScenes(scItem.scenes);
                          setFrames([]);
                          setVoices(new Array(scItem.scenes.length).fill(null));
                          setFinalVideo(null);
                          setPreviewPlaying(false);
                          setPreviewSec(0);
                          setStatusText(
                            `Naskah "${scItem.title}" (${scItem.scenes.length} adegan) dimuat dari Firestore. Lanjutkan Tahap 2 untuk render visual.`
                          );
                        }}
                        className="px-2 py-1 rounded bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-[11px] font-semibold text-[#c7ff55] cursor-pointer disabled:opacity-40"
                      >
                        Muat
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onDeleteScriptCloud(scItem.id)}
                        title="Hapus naskah dari Firestore"
                        className="p-1 rounded bg-[#181c27] hover:bg-red-950/50 border border-[#2d3548] text-[#aeb6c4] hover:text-red-300 cursor-pointer disabled:opacity-40"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Stage 2 & 3: Scene Cards + Visuals + Voice */}
        <section className="bg-[#11141c] border border-[#1e2432] rounded-xl p-5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-white">2. Visual Adegan &amp; 3. Suara Narasi AI</h2>
            <div className="flex flex-wrap gap-2">
              {busy && abortControllerRef.current && (
                <button
                  type="button"
                  onClick={() => abortControllerRef.current?.abort()}
                  className="px-3 py-1.5 rounded-lg bg-[#181c27] hover:bg-red-950/50 border border-[#2d3548] text-xs font-bold text-white inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Square className="w-3 h-3 fill-current" />
                  Batal
                </button>
              )}
              <button
                type="button"
                disabled={busy || scenes.length === 0}
                onClick={() => generateFrames()}
                className="px-3 py-1.5 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-xs font-semibold text-white disabled:opacity-40 cursor-pointer"
              >
                2. Render Visual 9:16
              </button>
              <button
                type="button"
                disabled={busy || scenes.length === 0}
                onClick={() => generateAllVoices()}
                className="px-3 py-1.5 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-xs font-semibold text-white disabled:opacity-40 cursor-pointer"
              >
                3. Buat Suara Narasi AI
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] text-[#b7c0cf] mb-1">Karakter Suara AI (TTS)</label>
              <div className="flex items-center gap-2">
                <select
                  value={voiceName}
                  onChange={(e) => {
                    stopVoiceSample();
                    setVoiceName(e.target.value);
                  }}
                  className="flex-1 min-w-0 bg-[#0d1017] text-[#f3f5f8] border border-[#2d3548] rounded-lg px-2.5 py-2 text-xs"
                >
                  {VOICE_PRESETS.map((vp) => (
                    <option key={vp.id} value={vp.id}>
                      {vp.label}
                    </option>
                  ))}
                </select>
                {selectedVoicePreset.previewUrl && (
                  <button
                    type="button"
                    onClick={handleToggleVoiceSample}
                    title={`Putar contoh suara ${selectedVoicePreset.shortName}`}
                    className={`px-2.5 py-2 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer ${
                      playingSampleId === selectedVoicePreset.id
                        ? 'bg-[#c7ff55] text-[#111507] border-[#c7ff55]'
                        : 'bg-[#181c27] hover:bg-[#212636] border-[#2d3548] text-[#e8edf5]'
                    }`}
                  >
                    {playingSampleId === selectedVoicePreset.id ? (
                      <>
                        <Square className="w-3 h-3 fill-current" />
                        Stop
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5" />
                        Contoh
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-[#b7c0cf] mb-1">Gaya Bicara</label>
              <select
                value={voiceStyle}
                onChange={(e) => setVoiceStyle(e.target.value)}
                className="w-full bg-[#0d1017] text-[#f3f5f8] border border-[#2d3548] rounded-lg px-2.5 py-2 text-xs"
              >
                <option value="Clear, engaging short-form video narrator">Narator Shorts Menarik</option>
                <option value="Energetic, fast-paced YouTube creator">Kreator Enerjik &amp; Cepat</option>
                <option value="Calm, warm documentary storyteller">Storyteller Tenang</option>
                <option value="Confident professional presenter">Presenter Profesional</option>
              </select>
            </div>
          </div>

          {scenes.length === 0 ? (
            <div className="border border-dashed border-[#2d3548] rounded-lg p-6 text-center text-xs text-[#8f98a8] bg-[#0d1017]">
              Jalankan Tahap 1 untuk melihat daftar adegan, mengunggah gambar kustom, atau merekam suara narasi.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
              {scenes.map((sc, idx) => {
                const frame = frames[idx];
                const voice = voices[idx];
                const isMic = micSceneIdx === idx;
                return (
                  <div
                    key={idx}
                    className="bg-[#0d1017] border border-[#1e2432] rounded-xl p-3 grid grid-cols-[74px_minmax(0,1fr)] gap-3 items-start"
                  >
                    <div className="w-[74px] aspect-[9/16] rounded-lg bg-[#080a0f] border border-[#2d3548] overflow-hidden flex items-center justify-center text-[10px] text-[#687285] text-center p-1">
                      {frame ? (
                        <img src={frame.dataUrl} alt={sc.visualTitle} className="w-full h-full object-cover" />
                      ) : (
                        <span>Belum dirender</span>
                      )}
                    </div>

                    <div className="space-y-2 min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <strong className="text-white truncate">
                          {String(idx + 1).padStart(2, '0')}. {sc.visualTitle}
                        </strong>
                        <span className="font-mono tabular-nums text-[11px] text-[#8f98a8]">
                          {sc.timestampLabel} ·{' '}
                          {voice ? `${voice.durationSec.toFixed(1)}s (${voice.source === 'microphone' ? 'Mik' : 'TTS'})` : `${sc.durationSec}s`}
                        </span>
                      </div>

                      <textarea
                        rows={2}
                        value={sc.narration}
                        onChange={(e) => {
                          const val = e.target.value;
                          setScenes((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, narration: val, captionText: val } : item
                            )
                          );
                        }}
                        className="w-full bg-[#080a0f] text-[#f3f5f8] border border-[#2d3548] rounded-lg p-2 text-xs focus:outline-none focus:border-[#ff5436]"
                      />

                      <div className="flex flex-wrap items-center gap-2">
                        <label className="px-2.5 py-1 rounded-md bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-[11px] font-semibold text-[#e8edf5] inline-flex items-center gap-1 cursor-pointer">
                          <ImagePlus className="w-3 h-3" />
                          {frame?.isCustom ? 'Ganti Gambar' : 'Unggah Gambar'}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleSceneImageUpload(idx, f);
                              e.target.value = '';
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            try {
                              setStatusText(`Membuat suara Adegan ${idx + 1}…`);
                              const tr = await synthesizeOneVoice(sc);
                              setVoices((prev) => {
                                const next = [...prev];
                                if (next[idx]?.url) URL.revokeObjectURL(next[idx]!.url);
                                next[idx] = tr;
                                return next;
                              });
                              setStatusText(`Suara Adegan ${idx + 1} siap.`);
                            } catch (err) {
                              setStatusText(err instanceof Error ? err.message : String(err));
                            }
                          }}
                          className="px-2.5 py-1 rounded-md bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-[11px] font-semibold text-[#e8edf5] inline-flex items-center gap-1 disabled:opacity-40 cursor-pointer"
                        >
                          <Volume2 className="w-3 h-3" />
                          Suara AI
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleMic(idx)}
                          className={`px-2.5 py-1 rounded-md border text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer ${
                            isMic
                              ? 'bg-red-950/50 border-red-500 text-red-200'
                              : 'bg-[#181c27] hover:bg-[#212636] border-[#2d3548] text-[#e8edf5]'
                          }`}
                        >
                          <Mic className="w-3 h-3" />
                          {isMic ? 'Stop Rekam' : 'Rekam Suara'}
                        </button>
                        {voice && (
                          <audio controls src={voice.url} className="h-7 max-w-[200px]" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Stage 4: Video Editing & Render */}
        <section className="bg-[#11141c] border border-[#1e2432] rounded-xl p-5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-white">4. Komposisi &amp; Render Video 9:16</h2>
            <div className="flex items-center gap-2">
              {busy && abortControllerRef.current && (
                <button
                  type="button"
                  onClick={() => abortControllerRef.current?.abort()}
                  className="px-3 py-2 rounded-lg bg-[#181c27] hover:bg-red-950/50 border border-[#2d3548] text-xs font-bold text-white inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Square className="w-3 h-3 fill-current" />
                  Batal
                </button>
              )}
              <button
                type="button"
                disabled={busy || frames.length === 0}
                onClick={() => renderFinalVideo()}
                className="px-4 py-2 rounded-lg bg-[#ff5436] hover:bg-[#ff6b52] disabled:opacity-40 text-white text-xs font-bold cursor-pointer"
              >
                4. Rangkai &amp; Render Video
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[#b7c0cf] mb-1">Efek Visual</label>
              <select
                value={visualEffect}
                onChange={(e) => setVisualEffect(e.target.value as AiVisualEffect)}
                className="w-full bg-[#0d1017] text-[#f3f5f8] border border-[#2d3548] rounded-lg px-2.5 py-2 text-xs"
              >
                <option value="kenburns">Ken Burns · Zoom &amp; Vignette Halus</option>
                <option value="cinematic">Sinematik · Vignette Kontras</option>
                <option value="pulse">Dinamis · Denyut Gerak Lembut</option>
                <option value="none">Polos · Tanpa Efek Gerak</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[#b7c0cf] mb-1">Transisi Antar-Adegan</label>
              <select
                value={transitionStyle}
                onChange={(e) => setTransitionStyle(e.target.value as AiTransitionStyle)}
                className="w-full bg-[#0d1017] text-[#f3f5f8] border border-[#2d3548] rounded-lg px-2.5 py-2 text-xs"
              >
                <option value="fade">Fade Halus</option>
                <option value="zoom">Cross Zoom</option>
                <option value="slide">Geser Horizontal</option>
                <option value="none">Potong Langsung</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[#b7c0cf] mb-1">
                Penguatan Audio Narasi (<span className="font-mono">{audioGainPct}%</span>)
              </label>
              <input
                type="range"
                min={50}
                max={180}
                value={audioGainPct}
                onChange={(e) => setAudioGainPct(Number(e.target.value))}
                className="w-full cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#b7c0cf] mb-1">Format Render</label>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                className="w-full bg-[#0d1017] text-[#f3f5f8] border border-[#2d3548] rounded-lg px-2.5 py-2 text-xs"
              >
                <option value="webm">WebM · paling stabil</option>
                <option value="mp4">MP4 · H.264 (jika didukung)</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-5 pt-1">
            <label className="inline-flex items-center gap-2 text-xs text-[#d6dce6] cursor-pointer">
              <input
                type="checkbox"
                checked={enhanceAudio}
                onChange={(e) => setEnhanceAudio(e.target.checked)}
              />
              <span>Kompresor Kejernihan Audio</span>
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-[#d6dce6] cursor-pointer">
              <input
                type="checkbox"
                checked={includeCaptions}
                onChange={(e) => setIncludeCaptions(e.target.checked)}
              />
              <span>Sertakan Subtitle Karaoke</span>
            </label>
          </div>

          {includeCaptions && (
            <CaptionStylePanel
              compact
              settings={captionSettings}
              onChange={onChangeCaptionSettings}
              onFontReady={() => setFontTick((t) => t + 1)}
            />
          )}

          {progressPct > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-[#cbd2de] truncate">{progressLabel}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {busy && abortControllerRef.current && (
                    <button
                      type="button"
                      onClick={() => abortControllerRef.current?.abort()}
                      className="px-2 py-0.5 rounded bg-[#181c27] hover:bg-red-950/50 border border-[#2d3548] text-[11px] font-semibold text-white inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Square className="w-2.5 h-2.5 fill-current" />
                      Batal
                    </button>
                  )}
                  <span className="font-mono tabular-nums font-bold text-[#c7ff55]">
                    {Math.round(progressPct)}%
                  </span>
                </div>
              </div>
              <div className="h-1.5 bg-[#1b202c] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#ff5436] transition-all duration-150"
                  style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
                />
              </div>
            </div>
          )}

          <div className="text-xs text-[#b9c2d0]">{statusText}</div>
        </section>
      </div>
    </div>
  );
}
