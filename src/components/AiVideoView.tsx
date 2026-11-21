import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Download,
  ImagePlus,
  Mic,
  Pause,
  Play,
  Sparkles,
  Square,
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
import { useTranslation } from '../i18n/LanguageContext';
import { APP_LANGUAGES, type AppLocale } from '../i18n/translations';
import {
  buildTimeline,
  measureAudioDuration,
  renderAiVideo,
  renderSceneFrame,
  renderTimelineFrame,
  type RenderedSceneFrame,
} from '../utils/aiPipeline';
import { buildSrtFromScenes, formatClock } from '../utils/subtitles';
import { readApiJson } from '../utils/safeApiJson';
import { CaptionStylePanel } from './CaptionStylePanel';

interface AiVideoViewProps {
  captionSettings: CaptionSettings;
  onChangeCaptionSettings: (patch: Partial<CaptionSettings>) => void;
  onRegisterExport: (record: ExportedClipRecord) => void;
  onSendToStudio: (file: File, srtText: string, title: string) => void;
}

const VOICE_PRESETS: Array<{ id: string; label: string; shortName: string; previewUrl?: string }> = [
  {
    id: 'ricky',
    shortName: 'Ricky',
    label: 'Ricky · Soft & Authentic (Indonesian)',
    previewUrl: '/assets/aistudio/voice_preview_ricky_-_soft___authentic_indonesian_e1eddf78.mp3',
  },
  {
    id: 'sikedewo',
    shortName: 'Sikedewo',
    label: 'Sikedewo · Tender, Calm & Clear (Indonesian)',
    previewUrl: '/assets/aistudio/voice_preview_sikedewo_-_tender__calm_and_clear_67f5636e.mp3',
  },
  {
    id: 'todd',
    shortName: 'Todd',
    label: 'Todd · Clear, Engaging & Educational',
    previewUrl: '/assets/aistudio/voice_preview_todd_-_clear__engaging_and_educational_1be6d861.mp3',
  },
  {
    id: 'nichalia',
    shortName: 'Nichalia Schwartz',
    label: 'Nichalia Schwartz · Bright & Friendly',
    previewUrl: '/assets/aistudio/voice_preview_nichalia_schwartz_-_bright_and_friendly_0cd738b6.mp3',
  },
  { id: 'Kore', shortName: 'Kore', label: 'Kore · Natural & Clear' },
  { id: 'Puck', shortName: 'Puck', label: 'Puck · Bright & Energetic' },
  { id: 'Charon', shortName: 'Charon', label: 'Charon · Deep & Authoritative' },
  { id: 'Fenrir', shortName: 'Fenrir', label: 'Fenrir · Assertive & Crisp' },
  { id: 'Zephyr', shortName: 'Zephyr', label: 'Zephyr · Calm & Warm' },
];

const DURATION_OPTIONS = [
  { minutes: 5, sceneCount: 22, labelKey: 'ai.dur5' as const },
  { minutes: 6, sceneCount: 26, labelKey: 'ai.dur6' as const },
  { minutes: 7, sceneCount: 30, labelKey: 'ai.dur7' as const },
  { minutes: 8, sceneCount: 34, labelKey: 'ai.dur8' as const },
  { minutes: 10, sceneCount: 42, labelKey: 'ai.dur10' as const },
];

interface SceneNarrationInputProps {
  index: number;
  value: string;
  onDraftChange: (idx: number, val: string) => void;
  onCommit: (idx: number, val: string) => void;
}

const SceneNarrationInput = memo(function SceneNarrationInput({
  index,
  value,
  onDraftChange,
  onCommit,
}: SceneNarrationInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef<number | null>(null);
  const lastCommittedRef = useRef(value);

  useEffect(() => {
    if (value !== lastCommittedRef.current) {
      lastCommittedRef.current = value;
      setLocalValue(value);
    }
  }, [value]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const flushCommit = (nextVal: string) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (nextVal !== lastCommittedRef.current) {
      lastCommittedRef.current = nextVal;
      onCommit(index, nextVal);
    }
  };

  return (
    <textarea
      rows={2}
      value={localValue}
      onChange={(e) => {
        const nextVal = e.target.value;
        setLocalValue(nextVal);
        onDraftChange(index, nextVal);
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
        }
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          lastCommittedRef.current = nextVal;
          onCommit(index, nextVal);
        }, 280);
      }}
      onBlur={(e) => flushCommit(e.target.value)}
      className="w-full bg-[#070e20] text-[#f1f5fc] border border-[#2a4173] rounded-lg p-2 text-xs focus:outline-none focus:border-[#ff6b00]"
    />
  );
});

