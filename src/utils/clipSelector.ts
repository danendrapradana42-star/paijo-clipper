import type { AudioEnvelopeData, ClipCandidate, SubtitleCue } from '../types/clipper';
import { findGap } from './audioAnalyzer';
import { formatClock } from './subtitles';

const STOPWORDS = new Set(
  'yang dan di ke dari ini itu untuk dengan pada adalah ada akan juga tidak bisa saya kita kamu anda dia mereka kami aku gue lu lo sih aja deh kan lah dong ya ga gak nggak enggak tapi atau karena jadi kalau kalo jika sudah udah belum masih lagi sangat banget lebih sebagai oleh dalam apa siapa kapan gimana bagaimana kenapa mengapa seperti sama para saat ketika sebuah suatu hal orang dulu nah oke terus lalu kemudian bahwa yaitu yakni tentang antara setelah sebelum sampai hingga harus mau punya sebenarnya memang begitu begini gitu gini the and of to is in it that'.split(
    ' '
  )
);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/(nya|kan|lah|kah)$/, ''))
    .map((w) => (w.length > 5 ? w.replace(/^(meng|meny|mem|men|ber|ter|per|pen|peng|pem)/, '') : w))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

interface SentenceUnit {
  start: number;
  end: number;
  text: string;
  terminal: boolean;
}

