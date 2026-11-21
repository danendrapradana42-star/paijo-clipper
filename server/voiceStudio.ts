import fs from 'node:fs';
import path from 'node:path';

export interface VoiceStudioAssetProfile {
  id:
    | 'ricky'
    | 'sikedewo'
    | 'todd'
    | 'nichalia'
    | 'bima'
    | 'sari'
    | 'dimas'
    | 'maya'
    | 'arjun'
    | 'nadia';
  sampleAlias: string;
  displayName: string;
  label: string;
  filename: string;
  publicUrl: string;
  language: 'id-ID' | 'en-US';
  gender: 'Male' | 'Female';
  baseVoice: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr' | 'Aoede' | 'Orus' | 'Leda';
  personaStyle: string;
  sapiRateOffset: number;
  sapiPitch: string;
}

export const VOICE_STUDIO_ASSETS: VoiceStudioAssetProfile[] = [
  {
    id: 'ricky',
    sampleAlias: 'ricky-indonesian',
    displayName: 'Ricky',
    label: 'Ricky · Soft & Authentic (Indonesian)',
    filename: 'voice_preview_ricky_-_soft___authentic_indonesian_e1eddf78.mp3',
    publicUrl: '/assets/aistudio/voice_preview_ricky_-_soft___authentic_indonesian_e1eddf78.mp3',
    language: 'id-ID',
    gender: 'Male',
    baseVoice: 'Zephyr',
    personaStyle:
      'Soft, gentle, warm, authentic Indonesian male narrator with calm storytelling cadence, unhurried phrasing, and clear conversational warmth',
    sapiRateOffset: -1,
    sapiPitch: '-2%',
  },
  {
    id: 'sikedewo',
    sampleAlias: 'sikedewo-indonesian',
    displayName: 'Sikedewo',
    label: 'Sikedewo · Tender, Calm & Clear (Indonesian)',
    filename: 'voice_preview_sikedewo_-_tender__calm_and_clear_67f5636e.mp3',
    publicUrl: '/assets/aistudio/voice_preview_sikedewo_-_tender__calm_and_clear_67f5636e.mp3',
    language: 'id-ID',
    gender: 'Female',
    baseVoice: 'Kore',
    personaStyle:
      'Tender, calm, serene, crystal-clear Indonesian female storyteller with gentle emotional resonance, poised pacing, and soothing narration',
    sapiRateOffset: -1,
    sapiPitch: '+2%',
  },
  {
    id: 'todd',
    sampleAlias: 'todd-english',
    displayName: 'Todd',
    label: 'Todd · Clear, Engaging & Educational',
    filename: 'voice_preview_todd_-_clear__engaging_and_educational_1be6d861.mp3',
    publicUrl: '/assets/aistudio/voice_preview_todd_-_clear__engaging_and_educational_1be6d861.mp3',
    language: 'en-US',
    gender: 'Male',
    baseVoice: 'Puck',
    personaStyle:
      'Clear, engaging, articulate, educational male host with upbeat curiosity, crisp pronunciation, and friendly explainer delivery',
    sapiRateOffset: 0,
    sapiPitch: '0%',
  },
  {
    id: 'nichalia',
    sampleAlias: 'nichalia-schwartz',
    displayName: 'Nichalia Schwartz',
    label: 'Nichalia Schwartz · Bright & Friendly',
    filename: 'voice_preview_nichalia_schwartz_-_bright_and_friendly_0cd738b6.mp3',
    publicUrl: '/assets/aistudio/voice_preview_nichalia_schwartz_-_bright_and_friendly_0cd738b6.mp3',
    language: 'en-US',
    gender: 'Female',
    baseVoice: 'Kore',
    personaStyle:
      'Smart, confident, bright, friendly young adult female narrator with warm enthusiasm, crisp modern delivery, and inviting energy',
    sapiRateOffset: 0,
    sapiPitch: '+4%',
  },
  {
    id: 'bima',
    sampleAlias: 'bima-dokumenter',
    displayName: 'Bima',
    label: 'Bima · Dokumenter Tegas (Indonesian)',
    filename: 'voice_preview_bima_dokumenter.mp3',
    publicUrl: '/assets/aistudio/voice_preview_bima_dokumenter.mp3',
    language: 'id-ID',
    gender: 'Male',
    baseVoice: 'Charon',
    personaStyle:
      'Deep, resonant, authoritative Indonesian male documentary narrator with measured gravity, crisp articulation, and cinematic command',
    sapiRateOffset: -1,
    sapiPitch: '-6%',
  },
  {
    id: 'sari',
    sampleAlias: 'sari-ceria',
    displayName: 'Sari',
    label: 'Sari · Ceria & Persuasif (Indonesian)',
    filename: 'voice_preview_sari_ceria.mp3',
    publicUrl: '/assets/aistudio/voice_preview_sari_ceria.mp3',
    language: 'id-ID',
    gender: 'Female',
    baseVoice: 'Aoede',
    personaStyle:
      'Bright, upbeat, friendly, persuasive Indonesian female creator host with smiling tone, natural rhythm, and lively energy',
    sapiRateOffset: 1,
    sapiPitch: '+5%',
  },
  {
    id: 'dimas',
    sampleAlias: 'dimas-berita',
    displayName: 'Dimas',
    label: 'Dimas · Berita & Hook Cepat (Indonesian)',
    filename: 'voice_preview_dimas_berita.mp3',
    publicUrl: '/assets/aistudio/voice_preview_dimas_berita.mp3',
    language: 'id-ID',
    gender: 'Male',
    baseVoice: 'Fenrir',
    personaStyle:
      'Sharp, assertive, punchy Indonesian male short-form news presenter with brisk pacing, strong hook emphasis, and confident clarity',
    sapiRateOffset: 1,
    sapiPitch: '-2%',
  },
  {
    id: 'maya',
    sampleAlias: 'maya-sinematik',
    displayName: 'Maya',
    label: 'Maya · Cerita & Sinematik (Indonesian)',
    filename: 'voice_preview_maya_sinematik.mp3',
    publicUrl: '/assets/aistudio/voice_preview_maya_sinematik.mp3',
    language: 'id-ID',
    gender: 'Female',
    baseVoice: 'Leda',
    personaStyle:
      'Expressive, emotive, cinematic Indonesian female storyteller with dramatic pauses, warm intonation, and compelling narrative depth',
    sapiRateOffset: -1,
    sapiPitch: '+1%',
  },
  {
    id: 'arjun',
    sampleAlias: 'arjun-podcast',
    displayName: 'Arjun',
    label: 'Arjun · Santai & Podcast (Indonesian)',
    filename: 'voice_preview_arjun_podcast.mp3',
    publicUrl: '/assets/aistudio/voice_preview_arjun_podcast.mp3',
    language: 'id-ID',
    gender: 'Male',
    baseVoice: 'Orus',
    personaStyle:
      'Relaxed, conversational, relatable Indonesian male podcast speaker with natural pauses, approachable warmth, and modern casual delivery',
    sapiRateOffset: 0,
    sapiPitch: '0%',
  },
  {
    id: 'nadia',
    sampleAlias: 'nadia-edukasi',
    displayName: 'Nadia',
    label: 'Nadia · Edukasi & Jernih (Indonesian)',
    filename: 'voice_preview_nadia_edukasi.mp3',
    publicUrl: '/assets/aistudio/voice_preview_nadia_edukasi.mp3',
    language: 'id-ID',
    gender: 'Female',
    baseVoice: 'Zephyr',
    personaStyle:
      'Crisp, clear, structured Indonesian female explainer narrator with helpful academic clarity, calm confidence, and steady tempo',
    sapiRateOffset: 0,
    sapiPitch: '+3%',
  },
];

