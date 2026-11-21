import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Film, Loader2 } from 'lucide-react';
import type {
  AiTheme,
  AiTransitionStyle,
  AiVisualEffect,
  CaptionSettings,
  SubtitleCue,
  SubtitleStyleId,
} from '../types/clipper';
import type { RenderedSceneFrame } from '../utils/aiPipeline';
import { drawCaption } from '../utils/canvasRenderer';
import {
  STYLE_OPTIONS,
  ensureFontLoaded,
  type CaptionStylePreset,
} from '../utils/fontCatalog';

// Shared 24fps preview clock to animate all visible preview canvases cleanly on a single RAF loop
type TickListener = (sec: number) => void;
const tickListeners = new Set<TickListener>();
let sharedRafId = 0;
let sharedLastDrawMs = 0;
let sharedStartMs = 0;

function startSharedLoopIfNeeded() {
  if (typeof window === 'undefined' || sharedRafId || tickListeners.size === 0) return;
  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!sharedStartMs) sharedStartMs = performance.now();

  if (reducedMotion) {
    tickListeners.forEach((cb) => cb(1.15));
    return;
  }

  const loop = (now: number) => {
    if (tickListeners.size === 0) {
      sharedRafId = 0;
      return;
    }
    if (!document.hidden && now - sharedLastDrawMs >= 42) {
      sharedLastDrawMs = now;
      const sec = (now - sharedStartMs) / 1000;
      tickListeners.forEach((cb) => cb(sec));
    }
    sharedRafId = window.requestAnimationFrame(loop);
  };
  sharedRafId = window.requestAnimationFrame(loop);
}

function subscribePreviewClock(cb: TickListener): () => void {
  tickListeners.add(cb);
  startSharedLoopIfNeeded();
  return () => {
    tickListeners.delete(cb);
    if (tickListeners.size === 0 && sharedRafId) {
      window.cancelAnimationFrame(sharedRafId);
      sharedRafId = 0;
    }
  };
}

const SAMPLE_PALETTES: Record<
  AiTheme,
  {
    aTop: string;
    aBot: string;
    aAccent: string;
    bTop: string;
    bBot: string;
    bAccent: string;
  }
> = {
  cinematic: {
    aTop: '#16111c',
    aBot: '#2d1820',
    aAccent: '#ff6b00',
    bTop: '#0b182b',
    bBot: '#132d46',
    bAccent: '#38bdf8',
  },
  editorial: {
    aTop: '#14171d',
    aBot: '#212832',
    aAccent: '#c7ff55',
    bTop: '#1c1824',
    bBot: '#2b2438',
    bAccent: '#ffe45c',
  },
  tech: {
    aTop: '#071321',
    aBot: '#0f2842',
    aAccent: '#38bdf8',
    bTop: '#0c1a2a',
    bBot: '#10343a',
    bAccent: '#34d399',
  },
  minimal: {
    aTop: '#12151c',
    aBot: '#202632',
    aAccent: '#e2e8f0',
    bTop: '#181b24',
    bBot: '#272c3a',
    bAccent: '#c7ff55',
  },
};

