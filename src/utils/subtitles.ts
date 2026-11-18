import type { AudioEnvelopeData, SubtitleCue } from '../types/clipper';

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatTimeDecimal(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0';
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

export function parseTime(raw: string): number | null {
  const m = raw
    .trim()
    .replace(',', '.')
    .match(/(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?/);
  if (!m) return null;
  const hours = Number(m[1] || 0);
  const mins = Number(m[2]);
  const secs = Number(m[3]);
  const ms = Number((m[4] || '0').padEnd(3, '0'));
  return hours * 3600 + mins * 60 + secs + ms / 1000;
}

export function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const frac = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(frac).padStart(3, '0')}`;
}

export function parseSubs(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.split('\n');
    const ti = lines.findIndex((x) => x.includes('-->'));
    if (ti < 0) continue;
    const times = lines[ti].split('-->');
    if (times.length < 2) continue;
    const start = parseTime(times[0]);
    const end = parseTime(times[1].trim().split(/\s+/)[0]);
    const caption = lines
      .slice(ti + 1)
      .join(' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (start !== null && end !== null && end > start && caption) {
      cues.push({ start, end, text: caption });
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function cleanCueText(text: string): string {
  let t = String(text || '');
  t = t
    .replace(/\[[^\]]*\]|\([^)]*\)|[♪♫]+/g, ' ')
    .replace(/^[\s>\-–—]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/\s+([,.;:!?…])/g, '$1').replace(/([,;:!?])(?=\p{L})/gu, '$1 ');
  t = t.replace(/(?<![\p{L}\p{N}])(\p{L}{2,})(?:\s+\1(?![\p{L}\p{N}]))+/giu, '$1');
  t = t.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = t.charAt(0).toUpperCase() + t.slice(1);
  t = t.replace(/([.!?…]\s+)(\p{Ll})/gu, (_m, p: string, c: string) => p + c.toUpperCase());
  return t;
}

export function cleanCues(cues: SubtitleCue[]): SubtitleCue[] {
  const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const out: SubtitleCue[] = [];
  for (const c of cues) {
    const text = cleanCueText(c.text);
    if (text) out.push({ start: c.start, end: c.end, text });
  }
  const res: SubtitleCue[] = [];
  for (let i = 0; i < out.length; ) {
    let j = i;
    const key = norm(out[i].text);
    while (j + 1 < out.length && norm(out[j + 1].text) === key) j++;
    if (j - i >= 2) res.push(out[i]);
    else for (let k = i; k <= j; k++) res.push(out[k]);
    i = j + 1;
  }
  for (let i = 0; i < res.length - 1; i++) {
    if (res[i].end > res[i + 1].start) {
      res[i].end = Math.max(res[i].start + 0.2, res[i + 1].start);
    }
  }
  return res;
}

export function retimeCues(cues: SubtitleCue[], audioEnv: AudioEnvelopeData | null): SubtitleCue[] {
  if (!audioEnv || !audioEnv.n) return cues;
  const e = audioEnv;
  const act = (t: number) => {
    const i = Math.floor(t / e.hop);
    return i >= 0 && i < e.n && e.rms[i] >= e.thr;
  };
  let prevEnd = 0;
  for (const c of cues) {
    let st = c.start;
    let en = c.end;
    if (!act(st - 0.3)) {
      for (let t = st - 0.3; t <= st + 0.6; t += e.hop) {
        if (act(t)) {
          st = Math.max(prevEnd, t - 0.05);
          break;
        }
      }
    }
    if (!act(en + 0.3)) {
      for (let t = en + 0.3; t >= en - 0.6; t -= e.hop) {
        if (act(t)) {
          en = t + 0.15;
          break;
        }
      }
    }
    if (en - st >= 0.25) {
      c.start = st;
      c.end = en;
    }
    prevEnd = c.end;
  }
  for (let i = 0; i < cues.length - 1; i++) {
    if (cues[i].end > cues[i + 1].start) {
      cues[i].end = Math.max(cues[i].start + 0.2, cues[i + 1].start);
    }
  }
  return cues;
}

export function cueProgress(cue: SubtitleCue, t: number, audioEnv: AudioEnvelopeData | null): number {
  const dur = Math.max(0.05, cue.end - cue.start);
  const lin = Math.max(0, Math.min(0.999999, (t - cue.start) / dur));
  if (!audioEnv || !audioEnv.n) return lin;

  const i0 = Math.max(0, Math.floor(cue.start / audioEnv.hop));
  const i1 = Math.min(audioEnv.n - 1, Math.ceil(cue.end / audioEnv.hop));
  if (i1 <= i0) return lin;

  let activeTotal = 0;
  let activeUpToT = 0;
  const curIdx = Math.max(i0, Math.min(i1, Math.floor(t / audioEnv.hop)));
  for (let i = i0; i <= i1; i++) {
    const active = audioEnv.rms[i] >= audioEnv.thr ? 1 : 0;
    activeTotal += active;
    if (i <= curIdx) activeUpToT += active;
  }
  if (activeTotal < 3) return lin;
  return Math.max(0, Math.min(0.999999, activeUpToT / activeTotal));
}

const CAPTION_NO_END = new Set([
  'yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'dengan', 'pada', 'atau', 'karena',
  'bahwa', 'dalam', 'sebagai', 'oleh', 'kalau', 'jika', 'tapi', 'tetapi', 'agar',
  'supaya', 'seperti', 'the', 'a', 'of', 'to', 'in',
]);

export function chunkWords(words: string[]): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [];
  for (let k = 0; k < words.length; k++) {
    cur.push(words[k]);
    const last = k === words.length - 1;
    const hard = /[.!?…？！]$/.test(words[k]);
    const soft = /[,;:]$/.test(words[k]) && cur.length >= 2;
    const closes = hard || soft;
    if (cur.length >= 3 || closes || last) {
      if (
        !last &&
        !closes &&
        cur.length > 1 &&
        CAPTION_NO_END.has(words[k].toLowerCase().replace(/[^\p{L}]/gu, ''))
      ) {
        const carry = cur.pop()!;
        chunks.push(cur);
        cur = [carry];
        continue;
      }
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur);
  const n = chunks.length;
  if (n >= 2 && chunks[n - 1].length === 1 && chunks[n - 2].length >= 3) {
    const prev = chunks[n - 2];
    const tail = prev[prev.length - 2].toLowerCase().replace(/[^\p{L}]/gu, '');
    chunks[n - 1].unshift(prev.pop()!);
    if (CAPTION_NO_END.has(tail) && prev.length > 1) {
      chunks[n - 1].unshift(prev.pop()!);
    }
  }
  return chunks;
}

export function cuesToSrt(cues: SubtitleCue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}`)
    .join('\n\n');
}

