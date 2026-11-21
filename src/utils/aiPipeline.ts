import type {
  AiScene,
  AiTheme,
  AiTransitionStyle,
  AiVisualEffect,
  AiVoiceTrack,
  CaptionSettings,
  ExportFormat,
} from '../types/clipper';
import { drawCaption } from './canvasRenderer';
import { supportedExportMime } from './videoExporter';

export interface RenderedSceneFrame {
  canvas: HTMLCanvasElement;
  dataUrl: string;
  isCustom: boolean;
}

export interface TimelineSegment {
  index: number;
  scene: AiScene;
  frame: RenderedSceneFrame;
  voice: AiVoiceTrack | null;
  startSec: number;
  endSec: number;
  durationSec: number;
}

const THEME_PALETTES: Record<AiTheme, { bg1: string; bg2: string; accent: string; ink: string }> = {
  cinematic: { bg1: '#0a0d16', bg2: '#1a1118', accent: '#ff5436', ink: '#f8fafc' },
  editorial: { bg1: '#121316', bg2: '#1d212b', accent: '#c7ff55', ink: '#f3f5f8' },
  tech: { bg1: '#07111a', bg2: '#0e2236', accent: '#38bdf8', ink: '#f0f9ff' },
  minimal: { bg1: '#111215', bg2: '#181a20', accent: '#e2e8f0', ink: '#ffffff' },
};

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
      if (lines.length >= maxLines) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gagal memuat gambar adegan.'));
    img.src = src;
  });
}

export async function renderSceneFrame(
  scene: AiScene,
  index: number,
  total: number,
  theme: AiTheme
): Promise<RenderedSceneFrame> {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 1280;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  if (scene.customImageUrl) {
    try {
      const img = await loadImage(scene.customImageUrl);
      const iw = img.naturalWidth || 720;
      const ih = img.naturalHeight || 1280;
      const coverScale = Math.max(720 / iw, 1280 / ih);
      const dw = iw * coverScale;
      const dh = ih * coverScale;
      ctx.drawImage(img, (720 - dw) / 2, (1280 - dh) / 2, dw, dh);

      const scrim = ctx.createLinearGradient(0, 0, 0, 1280);
      scrim.addColorStop(0, 'rgba(8, 9, 12, 0.35)');
      scrim.addColorStop(0.5, 'rgba(8, 9, 12, 0.12)');
      scrim.addColorStop(1, 'rgba(8, 9, 12, 0.72)');
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, 720, 1280);

      return { canvas, dataUrl: canvas.toDataURL('image/jpeg', 0.85), isCustom: true };
    } catch {
      // Fallback to procedural render
    }
  }

  const pal = THEME_PALETTES[theme] || THEME_PALETTES.cinematic;
  const grad = ctx.createLinearGradient(0, 0, 720, 1280);
  grad.addColorStop(0, pal.bg1);
  grad.addColorStop(1, pal.bg2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 720, 1280);

  // Subtle geometric editorial grid & focal glow
  ctx.save();
  const radial = ctx.createRadialGradient(360, 420, 40, 360, 420, 460);
  radial.addColorStop(0, `${pal.accent}24`);
  radial.addColorStop(1, 'transparent');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, 720, 1280);

  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let y = 160; y < 1200; y += 160) {
    ctx.beginPath();
    ctx.moveTo(48, y);
    ctx.lineTo(672, y);
    ctx.stroke();
  }

  // Scene index & timestamp label
  ctx.fillStyle = pal.accent;
  ctx.font = '700 22px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`ADEGAN ${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, 56, 150);

  // Scene headline
  ctx.fillStyle = pal.ink;
  ctx.font = '800 50px "Plus Jakarta Sans", sans-serif';
  const headlineLines = wrapLines(ctx, scene.visualTitle, 608, 4);
  headlineLines.forEach((ln, i) => {
    ctx.fillText(ln, 56, 250 + i * 64);
  });

  // Visual prompt summary block
  ctx.fillStyle = 'rgba(255,255,255,0.68)';
  ctx.font = '500 25px "Plus Jakarta Sans", sans-serif';
  const descLines = wrapLines(ctx, scene.imagePrompt || scene.narration, 608, 5);
  const descStartY = 270 + headlineLines.length * 64 + 34;
  descLines.forEach((ln, i) => {
    ctx.fillText(ln, 56, descStartY + i * 36);
  });

  ctx.restore();
  return { canvas, dataUrl: canvas.toDataURL('image/jpeg', 0.85), isCustom: false };
}

