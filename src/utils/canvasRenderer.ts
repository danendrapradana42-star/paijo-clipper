import type {
  AudioEnvelopeData,
  CaptionSettings,
  FramingMode,
  MotionState,
  SubtitleCue,
  YoutubePreviewInfo,
} from '../types/clipper';
import { resolveCanvasFontString } from './fontCatalog';
import { chunkWords, cueProgress } from './subtitles';

// Reusable offscreen canvases to avoid per-frame GC churn
let blurCanvas: HTMLCanvasElement | null = null;
let blurCtx: CanvasRenderingContext2D | null = null;
let motionSampleCanvas: HTMLCanvasElement | null = null;
let motionSampleCtx: CanvasRenderingContext2D | null = null;

function getBlurSurface() {
  if (!blurCanvas) {
    blurCanvas = document.createElement('canvas');
    blurCanvas.width = 90;
    blurCanvas.height = 160;
    blurCtx = blurCanvas.getContext('2d', { alpha: false });
  }
  return { blurCanvas, blurCtx };
}

function getMotionSurface() {
  if (!motionSampleCanvas) {
    motionSampleCanvas = document.createElement('canvas');
    motionSampleCanvas.width = 48;
    motionSampleCanvas.height = 27;
    motionSampleCtx = motionSampleCanvas.getContext('2d', { willReadFrequently: true });
  }
  return { motionSampleCanvas, motionSampleCtx };
}

export function createMotionState(): MotionState {
  return {
    previous: null,
    focusX: 0.5,
    targetX: 0.5,
    lastSampleTime: -1,
    filteredX: null,
    prevDerivative: 0,
    prevFilterTime: null,
    prevMeanLum: null,
  };
}

function lowPassAlpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * Math.max(0.01, cutoff));
  return 1 / (1 + tau / Math.max(1e-4, dt));
}

function applyOneEuroStep(rawX: number, now: number, state: MotionState): number {
  if (state.filteredX === null || state.prevFilterTime === null || now <= state.prevFilterTime) {
    state.filteredX = rawX;
    state.prevDerivative = 0;
    state.prevFilterTime = now;
    return rawX;
  }
  const dt = Math.max(0.016, Math.min(0.5, now - state.prevFilterTime));
  const rawDeriv = (rawX - state.filteredX) / dt;
  const derivAlpha = lowPassAlpha(1.0, dt);
  state.prevDerivative = derivAlpha * rawDeriv + (1 - derivAlpha) * state.prevDerivative;

  // 1€ filter: strict smoothing at rest (minCutoff=0.65Hz), responsive on real pans (beta=0.05)
  const cutoff = 0.65 + 0.05 * Math.abs(state.prevDerivative);
  const alpha = lowPassAlpha(cutoff, dt);
  const filtered = alpha * rawX + (1 - alpha) * state.filteredX;
  state.filteredX = filtered;
  state.prevFilterTime = now;

  // Deadzone (ignore micro-jitter < 3.2% of frame width) + velocity clamp (max 0.55/sec)
  if (Math.abs(filtered - state.targetX) < 0.032) {
    return state.targetX;
  }
  const maxStep = 0.55 * dt;
  const delta = filtered - state.targetX;
  return Math.abs(delta) > maxStep ? state.targetX + Math.sign(delta) * maxStep : filtered;
}

/**
 * Lightweight offline motion-energy tracker (runs on 48x27 frame buffer)
 * enhanced with scene-cut instant snap, 1-Euro adaptive smoothing, deadzone, and velocity clamp.
 */