export function resolveVoiceStudioAsset(idOrAlias: string): VoiceStudioAssetProfile | null {
  const key = String(idOrAlias || '').trim().toLowerCase();
  if (!key) return null;
  return (
    VOICE_STUDIO_ASSETS.find(
      (item) =>
        item.id.toLowerCase() === key ||
        item.sampleAlias.toLowerCase() === key ||
        item.displayName.toLowerCase() === key
    ) || null
  );
}

export function resolveVoiceStudioAssetFilePath(idOrAlias: string): string | null {
  const asset = resolveVoiceStudioAsset(idOrAlias);
  if (!asset) return null;
  const roots = [process.env.PAIJO_APP_ROOT || '', process.cwd()].filter(Boolean);
  for (const root of roots) {
    const candidates = [
      path.join(root, 'public', 'assets', 'aistudio', asset.filename),
      path.join(root, 'dist', 'assets', 'aistudio', asset.filename),
    ];
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // try next candidate
      }
    }
  }
  return null;
}

/**
 * Ensures audio bytes returned from TTS models are directly playable in browser <audio> and AudioContext.
 * If Gemini returns headerless L16 PCM (24kHz mono 16-bit LE), prepends a standard 44-byte RIFF WAV header.
 */
export function ensurePlayableAudioDataUrl(base64Audio: string, mimeType = 'audio/wav'): string {
  const cleanMime = String(mimeType || 'audio/wav').toLowerCase();
  const buf = Buffer.from(base64Audio, 'base64');

  const isRiffWav =
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WAVE';

  if (isRiffWav) {
    return `data:audio/wav;base64,${buf.toString('base64')}`;
  }

  if (/mp3|mpeg|ogg|webm|aac|mp4|flac/.test(cleanMime)) {
    return `data:${cleanMime};base64,${buf.toString('base64')}`;
  }

  // Wrap raw L16 PCM (Gemini default 24kHz mono 16-bit little-endian) into RIFF WAV
  const rateMatch = /rate=(\d+)/i.exec(cleanMime);
  const sampleRate = rateMatch ? Math.max(8000, Math.min(48000, Number(rateMatch[1]))) : 24000;
  const header = Buffer.allocUnsafe(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + buf.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // Mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(buf.length, 40);

  const wav = Buffer.concat([header, buf]);
  return `data:audio/wav;base64,${wav.toString('base64')}`;
}

export interface VoiceStudioProfileEntry {
  id: string;
  name: string;
  language?: string;
}

export interface VoiceStudioStatusResult {
  available: boolean;
  endpoint: string;
  profiles: VoiceStudioProfileEntry[];
}

function getVoiceStudioBaseUrl(): string {
  return (process.env.VOICE_STUDIO_URL || 'http://127.0.0.1:3900').replace(/\/+$/, '');
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeProfilesPayload(payload: unknown): VoiceStudioProfileEntry[] {
  const listRaw = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>).profiles ||
        (payload as Record<string, unknown>).voices ||
        (payload as Record<string, unknown>).data ||
        []
      : [];

  if (!Array.isArray(listRaw)) return [];
  const out: VoiceStudioProfileEntry[] = [];
  for (const item of listRaw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const id = String(rec.id || rec.voice_id || rec.profile_id || rec.name || '').trim();
    const name = String(rec.name || rec.display_name || rec.label || id).trim();
    const language = rec.language ? String(rec.language) : undefined;
    if (id) {
      out.push({ id, name, language });
    }
  }
  return out;
}

export async function probeVoiceStudioLocal(): Promise<VoiceStudioStatusResult> {
  const endpoint = getVoiceStudioBaseUrl();
  const statusPaths = ['/health', '/api/health', '/profiles', '/voices', '/api/profiles', '/api/voices'];

  const results = await Promise.all(
    statusPaths.map(async (p) => {
      try {
        const res = await fetchWithTimeout(`${endpoint}${p}`, { method: 'GET' }, 750);
        if (!res.ok) return null;
        if (p.includes('profile') || p.includes('voice')) {
          const json = await res.json().catch(() => null);
          return { reachable: true, profiles: normalizeProfilesPayload(json) };
        }
        return { reachable: true, profiles: null as VoiceStudioProfileEntry[] | null };
      } catch {
        return null;
      }
    })
  );

  const hitWithProfiles = results.find((r) => r && r.profiles !== null);
  if (hitWithProfiles) {
    return { available: true, endpoint, profiles: hitWithProfiles.profiles || [] };
  }

  const anyReachable = results.some((r) => r?.reachable);
  if (!anyReachable) {
    return { available: false, endpoint, profiles: [] };
  }

  const profiles = await fetchVoiceStudioProfiles();
  return { available: true, endpoint, profiles };
}

export async function fetchVoiceStudioProfiles(): Promise<VoiceStudioProfileEntry[]> {
  const endpoint = getVoiceStudioBaseUrl();
  for (const p of ['/profiles', '/api/profiles', '/voices', '/api/voices']) {
    try {
      const res = await fetchWithTimeout(`${endpoint}${p}`, { method: 'GET' }, 1500);
      if (!res.ok) continue;
      const json = await res.json().catch(() => null);
      const profiles = normalizeProfilesPayload(json);
      if (profiles.length > 0 || Array.isArray(json)) {
        return profiles;
      }
    } catch {
      // try next
    }
  }
  return [];
}

export async function importAssetToVoiceStudio(sampleId: string): Promise<{
  id: string;
  name: string;
}> {
  const asset = resolveVoiceStudioAsset(sampleId);
  if (!asset) {
    throw new Error('Sampel Voice Studio tidak ditemukan.');
  }
  const filePath = resolveVoiceStudioAssetFilePath(asset.id);
  if (!filePath) {
    throw new Error(`File MP3 sampel "${asset.filename}" tidak tersedia di paket aplikasi.`);
  }

  const endpoint = getVoiceStudioBaseUrl();
  const mp3Bytes = await fs.promises.readFile(filePath);
  const uploadEndpoints = [
    '/profiles',
    '/api/profiles',
    '/voices',
    '/api/voices',
    '/import-sample',
    '/api/import-sample',
  ];

  let lastError = 'VoiceStudio lokal (127.0.0.1:3900) belum merespons permintaan impor.';
  for (const p of uploadEndpoints) {
    try {
      const form = new FormData();
      const blob = new Blob([mp3Bytes], { type: 'audio/mpeg' });
      form.append('file', blob, asset.filename);
      form.append('audio', blob, asset.filename);
      form.append('sample', blob, asset.filename);
      form.append('name', asset.displayName);
      form.append('language', asset.language.startsWith('id') ? 'id' : 'en');
      form.append('sampleId', asset.id);

      const res = await fetchWithTimeout(
        `${endpoint}${p}`,
        {
          method: 'POST',
          body: form,
        },
        15_000
      );
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        lastError = `HTTP ${res.status}${errText ? `: ${errText.slice(0, 120)}` : ''}`;
        continue;
      }
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return {
        id: String(data.id || data.profile_id || data.voice_id || asset.id),
        name: String(data.name || asset.displayName),
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(lastError);
}

export async function synthesizeWithVoiceStudio(params: {
  text: string;
  voiceName: string;
  style?: string;
  language?: string;
}): Promise<{ audioDataUrl: string; engineUsed: string }> {
  const endpoint = getVoiceStudioBaseUrl();
  const status = await probeVoiceStudioLocal();
  if (!status.available) {
    throw new Error('VoiceStudio lokal (127.0.0.1:3900) belum aktif.');
  }

  const asset = resolveVoiceStudioAsset(params.voiceName);
  let targetProfileId = params.voiceName;
  if (status.profiles.length > 0) {
    const exactMatch = status.profiles.find(
      (p) =>
        p.id.toLowerCase() === params.voiceName.toLowerCase() ||
        p.name.toLowerCase() === params.voiceName.toLowerCase() ||
        (asset &&
          (p.name.toLowerCase().includes(asset.displayName.toLowerCase()) ||
            p.id.toLowerCase().includes(asset.id)))
    );
    targetProfileId = exactMatch ? exactMatch.id : status.profiles[0].id;
  } else if (asset) {
    targetProfileId = asset.displayName;
  }

  const langCode = String(
    params.language || (asset?.language.startsWith('id') ? 'id' : 'en')
  ).toLowerCase();

  const candidatePaths = ['/generate', '/api/generate', '/tts', '/api/tts', '/synthesize', '/speak'];
  let lastErr = 'VoiceStudio gagal menghasilkan audio.';

  for (const p of candidatePaths) {
    try {
      const res = await fetchWithTimeout(
        `${endpoint}${p}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: params.text,
            profile_id: targetProfileId,
            voice_id: targetProfileId,
            voice: targetProfileId,
            style: params.style || asset?.personaStyle || '',
            language: langCode,
          }),
        },
        35_000
      );

      if (!res.ok) {
        lastErr = `VoiceStudio HTTP ${res.status}`;
        continue;
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('audio/') || contentType.includes('application/octet-stream')) {
        const arr = Buffer.from(await res.arrayBuffer());
        if (arr.length < 64) {
          lastErr = 'Audio dari VoiceStudio kosong.';
          continue;
        }
        return {
          audioDataUrl: ensurePlayableAudioDataUrl(
            arr.toString('base64'),
            contentType.includes('mpeg') || contentType.includes('mp3') ? 'audio/mpeg' : 'audio/wav'
          ),
          engineUsed: `voice-studio:${targetProfileId}`,
        };
      }

      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (json) {
        if (typeof json.audioDataUrl === 'string' && json.audioDataUrl.startsWith('data:audio/')) {
          return { audioDataUrl: json.audioDataUrl, engineUsed: `voice-studio:${targetProfileId}` };
        }
        const b64 = String(json.audioBase64 || json.audio || json.data || '').trim();
        if (b64) {
          return {
            audioDataUrl: ensurePlayableAudioDataUrl(
              b64,
              String(json.mimeType || 'audio/wav')
            ),
            engineUsed: `voice-studio:${targetProfileId}`,
          };
        }
        if (typeof json.audioUrl === 'string' && json.audioUrl) {
          const audioUrl = json.audioUrl.startsWith('http')
            ? json.audioUrl
            : `${endpoint}${json.audioUrl.startsWith('/') ? '' : '/'}${json.audioUrl}`;
          const audioRes = await fetchWithTimeout(audioUrl, { method: 'GET' }, 15_000);
          if (audioRes.ok) {
            const arr = Buffer.from(await audioRes.arrayBuffer());
            const ct = audioRes.headers.get('content-type') || 'audio/wav';
            return {
              audioDataUrl: ensurePlayableAudioDataUrl(arr.toString('base64'), ct),
              engineUsed: `voice-studio:${targetProfileId}`,
            };
          }
        }
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(lastErr);
}