export async function measureAudioDuration(url: string, fallbackSec: number): Promise<number> {
  try {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return fallbackSec;
    const ctx = new AC();
    try {
      const decoded = await ctx.decodeAudioData(buf);
      return Math.max(1.5, decoded.duration);
    } finally {
      ctx.close().catch(() => {});
    }
  } catch {
    return fallbackSec;
  }
}

export function buildTimeline(
  scenes: AiScene[],
  frames: RenderedSceneFrame[],
  voices: Array<AiVoiceTrack | null>
): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  let cursor = 0;
  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    const frame = frames[i];
    if (!frame) continue;
    const voice = voices[i] || null;
    const dur = Math.max(sc.durationSec || 5, voice ? voice.durationSec + 0.35 : 0);
    segments.push({
      index: i,
      scene: sc,
      frame,
      voice,
      startSec: cursor,
      endSec: cursor + dur,
      durationSec: dur,
    });
    cursor += dur;
  }
  return segments;
}

let vignetteSurface: HTMLCanvasElement | null = null;
function getVignetteSurface(W: number, H: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (!vignetteSurface || vignetteSurface.width !== W || vignetteSurface.height !== H) {
    vignetteSurface = document.createElement('canvas');
    vignetteSurface.width = W;
    vignetteSurface.height = H;
    const vCtx = vignetteSurface.getContext('2d');
    if (vCtx) {
      const vig = vCtx.createRadialGradient(W / 2, H / 2, W * 0.25, W / 2, H / 2, H * 0.65);
      vig.addColorStop(0, 'transparent');
      vig.addColorStop(1, 'rgba(0,0,0,0.42)');
      vCtx.fillStyle = vig;
      vCtx.fillRect(0, 0, W, H);
    }
  }
  return vignetteSurface;
}