export function updateMotionFocus(source: HTMLVideoElement, state: MotionState) {
  const now = source.currentTime;
  if (state.lastSampleTime >= 0 && Math.abs(now - state.lastSampleTime) < 0.12) return;
  state.lastSampleTime = now;

  const { motionSampleCanvas: mCanvas, motionSampleCtx: mCtx } = getMotionSurface();
  if (!mCtx || source.readyState < 2) return;

  try {
    mCtx.drawImage(source, 0, 0, mCanvas.width, mCanvas.height);
    const frame = mCtx.getImageData(0, 0, mCanvas.width, mCanvas.height).data;
    const w = mCanvas.width;
    const h = mCanvas.height;

    let lumSum = 0;
    for (let p = 0; p < frame.length; p += 4) {
      lumSum += frame[p] * 0.3 + frame[p + 1] * 0.59 + frame[p + 2] * 0.11;
    }
    const meanLum = lumSum / (w * h);
    const isSceneCut = state.prevMeanLum !== null && Math.abs(meanLum - state.prevMeanLum) > 36;
    state.prevMeanLum = meanLum;

    if (isSceneCut) {
      // Hard camera cut: reset filter history so camera doesn't lag across cuts
      state.filteredX = null;
      state.prevFilterTime = null;
      state.prevDerivative = 0;
    }

    if (state.previous && state.previous.length === frame.length) {
      let weightedX = 0;
      let totalWeight = 0;
      // Focus weight higher in upper-middle band where faces/speakers sit
      for (let y = 2; y < h - 3; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const lumNow = frame[i] * 0.3 + frame[i + 1] * 0.59 + frame[i + 2] * 0.11;
          const lumPrev =
            state.previous[i] * 0.3 + state.previous[i + 1] * 0.59 + state.previous[i + 2] * 0.11;
          const diff = Math.abs(lumNow - lumPrev);
          if (diff > 14) {
            const weight = diff * diff;
            weightedX += (x / (w - 1)) * weight;
            totalWeight += weight;
          }
        }
      }
      if (totalWeight > 7500) {
        const nextX = Math.max(0.15, Math.min(0.85, weightedX / totalWeight));
        if (isSceneCut) {
          state.targetX = nextX;
          state.focusX = nextX;
          state.filteredX = nextX;
          state.prevFilterTime = now;
        } else {
          state.targetX = applyOneEuroStep(nextX, now, state);
        }
      }
    }
    if (!state.previous || state.previous.length !== frame.length) {
      state.previous = new Uint8ClampedArray(frame);
    } else {
      state.previous.set(frame);
    }
  } catch {
    // Ignore cross-origin or transient decode issues
  }
}

function hexToInk(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#111408';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 155 ? '#111408' : '#ffffff';
}

