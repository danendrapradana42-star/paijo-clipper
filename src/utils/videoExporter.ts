import type {
  AudioEnvelopeData,
  CaptionSettings,
  ClipCandidate,
  ExportFormat,
  FramingMode,
  SubtitleCue,
} from '../types/clipper';
import { createMotionState, drawVideoFrame, updateMotionFocus } from './canvasRenderer';
import { formatClock } from './subtitles';

interface AudioGraph {
  actx: AudioContext;
  gain: GainNode;
  monitorGain: GainNode;
  dest: MediaStreamAudioDestinationNode;
}

// WeakMap prevents InvalidStateError ("HTMLMediaElement already connected") across repeated exports
const elementAudioMap = new WeakMap<HTMLMediaElement, AudioGraph>();

function ensureExportAudio(videoEl: HTMLVideoElement): AudioGraph | null {
  const existing = elementAudioMap.get(videoEl);
  if (existing) return existing;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    const actx = new AC();
    const src = actx.createMediaElementSource(videoEl);
    const gain = actx.createGain();
    const monitorGain = actx.createGain();
    const dest = actx.createMediaStreamDestination();
    src.connect(gain);
    gain.connect(dest);
    src.connect(monitorGain);
    monitorGain.connect(actx.destination);
    const graph: AudioGraph = { actx, gain, monitorGain, dest };
    elementAudioMap.set(videoEl, graph);
    return graph;
  } catch {
    return null;
  }
}

export async function syncPreviewAudio(videoEl: HTMLVideoElement, volume: number, muted: boolean): Promise<void> {
  videoEl.muted = muted;
  videoEl.volume = Math.max(0, Math.min(1, volume));
  const graph = elementAudioMap.get(videoEl);
  if (graph) {
    if (graph.actx.state === 'suspended') {
      await graph.actx.resume().catch(() => {});
    }
    graph.monitorGain.gain.setValueAtTime(muted ? 0 : Math.max(0, Math.min(1, volume)), graph.actx.currentTime);
  }
}

function scheduleAudioFade(graph: AudioGraph | null, dur: number) {
  if (!graph) return;
  const g = graph.gain.gain;
  const t0 = graph.actx.currentTime;
  g.cancelScheduledValues(t0);
  g.setValueAtTime(0, t0);
  g.linearRampToValueAtTime(1, t0 + 0.04);
  if (dur > 0.4) {
    g.setValueAtTime(1, t0 + dur - 0.1);
    g.linearRampToValueAtTime(0, t0 + dur - 0.01);
  }
}

export function supportedExportMime(preferred: ExportFormat): string {
  if (typeof window === 'undefined' || !window.MediaRecorder) return '';
  const webm = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  const mp4 = [
    'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
    'video/mp4;codecs=avc1.4d4028,mp4a.40.2',
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
  ];
  const order = preferred === 'mp4' ? mp4.concat(webm) : webm.concat(mp4);
  for (const m of order) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

async function seekVideoSafe(videoEl: HTMLVideoElement, seconds: number): Promise<void> {
  const maxDur = Number.isFinite(videoEl.duration) ? Math.max(0, videoEl.duration - 0.05) : seconds;
  const target = Math.max(0, Math.min(maxDur, seconds));
  if (Math.abs(videoEl.currentTime - target) >= 0.02 || videoEl.readyState < 2) {
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        videoEl.removeEventListener('seeked', done);
        videoEl.removeEventListener('error', done);
        resolve();
      };
      const timer = setTimeout(done, 3500);
      videoEl.addEventListener('seeked', done, { once: true });
      videoEl.addEventListener('error', done, { once: true });
      videoEl.currentTime = target;
    });
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

export interface ExportSingleClipResult {
  blob: Blob;
  url: string;
  ext: string;
  durationSec: number;
}