export function renderTimelineFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  timeline: TimelineSegment[],
  sec: number,
  options: {
    visualEffect: AiVisualEffect;
    transitionStyle: AiTransitionStyle;
    includeCaptions: boolean;
    captionSettings: CaptionSettings;
  }
) {
  ctx.fillStyle = '#07090d';
  ctx.fillRect(0, 0, W, H);
  if (!timeline.length) return;

  const segIdx = Math.max(
    0,
    timeline.findIndex((s) => sec >= s.startSec && sec < s.endSec)
  );
  const seg = timeline[segIdx] || timeline[timeline.length - 1];
  const localT = Math.max(0, sec - seg.startSec);
  const norm = Math.min(1, localT / Math.max(0.1, seg.durationSec));
  const transDur = 0.45;
  const cachedVignette =
    options.visualEffect === 'cinematic' || options.visualEffect === 'kenburns'
      ? getVignetteSurface(W, H)
      : null;

  const drawFrameWithFx = (
    frameCanvas: HTMLCanvasElement,
    progress: number,
    alpha: number,
    offsetX = 0,
    extraScale = 1,
    offsetY = 0
  ) => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    let scale = extraScale;
    let fxOffsetX = offsetX;
    let fxOffsetY = offsetY;
    let tiltRad = 0;

    if (options.visualEffect === 'kenburns') {
      scale *= 1 + progress * 0.08;
    } else if (options.visualEffect === 'pulse') {
      scale *= 1 + Math.sin(progress * Math.PI * 2) * 0.025;
    } else if (options.visualEffect === 'pan_sweep') {
      scale *= 1.12;
      fxOffsetX += Math.sin(progress * Math.PI) * (W * 0.045);
    } else if (options.visualEffect === 'handheld') {
      scale *= 1.07;
      fxOffsetX += Math.sin(sec * 2.8) * (W * 0.014) + Math.cos(sec * 4.1) * (W * 0.008);
      fxOffsetY += Math.cos(sec * 2.2) * (H * 0.008) + Math.sin(sec * 3.7) * (H * 0.005);
      tiltRad = Math.sin(sec * 1.9) * 0.009;
    } else if (options.visualEffect === 'glitch_rgb') {
      const burst = Math.sin(sec * 7.2) > 0.72;
      if (burst) {
        scale *= 1.03;
        fxOffsetX += Math.sin(sec * 47) * (W * 0.012);
      }
    }

    const dw = W * scale;
    const dh = H * scale;
    if (tiltRad !== 0) {
      ctx.translate(W / 2 + fxOffsetX, H / 2 + fxOffsetY);
      ctx.rotate(tiltRad);
      ctx.drawImage(frameCanvas, -dw / 2, -dh / 2, dw, dh);
    } else {
      ctx.drawImage(frameCanvas, (W - dw) / 2 + fxOffsetX, (H - dh) / 2 + fxOffsetY, dw, dh);
    }

    if (options.visualEffect === 'vhs_retro') {
      ctx.fillStyle = 'rgba(255, 168, 76, 0.08)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      const step = Math.max(4, Math.round(H / 160));
      for (let sy = 0; sy < H; sy += step * 2) {
        ctx.fillRect(0, sy, W, Math.max(1, Math.floor(step * 0.5)));
      }
      const scanY = ((sec * 190) % (H + 90)) - 45;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fillRect(0, scanY, W, Math.max(6, H * 0.015));
    } else if (options.visualEffect === 'glitch_rgb') {
      const burst = Math.sin(sec * 7.2) > 0.72;
      if (burst) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
        ctx.fillRect(0, H * 0.22, W, H * 0.06);
        ctx.fillStyle = 'rgba(255, 59, 107, 0.18)';
        ctx.fillRect(0, H * 0.58, W, H * 0.045);
      }
    }

    if (cachedVignette || options.visualEffect === 'vhs_retro') {
      const v = cachedVignette || getVignetteSurface(W, H);
      if (v) ctx.drawImage(v, 0, 0, W, H);
    }
    ctx.restore();
  };

  if (options.transitionStyle !== 'none' && localT < transDur && segIdx > 0) {
    const prev = timeline[segIdx - 1];
    const p = localT / transDur;
    const ease = 1 - Math.pow(1 - p, 3);
    if (options.transitionStyle === 'fade') {
      drawFrameWithFx(prev.frame.canvas, 1, 1 - p);
      drawFrameWithFx(seg.frame.canvas, norm, p);
    } else if (options.transitionStyle === 'zoom') {
      drawFrameWithFx(prev.frame.canvas, 1, 1 - p, 0, 1 + p * 0.14);
      drawFrameWithFx(seg.frame.canvas, norm, p, 0, 0.94 + p * 0.06);
    } else if (options.transitionStyle === 'slide') {
      drawFrameWithFx(prev.frame.canvas, 1, 1, -W * ease);
      drawFrameWithFx(seg.frame.canvas, norm, 1, W * (1 - ease));
    } else if (options.transitionStyle === 'wipe_up') {
      drawFrameWithFx(prev.frame.canvas, 1, 1, 0, 1, -H * 0.12 * ease);
      const topY = Math.round(H * (1 - ease));
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, topY, W, H - topY);
      ctx.clip();
      drawFrameWithFx(seg.frame.canvas, norm, 1);
      ctx.restore();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.fillRect(0, topY - 2, W, 3);
    } else if (options.transitionStyle === 'whip_blur') {
      const whipEase = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      drawFrameWithFx(prev.frame.canvas, 1, 0.35, -W * whipEase - W * 0.06);
      drawFrameWithFx(prev.frame.canvas, 1, 1, -W * whipEase);
      drawFrameWithFx(seg.frame.canvas, norm, 0.35, W * (1 - whipEase) + W * 0.06);
      drawFrameWithFx(seg.frame.canvas, norm, 1, W * (1 - whipEase));
    } else if (options.transitionStyle === 'flash_white') {
      if (p < 0.5) {
        drawFrameWithFx(prev.frame.canvas, 1, 1);
      } else {
        const settle = (p - 0.5) / 0.5;
        drawFrameWithFx(seg.frame.canvas, norm, 1, 0, 1.07 - settle * 0.07);
      }
      const flashAlpha = (1 - Math.abs(p * 2 - 1)) * 0.92;
      ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    } else if (options.transitionStyle === 'iris_circle') {
      drawFrameWithFx(prev.frame.canvas, 1, 1);
      const radius = Math.hypot(W, H) * 0.55 * ease;
      ctx.save();
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, Math.max(1, radius), 0, Math.PI * 2);
      ctx.clip();
      drawFrameWithFx(seg.frame.canvas, norm, 1);
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, Math.max(1, radius), 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.stroke();
      ctx.restore();
    }
  } else {
    drawFrameWithFx(seg.frame.canvas, norm, 1);
  }

  if (options.includeCaptions && (seg.scene.captionText || seg.scene.narration)) {
    const cue = {
      start: seg.startSec,
      end: seg.endSec,
      text: seg.scene.captionText || seg.scene.narration,
    };
    drawCaption(sec, ctx, ctx.canvas, [cue], { ...options.captionSettings, showCaptions: true }, null);
  }
}