export function drawCaption(
  t: number,
  targetCtx: CanvasRenderingContext2D,
  target: HTMLCanvasElement,
  cues: SubtitleCue[],
  settings: CaptionSettings,
  audioEnv: AudioEnvelopeData | null
) {
  if (!settings.showCaptions) return;
  const cue = cues.find((c) => t >= c.start && t < c.end);
  if (!cue) return;
  const rawWords = cue.text.trim().split(/\s+/).filter(Boolean);
  if (!rawWords.length) return;

  const useCaps = settings.caps;
  const words = useCaps ? rawWords.map((w) => w.toUpperCase()) : rawWords;
  const weights = rawWords.map(
    (w) =>
      Math.max(1, w.replace(/[^\p{L}\p{N}]/gu, '').length) +
      (/[,;:，；：]$/.test(w) ? 2 : 0) +
      (/[.!?…？！]$/.test(w) ? 4 : 0)
  );
  const total = weights.reduce((a, b) => a + b, 0);
  const progress = cueProgress(cue, t, audioEnv);
  let remaining = progress * total;
  let active = weights.length - 1;
  let wordProgress = 0;
  for (let i = 0; i < words.length; i++) {
    if (remaining < weights[i]) {
      active = i;
      wordProgress = remaining / weights[i];
      break;
    }
    remaining -= weights[i];
  }

  const cacheKey = (useCaps ? 'U:' : 'N:') + cue.text;
  const chunks =
    cue._chunks && cue._chunksFor === cacheKey
      ? cue._chunks
      : ((cue._chunksFor = cacheKey), (cue._chunks = chunkWords(words)));
  let first = 0;
  let shown = chunks[chunks.length - 1];
  for (const ch of chunks) {
    if (active < first + ch.length) {
      shown = ch;
      break;
    }
    first += ch.length;
  }

  const W = target.width;
  const H = target.height;
  const style = settings.style || 'capcut';
  const fontFamily = settings.fontFamily || '"Montserrat", "Plus Jakarta Sans", sans-serif';
  const fontWeight = settings.fontWeight || '800';
  const isItalic = Boolean(settings.italic);
  const baseSize = settings.fontSize || 43;
  const posMode = settings.position || 'bottom';
  const hiColor = settings.highlightColor || '#c7ff55';
  const hiInk = hexToInk(hiColor);

  const isPill =
    style === 'pop' ||
    style === 'box3d' ||
    style === 'highlight' ||
    style === 'typewriter_box' ||
    style === 'comic_boom';
  const gap = isPill ? 12 : 14;
  const padX =
    style === 'pop' ||
    style === 'box3d' ||
    style === 'typewriter_box' ||
    style === 'comic_boom'
      ? 15
      : style === 'highlight'
        ? 10
        : 4;
  const boxH = Math.round(baseSize * (isPill ? 1.45 : 1.25));
  const maxWidth = W * 0.9;

  targetCtx.save();
  targetCtx.font = resolveCanvasFontString(fontFamily, baseSize, fontWeight, isItalic);
  targetCtx.textAlign = 'center';
  targetCtx.textBaseline = 'middle';

  const widths = shown.map((w) => targetCtx.measureText(w).width + padX * 2);
  const natural = widths.reduce((a, b) => a + b, 0) + gap * (shown.length - 1);
  const scale = Math.min(1, maxWidth / Math.max(1, natural));
  const fontSize = Math.round(baseSize * scale);
  targetCtx.font = resolveCanvasFontString(fontFamily, fontSize, fontWeight, isItalic);

  const textWidths = shown.map((w) => targetCtx.measureText(w).width);
  const boxWidths = textWidths.map((w) => w + padX * 2);
  const totalWidth = boxWidths.reduce((a, b) => a + b, 0) + gap * (shown.length - 1);
  const boxX = (W - totalWidth) / 2;
  const y =
    posMode === 'top'
      ? 190
      : posMode === 'center'
        ? H / 2 - boxH / 2
        : posMode === 'lower'
          ? H - 360
          : H - 235;
  const cy = y + boxH / 2;
  const radius = 14;

  // Remotion-style subtle entrance pop on cue start
  if (style === 'tiktok_stroke') {
    const enterT = Math.max(0, Math.min(1, (t - cue.start) / 0.14));
    const enterScale = 0.88 + 0.12 * (1 - Math.pow(1 - enterT, 3));
    const enterOffsetY = (1 - enterT) * 14;
    targetCtx.translate(W / 2, cy + enterOffsetY);
    targetCtx.scale(enterScale, enterScale);
    targetCtx.translate(-W / 2, -cy);
  }

  if (
    style === 'capcut' ||
    style === 'karaoke_bar' ||
    style === 'pill_glass' ||
    style === 'editorial_frame'
  ) {
    targetCtx.fillStyle =
      style === 'pill_glass'
        ? 'rgba(14, 18, 28, 0.56)'
        : style === 'editorial_frame'
          ? 'rgba(8, 12, 22, 0.86)'
          : style === 'karaoke_bar'
            ? 'rgba(9,11,16,.72)'
            : 'rgba(10,12,16,.84)';
    targetCtx.beginPath();
    if (typeof targetCtx.roundRect === 'function') {
      targetCtx.roundRect(
        boxX - 14,
        cy - boxH / 2 - 6,
        totalWidth + 28,
        boxH + 12,
        style === 'pill_glass' ? 999 : style === 'editorial_frame' ? 10 : 16
      );
    } else {
      targetCtx.rect(boxX - 14, cy - boxH / 2 - 6, totalWidth + 28, boxH + 12);
    }
    targetCtx.fill();
    if (style === 'pill_glass' || style === 'editorial_frame') {
      targetCtx.lineWidth = style === 'editorial_frame' ? 2 : 2;
      targetCtx.strokeStyle =
        style === 'editorial_frame' ? hiColor : 'rgba(255,255,255,0.22)';
      targetCtx.stroke();
    }
  }

  let x = boxX;
  shown.forEach((word, i) => {
    const wi = first + i;
    const isActive = wi === active;
    const bw = boxWidths[i];
    const cx = x + bw / 2;
    if (style === 'pop') {
      const anim = isActive ? 1 + Math.min(0.08, wordProgress * 0.08) : 1;
      targetCtx.save();
      targetCtx.translate(cx, cy);
      targetCtx.scale(anim, anim);
      targetCtx.translate(-cx, -cy);
      targetCtx.beginPath();
      if (typeof targetCtx.roundRect === 'function') {
        targetCtx.roundRect(x, cy - boxH / 2, bw, boxH, radius);
      } else {
        targetCtx.rect(x, cy - boxH / 2, bw, boxH);
      }
      targetCtx.fillStyle = isActive ? hiColor : '#12151d';
      targetCtx.fill();
      targetCtx.fillStyle = isActive ? hiInk : '#ffffff';
      targetCtx.fillText(word, cx, cy, maxWidth);
      targetCtx.restore();
    } else if (style === 'typewriter_box') {
      const anim = isActive ? 1.07 : 1;
      targetCtx.save();
      targetCtx.translate(cx, cy);
      targetCtx.scale(anim, anim);
      targetCtx.transform(1, 0, -0.14, 1, 0, 0);
      targetCtx.translate(-cx, -cy);
      targetCtx.beginPath();
      if (typeof targetCtx.roundRect === 'function') {
        targetCtx.roundRect(x, cy - boxH / 2 + 1, bw, boxH - 2, 8);
      } else {
        targetCtx.rect(x, cy - boxH / 2 + 1, bw, boxH - 2);
      }
      targetCtx.fillStyle = isActive ? hiColor : 'rgba(13, 16, 24, 0.9)';
      targetCtx.fill();
      targetCtx.lineWidth = 2;
      targetCtx.strokeStyle = isActive ? hiColor : 'rgba(255,255,255,0.16)';
      targetCtx.stroke();
      targetCtx.fillStyle = isActive ? hiInk : '#f8fafc';
      targetCtx.fillText(word, cx, cy, maxWidth);
      targetCtx.restore();
    } else if (style === 'box3d') {
      const anim = isActive ? 1.06 : 1;
      targetCtx.save();
      targetCtx.translate(cx, cy);
      targetCtx.scale(anim, anim);
      targetCtx.translate(-cx, -cy);
      targetCtx.fillStyle = '#090b10';
      targetCtx.beginPath();
      if (typeof targetCtx.roundRect === 'function') {
        targetCtx.roundRect(x + 4, cy - boxH / 2 + 5, bw, boxH, 12);
      } else {
        targetCtx.rect(x + 4, cy - boxH / 2 + 5, bw, boxH);
      }
      targetCtx.fill();
      targetCtx.fillStyle = isActive ? hiColor : '#ffffff';
      targetCtx.beginPath();
      if (typeof targetCtx.roundRect === 'function') {
        targetCtx.roundRect(x, cy - boxH / 2, bw, boxH, 12);
      } else {
        targetCtx.rect(x, cy - boxH / 2, bw, boxH);
      }
      targetCtx.fill();
      targetCtx.fillStyle = isActive ? hiInk : '#11141c';
      targetCtx.fillText(word, cx, cy, maxWidth);
      targetCtx.restore();
    } else if (style === 'highlight') {
      if (isActive) {
        targetCtx.fillStyle = hiColor;
        targetCtx.beginPath();
        if (typeof targetCtx.roundRect === 'function') {
          targetCtx.roundRect(x - 2, cy - boxH / 2 + 2, bw + 4, boxH - 4, 10);
        } else {
          targetCtx.rect(x - 2, cy - boxH / 2 + 2, bw + 4, boxH - 4);
        }
        targetCtx.fill();
        targetCtx.fillStyle = hiInk;
        targetCtx.fillText(word, cx, cy, maxWidth);
      } else {
        targetCtx.lineJoin = 'round';
        targetCtx.lineWidth = 7;
        targetCtx.strokeStyle = 'rgba(0,0,0,.88)';
        targetCtx.strokeText(word, cx, cy, maxWidth);
        targetCtx.fillStyle = '#ffffff';
        targetCtx.fillText(word, cx, cy, maxWidth);
      }
    } else if (style === 'tiktok_stroke') {
      const anim = isActive ? 1 + Math.min(0.14, 0.06 + wordProgress * 0.08) : 1;
      targetCtx.save();
      targetCtx.translate(cx, cy);
      targetCtx.scale(anim, anim);
      targetCtx.translate(-cx, -cy);
      targetCtx.lineJoin = 'round';
      targetCtx.miterLimit = 2;
      targetCtx.lineWidth = Math.max(10, Math.round(fontSize * 0.28));
      targetCtx.strokeStyle = '#07080c';
      targetCtx.strokeText(word, cx, cy, maxWidth);
      targetCtx.fillStyle = isActive ? hiColor : '#ffffff';
      targetCtx.fillText(word, cx, cy, maxWidth);
      targetCtx.restore();
    } else if (style === 'hormozi') {
      const anim = isActive ? 1.14 : 1;
      targetCtx.save();
      targetCtx.translate(cx, cy);
      targetCtx.scale(anim, anim);
      targetCtx.translate(-cx, -cy);
      targetCtx.shadowColor = 'rgba(0,0,0,.95)';
      targetCtx.shadowBlur = 0;
      targetCtx.shadowOffsetX = 0;
      targetCtx.shadowOffsetY = 6;
      targetCtx.lineJoin = 'round';
      targetCtx.lineWidth = 10;
      targetCtx.strokeStyle = '#07080c';
      targetCtx.strokeText(word, cx, cy, maxWidth);
      targetCtx.fillStyle = isActive ? hiColor : '#ffffff';
      targetCtx.fillText(word, cx, cy, maxWidth);
      targetCtx.restore();
    } else if (style === 'retro_shadow') {
      const anim = isActive ? 1.1 : 1;
      targetCtx.save();
      targetCtx.translate(cx, cy);
      targetCtx.scale(anim, anim);
      targetCtx.translate(-cx, -cy);
      targetCtx.lineJoin = 'round';
      targetCtx.fillStyle = '#07080c';
      targetCtx.fillText(word, cx + 5, cy + 6, maxWidth);
      targetCtx.fillStyle = isActive ? '#ffffff' : hiColor;
      targetCtx.fillText(word, cx + 2, cy + 3, maxWidth);
      targetCtx.lineWidth = 6;
      targetCtx.strokeStyle = '#07080c';
      targetCtx.strokeText(word, cx, cy, maxWidth);
      targetCtx.fillStyle = isActive ? hiColor : '#ffffff';
      targetCtx.fillText(word, cx, cy, maxWidth);
      targetCtx.restore();
    } else if (style === 'outline_hollow') {
      const anim = isActive ? 1.09 : 1;
      targetCtx.save();
      targetCtx.translate(cx, cy);
      targetCtx.scale(anim, anim);
      targetCtx.translate(-cx, -cy);
      targetCtx.lineJoin = 'round';
      if (isActive) {
        targetCtx.lineWidth = 8;
        targetCtx.strokeStyle = '#07080c';
        targetCtx.strokeText(word, cx, cy, maxWidth);
        targetCtx.fillStyle = hiColor;
        targetCtx.fillText(word, cx, cy, maxWidth);
      } else {
        targetCtx.lineWidth = 4;
        targetCtx.strokeStyle = 'rgba(255,255,255,0.9)';
        targetCtx.strokeText(word, cx, cy, maxWidth);
        targetCtx.fillStyle = 'rgba(8,10,16,0.38)';
        targetCtx.fillText(word, cx, cy, maxWidth);
      }
      targetCtx.restore();
    } else if (style === 'gradient') {
      const anim = isActive ? 1 + Math.min(0.1, wordProgress * 0.1) : 1;
      targetCtx.save();
      targetCtx.translate(cx, cy);
      targetCtx.scale(anim, anim);
      targetCtx.translate(-cx, -cy);
      targetCtx.lineJoin = 'round';
      targetCtx.lineWidth = 8;
      targetCtx.strokeStyle = 'rgba(8,10,16,.9)';
      targetCtx.strokeText(word, cx, cy, maxWidth);
      if (isActive) {
        const grad = targetCtx.createLinearGradient(x, cy - fontSize / 2, x + bw, cy + fontSize / 2);
        grad.addColorStop(0, hiColor);
        grad.addColorStop(1, '#38bdf8');
        targetCtx.shadowColor = hiColor;
        targetCtx.shadowBlur = 14;
        targetCtx.fillStyle = grad;
      } else {
        targetCtx.fillStyle = '#f8fafc';
      }
      targetCtx.fillText(word, cx, cy, maxWidth);
      targetCtx.restore();
    } else if (style === 'glitch_rgb') {
      const jitter = isActive ? Math.sin(t * 28 + wi * 3) * 2.2 : 0;
      const anim = isActive ? 1.1 : 1;
      targetCtx.save();
      targetCtx.translate(cx, cy);
      targetCtx.scale(anim, anim);
      targetCtx.translate(-cx, -cy);
      targetCtx.lineJoin = 'round';
      targetCtx.font = resolveCanvasFontString(fontFamily, fontSize, fontWeight, isItalic);
      targetCtx.fillStyle = 'rgba(56, 189, 248, 0.85)';
      targetCtx.fillText(word, cx - (isActive ? 4 : 2) + jitter, cy - 1, maxWidth);
      targetCtx.fillStyle = 'rgba(255, 59, 107, 0.85)';
      targetCtx.fillText(word, cx + (isActive ? 4 : 2) - jitter, cy + 1, maxWidth);
      targetCtx.lineWidth = 6;
      targetCtx.strokeStyle = '#07080c';
      targetCtx.strokeText(word, cx, cy, maxWidth);
      targetCtx.fillStyle = isActive ? hiColor : '#ffffff';
      targetCtx.fillText(word, cx, cy, maxWidth);
      targetCtx.restore();
    } else if (style === 'comic_boom') {
      const anim = isActive ? 1.1 : 1;
      const tilt = isActive ? -0.05 : 0.015;
      targetCtx.save();
      targetCtx.translate(cx, cy);
      targetCtx.rotate(tilt);
      targetCtx.scale(anim, anim);
      targetCtx.translate(-cx, -cy);
      targetCtx.fillStyle = '#07080c';
      targetCtx.fillRect(x + 4, cy - boxH / 2 + 4, bw, boxH);
      targetCtx.fillStyle = isActive ? hiColor : '#ffffff';
      targetCtx.fillRect(x, cy - boxH / 2, bw, boxH);
      targetCtx.lineWidth = 3;
      targetCtx.strokeStyle = '#07080c';
      targetCtx.strokeRect(x, cy - boxH / 2, bw, boxH);
      targetCtx.fillStyle = isActive ? hiInk : '#11141c';
      targetCtx.fillText(word, cx, cy, maxWidth);
      targetCtx.restore();
    } else if (style === 'fire_glow') {
      const anim = isActive ? 1 + Math.min(0.12, 0.05 + wordProgress * 0.07) : 1;
      targetCtx.save();
      targetCtx.translate(cx, cy);
      targetCtx.scale(anim, anim);
      targetCtx.translate(-cx, -cy);
      targetCtx.lineJoin = 'round';
      targetCtx.lineWidth = 9;
      targetCtx.strokeStyle = '#180804';
      targetCtx.strokeText(word, cx, cy, maxWidth);
      if (isActive) {
        const fireGrad = targetCtx.createLinearGradient(0, cy - fontSize * 0.55, 0, cy + fontSize * 0.55);
        fireGrad.addColorStop(0, '#fff4b8');
        fireGrad.addColorStop(0.5, hiColor === '#c7ff55' ? '#ffb703' : hiColor);
        fireGrad.addColorStop(1, '#ff5436');
        targetCtx.shadowColor = '#ff5436';
        targetCtx.shadowBlur = 18;
        targetCtx.fillStyle = fireGrad;
      } else {
        targetCtx.fillStyle = '#f8fafc';
      }
      targetCtx.fillText(word, cx, cy, maxWidth);
      targetCtx.restore();
    } else if (style === 'kinetic_underline') {
      const anim = isActive ? 1.07 : 1;
      targetCtx.save();
      targetCtx.translate(cx, cy);
      targetCtx.scale(anim, anim);
      targetCtx.translate(-cx, -cy);
      targetCtx.lineJoin = 'round';
      targetCtx.lineWidth = 7;
      targetCtx.strokeStyle = 'rgba(0,0,0,0.88)';
      targetCtx.strokeText(word, cx, cy, maxWidth);
      targetCtx.fillStyle = isActive ? '#ffffff' : 'rgba(255,255,255,0.82)';
      targetCtx.fillText(word, cx, cy, maxWidth);
      if (isActive) {
        const lineW = Math.max(12, textWidths[i] * Math.min(1, 0.35 + wordProgress * 0.75));
        targetCtx.fillStyle = hiColor;
        targetCtx.fillRect(cx - lineW / 2, cy + fontSize * 0.48, lineW, Math.max(3, Math.round(fontSize * 0.13)));
      }
      targetCtx.restore();
    } else {
      const anim = isActive ? 1 + Math.min(0.1, wordProgress * 0.1) : 1;
      targetCtx.save();
      targetCtx.translate(cx, cy);
      targetCtx.scale(anim, anim);
      targetCtx.translate(-cx, -cy);
      targetCtx.lineJoin = 'round';
      targetCtx.lineWidth = style === 'clean' ? 5 : 7;
      targetCtx.strokeStyle = 'rgba(0,0,0,.85)';
      targetCtx.strokeText(word, cx, cy, maxWidth);
      if (style === 'neon' && isActive) {
        targetCtx.shadowColor = hiColor === '#c7ff55' ? '#ff55d6' : hiColor;
        targetCtx.shadowBlur = 22;
        targetCtx.fillStyle = hiColor === '#c7ff55' ? '#ff89df' : hiColor;
      } else if (style === 'pill_glass' && isActive) {
        targetCtx.shadowColor = hiColor;
        targetCtx.shadowBlur = 14;
        targetCtx.fillStyle = hiColor;
      } else if (isActive) {
        targetCtx.fillStyle = style === 'classic' && hiColor === '#c7ff55' ? '#ffe45c' : hiColor;
      } else {
        targetCtx.fillStyle = style === 'karaoke_bar' && wi < active ? hiColor : '#fff';
      }
      targetCtx.fillText(word, cx, cy, maxWidth);
      targetCtx.restore();
    }
    x += bw + gap;
  });

  targetCtx.restore();
}

