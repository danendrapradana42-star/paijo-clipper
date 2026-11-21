import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  probeVoiceStudioLocal,
  resolveVoiceStudioAsset,
  synthesizeWithVoiceStudio,
} from './voiceStudio';

const execFileAsync = promisify(execFile);

export type LocalVoiceProvider =
  | 'local_auto'
  | 'local_voicestudio'
  | 'local_tts'
  | 'local_cadence'
  | 'gemini';

export interface LocalTtsCapability {
  osSpeechAvailable: boolean;
  osEngineName: string;
  cadenceAvailable: boolean;
  voiceStudioAvailable: boolean;
  voiceStudioEndpoint: string;
  voiceStudioProfilesCount: number;
}

let cachedLinuxBin: string | null | undefined = undefined;

async function detectLinuxSpeechBin(): Promise<string | null> {
  if (cachedLinuxBin !== undefined) return cachedLinuxBin;
  for (const bin of ['espeak-ng', 'espeak']) {
    try {
      await execFileAsync(bin, ['--version'], { timeout: 1500 });
      cachedLinuxBin = bin;
      return bin;
    } catch {
      // try next
    }
  }
  cachedLinuxBin = null;
  return null;
}

export async function probeLocalTtsCapability(): Promise<LocalTtsCapability> {
  const voiceStudio = await probeVoiceStudioLocal();

  if (process.platform === 'win32') {
    return {
      osSpeechAvailable: true,
      osEngineName: 'Windows Built-in SAPI Voice',
      cadenceAvailable: true,
      voiceStudioAvailable: voiceStudio.available,
      voiceStudioEndpoint: voiceStudio.endpoint,
      voiceStudioProfilesCount: voiceStudio.profiles.length,
    };
  }
  if (process.platform === 'darwin') {
    return {
      osSpeechAvailable: true,
      osEngineName: 'macOS Built-in Voice',
      cadenceAvailable: true,
      voiceStudioAvailable: voiceStudio.available,
      voiceStudioEndpoint: voiceStudio.endpoint,
      voiceStudioProfilesCount: voiceStudio.profiles.length,
    };
  }
  const linuxBin = await detectLinuxSpeechBin();
  if (linuxBin) {
    return {
      osSpeechAvailable: true,
      osEngineName: `Offline ${linuxBin}`,
      cadenceAvailable: true,
      voiceStudioAvailable: voiceStudio.available,
      voiceStudioEndpoint: voiceStudio.endpoint,
      voiceStudioProfilesCount: voiceStudio.profiles.length,
    };
  }
  return {
    osSpeechAvailable: false,
    osEngineName: 'Built-in Cadence Audio (Offline)',
    cadenceAvailable: true,
    voiceStudioAvailable: voiceStudio.available,
    voiceStudioEndpoint: voiceStudio.endpoint,
    voiceStudioProfilesCount: voiceStudio.profiles.length,
  };
}