export async function renderAiVideo(params: {
  timeline: TimelineSegment[];
  visualEffect: AiVisualEffect;
  transitionStyle: AiTransitionStyle;
  includeCaptions: boolean;
  captionSettings: CaptionSettings;
  audioGain: number;
  enhanceAudio: boolean;
  exportFormat: ExportFormat;
  signal: AbortSignal;
  onProgress: (pct: number, sec: number, totalSec: number) => void;
}): Promise<{ blob: Blob; url: string; ext: string; durationSec: number; sizeBytes: number; renderMs: number }> {
  const {
    timeline,
    visualEffect,
    transitionStyle,
    includeCaptions,
    captionSettings,
    audioGain,
    enhanceAudio,
    exportFormat,
    signal,
    onProgress,
  } = params;

  const totalSec = timeline[timeline.length - 1]?.endSec || 0;
  if (!timeline.length || totalSec <= 0) {
    throw new Error('Timeline video AI kosong.');
  }
  const mime = supportedExportMime(exportFormat);
  if (!mime) throw new Error('Browser tidak mendukung perekaman MediaRecorder.');

  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 1280;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const actx = AC ? new AC() : null;
  const dest = actx ? actx.createMediaStreamDestination() : null;

  if (actx && dest) {
    if (actx.state === 'suspended') await actx.resume();
    const masterGain = actx.createGain();
    masterGain.gain.value = Math.max(0.3, Math.min(2, audioGain));

    if (enhanceAudio) {
      const comp = actx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 4;
      masterGain.connect(comp);
      comp.connect(dest);
    } else {
      masterGain.connect(dest);
    }

    const baseTime = actx.currentTime + 0.08;
    for (const seg of timeline) {
      if (!seg.voice?.url) continue;
      try {
        const res = await fetch(seg.voice.url);
        const raw = await res.arrayBuffer();
        const decoded = await actx.decodeAudioData(raw);
        const src = actx.createBufferSource();
        src.buffer = decoded;
        src.connect(masterGain);
        src.start(baseTime + seg.startSec);
      } catch {
        // Skip broken voice track cleanly
      }
    }
  }

  const stream = canvas.captureStream(30);
  if (dest) {
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  }

  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const startedAt = performance.now();
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';

  return new Promise((resolve, reject) => {
    let active = true;
    let intervalId = 0;

    const cleanup = () => {
      active = false;
      clearInterval(intervalId);
      signal.removeEventListener('abort', handleAbort);
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
      if (actx) actx.close().catch(() => {});
    };

    const handleAbort = () => {
      cleanup();
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {}
      }
      reject(new Error('Render video AI dibatalkan.'));
    };

    signal.addEventListener('abort', handleAbort, { once: true });

    recorder.onerror = () => {
      cleanup();
      reject(new Error('MediaRecorder gagal saat merender video AI.'));
    };

    recorder.onstop = () => {
      cleanup();
      if (signal.aborted) {
        reject(new Error('Render video AI dibatalkan.'));
        return;
      }
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      if (!blob.size) {
        reject(new Error('Hasil render video AI kosong.'));
        return;
      }
      resolve({
        blob,
        url: URL.createObjectURL(blob),
        ext,
        durationSec: totalSec,
        sizeBytes: blob.size,
        renderMs: performance.now() - startedAt,
      });
    };

    recorder.start(250);
    const t0 = performance.now();
    let lastProgressAt = 0;

    intervalId = window.setInterval(() => {
      if (!active) return;
      const now = performance.now();
      const elapsed = (now - t0) / 1000;
      const sec = Math.min(totalSec, elapsed);
      renderTimelineFrame(ctx, 720, 1280, timeline, sec, {
        visualEffect,
        transitionStyle,
        includeCaptions,
        captionSettings,
      });
      if (now - lastProgressAt >= 200) {
        lastProgressAt = now;
        onProgress(Math.min(99, (sec / totalSec) * 100), sec, totalSec);
      }
      if (elapsed >= totalSec + 0.15) {
        active = false;
        clearInterval(intervalId);
        onProgress(99, totalSec, totalSec);
        if (recorder.state !== 'inactive') {
          try {
            recorder.stop();
          } catch {}
        }
      }
    }, 33);
  });
}
