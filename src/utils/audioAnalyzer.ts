import type { AudioEnvelopeData } from '../types/clipper';

export function buildEnvelope(samples: Float32Array, sampleRate = 16000): AudioEnvelopeData {
  const hop = Math.max(1, Math.round(sampleRate * 0.02)); // 20ms hop
  const n = Math.floor(samples.length / hop);
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const o = i * hop;
    for (let k = 0; k < hop; k++) {
      const v = samples[o + k];
      sum += v * v;
    }
    rms[i] = Math.sqrt(sum / hop);
  }
  const sorted = Float32Array.from(rms).sort();
  const p = (q: number) => sorted[Math.min(Math.max(0, n - 1), Math.floor(n * q))];
  const noise = n ? p(0.1) : 0;
  const peak = n ? p(0.9) : 0;

  // Downsample to ~160 visual bars for crisp waveform timeline display
  const barCount = 160;
  const peaks: number[] = [];
  if (n > 0) {
    const step = Math.max(1, Math.floor(n / barCount));
    const normMax = Math.max(0.01, peak * 1.15);
    for (let b = 0; b < barCount; b++) {
      const i0 = Math.floor((b / barCount) * n);
      const i1 = Math.min(n, i0 + step);
      let maxV = 0;
      for (let k = i0; k < i1; k++) {
        if (rms[k] > maxV) maxV = rms[k];
      }
      peaks.push(Math.max(0.06, Math.min(1, maxV / normMax)));
    }
  }

  return {
    hop: hop / sampleRate,
    rms,
    n,
    thr: noise + (peak - noise) * 0.12,
    peaks,
  };
}

export function silentRuns(
  audioEnv: AudioEnvelopeData | null,
  from: number,
  to: number,
  minLen: number
): Array<{ a: number; b: number }> {
  if (!audioEnv || !audioEnv.n) return [];
  const e = audioEnv;
  const i0 = Math.max(0, Math.floor(from / e.hop));
  const i1 = Math.min(e.n - 1, Math.ceil(to / e.hop));
  const runs: Array<{ a: number; b: number }> = [];
  let a = -1;
  for (let i = i0; i <= i1; i++) {
    const quiet = e.rms[i] < e.thr;
    if (quiet && a < 0) a = i;
    if (a >= 0 && (!quiet || i === i1)) {
      const b = quiet ? i + 1 : i;
      if ((b - a) * e.hop >= minLen) {
        runs.push({ a: a * e.hop, b: b * e.hop });
      }
      a = -1;
    }
  }
  return runs;
}

export function findGap(
  audioEnv: AudioEnvelopeData | null,
  from: number,
  to: number
): { a: number; b: number } | null {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const mid = (lo + hi) / 2;
  for (const minLen of [0.25, 0.12]) {
    let best: { a: number; b: number } | null = null;
    let bestScore = -1e9;
    for (const r of silentRuns(audioEnv, lo - 0.7, hi + 0.7, minLen)) {
      const len = r.b - r.a;
      const dist = mid < r.a ? r.a - mid : mid > r.b ? mid - r.b : 0;
      const score = len - 0.5 * dist;
      if (score > bestScore) {
        best = r;
        bestScore = score;
      }
    }
    if (best) return best;
  }
  return null;
}

export async function decodeVideoAudioEnvelope(
  file: File,
  maxBytes = 420 * 1024 * 1024
): Promise<AudioEnvelopeData | null> {
  if (!file || file.size > maxBytes) return null;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  const ctx = new AudioCtx();
  try {
    const buffer = await file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(buffer);
    const channel = decoded.getChannelData(0);
    if (!channel || !channel.length) return null;
    return buildEnvelope(channel, decoded.sampleRate);
  } catch {
    return null;
  } finally {
    ctx.close().catch(() => {});
  }
}

function encodeMonoWav16(samples: Float32Array, sampleRate: number): Uint8Array {
  const byteLength = 44 + samples.length * 2;
  const buf = new ArrayBuffer(byteLength);
  const view = new DataView(buf);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buf);
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function extractWavBase64ForTranscription(
  file: File,
  signal?: AbortSignal
): Promise<{ base64: string; mimeType: string; durationSec: number }> {
  if (signal?.aborted) {
    throw new DOMException('Pembuatan subtitle dibatalkan.', 'AbortError');
  }
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const OfflineCtx = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!AudioCtx || !OfflineCtx) {
    throw new Error('Browser tidak mendukung pemrosesan audio OfflineAudioContext.');
  }

  const ctx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    const raw = await file.arrayBuffer();
    if (signal?.aborted) {
      throw new DOMException('Pembuatan subtitle dibatalkan.', 'AbortError');
    }
    decoded = await ctx.decodeAudioData(raw);
  } finally {
    ctx.close().catch(() => {});
  }

  if (signal?.aborted) {
    throw new DOMException('Pembuatan subtitle dibatalkan.', 'AbortError');
  }

  // Use 8kHz mono for longer videos (up to ~18 minutes inside 18MB WAV) or 16kHz for <= 9 min
  const targetRate = decoded.duration > 520 ? 8000 : 16000;
  if (decoded.duration > 1100) {
    throw new Error('Durasi audio melebihi batas 18 menit untuk transkripsi AI sekali jalan. Gunakan file .srt/.vtt lokal.');
  }

  const offline = new OfflineCtx(1, Math.max(1, Math.ceil(decoded.duration * targetRate)), targetRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  if (signal?.aborted) {
    throw new DOMException('Pembuatan subtitle dibatalkan.', 'AbortError');
  }
  const wavBytes = encodeMonoWav16(rendered.getChannelData(0), targetRate);
  if (wavBytes.byteLength > 19 * 1024 * 1024) {
    throw new Error('Ukuran audio terlalu besar (>19 MB) untuk diunggah. Gunakan file .srt/.vtt lokal.');
  }

  return {
    base64: uint8ToBase64(wavBytes),
    mimeType: 'audio/wav',
    durationSec: decoded.duration,
  };
}