function buildSentences(cues: SubtitleCue[]): SentenceUnit[] {
  const out: SentenceUnit[] = [];
  let cur: SentenceUnit | null = null;
  const flush = () => {
    if (cur) {
      cur.text = cur.text.replace(/\s+/g, ' ').trim();
      if (cur.text) out.push(cur);
    }
    cur = null;
  };

  for (const c of cues) {
    const text = String(c.text || '').replace(/\s+/g, ' ').trim();
    if (!text || !(c.end > c.start)) continue;
    if (cur && c.start - cur.end > 1) flush();
    const parts = text.split(/(?<=[.!?…？]["')\]]*)\s+/);
    const dur = c.end - c.start;
    let offset = 0;
    for (const part of parts) {
      const ps = c.start + (dur * offset) / text.length;
      offset += part.length + 1;
      const pe = c.start + dur * Math.min(1, offset / text.length);
      const terminal = /[.!?…？]["')\]]*$/.test(part);
      if (!cur) cur = { start: ps, end: pe, text: part, terminal: false };
      else {
        cur.end = pe;
        cur.text += ' ' + part;
      }
      if (terminal) {
        cur.terminal = true;
        flush();
      }
    }
    if (cur && cur.end - cur.start > 14) flush();
  }
  flush();
  return out;
}

function computeBoundaries(S: SentenceUnit[], audioEnv: AudioEnvelopeData | null) {
  const n = S.length;
  const tok = S.map((x) => tokenize(x.text));
  const B = new Array<number>(n + 1).fill(0);
  const gaps = new Array<{ a: number; b: number } | null>(n + 1).fill(null);
  const dis = new Array<number | null>(n + 1).fill(null);
  const W = 5;

  for (let b = 0; b <= n; b++) {
    const prev = S[b - 1];
    const next = S[b];
    gaps[b] = findGap(audioEnv, prev ? prev.end : next.start - 0.5, next ? next.start : prev.end + 0.5);
  }

  for (let b = 1; b < n; b++) {
    const L = new Map<string, number>();
    const R = new Map<string, number>();
    let lc = 0;
    let rc = 0;
    for (let k = Math.max(0, b - W); k < b; k++) {
      for (const t of tok[k]) {
        L.set(t, (L.get(t) || 0) + 1);
        lc++;
      }
    }
    for (let k = b; k < Math.min(n, b + W); k++) {
      for (const t of tok[k]) {
        R.set(t, (R.get(t) || 0) + 1);
        rc++;
      }
    }
    if (lc < 4 || rc < 4) continue;
    let dot = 0;
    let nl = 0;
    let nr = 0;
    for (const [t, v] of L) {
      nl += v * v;
      const r = R.get(t);
      if (r) dot += v * r;
    }
    for (const v of R.values()) nr += v * v;
    dis[b] = 1 - dot / Math.sqrt(nl * nr);
  }

  const vals = dis.filter((v): v is number => v !== null).sort((x, y) => x - y);
  const rank = (v: number | null) => {
    if (v === null || !vals.length) return 0.35;
    let less = 0;
    let equal = 0;
    for (const x of vals) {
      if (x < v) less++;
      else if (x === v) equal++;
    }
    return (less + equal / 2) / vals.length;
  };

  const strong = /^(oke|ok|okay|baik|baiklah|selanjutnya|berikutnya|next|lanjut|topik|pertanyaan|ngomong-ngomong|omong-omong|balik ke)\b/i;
  const weak = /^(nah|jadi|terus|kemudian|lalu|sementara|sekarang)\b/i;

  for (let b = 1; b < n; b++) {
    const gapLen = gaps[b] ? gaps[b]!.b - gaps[b]!.a : Math.max(0, S[b].start - S[b - 1].end);
    const pause = Math.max(0, Math.min(1, (gapLen - 0.25) / 1));
    const lex = Math.max(0, Math.min(1, (rank(dis[b]) - 0.6) / 0.4));
    const head = S[b].text.replace(/^[^a-z0-9]+/i, '');
    const marker = strong.test(head) ? 0.5 : weak.test(head) ? 0.1 : 0;
    let v = 0.45 * pause + 0.4 * lex + marker;
    if (!S[b - 1].terminal) v *= 0.6;
    B[b] = Math.min(1.2, v);
  }
  B[0] = 1;
  B[n] = 1;
  return { B, gaps };
}

export function analyzeCues(
  cues: SubtitleCue[],
  options: {
    minDur: number;
    maxDur: number;
    limit: number;
    videoDuration: number;
    audioEnv: AudioEnvelopeData | null;
  }
): ClipCandidate[] {
  const { minDur, maxDur, limit, videoDuration, audioEnv } = options;
  const S = buildSentences(cues);
  const n = S.length;
  if (n < 2) return [];

  const SILENCE_LEAD_S = 0.12;
  const SILENCE_TAIL_S = 0.28;
  const SILENCE_MARGIN_S = 0.04;

  const { B, gaps } = computeBoundaries(S, audioEnv);
  const startAt = (i: number) => {
    const g = gaps[i];
    if (!g) return Math.max(0, S[i].start - SILENCE_LEAD_S);
    const earliest = Math.min(g.a + SILENCE_MARGIN_S, g.b);
    const preferred = g.b - SILENCE_LEAD_S;
    return Math.max(0, Math.max(earliest, Math.min(preferred, S[i].start)));
  };
  const endAt = (j: number) => {
    const g = gaps[j + 1];
    if (!g) return S[j].end + SILENCE_TAIL_S;
    const latest = Math.max(g.b - SILENCE_MARGIN_S, g.a);
    const preferred = g.a + SILENCE_TAIL_S;
    return Math.max(S[j].end, Math.min(preferred, latest));
  };
  const sp = new Array<number>(n + 1).fill(0);
  for (let b = 1; b <= n; b++) sp[b] = sp[b - 1] + (b < n && B[b] >= 0.65 ? 1 : 0);

  const vd = Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : Infinity;

  const collect = (minB: number, minKw = 2): ClipCandidate[] => {
    const out: ClipCandidate[] = [];
    for (let i = 0; i < n; i++) {
      if (B[i] < minB) continue;
      const st = startAt(i);
      for (let j = i; j < n; j++) {
        const en = endAt(j);
        const duration = en - st;
        if (duration > maxDur) break;
        if (duration < minDur || B[j + 1] < minB) continue;
        const text = S.slice(i, j + 1)
          .map((x) => x.text)
          .join(' ');
        const low = text.toLowerCase();
        const reasons: string[] = [];
        let kw = 0;
        if (/[?？]/.test(text) || /\b(kenapa|bagaimana|gimana|apa|siapa|kapan)\b/.test(low)) {
          kw += 2;
          reasons.push('Ada pertanyaan yang memberi hook.');
        }
        if (/\b(ternyata|tapi|tetapi|namun|padahal|justru|berbeda|sebaliknya)\b/.test(low)) {
          kw += 2;
          reasons.push('Ada kontras atau perubahan arah cerita.');
        }
        if (/\b(akhirnya|hasilnya|berhasil|gagal|terbukti|jadi|kesimpulannya)\b/.test(low)) {
          kw += 2;
          reasons.push('Memuat hasil atau payoff.');
        }
        if (/\b(cara|tips|langkah|rahasia|trik|solusi|tutorial|pertama|kedua)\b/.test(low)) {
          kw += 1.5;
          reasons.push('Memuat informasi praktis.');
        }
        if (/\b\d+\b/.test(low)) {
          kw += 0.75;
          reasons.push('Ada angka spesifik.');
        }
        if (kw < minKw) continue;
        const internal = sp[j] - sp[i];
        const edge = (Math.min(1, B[i]) + Math.min(1, B[j + 1])) / 2;
        const score = kw + 1.5 * edge - 1.5 * internal - (S[j].terminal || B[j + 1] >= 0.6 ? 0 : 1);
        if (internal === 0 && B[i] >= 0.45 && B[j + 1] >= 0.45) {
          reasons.push('Awal dan akhir jatuh di jeda alami.');
        }
        const first = S.slice(i, j + 1).find((x) => x.text.length > 18)?.text || S[i].text;
        const finalStart = Math.round(st * 100) / 100;
        const finalEnd = Math.round(Math.min(en, vd) * 100) / 100;
        out.push({
          id: `clip-${finalStart}-${finalEnd}-${out.length}`,
          start: finalStart,
          end: finalEnd,
          title: first.replace(/[.!?]+$/, '').slice(0, 76) + (first.length > 76 ? '…' : ''),
          reasons,
          quote: text.slice(0, 180) + (text.length > 180 ? '…' : ''),
          score,
          selected: true,
        });
      }
    }
    return out;
  };

  const midpoint = (minDur + maxDur) / 2;
  const target = Math.min(20, Math.max(limit, Math.ceil((limit * 75) / Math.max(10, midpoint))));

  const strong = collect(0.25, 2).sort((x, y) => y.score - x.score);
  const expanded = collect(0.12, 0.75);
  for (const c of expanded) {
    const duplicate = strong.some((x) => Math.abs(x.start - c.start) < 1 && Math.abs(x.end - c.end) < 1);
    if (!duplicate) {
      c.score -= 1.35;
      c.reasons.push('Kandidat tambahan dengan kalimat utuh.');
    }
  }
  expanded.sort((x, y) => y.score - x.score);

  const picked: ClipCandidate[] = [];
  const addFrom = (pool: ClipCandidate[]) => {
    for (const c of pool) {
      if (picked.length >= target) break;
      if (picked.every((p) => c.end <= p.start || c.start >= p.end)) picked.push(c);
    }
  };
  addFrom(strong);
  if (picked.length < target) addFrom(expanded);
  if (picked.length < target) {
    const broad = collect(0.04, 0);
    for (const c of broad) {
      const duplicate = strong.concat(expanded).some((x) => Math.abs(x.start - c.start) < 1 && Math.abs(x.end - c.end) < 1);
      if (!duplicate) {
        c.score -= 3;
        c.reasons.push('Kandidat tambahan pada batas kalimat selesai.');
      }
    }
    broad.sort((x, y) => y.score - x.score);
    addFrom(broad);
  }

  return picked
    .sort((x, y) => x.start - y.start)
    .map((c, idx) => ({ ...c, id: `clip-${idx + 1}-${Math.round(c.start * 10)}` }));
}

export function buildAudioEnvelopeClips(
  duration: number,
  options: {
    minDur: number;
    maxDur: number;
    limit: number;
    audioEnv: AudioEnvelopeData | null;
  }
): ClipCandidate[] {
  if (!Number.isFinite(duration) || duration <= 0.2) return [];
  const minD = Math.max(8, options.minDur);
  const maxD = Math.max(minD + 5, options.maxDur);
  const targetD = (minD + maxD) / 2;
  const limit = Math.max(1, Math.min(20, options.limit || 10));

  if (duration <= minD) {
    return [
      {
        id: 'clip-1',
        start: 0,
        end: Math.round(duration * 100) / 100,
        title: `Klip 1 · Bagian Utama (${formatClock(duration)})`,
        reasons: ['Durasi video berada dalam rentang target klip; video utuh disiapkan dalam 9:16.'],
        quote: '',
        score: 1,
        selected: true,
      },
    ];
  }

  const rawCuts: ClipCandidate[] = [];
  let cursor = 0;
  let idx = 1;
  while (cursor < duration - 6 && rawCuts.length < 40) {
    const remaining = duration - cursor;
    let end = Math.min(duration, cursor + targetD);
    let usedGap = false;
    if (remaining > maxD) {
      const searchStart = cursor + minD;
      const searchEnd = Math.min(duration - 3, cursor + maxD);
      const gap = findGap(options.audioEnv, searchStart, searchEnd);
      if (gap && gap.b > searchStart && gap.a < searchEnd) {
        end = (gap.a + gap.b) / 2;
        usedGap = true;
      }
    } else {
      end = duration;
    }

    if (duration - end < Math.min(14, minD * 0.45) && end - cursor + (duration - end) <= maxD + 12) {
      end = duration;
    }

    let activity = 0;
    if (options.audioEnv && options.audioEnv.n) {
      const e = options.audioEnv;
      const i0 = Math.max(0, Math.floor(cursor / e.hop));
      const i1 = Math.min(e.n - 1, Math.ceil(end / e.hop));
      let activeBins = 0;
      for (let k = i0; k <= i1; k++) if (e.rms[k] >= e.thr) activeBins++;
      activity = activeBins / Math.max(1, i1 - i0 + 1);
    }

    const st = Math.round(cursor * 100) / 100;
    const en = Math.round(end * 100) / 100;
    rawCuts.push({
      id: `clip-${idx}`,
      start: st,
      end: en,
      title: `Klip ${idx} · Segmen ${formatClock(st)}–${formatClock(en)}`,
      reasons: [
        (usedGap ? 'Pemotongan tepat di jeda hening/napas audio.' : 'Pemotongan otomatis sesuai durasi target.') +
          (options.audioEnv ? ` Kepadatan suara ±${Math.round(activity * 100)}%.` : ''),
      ],
      quote: '',
      score: usedGap ? 1 + activity : activity,
      selected: true,
    });
    idx++;
    cursor = end;
  }

  if (rawCuts.length <= limit) return rawCuts;
  const picked = [...rawCuts]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .sort((a, b) => a.start - b.start);
  return picked.map((c, i) => ({
    ...c,
    id: `clip-${i + 1}`,
    title: `Klip ${i + 1} · Segmen ${formatClock(c.start)}–${formatClock(c.end)}`,
  }));
}

/**
 * Snaps a dragged clip boundary to the nearest subtitle cue edge (within 0.45s)
 * or nearest natural audio silence gap so manual trims never cut mid-word.
 */
export function snapBoundaryToCueOrGap(
  time: number,
  edge: 'start' | 'end',
  cues: SubtitleCue[],
  audioEnv: AudioEnvelopeData | null
): number {
  let best = time;
  let bestDist = 0.45;

  for (const cue of cues) {
    const candidate = edge === 'start' ? Math.max(0, cue.start - 0.08) : cue.end + 0.15;
    const dist = Math.abs(candidate - time);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }

  if (bestDist === 0.45 && audioEnv) {
    const gap = findGap(audioEnv, Math.max(0, time - 0.4), time + 0.4);
    if (gap) {
      const candidate = edge === 'start' ? Math.max(gap.a + 0.04, gap.b - 0.12) : Math.min(gap.b - 0.04, gap.a + 0.28);
      if (Math.abs(candidate - time) < 0.45) {
        best = candidate;
      }
    }
  }

  return Math.round(Math.max(0, best) * 100) / 100;
}