function sanitizeNarrationForSpeech(rawText: string): string {
  return String(rawText || '')
    .replace(/[*_`~#<>]/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function encodePcm16MonoWav(samples: Int16Array, sampleRate: number): Buffer {
  const dataBytes = samples.length * 2;
  const buf = Buffer.allocUnsafe(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(samples[i], 44 + i * 2);
  }
  return buf;
}

/**
 * Pure-Node offline audio fallback: synthesizes a soft, warm ambient narrative bed
 * with gentle syllable cadence pulses timed accurately to the scene's spoken reading length.
 */
export function generateLocalCadenceWav(text: string, voiceName = 'ricky'): {
  audioDataUrl: string;
  engineUsed: string;
} {
  const asset = resolveVoiceStudioAsset(voiceName);
  const words = Math.max(4, text.trim().split(/\s+/).filter(Boolean).length);
  const durationSec = Math.max(4.5, Math.min(35, words / 2.65));
  const sampleRate = 16000;
  const totalSamples = Math.floor(durationSec * sampleRate);
  const pcm = new Int16Array(totalSamples);

  const isFemale =
    asset?.gender === 'Female' ||
    new Set(['sikedewo', 'nichalia', 'Kore', 'Aoede', 'Leda']).has(voiceName);
  const baseFreq = isFemale ? 220 : 146.83;
  const fifthFreq = baseFreq * 1.5;

  const syllablePeriod = 0.24;
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const edgeIn = Math.min(1, t / 0.18);
    const edgeOut = Math.min(1, (durationSec - t) / 0.28);
    const wordBeat = 0.55 + 0.45 * Math.sin((2 * Math.PI * t) / syllablePeriod);
    const env = edgeIn * edgeOut * (0.28 + 0.35 * wordBeat);

    const tone =
      0.65 * Math.sin(2 * Math.PI * baseFreq * t) +
      0.25 * Math.sin(2 * Math.PI * fifthFreq * t) +
      0.1 * Math.sin(2 * Math.PI * baseFreq * 2 * t);

    const chimeEnv = t < 0.45 ? Math.exp(-t * 7) * 0.35 : 0;
    const chime = chimeEnv * Math.sin(2 * Math.PI * baseFreq * 3 * t);

    const sample = Math.max(-1, Math.min(1, tone * env * 0.14 + chime));
    pcm[i] = Math.round(sample * 32767);
  }

  const wav = encodePcm16MonoWav(pcm, sampleRate);
  return {
    audioDataUrl: `data:audio/wav;base64,${wav.toString('base64')}`,
    engineUsed: 'builtin-cadence-offline',
  };
}

async function synthesizeWindowsSapiWav(params: {
  text: string;
  voiceName: string;
  style: string;
  language?: string;
}): Promise<Buffer> {
  const tmpFile = path.join(os.tmpdir(), `paijo-sapi-${crypto.randomUUID()}.wav`);
  const asset = resolveVoiceStudioAsset(params.voiceName);
  const wantFemale =
    asset?.gender === 'Female' ||
    new Set(['sikedewo', 'nichalia', 'Kore', 'Aoede', 'Leda']).has(params.voiceName);
  const baseRateOffset = asset?.sapiRateOffset ?? 0;
  const styleRate = /energetic|fast/i.test(params.style)
    ? 1
    : /calm|warm|tender|soft/i.test(params.style)
      ? -1
      : 0;
  const rate = Math.max(-3, Math.min(3, baseRateOffset + styleRate));
  const langPrefix = String(params.language || (asset?.language.startsWith('en') ? 'en' : 'id'))
    .toLowerCase()
    .slice(0, 2);

  const cleanText = sanitizeNarrationForSpeech(params.text);
  const prosodyRate = rate > 0 ? '+8%' : rate < 0 ? '-6%' : '0%';
  const prosodyPitch = asset?.sapiPitch || '0%';
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${
    langPrefix === 'id' ? 'id-ID' : 'en-US'
  }"><prosody rate="${prosodyRate}" pitch="${prosodyPitch}">${escapeXml(cleanText)}</prosody></speak>`;

  const psScript = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `$wantGender = '${wantFemale ? 'Female' : 'Male'}'`,
    `$wantLang = '${langPrefix}*'`,
    '$voices = $s.GetInstalledVoices() | Where-Object { $_.Enabled }',
    '$pick = $voices | Where-Object { $_.VoiceInfo.Culture.Name -like $wantLang -and $_.VoiceInfo.Gender.ToString() -eq $wantGender } | Select-Object -First 1',
    'if (-not $pick) { $pick = $voices | Where-Object { $_.VoiceInfo.Culture.Name -like $wantLang } | Select-Object -First 1 }',
    'if (-not $pick) { $pick = $voices | Where-Object { $_.VoiceInfo.Gender.ToString() -eq $wantGender } | Select-Object -First 1 }',
    'if ($pick) { $s.SelectVoice($pick.VoiceInfo.Name) }',
    `$s.Rate = ${rate}`,
    '$s.SetOutputToWaveFile($env:PAIJO_TTS_OUT)',
    'try { $s.SpeakSsml($env:PAIJO_TTS_SSML) } catch { $s.Speak($env:PAIJO_TTS_TEXT) }',
    '$s.Dispose()',
  ].join('; ');

  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      {
        timeout: 25_000,
        env: {
          ...process.env,
          PAIJO_TTS_OUT: tmpFile,
          PAIJO_TTS_TEXT: cleanText,
          PAIJO_TTS_SSML: ssml,
        },
      }
    );
    const wavBuf = await fs.promises.readFile(tmpFile);
    if (wavBuf.length < 64) {
      throw new Error('Output SAPI kosong.');
    }
    return wavBuf;
  } finally {
    fs.promises.unlink(tmpFile).catch(() => {});
  }
}