export function drawVideoFrame(
  source: HTMLVideoElement,
  target: HTMLCanvasElement,
  targetCtx: CanvasRenderingContext2D,
  options: {
    framingMode: FramingMode;
    manualPanX: number;
    motionState: MotionState;
    cues: SubtitleCue[];
    captionSettings: CaptionSettings;
    audioEnv: AudioEnvelopeData | null;
  }
): boolean {
  const W = target.width;
  const H = target.height;
  const vw = source.videoWidth;
  const vh = source.videoHeight;
  if (!vw || !vh || source.readyState < 2) return false;

  const { framingMode, manualPanX, motionState, cues, captionSettings, audioEnv } = options;

  if (framingMode === 'fit') {
    const { blurCanvas: bCanvas, blurCtx: bCtx } = getBlurSurface();
    if (bCtx) {
      const bW = bCanvas.width;
      const bH = bCanvas.height;
      const bCover = Math.max(bW / vw, bH / vh);
      const bbw = vw * bCover;
      const bbh = vh * bCover;
      bCtx.save();
      bCtx.filter = 'blur(6px) brightness(.48)';
      bCtx.fillStyle = '#08090c';
      bCtx.fillRect(0, 0, bW, bH);
      bCtx.drawImage(source, (bW - bbw) / 2, (bH - bbh) / 2, bbw, bbh);
      bCtx.restore();
      targetCtx.save();
      targetCtx.imageSmoothingEnabled = true;
      targetCtx.imageSmoothingQuality = 'high';
      targetCtx.drawImage(bCanvas, 0, 0, bW, bH, 0, 0, W, H);
      targetCtx.restore();
    } else {
      targetCtx.fillStyle = '#08090c';
      targetCtx.fillRect(0, 0, W, H);
    }
    const scale = Math.min(W / vw, H / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    targetCtx.drawImage(source, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } else {
    if (vw / vh <= W / H) {
      const scale = Math.min(W / vw, H / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      targetCtx.fillStyle = '#08090c';
      targetCtx.fillRect(0, 0, W, H);
      targetCtx.drawImage(source, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      const sw = vh * (W / H);
      if (framingMode === 'manual') {
        motionState.focusX = Math.max(0, Math.min(1, manualPanX));
      } else {
        motionState.focusX += (motionState.targetX - motionState.focusX) * 0.14;
      }
      const sx = Math.max(0, Math.min(vw - sw, motionState.focusX * vw - sw / 2));
      targetCtx.drawImage(source, sx, 0, sw, vh, 0, 0, W, H);
    }
  }

  drawCaption(source.currentTime, targetCtx, target, cues, captionSettings, audioEnv);
  return true;
}

export function drawIdleCanvas(
  target: HTMLCanvasElement,
  targetCtx: CanvasRenderingContext2D,
  ytPreview: YoutubePreviewInfo | null
) {
  const W = target.width;
  const H = target.height;
  targetCtx.save();
  targetCtx.fillStyle = '#07090e';
  targetCtx.fillRect(0, 0, W, H);

  if (ytPreview && ytPreview.id) {
    targetCtx.fillStyle = ytPreview.state === 'error' ? '#f87171' : '#ff5436';
    targetCtx.font = '800 22px "Plus Jakarta Sans", sans-serif';
    targetCtx.textAlign = 'center';
    targetCtx.fillText('LINK YOUTUBE TERDETEKSI', W / 2, H * 0.36);

    targetCtx.fillStyle = '#ffffff';
    targetCtx.font = '700 26px "Plus Jakarta Sans", sans-serif';
    const titleWords = String(ytPreview.title || 'Video YouTube').split(/\s+/);
    let line = '';
    const lines: string[] = [];
    for (const w of titleWords) {
      const test = line ? `${line} ${w}` : w;
      if (targetCtx.measureText(test).width > W * 0.8 && line) {
        lines.push(line);
        line = w;
        if (lines.length >= 3) break;
      } else {
        line = test;
      }
    }
    if (line && lines.length < 4) lines.push(line);
    lines.forEach((ln, idx) => targetCtx.fillText(ln, W / 2, H * 0.45 + idx * 36, W * 0.85));

    targetCtx.fillStyle = '#8f98a8';
    targetCtx.font = '500 18px "Plus Jakarta Sans", sans-serif';
    targetCtx.fillText('Unggah file lokal atau gunakan mode Desktop untuk YouTube', W / 2, H * 0.65, W * 0.85);
  } else {
    targetCtx.strokeStyle = '#1e2432';
    targetCtx.lineWidth = 2;
    targetCtx.strokeRect(36, 36, W - 72, H - 72);
    targetCtx.fillStyle = '#cbd2de';
    targetCtx.font = '700 26px "Plus Jakarta Sans", sans-serif';
    targetCtx.textAlign = 'center';
    targetCtx.fillText('Pratinjau Kanvas 9:16', W / 2, H * 0.47);
    targetCtx.fillStyle = '#687285';
    targetCtx.font = '500 19px "Plus Jakarta Sans", sans-serif';
    targetCtx.fillText('Pilih file video di Beranda untuk memulai', W / 2, H * 0.52);
  }
  targetCtx.restore();
}