function createSampleScenePair(
  W: number,
  H: number,
  theme: AiTheme
): [HTMLCanvasElement, HTMLCanvasElement] {
  const pal = SAMPLE_PALETTES[theme] || SAMPLE_PALETTES.cinematic;
  const makeScene = (
    topColor: string,
    botColor: string,
    accent: string,
    tag: string,
    title: string,
    variant: 'horizon' | 'city'
  ) => {
    const cvs = document.createElement('canvas');
    cvs.width = W;
    cvs.height = H;
    const ctx = cvs.getContext('2d', { alpha: false })!;

    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, topColor);
    grad.addColorStop(1, botColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Glow focal orb
    const cx = variant === 'horizon' ? W * 0.52 : W * 0.48;
    const cy = variant === 'horizon' ? H * 0.42 : H * 0.36;
    const radial = ctx.createRadialGradient(cx, cy, 4, cx, cy, W * 0.65);
    radial.addColorStop(0, `${accent}66`);
    radial.addColorStop(0.55, `${accent}1e`);
    radial.addColorStop(1, 'transparent');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, W, H);

    // Subtle geometric focal subject so zoom/slide/fade motion is crisp & unmistakable
    ctx.save();
    if (variant === 'horizon') {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.arc(W * 0.5, H * 0.44, W * 0.22, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(7, 10, 18, 0.72)';
      ctx.beginPath();
      ctx.moveTo(0, H * 0.78);
      ctx.lineTo(W * 0.34, H * 0.54);
      ctx.lineTo(W * 0.62, H * 0.66);
      ctx.lineTo(W, H * 0.48);
      ctx.lineTo(W, H);
      ctx.lineTo(0, H);
      ctx.closePath();
      ctx.fill();
    } else {
      const bars = [0.22, 0.36, 0.28, 0.44, 0.32];
      bars.forEach((hRatio, idx) => {
        const bw = W / 6;
        const bx = idx * (W / 5) + 4;
        const bh = H * hRatio;
        ctx.fillStyle = idx % 2 === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(8,14,28,0.65)';
        ctx.fillRect(bx, H - bh, bw, bh);
      });
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    for (let y = 36; y < H; y += 36) {
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.lineTo(W - 10, y);
      ctx.stroke();
    }

    ctx.fillStyle = accent;
    ctx.font = '700 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(tag, 12, 26);

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 16px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(title, 12, 48);
    ctx.restore();
    return cvs;
  };

  return [
    makeScene(pal.aTop, pal.aBot, pal.aAccent, 'ADEGAN 01', 'Fokus Visual', 'horizon'),
    makeScene(pal.bTop, pal.bBot, pal.bAccent, 'ADEGAN 02', 'Lanjut Cerita', 'city'),
  ];
}

function drawVignetteOverlay(ctx: CanvasRenderingContext2D, W: number, H: number, strength = 0.5) {
  const vig = ctx.createRadialGradient(W / 2, H / 2, W * 0.2, W / 2, H / 2, H * 0.65);
  vig.addColorStop(0, 'transparent');
  vig.addColorStop(1, `rgba(0, 0, 0, ${strength})`);
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

const VISUAL_EFFECT_ITEMS: Array<{
  id: AiVisualEffect;
  label: string;
  desc: string;
}> = [
  { id: 'kenburns', label: 'Ken Burns', desc: 'Zoom halus + vignette' },
  { id: 'cinematic', label: 'Sinematik', desc: 'Vignette & tone kontras' },
  { id: 'pulse', label: 'Pulse Ritmis', desc: 'Denyut tempo dinamis' },
  { id: 'pan_sweep', label: 'Pan Geser', desc: 'Kamera menyapu horizontal' },
  { id: 'handheld', label: 'Handheld Live', desc: 'Goyangan organik natural' },
  { id: 'vhs_retro', label: 'VHS Retro', desc: 'Scanline analog & hangat' },
  { id: 'glitch_rgb', label: 'RGB Glitch', desc: 'Kilatan split warna cepat' },
  { id: 'none', label: 'Statis', desc: 'Tanpa gerak kamera' },
];

const TRANSITION_ITEMS: Array<{
  id: AiTransitionStyle;
  label: string;
  desc: string;
}> = [
  { id: 'fade', label: 'Fade Halus', desc: 'Cross-dissolve lembut' },
  { id: 'zoom', label: 'Zoom Masuk', desc: 'Punch zoom cepat' },
  { id: 'slide', label: 'Slide Geser', desc: 'Geser horizontal bersih' },
  { id: 'wipe_up', label: 'Wipe Naik', desc: 'Tirai vertikal membuka adegan' },
  { id: 'whip_blur', label: 'Whip Pan', desc: 'Sapuan cepat bertenaga' },
  { id: 'flash_white', label: 'Kilat Cahaya', desc: 'Kilatan flash kamera singkat' },
  { id: 'iris_circle', label: 'Iris Lingkar', desc: 'Membuka dari tengah frame' },
  { id: 'none', label: 'Cut Langsung', desc: 'Pindah instan tanpa jeda' },
];

interface VisualEffectPreviewGridProps {
  value: AiVisualEffect;
  onChange: (fx: AiVisualEffect) => void;
  theme: AiTheme;
  customFrames?: RenderedSceneFrame[];
}

export function VisualEffectPreviewGrid({
  value,
  onChange,
  theme,
  customFrames,
}: VisualEffectPreviewGridProps) {
  const canvasRefs = useRef<Partial<Record<AiVisualEffect, HTMLCanvasElement | null>>>({});

  const samplePair = useMemo(() => {
    if (typeof document === 'undefined') return null;
    if (customFrames && customFrames.length > 0 && customFrames[0]?.canvas) {
      return [customFrames[0].canvas, customFrames[1]?.canvas || customFrames[0].canvas] as [
        HTMLCanvasElement,
        HTMLCanvasElement,
      ];
    }
    return createSampleScenePair(144, 216, theme);
  }, [theme, customFrames]);

  useEffect(() => {
    if (!samplePair) return;
    const W = 144;
    const H = 216;
    const baseFrame = samplePair[0];

    return subscribePreviewClock((sec) => {
      const cycleT = (sec % 2.8) / 2.8;
      for (const item of VISUAL_EFFECT_ITEMS) {
        const cvs = canvasRefs.current[item.id];
        if (!cvs) continue;
        const ctx = cvs.getContext('2d', { alpha: false });
        if (!ctx) continue;

        ctx.fillStyle = '#070e20';
        ctx.fillRect(0, 0, W, H);
        ctx.save();

        let scale = 1;
        let offsetX = 0;
        let offsetY = 0;
        let tiltRad = 0;

        if (item.id === 'kenburns') {
          const ease = 0.5 - 0.5 * Math.cos(cycleT * Math.PI * 2);
          scale = 1 + ease * 0.16;
          offsetX = (ease - 0.5) * -10;
          offsetY = (ease - 0.5) * -8;
        } else if (item.id === 'cinematic') {
          scale = 1.03;
        } else if (item.id === 'pulse') {
          const beat = Math.pow(Math.abs(Math.sin(sec * Math.PI * 1.4)), 4);
          scale = 1 + beat * 0.085;
        } else if (item.id === 'pan_sweep') {
          scale = 1.18;
          offsetX = Math.sin(cycleT * Math.PI * 2) * 10;
        } else if (item.id === 'handheld') {
          scale = 1.1;
          offsetX = Math.sin(sec * 3.1) * 4 + Math.cos(sec * 4.5) * 2.5;
          offsetY = Math.cos(sec * 2.4) * 3.5 + Math.sin(sec * 3.9) * 2;
          tiltRad = Math.sin(sec * 2.1) * 0.018;
        } else if (item.id === 'glitch_rgb') {
          const burst = Math.sin(sec * 6.5) > 0.68;
          if (burst) {
            scale = 1.04;
            offsetX = Math.sin(sec * 43) * 4.5;
          }
        }

        const dw = W * scale;
        const dh = H * scale;
        if (tiltRad !== 0) {
          ctx.translate(W / 2 + offsetX, H / 2 + offsetY);
          ctx.rotate(tiltRad);
          ctx.drawImage(baseFrame, -dw / 2, -dh / 2, dw, dh);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        } else {
          ctx.drawImage(baseFrame, (W - dw) / 2 + offsetX, (H - dh) / 2 + offsetY, dw, dh);
        }

        if (item.id === 'cinematic') {
          drawVignetteOverlay(ctx, W, H, 0.58);
          const sweepX = ((sec * 42) % (W + 120)) - 60;
          const sheen = ctx.createLinearGradient(sweepX - 35, 0, sweepX + 35, H);
          sheen.addColorStop(0, 'transparent');
          sheen.addColorStop(0.5, 'rgba(255, 195, 110, 0.14)');
          sheen.addColorStop(1, 'transparent');
          ctx.fillStyle = sheen;
          ctx.fillRect(0, 0, W, H);
        } else if (item.id === 'kenburns') {
          drawVignetteOverlay(ctx, W, H, 0.35);
        } else if (item.id === 'vhs_retro') {
          ctx.fillStyle = 'rgba(255, 168, 76, 0.09)';
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
          for (let sy = 0; sy < H; sy += 4) {
            ctx.fillRect(0, sy, W, 1);
          }
          const barY = ((sec * 52) % (H + 24)) - 12;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
          ctx.fillRect(0, barY, W, 4);
          drawVignetteOverlay(ctx, W, H, 0.45);
        } else if (item.id === 'glitch_rgb') {
          const burst = Math.sin(sec * 6.5) > 0.68;
          if (burst) {
            ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
            ctx.fillRect(0, H * 0.24, W, 11);
            ctx.fillStyle = 'rgba(255, 59, 107, 0.24)';
            ctx.fillRect(0, H * 0.62, W, 9);
          }
        }

        ctx.restore();
      }
    });
  }, [samplePair]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
      {VISUAL_EFFECT_ITEMS.map((item) => {
        const selected = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            aria-pressed={selected}
            className={`group text-left rounded-xl border p-2 transition-colors cursor-pointer bg-[#0c1733] focus-visible:outline-2 focus-visible:outline-[#c7ff55] ${
              selected
                ? 'border-[#c7ff55] bg-[#142347]'
                : 'border-[#1e3159] hover:border-[#2a4173]'
            }`}
          >
            <div className="relative w-full aspect-[2/3] max-h-[152px] rounded-lg overflow-hidden bg-[#070e20] border border-[#1e3159]">
              <canvas
                ref={(el) => {
                  canvasRefs.current[item.id] = el;
                }}
                width={144}
                height={216}
                className="w-full h-full object-cover block"
              />
              <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/85 via-black/40 to-transparent pointer-events-none" />
              <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-md flex items-center justify-center bg-black/65 border border-white/15">
                {selected ? (
                  <Check className="w-3 h-3 text-[#c7ff55]" />
                ) : (
                  <Film className="w-2.5 h-2.5 text-white/75" />
                )}
              </div>
            </div>
            <div className="pt-2 px-0.5 space-y-0.5">
              <div
                className={`text-xs font-bold truncate ${
                  selected ? 'text-[#c7ff55]' : 'text-white'
                }`}
              >
                {item.label}
              </div>
              <div className="text-[11px] text-[#93a7cc] truncate">{item.desc}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

interface TransitionPreviewGridProps {
  value: AiTransitionStyle;
  onChange: (tr: AiTransitionStyle) => void;
  theme: AiTheme;
  customFrames?: RenderedSceneFrame[];
}

export function TransitionPreviewGrid({
  value,
  onChange,
  theme,
  customFrames,
}: TransitionPreviewGridProps) {
  const canvasRefs = useRef<Partial<Record<AiTransitionStyle, HTMLCanvasElement | null>>>({});

  const samplePair = useMemo(() => {
    if (typeof document === 'undefined') return null;
    if (customFrames && customFrames.length >= 2 && customFrames[0]?.canvas && customFrames[1]?.canvas) {
      return [customFrames[0].canvas, customFrames[1].canvas] as [
        HTMLCanvasElement,
        HTMLCanvasElement,
      ];
    }
    return createSampleScenePair(144, 216, theme);
  }, [theme, customFrames]);

  useEffect(() => {
    if (!samplePair) return;
    const W = 144;
    const H = 216;
    const [sceneA, sceneB] = samplePair;

    return subscribePreviewClock((sec) => {
      // 2.8s loop: 0..1.4s Scene A -> Scene B, 1.4..2.8s Scene B -> Scene A
      const loop = sec % 2.8;
      const half = loop % 1.4;
      const forward = loop < 1.4;
      const fromFrame = forward ? sceneA : sceneB;
      const toFrame = forward ? sceneB : sceneA;
      const transStart = 0.72;
      const transDur = 0.52;
      const inTransition = half >= transStart;
      const p = inTransition ? Math.min(1, (half - transStart) / transDur) : 0;
      const ease = 1 - Math.pow(1 - p, 3);

      for (const item of TRANSITION_ITEMS) {
        const cvs = canvasRefs.current[item.id];
        if (!cvs) continue;
        const ctx = cvs.getContext('2d', { alpha: false });
        if (!ctx) continue;

        ctx.fillStyle = '#070e20';
        ctx.fillRect(0, 0, W, H);

        const drawScaled = (
          frame: HTMLCanvasElement,
          alpha: number,
          offsetX = 0,
          scale = 1,
          offsetY = 0
        ) => {
          ctx.save();
          ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
          const dw = W * scale;
          const dh = H * scale;
          ctx.drawImage(frame, (W - dw) / 2 + offsetX, (H - dh) / 2 + offsetY, dw, dh);
          ctx.restore();
        };

        if (!inTransition || item.id === 'none') {
          drawScaled(p >= 0.5 && item.id === 'none' ? toFrame : fromFrame, 1);
        } else if (item.id === 'fade') {
          drawScaled(fromFrame, 1 - p);
          drawScaled(toFrame, p);
        } else if (item.id === 'zoom') {
          drawScaled(fromFrame, 1 - p, 0, 1 + p * 0.18);
          drawScaled(toFrame, p, 0, 0.92 + p * 0.08);
        } else if (item.id === 'slide') {
          drawScaled(fromFrame, 1, -W * ease);
          drawScaled(toFrame, 1, W * (1 - ease));
        } else if (item.id === 'wipe_up') {
          drawScaled(fromFrame, 1, 0, 1, -H * 0.12 * ease);
          const topY = Math.round(H * (1 - ease));
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, topY, W, H - topY);
          ctx.clip();
          drawScaled(toFrame, 1);
          ctx.restore();
          ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.fillRect(0, topY - 1, W, 2);
        } else if (item.id === 'whip_blur') {
          const whipEase = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
          drawScaled(fromFrame, 0.35, -W * whipEase - 8);
          drawScaled(fromFrame, 1, -W * whipEase);
          drawScaled(toFrame, 0.35, W * (1 - whipEase) + 8);
          drawScaled(toFrame, 1, W * (1 - whipEase));
        } else if (item.id === 'flash_white') {
          if (p < 0.5) {
            drawScaled(fromFrame, 1);
          } else {
            const settle = (p - 0.5) / 0.5;
            drawScaled(toFrame, 1, 0, 1.07 - settle * 0.07);
          }
          const flashAlpha = (1 - Math.abs(p * 2 - 1)) * 0.92;
          ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha.toFixed(3)})`;
          ctx.fillRect(0, 0, W, H);
        } else if (item.id === 'iris_circle') {
          drawScaled(fromFrame, 1);
          const radius = Math.hypot(W, H) * 0.55 * ease;
          ctx.save();
          ctx.beginPath();
          ctx.arc(W / 2, H / 2, Math.max(1, radius), 0, Math.PI * 2);
          ctx.clip();
          drawScaled(toFrame, 1);
          ctx.restore();
          ctx.save();
          ctx.beginPath();
          ctx.arc(W / 2, H / 2, Math.max(1, radius), 0, Math.PI * 2);
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.stroke();
          ctx.restore();
        }
      }
    });
  }, [samplePair]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
      {TRANSITION_ITEMS.map((item) => {
        const selected = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            aria-pressed={selected}
            className={`group text-left rounded-xl border p-2 transition-colors cursor-pointer bg-[#0c1733] focus-visible:outline-2 focus-visible:outline-[#c7ff55] ${
              selected
                ? 'border-[#c7ff55] bg-[#142347]'
                : 'border-[#1e3159] hover:border-[#2a4173]'
            }`}
          >
            <div className="relative w-full aspect-[2/3] max-h-[152px] rounded-lg overflow-hidden bg-[#070e20] border border-[#1e3159]">
              <canvas
                ref={(el) => {
                  canvasRefs.current[item.id] = el;
                }}
                width={144}
                height={216}
                className="w-full h-full object-cover block"
              />
              <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/85 via-black/40 to-transparent pointer-events-none" />
              <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-md flex items-center justify-center bg-black/65 border border-white/15">
                {selected ? (
                  <Check className="w-3 h-3 text-[#c7ff55]" />
                ) : (
                  <Film className="w-2.5 h-2.5 text-white/75" />
                )}
              </div>
            </div>
            <div className="pt-2 px-0.5 space-y-0.5">
              <div
                className={`text-xs font-bold truncate ${
                  selected ? 'text-[#c7ff55]' : 'text-white'
                }`}
              >
                {item.label}
              </div>
              <div className="text-[11px] text-[#93a7cc] truncate">{item.desc}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

const SAMPLE_SUBTITLE_CUES: SubtitleCue[] = [
  { start: 0, end: 1.6, text: 'Rahasia video viral' },
  { start: 1.6, end: 3.2, text: 'tampil lebih tajam' },
];

function drawSubtitleBackdropFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  sec: number,
  accentColor: string
) {
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#091124');
  grad.addColorStop(1, '#151b30');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Subtle moving ambient light so canvas looks like a real looping sample video
  const orbX = W * (0.5 + 0.22 * Math.sin(sec * 1.15));
  const orbY = H * (0.45 + 0.14 * Math.cos(sec * 0.9));
  const radial = ctx.createRadialGradient(orbX, orbY, 4, orbX, orbY, W * 0.55);
  radial.addColorStop(0, `${accentColor}30`);
  radial.addColorStop(1, 'transparent');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H * 0.72);
  ctx.lineTo(W, H * 0.72);
  ctx.stroke();

  // Gentle equalizer motion silhouette at top to evoke live audio narration
  const barCount = 12;
  const barGap = 6;
  const barW = 4;
  const startX = (W - (barCount * barW + (barCount - 1) * barGap)) / 2;
  ctx.fillStyle = `${accentColor}66`;
  for (let i = 0; i < barCount; i++) {
    const amp = 4 + Math.abs(Math.sin(sec * 5 + i * 0.7)) * 12;
    ctx.fillRect(startX + i * (barW + barGap), 22 - amp / 2, barW, amp);
  }
}

interface SubtitlePresetPreviewGridProps {
  presets: CaptionStylePreset[];
  settings: CaptionSettings;
  onSelect: (patch: Partial<CaptionSettings>) => void;
}

export function SubtitlePresetPreviewGrid({
  presets,
  settings,
  onSelect,
}: SubtitlePresetPreviewGridProps) {
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const [fontsLoadedTick, setFontsLoadedTick] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all(
      presets.map((p) =>
        ensureFontLoaded(
          p.patch.fontFamily || settings.fontFamily,
          Boolean(p.patch.italic),
          p.patch.fontWeight || '800'
        )
      )
    ).then(() => {
      if (active) setFontsLoadedTick((n) => n + 1);
    });
    return () => {
      active = false;
    };
  }, [presets, settings.fontFamily]);

  useEffect(() => {
    const W = 320;
    const H = 160;
    const baseCues = SAMPLE_SUBTITLE_CUES.map((c) => ({ ...c }));

    return subscribePreviewClock((sec) => {
      const loopT = sec % 3.2;
      for (const preset of presets) {
        const cvs = canvasRefs.current[preset.id];
        if (!cvs) continue;
        const ctx = cvs.getContext('2d', { alpha: false });
        if (!ctx) continue;

        const accent = preset.patch.highlightColor || '#c7ff55';
        drawSubtitleBackdropFrame(ctx, W, H, sec, accent);

        const mergedSettings: CaptionSettings = {
          ...settings,
          ...preset.patch,
          showCaptions: true,
          fontSize: 28,
          position: 'center',
        };
        drawCaption(loopT, ctx, cvs, baseCues, mergedSettings, null);
      }
    });
  }, [presets, settings, fontsLoadedTick]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
      {presets.map((preset) => {
        const isMatch =
          settings.style === preset.patch.style &&
          settings.fontFamily === preset.patch.fontFamily;
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => onSelect(preset.patch)}
            aria-pressed={isMatch}
            className={`text-left rounded-xl border p-2 transition-colors cursor-pointer bg-[#0c1733] focus-visible:outline-2 focus-visible:outline-[#c7ff55] ${
              isMatch
                ? 'border-[#c7ff55] bg-[#16264d]'
                : 'border-[#1e3159] hover:border-[#2a4173]'
            }`}
          >
            <div className="relative w-full aspect-[2/1] rounded-lg overflow-hidden bg-[#070e20] border border-[#1e3159]">
              <canvas
                ref={(el) => {
                  canvasRefs.current[preset.id] = el;
                }}
                width={320}
                height={160}
                className="w-full h-full object-cover block"
              />
              {isMatch && (
                <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-md bg-black/70 border border-[#c7ff55]/70 flex items-center justify-center">
                  <Check className="w-3 h-3 text-[#c7ff55]" />
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 pt-2 px-0.5">
              <div className="min-w-0">
                <div
                  className={`text-xs font-bold truncate ${
                    isMatch ? 'text-[#c7ff55]' : 'text-white'
                  }`}
                >
                  {preset.name}
                </div>
                <div className="text-[11px] text-[#93a7cc] truncate">{preset.subtitle}</div>
              </div>
              <span
                className="w-3 h-3 rounded-sm shrink-0 border border-white/15"
                style={{ backgroundColor: preset.patch.highlightColor || '#c7ff55' }}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}

interface SubtitleStyleLiveCanvasProps {
  settings: CaptionSettings;
  sampleLabel: string;
}

export function SubtitleStyleLiveCanvas({
  settings,
  sampleLabel,
}: SubtitleStyleLiveCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const W = 480;
    const H = 128;
    const baseCues = SAMPLE_SUBTITLE_CUES.map((c) => ({ ...c }));

    return subscribePreviewClock((sec) => {
      const cvs = canvasRef.current;
      if (!cvs) return;
      const ctx = cvs.getContext('2d', { alpha: false });
      if (!ctx) return;

      const loopT = sec % 3.2;
      drawSubtitleBackdropFrame(ctx, W, H, sec, settings.highlightColor || '#c7ff55');
      drawCaption(
        loopT,
        ctx,
        cvs,
        baseCues,
        {
          ...settings,
          showCaptions: true,
          fontSize: Math.max(24, Math.min(34, Math.round((settings.fontSize || 43) * 0.68))),
          position: 'center',
        },
        null
      );
    });
  }, [settings]);

  return (
    <div className="bg-[#070e20] border border-[#1e3159] rounded-xl overflow-hidden">
      <canvas ref={canvasRef} width={480} height={128} className="w-full h-[92px] object-cover block" />
      <div className="px-3 py-1.5 border-t border-[#1e3159] flex items-center justify-between gap-2 text-[11px] text-[#93a7cc]">
        <span className="truncate">{sampleLabel}</span>
        <span className="font-mono text-[#c7ff55] shrink-0">Live 24fps</span>
      </div>
    </div>
  );
}

interface SubtitleAllStylesGalleryProps {
  settings: CaptionSettings;
  onSelectStyle: (style: SubtitleStyleId) => void;
}

export function SubtitleAllStylesGallery({
  settings,
  onSelectStyle,
}: SubtitleAllStylesGalleryProps) {
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});

  useEffect(() => {
    const W = 280;
    const H = 120;
    const baseCues = SAMPLE_SUBTITLE_CUES.map((c) => ({ ...c }));

    return subscribePreviewClock((sec) => {
      const loopT = sec % 3.2;
      for (const opt of STYLE_OPTIONS) {
        const cvs = canvasRefs.current[opt.value];
        if (!cvs) continue;
        const ctx = cvs.getContext('2d', { alpha: false });
        if (!ctx) continue;

        drawSubtitleBackdropFrame(ctx, W, H, sec, settings.highlightColor || '#c7ff55');
        drawCaption(
          loopT,
          ctx,
          cvs,
          baseCues,
          {
            ...settings,
            style: opt.value,
            showCaptions: true,
            fontSize: 23,
            position: 'center',
          },
          null
        );
      }
    });
  }, [settings]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
      {STYLE_OPTIONS.map((opt) => {
        const active = settings.style === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelectStyle(opt.value)}
            aria-pressed={active}
            className={`text-left rounded-lg border p-2 transition-colors cursor-pointer bg-[#0c1733] ${
              active ? 'border-[#c7ff55] bg-[#16264d]' : 'border-[#1e3159] hover:border-[#2a4173]'
            }`}
          >
            <div className="relative w-full aspect-[7/3] rounded overflow-hidden bg-[#070e20] border border-[#1e3159]">
              <canvas
                ref={(el) => {
                  canvasRefs.current[opt.value] = el;
                }}
                width={280}
                height={120}
                className="w-full h-full object-cover block"
              />
            </div>
            <div className="pt-1.5 flex items-center justify-between gap-1.5">
              <span
                className={`text-[11px] font-bold truncate ${
                  active ? 'text-[#c7ff55]' : 'text-white'
                }`}
              >
                {opt.label}
              </span>
              {active && <Check className="w-3 h-3 text-[#c7ff55] shrink-0" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function VoiceSampleSpinner() {
  return <Loader2 className="w-3 h-3 animate-spin shrink-0" />;
}