export async function exportSingleClip(params: {
  videoEl: HTMLVideoElement;
  cut: ClipCandidate;
  mime: string;
  framingMode: FramingMode;
  manualPanX: number;
  cues: SubtitleCue[];
  captionSettings: CaptionSettings;
  audioEnv: AudioEnvelopeData | null;
  signal: AbortSignal;
  onProgress: (ratio: number, statusText: string) => void;
}): Promise<ExportSingleClipResult> {
  const {
    videoEl,
    cut,
    mime,
    framingMode,
    manualPanX,
    cues,
    captionSettings,
    audioEnv,
    signal,
    onProgress,
  } = params;

  if (signal.aborted) throw new Error('Ekspor dibatalkan.');

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = 720;
  exportCanvas.height = 1280;
  const exportCtx = exportCanvas.getContext('2d', { alpha: false });
  if (!exportCtx) throw new Error('Kanvas ekspor gagal diinisialisasi.');

  const safeEnd = Math.min(
    cut.end,
    Number.isFinite(videoEl.duration) && videoEl.duration > 0 ? videoEl.duration : cut.end
  );
  const clipDur = Math.max(0.5, safeEnd - cut.start);
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  const motionState = createMotionState();

  const prevMuted = videoEl.muted;
  const prevVolume = videoEl.volume;
  videoEl.muted = false;
  videoEl.volume = 1;

  const audioGraph = ensureExportAudio(videoEl);
  if (audioGraph) {
    if (audioGraph.actx.state === 'suspended') {
      await audioGraph.actx.resume().catch(() => {});
    }
    audioGraph.monitorGain.gain.setValueAtTime(0, audioGraph.actx.currentTime);
  }

  videoEl.pause();
  await seekVideoSafe(videoEl, cut.start);

  const renderOpts = {
    framingMode,
    manualPanX,
    motionState,
    cues,
    captionSettings,
    audioEnv,
  };
  drawVideoFrame(videoEl, exportCanvas, exportCtx, renderOpts);

  const stream = exportCanvas.captureStream(30);
  const videoTrack = stream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
  const trackedStreams: MediaStreamTrack[] = [...stream.getTracks()];

  if (audioGraph) {
    audioGraph.dest.stream.getAudioTracks().forEach((t) => {
      const cloned = t.clone();
      stream.addTrack(cloned);
      trackedStreams.push(cloned);
    });
  } else {
    const captureCapable = videoEl as HTMLVideoElement & { captureStream?: () => MediaStream };
    if (typeof captureCapable.captureStream === 'function') {
      captureCapable.captureStream().getAudioTracks().forEach((t) => {
        const cloned = t.clone();
        stream.addTrack(cloned);
        trackedStreams.push(cloned);
      });
    }
  }

  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: 5_000_000,
  });

  return new Promise<ExportSingleClipResult>((resolve, reject) => {
    let active = true;
    let rafId = 0;
    let intervalId = 0;
    let rvfcId = 0;
    let watchdogTimer = 0;
    let lastDrawAt = 0;

    const cleanup = () => {
      active = false;
      cancelAnimationFrame(rafId);
      clearInterval(intervalId);
      clearTimeout(watchdogTimer);
      const vidRvfc = videoEl as HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void };
      if (rvfcId && typeof vidRvfc.cancelVideoFrameCallback === 'function') {
        try {
          vidRvfc.cancelVideoFrameCallback(rvfcId);
        } catch {}
      }
      signal.removeEventListener('abort', handleAbort);
      videoEl.removeEventListener('ended', finishCut);
      trackedStreams.forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
      videoEl.muted = prevMuted;
      videoEl.volume = prevVolume;
      if (audioGraph) {
        audioGraph.monitorGain.gain.setValueAtTime(
          prevMuted ? 0 : prevVolume,
          audioGraph.actx.currentTime
        );
      }
    };

    const finishCut = () => {
      if (!active) return;
      active = false;
      drawVideoFrame(videoEl, exportCanvas, exportCtx, renderOpts);
      if (videoTrack && typeof videoTrack.requestFrame === 'function') {
        try {
          videoTrack.requestFrame();
        } catch {}
      }
      videoEl.pause();
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {}
      }
    };

    const handleAbort = () => {
      cleanup();
      videoEl.pause();
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {}
      }
      reject(new Error('Ekspor dihentikan oleh pengguna.'));
    };

    signal.addEventListener('abort', handleAbort, { once: true });
    videoEl.addEventListener('ended', finishCut, { once: true });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onerror = () => {
      cleanup();
      reject(new Error('MediaRecorder gagal merekam klip. Coba format WebM.'));
    };

    recorder.onstop = () => {
      cleanup();
      if (signal.aborted) {
        reject(new Error('Ekspor dihentikan oleh pengguna.'));
        return;
      }
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      if (!blob.size) {
        reject(new Error('Ekspor menghasilkan file kosong. Coba format WebM.'));
        return;
      }
      const url = URL.createObjectURL(blob);
      resolve({ blob, url, ext, durationSec: clipDur });
    };

    const pump = (force = false) => {
      if (!active) return;
      const now = performance.now();
      if (videoEl.readyState >= 2 && (force || now - lastDrawAt >= 28)) {
        lastDrawAt = now;
        if (framingMode === 'motion') updateMotionFocus(videoEl, motionState);
        if (drawVideoFrame(videoEl, exportCanvas, exportCtx, renderOpts)) {
          if (videoTrack && typeof videoTrack.requestFrame === 'function') {
            try {
              videoTrack.requestFrame();
            } catch {}
          }
        }
      }
      const progress = Math.min(1, Math.max(0, (videoEl.currentTime - cut.start) / clipDur));
      onProgress(progress, `${formatClock(videoEl.currentTime)} / ${formatClock(safeEnd)}`);
      if (videoEl.ended || videoEl.currentTime >= safeEnd - 0.02) {
        finishCut();
      }
    };

    recorder.start(250);
    videoEl
      .play()
      .then(() => {
        if (!active) return;
        scheduleAudioFade(audioGraph, Math.max(0.2, safeEnd - videoEl.currentTime));

        const rafStep = () => {
          if (!active) return;
          pump(false);
          if (active) rafId = requestAnimationFrame(rafStep);
        };
        rafId = requestAnimationFrame(rafStep);
        intervalId = window.setInterval(() => {
          if (active) pump(false);
        }, 33);

        const vidRvfc = videoEl as HTMLVideoElement & {
          requestVideoFrameCallback?: (cb: () => void) => number;
        };
        if (typeof vidRvfc.requestVideoFrameCallback === 'function') {
          const vfcStep = () => {
            if (!active) return;
            pump(true);
            if (active) rvfcId = vidRvfc.requestVideoFrameCallback!(vfcStep);
          };
          rvfcId = vidRvfc.requestVideoFrameCallback(vfcStep);
        }

        watchdogTimer = window.setTimeout(() => finishCut(), Math.max(3000, (clipDur + 15) * 1000));
      })
      .catch((err) => {
        cleanup();
        reject(new Error(`Browser gagal memutar video saat ekspor: ${err instanceof Error ? err.message : String(err)}`));
      });
  });
}
