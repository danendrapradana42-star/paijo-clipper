import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const execFileAsync = promisify(execFile);

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY belum dikonfigurasi pada server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = /429|503|RESOURCE_EXHAUSTED|UNAVAILABLE|timeout/i.test(msg);
      if (!isTransient || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

function extractYoutubeId(raw: string): string {
  try {
    const u = new URL(String(raw || '').trim());
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') return (u.pathname.split('/').filter(Boolean)[0] || '').slice(0, 20);
    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      const v = u.searchParams.get('v');
      if (v) return v.slice(0, 20);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') {
        return (parts[1] || '').slice(0, 20);
      }
    }
  } catch {
    return '';
  }
  return '';
}

let ytDlpAvailableCache: boolean | null = null;
async function hasYtDlp(): Promise<boolean> {
  if (ytDlpAvailableCache !== null) return ytDlpAvailableCache;
  if (process.env.VERCEL) {
    ytDlpAvailableCache = false;
    return false;
  }
  try {
    await execFileAsync('yt-dlp', ['--version'], { timeout: 3000 });
    ytDlpAvailableCache = true;
  } catch {
    ytDlpAvailableCache = false;
  }
  return ytDlpAvailableCache;
}

const ytDownloadDir = '/tmp/autoclipper-yt';
const ytFiles = new Map<string, { path: string; filename: string; createdAt: number }>();