export function cuesToPreviewText(cues: SubtitleCue[]): string {
  return cues.map((c) => `[${srtTime(c.start)} → ${srtTime(c.end)}] ${c.text}`).join('\n');
}

export function parseEditedTranscript(text: string): { cues: SubtitleCue[]; bad: number } {
  const cues: SubtitleCue[] = [];
  let bad = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(
      /^\[\s*(\d+:\d{2}:\d{2}[.,]\d{1,3})\s*(?:→|->|-->)\s*(\d+:\d{2}:\d{2}[.,]\d{1,3})\s*\]\s*(.*)$/
    );
    if (!m) {
      bad++;
      continue;
    }
    const st = parseTime(m[1]);
    const en = parseTime(m[2]);
    const t = m[3].replace(/\s+/g, ' ').trim();
    if (st === null || en === null || !(en > st)) {
      bad++;
      continue;
    }
    if (t) cues.push({ start: st, end: en, text: t });
  }
  return { cues: cues.sort((x, y) => x.start - y.start), bad };
}

export function buildSrtFromScenes(
  scenes: Array<{ captionText?: string; narration?: string; durationSec: number }>,
  durations?: number[]
): string {
  let cursor = 0;
  const blocks: string[] = [];
  scenes.forEach((sc, idx) => {
    const dur = Math.max(1, Number(durations?.[idx] ?? sc.durationSec) || 5);
    const start = cursor;
    const end = cursor + dur;
    cursor = end;
    const text = String(sc.captionText || sc.narration || '').trim();
    if (text) {
      blocks.push(`${blocks.length + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${text}`);
    }
  });
  return blocks.join('\n\n');
}
