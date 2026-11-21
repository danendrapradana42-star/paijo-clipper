import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../i18n/LanguageContext';
import type { AudioEnvelopeData, SubtitleCue } from '../types/clipper';
import { snapBoundaryToCueOrGap } from '../utils/clipSelector';
import { formatTimeDecimal } from '../utils/subtitles';

interface TrimBarProps {
  start: number;
  end: number;
  maxDuration: number;
  cues: SubtitleCue[];
  audioEnv: AudioEnvelopeData | null;
  disabled?: boolean;
  onCommit: (nextStart: number, nextEnd: number) => void;
}

export function TrimBar({
  start,
  end,
  maxDuration,
  cues,
  audioEnv,
  disabled = false,
  onCommit,
}: TrimBarProps) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
  const [local, setLocal] = useState({ start, end });

  useEffect(() => {
    setLocal({ start, end });
  }, [start, end]);

  const windowStart = Math.max(0, start - 6);
  const hardMax = maxDuration > 0 ? maxDuration : end + 6;
  const windowEnd = Math.min(hardMax, Math.max(end + 6, windowStart + 10));
  const span = Math.max(0.5, windowEnd - windowStart);

  const toFraction = (tVal: number) => Math.max(0, Math.min(1, (tVal - windowStart) / span));
  const toTime = useCallback(
    (fraction: number) => Math.max(windowStart, Math.min(windowEnd, windowStart + fraction * span)),
    [windowStart, windowEnd, span]
  );

  const bars = useMemo(() => {
    const count = 72;
    const out = new Array<number>(count).fill(0.14);
    if (audioEnv && audioEnv.n > 0) {
      const normMax = Math.max(0.02, audioEnv.thr * 3.5);
      for (let b = 0; b < count; b++) {
        const t0 = windowStart + (b / count) * span;
        const t1 = windowStart + ((b + 1) / count) * span;
        const i0 = Math.max(0, Math.floor(t0 / audioEnv.hop));
        const i1 = Math.min(audioEnv.n - 1, Math.ceil(t1 / audioEnv.hop));
        let peak = 0;
        for (let i = i0; i <= i1; i++) {
          if (audioEnv.rms[i] > peak) peak = audioEnv.rms[i];
        }
        out[b] = Math.max(0.12, Math.min(1, peak / normMax));
      }
      return out;
    }

    if (cues.length > 0) {
      for (const cue of cues) {
        const b0 = Math.max(0, Math.floor(((cue.start - windowStart) / span) * count));
        const b1 = Math.min(count - 1, Math.ceil(((cue.end - windowStart) / span) * count));
        for (let b = b0; b <= b1; b++) {
          out[b] = 0.78;
        }
      }
    }
    return out;
  }, [audioEnv, cues, windowStart, span]);

  const dragRafRef = useRef<number>(0);
  const pendingClientXRef = useRef<number | null>(null);
  const dragRectRef = useRef<DOMRect | null>(null);

  useEffect(() => {
    if (!dragging || disabled) return;
    dragRectRef.current = trackRef.current?.getBoundingClientRect() || null;

    const applyPointerAt = (clientX: number) => {
      const rect = dragRectRef.current || trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const tVal = toTime(frac);
      setLocal((cur) =>
        dragging === 'start'
          ? { ...cur, start: Math.max(0, Math.min(cur.end - 2, tVal)) }
          : { ...cur, end: Math.min(hardMax, Math.max(cur.start + 2, tVal)) }
      );
    };

    const onMove = (e: PointerEvent) => {
      pendingClientXRef.current = e.clientX;
      if (dragRafRef.current) return;
      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = 0;
        const cx = pendingClientXRef.current;
        if (cx !== null) applyPointerAt(cx);
      });
    };

    const onUp = () => {
      if (dragRafRef.current) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = 0;
      }
      if (pendingClientXRef.current !== null) {
        applyPointerAt(pendingClientXRef.current);
        pendingClientXRef.current = null;
      }
      dragRectRef.current = null;
      setLocal((cur) => {
        const snappedStart = Math.max(
          0,
          Math.min(cur.end - 2, snapBoundaryToCueOrGap(cur.start, 'start', cues, audioEnv))
        );
        const snappedEnd = Math.min(
          hardMax,
          Math.max(snappedStart + 2, snapBoundaryToCueOrGap(cur.end, 'end', cues, audioEnv))
        );
        if (Math.abs(snappedStart - start) > 0.02 || Math.abs(snappedEnd - end) > 0.02) {
          onCommit(snappedStart, snappedEnd);
        }
        return { start: snappedStart, end: snappedEnd };
      });
      setDragging(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      if (dragRafRef.current) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = 0;
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, disabled, toTime, hardMax, cues, audioEnv, start, end, onCommit]);

  const leftPct = toFraction(local.start) * 100;
  const rightPct = (1 - toFraction(local.end)) * 100;
  const duration = Math.max(0, local.end - local.start);

  return (
    <div className="bg-[#0c1733] border border-[#1e3159] rounded-lg p-3 space-y-2 select-none">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="font-semibold text-[#dce6f7]">
          {t('trim.title')}
        </span>
        <span className="font-mono tabular-nums text-[#93a7cc]">
          {formatTimeDecimal(local.start)} → {formatTimeDecimal(local.end)}{' '}
          <strong className="text-[#c7ff55] ml-1.5">{duration.toFixed(1)}s</strong>
        </span>
      </div>

      <div
        ref={trackRef}
        className={`relative h-11 bg-[#070e20] border border-[#1e3159] rounded-md overflow-hidden ${
          disabled ? 'opacity-50 pointer-events-none' : ''
        }`}
      >
        <div className="absolute inset-0 flex items-end gap-[2px] px-1 pb-1 opacity-75">
          {bars.map((val, idx) => (
            <div
              key={idx}
              className="flex-1 bg-[#2a4173] rounded-t-[1px]"
              style={{ height: `${Math.round(val * 86)}%` }}
            />
          ))}
        </div>

        <div
          className="absolute inset-y-0 bg-[#ff6b00]/20 border-x border-[#ff6b00]"
          style={{ left: `${leftPct}%`, right: `${rightPct}%` }}
        />

        <button
          type="button"
          aria-label={t('trim.ariaStart')}
          onPointerDown={(e) => {
            e.preventDefault();
            setDragging('start');
          }}
          style={{ left: `${leftPct}%` }}
          className="absolute inset-y-0 w-3.5 -translate-x-1/2 cursor-ew-resize group z-10"
        >
          <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-[#ff6b00]" />
          <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-5 rounded-sm bg-[#ff6b00] group-hover:bg-[#ff8224]" />
        </button>

        <button
          type="button"
          aria-label={t('trim.ariaEnd')}
          onPointerDown={(e) => {
            e.preventDefault();
            setDragging('end');
          }}
          style={{ left: `${100 - rightPct}%` }}
          className="absolute inset-y-0 w-3.5 -translate-x-1/2 cursor-ew-resize group z-10"
        >
          <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-[#c7ff55]" />
          <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-5 rounded-sm bg-[#c7ff55] group-hover:bg-[#d8ff80]" />
        </button>
      </div>
    </div>
  );
}