export function AiVideoView({
  captionSettings,
  onChangeCaptionSettings,
  onRegisterExport,
  onSendToStudio,
}: AiVideoViewProps) {
  const { t, locale } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const micRecorderRef = useRef<{ recorder: MediaRecorder; chunks: BlobPart[]; stream: MediaStream } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const voiceSampleAudioRef = useRef<HTMLAudioElement | null>(null);

  const [prompt, setPrompt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(5);
  const [language, setLanguage] = useState<AppLocale>(locale);
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
  const [scenes, setScenes] = useState<AiScene[]>([]);
  const [frames, setFrames] = useState<RenderedSceneFrame[]>([]);
  const [voices, setVoices] = useState<Array<AiVoiceTrack | null>>([]);
  const [busy, setBusy] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [statusText, setStatusText] = useState('');
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

  const timeline = useMemo(
    () => buildTimeline(scenes, frames, voices),
    [scenes, frames, voices]
  );
  const totalSec = timeline[timeline.length - 1]?.endSec || 0;
  const handleFontReady = useCallback(() => setFontTick((v) => v + 1), []);

  const previewSecRef = useRef(0);
  previewSecRef.current = previewSec;
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;
  const voicesRef = useRef(voices);
  voicesRef.current = voices;
  const finalVideoRef = useRef(finalVideo);
  finalVideoRef.current = finalVideo;
  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const scrubRafRef = useRef<number>(0);
  const pendingScrubSecRef = useRef<number>(0);
  const draftNarrationsRef = useRef<Record<number, string>>({});

  const handleNarrationDraftChange = useCallback((idx: number, val: string) => {
    draftNarrationsRef.current[idx] = val;
  }, []);

  const handleNarrationCommit = useCallback((idx: number, val: string) => {
    delete draftNarrationsRef.current[idx];
    setScenes((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, narration: val, captionText: val } : item))
    );
  }, []);

  const flushPendingNarrations = useCallback(
    (sourceScenes: AiScene[]) => {
      const pending = draftNarrationsRef.current;
      const keys = Object.keys(pending);
      if (!keys.length) return sourceScenes;
      draftNarrationsRef.current = {};
      const nextScenes = sourceScenes.map((item, idx) =>
        Object.prototype.hasOwnProperty.call(pending, idx)
          ? { ...item, narration: pending[idx], captionText: pending[idx] }
          : item
      );
      setScenes(nextScenes);
      return nextScenes;
    },
    []
  );

  const schedulePreviewScrub = useCallback((nextSec: number) => {
    pendingScrubSecRef.current = nextSec;
    setPreviewPlaying(false);
    if (scrubRafRef.current) return;
    scrubRafRef.current = window.requestAnimationFrame(() => {
      scrubRafRef.current = 0;
      setPreviewSec(pendingScrubSecRef.current);
    });
  }, []);

  // Draw preview frame when paused or timeline/style updates
  useEffect(() => {
    if (previewPlaying) return;
    const cvs = canvasRef.current;
    if (!cvs) return;
    if (!canvasCtxRef.current) {
      canvasCtxRef.current = cvs.getContext('2d', { alpha: false });
    }
    const ctx = canvasCtxRef.current;
    if (!ctx) return;

    if (!timeline.length) {
      ctx.fillStyle = '#070e20';
      ctx.fillRect(0, 0, 720, 1280);
      ctx.strokeStyle = '#1e3159';
      ctx.lineWidth = 2;
      ctx.strokeRect(36, 36, 648, 1208);
      ctx.fillStyle = '#dce6f7';
      ctx.font = '700 24px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(t('ai.previewEmptyCanvasTitle'), 360, 610);
      ctx.fillStyle = '#6d83ad';
      ctx.font = '500 18px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(t('ai.previewEmptyCanvasSub'), 360, 652);
      return;
    }

    renderTimelineFrame(ctx, 720, 1280, timeline, Math.min(totalSec, previewSec), {
      visualEffect,
      transitionStyle,
      includeCaptions,
      captionSettings,
    });
  }, [
    previewPlaying,
    timeline,
    totalSec,
    previewSec,
    visualEffect,
    transitionStyle,
    includeCaptions,
    captionSettings,
    fontTick,
    t,
  ]);

  // Animated 30fps canvas playback loop with throttled (~150ms) React slider updates
  useEffect(() => {
    if (!previewPlaying || totalSec <= 0) return;
    const cvs = canvasRef.current;
    if (!cvs) return;
    if (!canvasCtxRef.current) {
      canvasCtxRef.current = cvs.getContext('2d', { alpha: false });
    }
    const ctx = canvasCtxRef.current;
    if (!ctx) return;

    let rafId = 0;
    let active = true;
    const startAt = performance.now() - previewSecRef.current * 1000;
    let lastDrawAt = 0;
    let lastUiSyncAt = 0;

    const tick = (now: number) => {
      if (!active) return;
      const elapsed = (now - startAt) / 1000;
      if (elapsed >= totalSec) {
        setPreviewSec(0);
        setPreviewPlaying(false);
        return;
      }
      if (now - lastDrawAt >= 32) {
        lastDrawAt = now;
        renderTimelineFrame(ctx, 720, 1280, timeline, elapsed, {
          visualEffect,
          transitionStyle,
          includeCaptions,
          captionSettings,
        });
      }
      if (now - lastUiSyncAt >= 150) {
        lastUiSyncAt = now;
        setPreviewSec(elapsed);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(rafId);
    };
  }, [previewPlaying, totalSec, timeline, visualEffect, transitionStyle, includeCaptions, captionSettings]);

  // Clean up audio, active renders, and temporary object URLs on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (voiceSampleAudioRef.current) {
        voiceSampleAudioRef.current.pause();
        voiceSampleAudioRef.current = null;
      }
      if (micRecorderRef.current) {
        try {
          micRecorderRef.current.stream.getTracks().forEach((tr) => tr.stop());
          micRecorderRef.current.recorder.stop();
        } catch {}
        micRecorderRef.current = null;
      }
      voicesRef.current.forEach((v) => {
        if (v?.url) {
          try {
            URL.revokeObjectURL(v.url);
          } catch {}
        }
      });
      scenesRef.current.forEach((sc) => {
        if (sc.customImageUrl) {
          try {
            URL.revokeObjectURL(sc.customImageUrl);
          } catch {}
        }
      });
      if (scrubRafRef.current) {
        window.cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = 0;
      }
      if (finalVideoRef.current?.url) {
        try {
          URL.revokeObjectURL(finalVideoRef.current.url);
        } catch {}
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
      const data = await readApiJson<{
        title?: string;
        summary?: string;
        totalDurationSec?: number;
        scenes?: AiScene[];
      }>(res, 'Gagal menyusun naskah AI.');

      voices.forEach((v) => {
        if (v?.url) {
          try {
            URL.revokeObjectURL(v.url);
          } catch {}
        }
      });

      const nextScenes: AiScene[] = data.scenes || [];
      draftNarrationsRef.current = {};
      setTitle(data.title || prompt.trim());
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
    const syncedScenes = flushPendingNarrations(targetScenes);
    if (!syncedScenes.length) {
      setStatusText('Buat naskah terlebih dahulu pada Tahap 1.');
      return null;
    }
    setBusy(true);
    setProgressPct(38);
    setProgressLabel('2/4 · Merender frame visual 9:16');
    setStatusText('Menyiapkan frame visual untuk tiap adegan…');
    try {
      const out: RenderedSceneFrame[] = [];
      for (let i = 0; i < syncedScenes.length; i++) {
        const frame = await renderSceneFrame(syncedScenes[i], i, syncedScenes.length, theme);
        out.push(frame);
        setProgressPct(38 + ((i + 1) / syncedScenes.length) * 18);
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
    const data = await readApiJson<{ audioDataUrl?: string }>(
      res,
      'Gagal membuat suara narasi AI.'
    );
    if (!data.audioDataUrl) {
      throw new Error('Gagal membuat suara narasi AI.');
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
    const syncedScenes = flushPendingNarrations(targetScenes);
    if (!syncedScenes.length) return null;
    setBusy(true);
    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;
    setProgressPct(60);
    setProgressLabel(`3/4 · Membuat narasi AI (${selectedVoicePreset.shortName})`);
    setStatusText(`Menghasilkan suara narasi ${selectedVoicePreset.shortName} untuk ${syncedScenes.length} adegan…`);
    let failedCount = 0;
    try {
      const nextVoices: Array<AiVoiceTrack | null> = new Array(syncedScenes.length)
        .fill(null)
        .map((_, idx) => voices[idx] ?? null);

      for (let i = 0; i < syncedScenes.length; i++) {
        if (ctrl.signal.aborted) break;
        setProgressPct(60 + ((i + 1) / syncedScenes.length) * 18);
        setProgressLabel(`3/4 · Suara adegan ${i + 1}/${syncedScenes.length}`);
        if (nextVoices[i]?.url) {
          try {
            URL.revokeObjectURL(nextVoices[i]!.url);
          } catch {}
        }
        try {
          nextVoices[i] = await synthesizeOneVoice(syncedScenes[i], ctrl.signal);
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
    const syncedScenes = flushPendingNarrations(targetScenes);
    const tl = buildTimeline(syncedScenes, targetFrames, targetVoices);
    if (!tl.length) {
      setStatusText('Selesaikan Tahap 1 dan 2 terlebih dahulu sebelum merender.');
      return;
    }
    setPreviewPlaying(false);
    setBusy(true);
    window.paijoDesktop?.setRenderActive?.(true);
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
      const srtText = buildSrtFromScenes(syncedScenes, durations);
      setFinalVideo((prev) => {
        if (prev?.url && prev.url !== result.url) {
          try {
            URL.revokeObjectURL(prev.url);
          } catch {}
        }
        return { ...result, srtText };
      });

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
        captionText: syncedScenes.map((s) => s.narration).filter(Boolean).slice(0, 2).join(' '),
        createdAt: Date.now(),
      });

      setProgressPct(100);
      setProgressLabel('Selesai · Video AI siap diunduh');
      setStatusText('Video AI berhasil dibuat dan masuk ke Galeri Hasil Ekspor!');
    } catch (err) {
      setStatusText(err instanceof Error ? err.message : String(err));
    } finally {
      window.paijoDesktop?.setRenderActive?.(false);
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
      <aside className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-4 flex flex-col items-center gap-3 lg:sticky lg:top-20">
        <div className="w-full text-center text-xs font-semibold truncate pb-2 border-b border-[#1e3159] text-[#c7ff55]">
          {title || t('ai.previewHeader')}
        </div>

        <canvas
          ref={canvasRef}
          width={720}
          height={1280}
          className="w-full max-w-[264px] aspect-[9/16] bg-[#070e20] border border-[#2a4173] rounded-xl block"
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
              className="py-2 px-3 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
            >
              {previewPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {previewPlaying ? t('studio.pause') : t('ai.previewBtn')}
            </button>
            <button
              type="button"
              disabled={!frames.length}
              onClick={() => {
                setPreviewPlaying(false);
                setPreviewSec(0);
              }}
              className="py-2 px-3 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-[#dce6f7] disabled:opacity-40 cursor-pointer"
            >
              {t('ai.startBtn')}
            </button>
          </div>
          <input
            type="range"
            min={0}
            max={1000}
            disabled={!frames.length || totalSec <= 0}
            value={totalSec ? Math.round((previewSec / totalSec) * 1000) : 0}
            onChange={(e) => {
              schedulePreviewScrub((Number(e.target.value) / 1000) * totalSec);
            }}
            className="w-full cursor-pointer disabled:opacity-40"
          />
          <div className="text-[11px] font-mono tabular-nums text-[#93a7cc] text-center">
            {totalSec > 0
              ? `${formatClock(previewSec)} / ${formatClock(totalSec)}`
              : t('ai.previewHint')}
          </div>
        </div>

        {finalVideo && (
          <div className="w-full pt-3 border-t border-[#1e3159] space-y-2.5">
            <div className="text-xs font-bold text-emerald-400">{t('ai.finalReady')}</div>
            <video
              src={finalVideo.url}
              controls
              playsInline
              className="w-full aspect-[9/16] rounded-lg bg-[#040915]"
            />
            <a
              href={finalVideo.url}
              download={`video-ai.${finalVideo.ext}`}
              className="w-full py-2 px-3 rounded-lg bg-[#c7ff55] hover:bg-[#d6ff7d] text-[#111507] text-xs font-bold inline-flex items-center justify-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              {t('ai.downloadMb', { mb: (finalVideo.sizeBytes / (1024 * 1024)).toFixed(1) })}
            </a>
            <button
              type="button"
              onClick={() => {
                const file = new File([finalVideo.blob], `video-ai.${finalVideo.ext}`, {
                  type: finalVideo.blob.type || 'video/webm',
                });
                onSendToStudio(file, finalVideo.srtText, title || t('nav.aiVideo'));
              }}
              className="w-full py-2 px-3 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white cursor-pointer"
            >
              {t('ai.sendToStudio')}
            </button>
          </div>
        )}
      </aside>

      {/* Right 4-Stage Pipeline */}
      <div className="space-y-4 min-w-0">
        {/* Guide & Steps */}
        <section className="bg-[#101d3d] border border-[#1e3159] rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowGuide((v) => !v)}
            className="w-full px-5 py-3.5 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-[#142347] transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <BookOpen className="w-4 h-4 text-[#c7ff55] shrink-0" />
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-white">
                  {t('ai.guideTitle')}
                </h2>
                <p className="text-xs text-[#93a7cc] truncate">
                  {t('ai.guideSubtitle')}
                </p>
              </div>
            </div>
            <span className="text-xs font-semibold text-[#dce6f7] inline-flex items-center gap-1 shrink-0 whitespace-nowrap">
              {showGuide ? t('ai.hideGuide') : t('ai.showGuide')}
              {showGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </span>
          </button>

          {showGuide && (
            <div className="px-5 pb-4 pt-2 border-t border-[#1e3159] space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="bg-[#0c1733] border border-[#1e3159] rounded-lg p-3 space-y-1">
                  <div className="font-bold text-[#c7ff55]">{t('ai.step1Title')}</div>
                  <p className="text-[#b8c7e3] leading-relaxed">{t('ai.step1Desc')}</p>
                </div>
                <div className="bg-[#0c1733] border border-[#1e3159] rounded-lg p-3 space-y-1">
                  <div className="font-bold text-[#c7ff55]">{t('ai.step2Title')}</div>
                  <p className="text-[#b8c7e3] leading-relaxed">{t('ai.step2Desc')}</p>
                </div>
                <div className="bg-[#0c1733] border border-[#1e3159] rounded-lg p-3 space-y-1">
                  <div className="font-bold text-[#c7ff55]">{t('ai.step3Title')}</div>
                  <p className="text-[#b8c7e3] leading-relaxed">{t('ai.step3Desc')}</p>
                </div>
                <div className="bg-[#0c1733] border border-[#1e3159] rounded-lg p-3 space-y-1">
                  <div className="font-bold text-[#c7ff55]">{t('ai.step4Title')}</div>
                  <p className="text-[#b8c7e3] leading-relaxed">{t('ai.step4Desc')}</p>
                </div>
              </div>
              <p className="text-[11.5px] text-[#93a7cc]">{t('ai.guideNote')}</p>
            </div>
          )}
        </section>

        {/* Stage 1: Script */}
        <section className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-white">{t('ai.stage1Title')}</h2>
              <p className="text-xs text-[#93a7cc] mt-0.5">{t('ai.stage1Desc')}</p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={handleRunAll}
              className="px-4 py-2 rounded-lg bg-[#ff6b00] hover:bg-[#ff8224] disabled:opacity-40 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {t('ai.runAllBtn')}
            </button>
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder={t('ai.promptPlaceholder')}
            className="w-full bg-[#070e20] text-[#f1f5fc] border border-[#2a4173] rounded-lg p-3 text-xs leading-relaxed focus:outline-none focus:border-[#ff6b00]"
          />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div>
              <label className="block text-[11px] text-[#b8c7e3] mb-1">
                {t('ai.durationLabel')}
              </label>
              <select
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="w-full bg-[#0c1733] text-[#f1f5fc] border border-[#2a4173] rounded-lg px-2.5 py-2 text-xs"
              >
                {DURATION_OPTIONS.map((opt) => (
                  <option key={opt.minutes} value={opt.minutes}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[#b8c7e3] mb-1">{t('ai.contentStyle')}</label>
              <select
                value={videoType}
                onChange={(e) => setVideoType(e.target.value)}
                className="w-full bg-[#0c1733] text-[#f1f5fc] border border-[#2a4173] rounded-lg px-2.5 py-2 text-xs"
              >
                <option value="general">{t('ai.typeGeneral')}</option>
                <option value="finance">{t('ai.typeFinance')}</option>
                <option value="prehistoric">{t('ai.typeHistory')}</option>
                <option value="pov">{t('ai.typePov')}</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[#b8c7e3] mb-1">{t('ai.visualTheme')}</label>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as AiTheme)}
                className="w-full bg-[#0c1733] text-[#f1f5fc] border border-[#2a4173] rounded-lg px-2.5 py-2 text-xs"
              >
                <option value="cinematic">{t('ai.themeCinematic')}</option>
                <option value="editorial">{t('ai.themeEditorial')}</option>
                <option value="tech">{t('ai.themeTech')}</option>
                <option value="minimal">{t('ai.themeMinimal')}</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[#b8c7e3] mb-1">{t('ai.scriptLanguage')}</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as AppLocale)}
                className="w-full bg-[#0c1733] text-[#f1f5fc] border border-[#2a4173] rounded-lg px-2.5 py-2 text-xs"
              >
                {APP_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.nativeName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => generateScript()}
              className="px-3.5 py-2 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white disabled:opacity-40 cursor-pointer"
            >
              {t('ai.genScriptBtn')}
            </button>
            <span className="text-xs font-mono tabular-nums text-[#93a7cc]">
              {scenes.length > 0
                ? t('ai.scenesReady', { count: scenes.length, duration: formatClock(totalSec) })
                : t('ai.noScriptYet')}
            </span>
          </div>
        </section>

        {/* Stage 2 & 3: Scene Cards + Visuals + Voice */}
        <section className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-white">{t('ai.stage23Title')}</h2>
            <div className="flex flex-wrap gap-2">
              {busy && abortControllerRef.current && (
                <button
                  type="button"
                  onClick={() => abortControllerRef.current?.abort()}
                  className="px-3 py-1.5 rounded-lg bg-[#16264d] hover:bg-red-950/50 border border-[#2a4173] text-xs font-bold text-white inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Square className="w-3 h-3 fill-current" />
                  {t('ai.cancelBtn')}
                </button>
              )}
              <button
                type="button"
                disabled={busy || scenes.length === 0}
                onClick={() => generateFrames()}
                className="px-3 py-1.5 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white disabled:opacity-40 cursor-pointer"
              >
                {t('ai.renderVisualBtn')}
              </button>
              <button
                type="button"
                disabled={busy || scenes.length === 0}
                onClick={() => generateAllVoices()}
                className="px-3 py-1.5 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white disabled:opacity-40 cursor-pointer"
              >
                {t('ai.genVoiceBtn')}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] text-[#b8c7e3] mb-1">{t('ai.voiceCharLabel')}</label>
              <div className="flex items-center gap-2">
                <select
                  value={voiceName}
                  onChange={(e) => {
                    stopVoiceSample();
                    setVoiceName(e.target.value);
                  }}
                  className="flex-1 min-w-0 bg-[#0c1733] text-[#f1f5fc] border border-[#2a4173] rounded-lg px-2.5 py-2 text-xs"
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
                    title={selectedVoicePreset.shortName}
                    className={`px-2.5 py-2 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer ${
                      playingSampleId === selectedVoicePreset.id
                        ? 'bg-[#c7ff55] text-[#111507] border-[#c7ff55]'
                        : 'bg-[#16264d] hover:bg-[#1e3363] border-[#2a4173] text-[#e4ecfa]'
                    }`}
                  >
                    {playingSampleId === selectedVoicePreset.id ? (
                      <>
                        <Square className="w-3 h-3 fill-current" />
                        {t('ai.stopSample')}
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5" />
                        {t('ai.sampleBtn')}
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-[#b8c7e3] mb-1">{t('ai.speakingStyleLabel')}</label>
              <select
                value={voiceStyle}
                onChange={(e) => setVoiceStyle(e.target.value)}
                className="w-full bg-[#0c1733] text-[#f1f5fc] border border-[#2a4173] rounded-lg px-2.5 py-2 text-xs"
              >
                <option value="Clear, engaging short-form video narrator">{t('ai.styleShorts')}</option>
                <option value="Energetic, fast-paced YouTube creator">{t('ai.styleEnergetic')}</option>
                <option value="Calm, warm documentary storyteller">{t('ai.styleCalm')}</option>
                <option value="Confident professional presenter">{t('ai.stylePro')}</option>
              </select>
            </div>
          </div>

          {scenes.length === 0 ? (
            <div className="border border-dashed border-[#2a4173] rounded-lg p-6 text-center text-xs text-[#93a7cc] bg-[#0c1733]">
              {t('ai.emptyScenesHint')}
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
                    className="bg-[#0c1733] border border-[#1e3159] rounded-xl p-3 grid grid-cols-[74px_minmax(0,1fr)] gap-3 items-start"
                  >
                    <div className="w-[74px] aspect-[9/16] rounded-lg bg-[#070e20] border border-[#2a4173] overflow-hidden flex items-center justify-center text-[10px] text-[#6d83ad] text-center p-1">
                      {frame ? (
                        <img src={frame.dataUrl} alt={sc.visualTitle} className="w-full h-full object-cover" />
                      ) : (
                        <span>{t('ai.notRendered')}</span>
                      )}
                    </div>

                    <div className="space-y-2 min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <strong className="text-white truncate">
                          {String(idx + 1).padStart(2, '0')}. {sc.visualTitle}
                        </strong>
                        <span className="font-mono tabular-nums text-[11px] text-[#93a7cc]">
                          {sc.timestampLabel} ·{' '}
                          {voice ? `${voice.durationSec.toFixed(1)}s (${voice.source === 'microphone' ? 'Mik' : 'TTS'})` : `${sc.durationSec}s`}
                        </span>
                      </div>

                      <SceneNarrationInput
                        index={idx}
                        value={sc.narration}
                        onDraftChange={handleNarrationDraftChange}
                        onCommit={handleNarrationCommit}
                      />

                      <div className="flex flex-wrap items-center gap-2">
                        <label className="px-2.5 py-1 rounded-md bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-[11px] font-semibold text-[#e4ecfa] inline-flex items-center gap-1 cursor-pointer">
                          <ImagePlus className="w-3 h-3" />
                          {frame?.isCustom ? t('ai.replaceImage') : t('ai.uploadImage')}
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
                              setStatusText(`TTS ${idx + 1}…`);
                              const targetScene = flushPendingNarrations(scenes)[idx] || sc;
                              const tr = await synthesizeOneVoice(targetScene);
                              setVoices((prev) => {
                                const next = [...prev];
                                if (next[idx]?.url) URL.revokeObjectURL(next[idx]!.url);
                                next[idx] = tr;
                                return next;
                              });
                              setStatusText(`TTS ${idx + 1} OK.`);
                            } catch (err) {
                              setStatusText(err instanceof Error ? err.message : String(err));
                            }
                          }}
                          className="px-2.5 py-1 rounded-md bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-[11px] font-semibold text-[#e4ecfa] inline-flex items-center gap-1 disabled:opacity-40 cursor-pointer"
                        >
                          <Volume2 className="w-3 h-3" />
                          {t('ai.sceneVoiceBtn')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleMic(idx)}
                          className={`px-2.5 py-1 rounded-md border text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer ${
                            isMic
                              ? 'bg-red-950/50 border-red-500 text-red-200'
                              : 'bg-[#16264d] hover:bg-[#1e3363] border-[#2a4173] text-[#e4ecfa]'
                          }`}
                        >
                          <Mic className="w-3 h-3" />
                          {isMic ? t('ai.stopRec') : t('ai.recVoice')}
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
        <section className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-white">{t('ai.stage4Title')}</h2>
            <div className="flex items-center gap-2">
              {busy && abortControllerRef.current && (
                <button
                  type="button"
                  onClick={() => abortControllerRef.current?.abort()}
                  className="px-3 py-2 rounded-lg bg-[#16264d] hover:bg-red-950/50 border border-[#2a4173] text-xs font-bold text-white inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Square className="w-3 h-3 fill-current" />
                  {t('ai.cancelBtn')}
                </button>
              )}
              <button
                type="button"
                disabled={busy || frames.length === 0}
                onClick={() => renderFinalVideo()}
                className="px-4 py-2 rounded-lg bg-[#ff6b00] hover:bg-[#ff8224] disabled:opacity-40 text-white text-xs font-bold cursor-pointer"
              >
                {t('ai.renderFinalBtn')}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[#b8c7e3] mb-1">{t('ai.visualEffect')}</label>
              <select
                value={visualEffect}
                onChange={(e) => setVisualEffect(e.target.value as AiVisualEffect)}
                className="w-full bg-[#0c1733] text-[#f1f5fc] border border-[#2a4173] rounded-lg px-2.5 py-2 text-xs"
              >
                <option value="kenburns">{t('ai.fxKenburns')}</option>
                <option value="cinematic">{t('ai.fxCinematic')}</option>
                <option value="pulse">{t('ai.fxPulse')}</option>
                <option value="none">{t('ai.fxNone')}</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[#b8c7e3] mb-1">{t('ai.transitionLabel')}</label>
              <select
                value={transitionStyle}
                onChange={(e) => setTransitionStyle(e.target.value as AiTransitionStyle)}
                className="w-full bg-[#0c1733] text-[#f1f5fc] border border-[#2a4173] rounded-lg px-2.5 py-2 text-xs"
              >
                <option value="fade">{t('ai.trFade')}</option>
                <option value="zoom">{t('ai.trZoom')}</option>
                <option value="slide">{t('ai.trSlide')}</option>
                <option value="none">{t('ai.trNone')}</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[#b8c7e3] mb-1">
                {t('ai.audioGain')} (<span className="font-mono">{audioGainPct}%</span>)
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
              <label className="block text-[11px] text-[#b8c7e3] mb-1">{t('ai.renderFormat')}</label>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                className="w-full bg-[#0c1733] text-[#f1f5fc] border border-[#2a4173] rounded-lg px-2.5 py-2 text-xs"
              >
                <option value="webm">{t('studio.formatWebm')}</option>
                <option value="mp4">{t('studio.formatMp4')}</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-5 pt-1">
            <label className="inline-flex items-center gap-2 text-xs text-[#dce6f7] cursor-pointer">
              <input
                type="checkbox"
                checked={enhanceAudio}
                onChange={(e) => setEnhanceAudio(e.target.checked)}
              />
              <span>{t('ai.enhanceAudio')}</span>
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-[#dce6f7] cursor-pointer">
              <input
                type="checkbox"
                checked={includeCaptions}
                onChange={(e) => setIncludeCaptions(e.target.checked)}
              />
              <span>{t('ai.includeCaptions')}</span>
            </label>
          </div>

          {includeCaptions && (
            <CaptionStylePanel
              compact
              settings={captionSettings}
              onChange={onChangeCaptionSettings}
              onFontReady={handleFontReady}
            />
          )}

          {progressPct > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-[#dce6f7] truncate">{progressLabel}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {busy && abortControllerRef.current && (
                    <button
                      type="button"
                      onClick={() => abortControllerRef.current?.abort()}
                      className="px-2 py-0.5 rounded bg-[#16264d] hover:bg-red-950/50 border border-[#2a4173] text-[11px] font-semibold text-white inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Square className="w-2.5 h-2.5 fill-current" />
                      {t('ai.cancelBtn')}
                    </button>
                  )}
                  <span className="font-mono tabular-nums font-bold text-[#c7ff55]">
                    {Math.round(progressPct)}%
                  </span>
                </div>
              </div>
              <div className="h-1.5 bg-[#1a2d59] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#ff6b00] transition-all duration-150"
                  style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
                />
              </div>
            </div>
          )}

          <div className="text-xs text-[#b8c7e3]">{statusText || t('ai.statusInitial')}</div>
        </section>
      </div>
    </div>
  );
}