function cleanupExpiredYtFiles() {
  const now = Date.now();
  for (const [id, entry] of ytFiles.entries()) {
    if (now - entry.createdAt > 30 * 60 * 1000) {
      fs.promises.unlink(entry.path).catch(() => {});
      ytFiles.delete(id);
    }
  }
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export function createApiApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '32mb' }));

  const serverStartedAt = new Date().toISOString();

  function readAppPackageVersion(): string {
    try {
      const pkgPath = path.resolve(process.cwd(), 'package.json');
      const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
      return String(parsed.version || '1.5.0');
    } catch {
      return '1.5.0';
    }
  }

  function compareSemver(a: string, b: string): number {
    const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
      const da = pa[i] || 0;
      const db = pb[i] || 0;
      if (da > db) return 1;
      if (da < db) return -1;
    }
    return 0;
  }

  app.get('/api/health', async (_req, res) => {
    const ytDlpReady = await hasYtDlp();
    const aiConfigured = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');
    res.json({
      ok: true,
      ytDlpReady,
      aiConfigured,
      version: readAppPackageVersion(),
      runtime: process.env.VERCEL ? 'vercel-serverless' : 'node-server',
    });
  });

  app.get('/api/app/version', async (_req, res) => {
    const ytDlpReady = await hasYtDlp();
    const aiConfigured = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');
    res.json({
      name: 'Auto Clipper Studio',
      version: readAppPackageVersion(),
      nodeVersion: process.version,
      serverStartedAt,
      checkedAt: new Date().toISOString(),
      ytDlpReady,
      aiConfigured,
      runtime: process.env.VERCEL ? 'vercel-serverless' : 'node-server',
    });
  });

  app.post('/api/app/check-update', async (req, res) => {
    const currentVersion = readAppPackageVersion();
    const clientVersion = String(req.body?.clientVersion || currentVersion).trim();
    const githubRepo = String(req.body?.githubRepo || '').trim();

    if (githubRepo) {
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepo)) {
        res.status(400).json({ error: 'Format repositori GitHub harus "pemilik/nama-repo".' });
        return;
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 7000);
        const ghRes = await fetch(`https://api.github.com/repos/${githubRepo}/releases/latest`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AutoClipper-Studio' },
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (ghRes.ok) {
          const data = (await ghRes.json()) as {
            tag_name?: string;
            name?: string;
            body?: string;
            html_url?: string;
            published_at?: string;
          };
          const latestVersion = String(data.tag_name || data.name || currentVersion).replace(/^v/i, '');
          const updateAvailable = compareSemver(latestVersion, clientVersion) > 0;
          res.json({
            source: 'github',
            repo: githubRepo,
            clientVersion,
            serverVersion: currentVersion,
            latestVersion,
            updateAvailable,
            releaseName: data.name || `v${latestVersion}`,
            releaseNotes: String(data.body || '').slice(0, 1200),
            releaseUrl: data.html_url || `https://github.com/${githubRepo}/releases`,
            publishedAt: data.published_at || null,
            checkedAt: new Date().toISOString(),
          });
          return;
        }

        if (ghRes.status === 404) {
          res.status(404).json({
            error: `Rilis resmi tidak ditemukan pada repositori "${githubRepo}".`,
          });
          return;
        }
        res.status(502).json({ error: `GitHub API merespons status ${ghRes.status}.` });
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(502).json({ error: `Gagal menghubungi GitHub Releases: ${msg}` });
        return;
      }
    }

    const serverAhead = compareSemver(currentVersion, clientVersion) > 0;
    res.json({
      source: 'server',
      clientVersion,
      serverVersion: currentVersion,
      latestVersion: currentVersion,
      updateAvailable: serverAhead,
      releaseName: `Auto Clipper Studio v${currentVersion}`,
      releaseNotes: '',
      releaseUrl: null,
      publishedAt: serverStartedAt,
      checkedAt: new Date().toISOString(),
    });
  });

  app.post('/api/youtube/info', async (req, res) => {
    const url = String(req.body?.url || '').trim();
    const id = extractYoutubeId(url);
    if (!id) {
      res.status(400).json({ error: 'Link YouTube tidak valid. Gunakan link youtube.com atau youtu.be.' });
      return;
    }
    const canonical = `https://www.youtube.com/watch?v=${id}`;
    const thumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    const ytDlpReady = await hasYtDlp();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`,
        { signal: controller.signal }
      );
      clearTimeout(timer);
      if (oembedRes.ok) {
        const data = (await oembedRes.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
        res.json({
          id,
          title: data.title || `Video YouTube (${id})`,
          channel: data.author_name || 'YouTube',
          thumbnail: data.thumbnail_url || thumb,
          duration: 0,
          canDownloadDirect: ytDlpReady,
        });
        return;
      }
    } catch {
      // Fallback to basic metadata
    }

    res.json({
      id,
      title: `Video YouTube (${id})`,
      channel: 'YouTube',
      thumbnail: thumb,
      duration: 0,
      canDownloadDirect: ytDlpReady,
    });
  });

  app.post('/api/youtube/import', async (req, res) => {
    cleanupExpiredYtFiles();
    const url = String(req.body?.url || '').trim();
    const id = extractYoutubeId(url);
    if (!id) {
      res.status(400).json({ error: 'Link YouTube tidak valid.' });
      return;
    }

    const ytDlpReady = await hasYtDlp();
    if (!ytDlpReady) {
      res.status(422).json({
        error:
          'Unduhan stream YouTube langsung belum tersedia di server web ini (yt-dlp tidak terpasang). Unggah file video (.mp4 / .webm / .mov) langsung dari perangkat Anda untuk pemrosesan instan tanpa batas.',
      });
      return;
    }

    try {
      await fs.promises.mkdir(ytDownloadDir, { recursive: true });
      const fileId = `${id}-${Date.now()}`;
      const outTemplate = path.join(ytDownloadDir, `${fileId}.%(ext)s`);
      const quality = String(req.body?.quality || '720');
      const maxHeight = quality === '1080' ? '1080' : quality === '360' ? '360' : '720';
      await execFileAsync(
        'yt-dlp',
        [
          '-f',
          `bestvideo[height<=${maxHeight}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${maxHeight}][ext=mp4]/best`,
          '--merge-output-format',
          'mp4',
          '-o',
          outTemplate,
          `https://www.youtube.com/watch?v=${id}`,
        ],
        { timeout: 120000 }
      );
      const files = await fs.promises.readdir(ytDownloadDir);
      const matched = files.find((f) => f.startsWith(fileId));
      if (!matched) throw new Error('File hasil unduhan tidak ditemukan.');
      const fullPath = path.join(ytDownloadDir, matched);
      const stat = await fs.promises.stat(fullPath);
      ytFiles.set(fileId, { path: fullPath, filename: matched, createdAt: Date.now() });
      res.json({
        fileUrl: `/api/youtube/file/${fileId}`,
        filename: matched,
        sizeBytes: stat.size,
        title: `YouTube ${id}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Gagal mengunduh dari YouTube: ${msg}` });
    }
  });

  app.get('/api/youtube/file/:fileId', (req, res) => {
    const entry = ytFiles.get(req.params.fileId);
    if (!entry || !fs.existsSync(entry.path)) {
      res.status(404).json({ error: 'File sementara sudah kedaluwarsa atau tidak ditemukan.' });
      return;
    }
    res.sendFile(entry.path);
  });

  // Opt-in AI Audio Transcription (server-side Gemini 3.5 Transcribe)
  app.post('/api/transcribe', async (req, res) => {
    try {
      const { audioBase64, mimeType, language, durationSec, consentConfirmed } = req.body ?? {};
      if (!consentConfirmed) {
        res.status(400).json({ error: 'Persetujuan pengguna diperlukan sebelum mengirim audio ke layanan transkripsi.' });
        return;
      }
      if (!audioBase64 || typeof audioBase64 !== 'string') {
        res.status(400).json({ error: 'Data audio tidak ditemukan.' });
        return;
      }

      const ai = getAiClient();
      const langHint = language === 'en' ? 'English' : language === 'auto' ? 'the spoken language' : 'Indonesian (Bahasa Indonesia)';
      const durInfo = Number(durationSec) > 0 ? `The audio duration is approximately ${Number(durationSec).toFixed(1)} seconds.` : '';

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-3.5-transcribe',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: String(mimeType || 'audio/wav'),
                  data: audioBase64,
                },
              },
              {
                text: `Transcribe the spoken dialogue accurately in ${langHint}. ${durInfo} Return a JSON array of subtitle cues with start (seconds), end (seconds), and text (short natural sentence or phrase of 4-12 words). Ensure timestamps are monotonic, non-overlapping, and stay within the audio duration.`,
              },
            ],
          },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  start: { type: Type.NUMBER, description: 'Start timestamp in seconds' },
                  end: { type: Type.NUMBER, description: 'End timestamp in seconds' },
                  text: { type: Type.STRING, description: 'Transcribed spoken text' },
                },
                required: ['start', 'end', 'text'],
              },
            },
          },
        })
      );

      const rawText = (response.text ?? '[]').trim();
      const cleanedJson = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

      let parsed: Array<{ start: number; end: number; text: string }> = [];
      try {
        const direct = JSON.parse(cleanedJson);
        if (Array.isArray(direct)) parsed = direct;
      } catch {
        const objMatches = cleanedJson.match(/\{[^{}]*"start"\s*:\s*[\d.]+[^{}]*"end"\s*:\s*[\d.]+[^{}]*"text"\s*:\s*"(?:[^"\\]|\\.)*"[^{}]*\}/g);
        if (objMatches) {
          for (const item of objMatches) {
            try {
              parsed.push(JSON.parse(item));
            } catch {
              // skip malformed partial object
            }
          }
        }
      }

      const cues = (Array.isArray(parsed) ? parsed : [])
        .map((c) => ({
          start: Math.max(0, Number(c.start) || 0),
          end: Math.max(0.2, Number(c.end) || 0),
          text: String(c.text || '').trim(),
        }))
        .filter((c) => c.text && c.end > c.start)
        .sort((a, b) => a.start - b.start);

      res.json({ cues });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Transkripsi AI gagal: ${msg}` });
    }
  });

  // AI Video Text Generation Agent (Gemini 4 Hydrogen — Min. 5–10 Minutes)
  app.post('/api/ai-video/text', async (req, res) => {
    try {
      const {
        prompt,
        sceneCount = 15,
        targetDurationMin = 5,
        language = 'id',
        visualTheme = 'cinematic',
        videoType = 'general',
      } = req.body ?? {};
      const cleanPrompt = String(prompt || '').trim();
      if (!cleanPrompt) {
        res.status(400).json({ error: 'Masukkan topik atau deskripsi video terlebih dahulu.' });
        return;
      }

      const safeMinutes = Math.max(5, Math.min(10, Number(targetDurationMin) || 5));
      const targetTotalSec = Math.round(safeMinutes * 60);
      const targetScenes = Math.max(15, Math.min(30, Number(sceneCount) || Math.round(safeMinutes * 3)));
      const perSceneTarget = Math.max(18, Math.round(targetTotalSec / targetScenes));
      const langLabel = language === 'en' ? 'English' : 'Indonesian (Bahasa Indonesia)';
      const ai = getAiClient();

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Create a vertical 9:16 long-form explainer/storytelling video script about: "${cleanPrompt}".
Language for title, summary, visualTitle, and narration: ${langLabel}.
Style/type: ${videoType}, visual mood: ${visualTheme}.
Minimum total duration: ${safeMinutes} minutes (${targetTotalSec} seconds).
Generate exactly ${targetScenes} sequential scenes structured clearly from Hook -> Context -> Deep Dive Sections -> Real Examples -> Conclusion & Call-to-Action.
Each scene must be around ${perSceneTarget} seconds long (18-26 seconds), with rich, non-repetitive spoken narration (~45-62 words per scene), a concise visualTitle (3-6 words), and a detailed visual scene description in imagePrompt.`,
          config: {
            systemInstruction:
              'You are an experienced documentary and vertical-video director and scriptwriter. Write substantive, engaging, non-repetitive scenes that meet the exact target duration (minimum 5 minutes). Output strictly valid JSON matching the requested schema.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: 'Catchy video title' },
                summary: { type: Type.STRING, description: 'One-sentence video summary' },
                scenes: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      visualTitle: { type: Type.STRING, description: 'Short 3-6 word headline shown on the scene' },
                      narration: { type: Type.STRING, description: 'Spoken narration script (~45-62 words for ~20s)' },
                      imagePrompt: { type: Type.STRING, description: 'Visual background description for 9:16 frame' },
                      durationSec: { type: Type.NUMBER, description: 'Scene duration in seconds (18-28)' },
                    },
                    required: ['visualTitle', 'narration', 'imagePrompt', 'durationSec'],
                  },
                },
              },
              required: ['title', 'summary', 'scenes'],
            },
          },
        })
      );

      const cleanedRaw = (response.text ?? '{}')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      const raw = JSON.parse(cleanedRaw) as {
        title?: string;
        summary?: string;
        scenes?: Array<{ visualTitle: string; narration: string; imagePrompt: string; durationSec: number }>;
      };

      const rawScenes = Array.isArray(raw.scenes) ? raw.scenes : [];
      if (!rawScenes.length) {
        throw new Error('Model tidak menghasilkan daftar adegan.');
      }

      const baseDurations = rawScenes.map((sc) =>
        Math.max(15, Math.min(34, Number(sc.durationSec) || perSceneTarget))
      );
      const rawSum = baseDurations.reduce((a, b) => a + b, 0);
      const requiredMinSec = Math.max(300, targetTotalSec);
      const scale = rawSum < requiredMinSec ? requiredMinSec / Math.max(1, rawSum) : 1;

      let cursor = 0;
      const scenes = rawScenes.map((sc, idx) => {
        const dur = Math.round(baseDurations[idx] * scale * 10) / 10;
        const startSec = cursor;
        const endSec = cursor + dur;
        cursor = endSec;
        return {
          index: idx,
          visualTitle: String(sc.visualTitle || `Adegan ${idx + 1}`).trim(),
          narration: String(sc.narration || '').trim(),
          captionText: String(sc.narration || '').trim(),
          imagePrompt: String(sc.imagePrompt || sc.visualTitle || '').trim(),
          durationSec: dur,
          timestampLabel: `${formatClock(startSec)} – ${formatClock(endSec)}`,
        };
      });

      res.json({
        title: raw.title || cleanPrompt,
        summary: raw.summary || '',
        totalDurationSec: cursor,
        scenes,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Pembuatan naskah AI gagal: ${msg}` });
    }
  });

  // AI Video Voice Agent (Gemini 3.8 Flash TTS Voice Design + Flash Lite TTS -> WAV)
  const CUSTOM_VOICE_PROFILES: Record<
    string,
    { label: string; baseVoice: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr'; personaStyle: string }
  > = {
    ricky: {
      label: 'Ricky',
      baseVoice: 'Zephyr',
      personaStyle:
        'Soft, gentle, warm, authentic Indonesian male narrator with calm coastal storytelling cadence, unhurried phrasing, and intimate conversational clarity',
    },
    sikedewo: {
      label: 'Sikedewo',
      baseVoice: 'Kore',
      personaStyle:
        'Tender, calm, serene, and crystal-clear Indonesian female storyteller with gentle emotional resonance, poised pacing, and soothing narration',
    },
    todd: {
      label: 'Todd',
      baseVoice: 'Puck',
      personaStyle:
        'Clear, engaging, articulate, and educational male host with upbeat curiosity, crisp articulation, and friendly explainer delivery',
    },
    nichalia: {
      label: 'Nichalia Schwartz',
      baseVoice: 'Kore',
      personaStyle:
        'Smart, confident, bright, and friendly young adult female narrator with warm enthusiasm, crisp modern delivery, and inviting energy',
    },
  };

  app.post('/api/ai-video/voice', async (req, res) => {
    try {
      const { text, voiceName = 'ricky', style = 'Clear, engaging short-form video narrator' } = req.body ?? {};
      const cleanText = String(text || '').trim();
      if (!cleanText) {
        res.status(400).json({ error: 'Teks narasi kosong.' });
        return;
      }

      const requestedVoice = String(voiceName || 'ricky');
      const customProfile = CUSTOM_VOICE_PROFILES[requestedVoice];
      const allowedStandardVoices = new Set(['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']);
      const baseVoice = customProfile
        ? customProfile.baseVoice
        : allowedStandardVoices.has(requestedVoice)
          ? requestedVoice
          : 'Kore';

      const requestedStyle = String(style || 'Clear, engaging short-form video narrator').trim();
      const combinedStyle = customProfile
        ? `${customProfile.personaStyle}. Direction: ${requestedStyle}`
        : requestedStyle;

      const ai = getAiClient();

      const callTtsModel = (model: 'gemini-3.8-flash-tts' | 'gemini-3.8-flash-lite-tts') =>
        withRetry(() =>
          ai.models.generateContent({
            model,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: cleanText,
                    speechMetadata: {
                      style: combinedStyle,
                    },
                  },
                ],
              },
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: baseVoice },
                },
              },
            },
          })
        );

      let response;
      if (customProfile) {
        try {
          response = await callTtsModel('gemini-3.8-flash-tts');
        } catch {
          response = await callTtsModel('gemini-3.8-flash-lite-tts');
        }
      } else {
        response = await callTtsModel('gemini-3.8-flash-lite-tts');
      }

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        throw new Error('Model TTS tidak mengembalikan data audio.');
      }

      res.json({
        audioDataUrl: `data:audio/wav;base64,${base64Audio}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Pembuatan suara narasi gagal: ${msg}` });
    }
  });

  // AI Highlight & Viral Hook Detector (adapted from autoclip highlight_v1 rubric)
  app.post('/api/clips/highlights', async (req, res) => {
    try {
      const { cues, minDur = 30, maxDur = 90, limit = 8 } = req.body ?? {};
      if (!Array.isArray(cues) || cues.length < 3) {
        res.status(400).json({ error: 'Minimal diperlukan 3 baris subtitle untuk deteksi momen viral AI.' });
        return;
      }

      const safeCues = cues
        .slice(0, 450)
        .map((c: { start?: unknown; end?: unknown; text?: unknown }, idx: number) => ({
          idx,
          start: Math.max(0, Number(c.start) || 0),
          end: Math.max(0.1, Number(c.end) || 0),
          text: String(c.text || '').replace(/\s+/g, ' ').trim(),
        }))
        .filter((c) => c.text && c.end > c.start);

      const indexedTranscript = safeCues
        .map((c) => `[${c.idx} | ${formatClock(c.start)}-${formatClock(c.end)}] ${c.text}`)
        .join('\n');

      const ai = getAiClient();
      const response = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `You are a short-form video editor finding standalone viral moments for TikTok, Instagram Reels, and YouTube Shorts.
Judge every candidate on:
1. Hook strength (first 3 seconds must spark curiosity, contrast, question, or tension — never start with filler words like "so", "um", "nah jadi").
2. Self-containment (fully understandable without prior video context).
3. Payoff (lands on a real insight, reversal, story climax, or actionable takeaway).
4. Quotability.

Target duration per clip: between ${Number(minDur)} and ${Number(maxDur)} seconds. Return up to ${Math.min(15, Number(limit) || 8)} highest-scoring non-overlapping clips (score 0-100, skip anything below 55).
Write "title" and "reason" in the same language as the transcript (usually Indonesian). "hook" must quote the verbatim opening words from startCueIndex.

Indexed Transcript:
${indexedTranscript}`,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                clips: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      startCueIndex: { type: Type.INTEGER },
                      endCueIndex: { type: Type.INTEGER },
                      title: { type: Type.STRING },
                      hook: { type: Type.STRING },
                      score: { type: Type.NUMBER },
                      reason: { type: Type.STRING },
                    },
                    required: ['startCueIndex', 'endCueIndex', 'title', 'hook', 'score', 'reason'],
                  },
                },
              },
              required: ['clips'],
            },
          },
        })
      );

      const rawText = (response.text ?? '{}').trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      const parsed = JSON.parse(rawText) as {
        clips?: Array<{
          startCueIndex: number;
          endCueIndex: number;
          title: string;
          hook: string;
          score: number;
          reason: string;
        }>;
      };

      const validClips = (Array.isArray(parsed.clips) ? parsed.clips : [])
        .map((c) => ({
          startCueIndex: Math.max(0, Math.min(safeCues.length - 1, Math.round(Number(c.startCueIndex) || 0))),
          endCueIndex: Math.max(0, Math.min(safeCues.length - 1, Math.round(Number(c.endCueIndex) || 0))),
          title: String(c.title || '').trim().slice(0, 80),
          hook: String(c.hook || '').trim().slice(0, 140),
          score: Math.max(0, Math.min(100, Math.round(Number(c.score) || 70))),
          reason: String(c.reason || '').trim().slice(0, 240),
        }))
        .filter((c) => c.endCueIndex >= c.startCueIndex && c.title);

      res.json({ clips: validClips });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Deteksi momen viral AI gagal: ${msg}` });
    }
  });

  return app;
}