async function synthesizeMacSayWav(text: string): Promise<Buffer> {
  const tmpFile = path.join(os.tmpdir(), `paijo-say-${crypto.randomUUID()}.wav`);
  try {
    await execFileAsync(
      'say',
      ['-o', tmpFile, '--data-format=LEI16@22050', sanitizeNarrationForSpeech(text)],
      { timeout: 25_000 }
    );
    return await fs.promises.readFile(tmpFile);
  } finally {
    fs.promises.unlink(tmpFile).catch(() => {});
  }
}

async function synthesizeLinuxEspeakWav(
  bin: string,
  text: string,
  voiceName: string,
  language?: string
): Promise<Buffer> {
  const tmpFile = path.join(os.tmpdir(), `paijo-espeak-${crypto.randomUUID()}.wav`);
  const asset = resolveVoiceStudioAsset(voiceName);
  const isFemale =
    asset?.gender === 'Female' ||
    new Set(['sikedewo', 'nichalia', 'Kore', 'Aoede', 'Leda']).has(voiceName);
  const lang = String(language || (asset?.language.startsWith('en') ? 'en' : 'id')).slice(0, 2);
  const voiceCode = `${lang === 'en' ? 'en' : 'id'}+${isFemale ? 'f3' : 'm3'}`;
  try {
    await execFileAsync(
      bin,
      ['-v', voiceCode, '-s', '150', '-w', tmpFile, sanitizeNarrationForSpeech(text)],
      { timeout: 25_000 }
    );
    return await fs.promises.readFile(tmpFile);
  } finally {
    fs.promises.unlink(tmpFile).catch(() => {});
  }
}

export async function synthesizeLocalSpeechWav(params: {
  text: string;
  voiceName: string;
  style: string;
  language?: string;
  provider?: LocalVoiceProvider;
}): Promise<{ audioDataUrl: string; engineUsed: string }> {
  const cleanText = sanitizeNarrationForSpeech(params.text);
  if (!cleanText) {
    throw new Error('Teks narasi kosong.');
  }

  if (params.provider === 'local_cadence') {
    return generateLocalCadenceWav(cleanText, params.voiceName);
  }

  if (params.provider === 'local_voicestudio') {
    return synthesizeWithVoiceStudio({
      text: cleanText,
      voiceName: params.voiceName,
      style: params.style,
      language: params.language,
    });
  }

  // In local_auto, prefer running VoiceStudio (127.0.0.1:3900) if active on the desktop machine
  if (params.provider === 'local_auto' || !params.provider) {
    try {
      const vsStatus = await probeVoiceStudioLocal();
      if (vsStatus.available) {
        return await synthesizeWithVoiceStudio({
          text: cleanText,
          voiceName: params.voiceName,
          style: params.style,
          language: params.language,
        });
      }
    } catch {
      // Fall through cleanly to Windows SAPI / OS Speech
    }
  }

  if (process.platform === 'win32') {
    try {
      const buf = await synthesizeWindowsSapiWav({
        text: cleanText,
        voiceName: params.voiceName,
        style: params.style,
        language: params.language,
      });
      return {
        audioDataUrl: `data:audio/wav;base64,${buf.toString('base64')}`,
        engineUsed: 'windows-sapi',
      };
    } catch {
      return generateLocalCadenceWav(cleanText, params.voiceName);
    }
  }

  if (process.platform === 'darwin') {
    try {
      const buf = await synthesizeMacSayWav(cleanText);
      return {
        audioDataUrl: `data:audio/wav;base64,${buf.toString('base64')}`,
        engineUsed: 'macos-say',
      };
    } catch {
      return generateLocalCadenceWav(cleanText, params.voiceName);
    }
  }

  const linuxBin = await detectLinuxSpeechBin();
  if (linuxBin) {
    try {
      const buf = await synthesizeLinuxEspeakWav(
        linuxBin,
        cleanText,
        params.voiceName,
        params.language
      );
      return {
        audioDataUrl: `data:audio/wav;base64,${buf.toString('base64')}`,
        engineUsed: linuxBin,
      };
    } catch {
      return generateLocalCadenceWav(cleanText, params.voiceName);
    }
  }

  return generateLocalCadenceWav(cleanText, params.voiceName);
}
