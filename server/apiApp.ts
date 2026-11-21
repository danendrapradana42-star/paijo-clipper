import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
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

let ytDlpCommandCache: string | null | undefined = undefined;
async function resolveYtDlpCommand(): Promise<string | null> {
  if (ytDlpCommandCache !== undefined) return ytDlpCommandCache;
  if (process.env.VERCEL) {
    ytDlpCommandCache = null;
    return null;
  }

  const localCandidates = [
    process.env.PAIJO_EXE_DIR ? path.join(process.env.PAIJO_EXE_DIR, 'yt-dlp.exe') : '',
    process.env.PAIJO_USER_DATA ? path.join(process.env.PAIJO_USER_DATA, 'yt-dlp.exe') : '',
    process.env.PAIJO_APP_ROOT ? path.join(process.env.PAIJO_APP_ROOT, 'yt-dlp.exe') : '',
    path.resolve(process.cwd(), 'yt-dlp.exe'),
  ].filter(Boolean);

  for (const candidate of localCandidates) {
    try {
      if (fs.existsSync(candidate)) {
        await execFileAsync(candidate, ['--version'], { timeout: 3000 });
        ytDlpCommandCache = candidate;
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }

  for (const bin of process.platform === 'win32' ? ['yt-dlp.exe', 'yt-dlp'] : ['yt-dlp']) {
    try {
      await execFileAsync(bin, ['--version'], { timeout: 3000 });
      ytDlpCommandCache = bin;
      return bin;
    } catch {
      // not in PATH
    }
  }

  ytDlpCommandCache = null;
  return null;
}

async function hasYtDlp(): Promise<boolean> {
  return (await resolveYtDlpCommand()) !== null;
}

const ytDownloadDir = path.join(os.tmpdir(), 'paijoclip-yt');
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

const LANGUAGE_NAME_MAP: Record<string, string> = {
  id: 'Indonesian (Bahasa Indonesia)',
  en: 'English',
  es: 'Spanish (Español)',
  pt: 'Portuguese (Português)',
  fr: 'French (Français)',
  de: 'German (Deutsch)',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
  zh: 'Simplified Chinese (简体中文)',
  ar: 'Arabic (العربية)',
  hi: 'Hindi (हिन्दी)',
};

export function createApiApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '32mb' }));

  const serverStartedAt = new Date().toISOString();

  function readAppPackageVersion(): string {
    const candidates = [
      process.env.PAIJO_APP_ROOT ? path.join(process.env.PAIJO_APP_ROOT, 'package.json') : '',
      path.resolve(process.cwd(), 'package.json'),
    ].filter(Boolean);
    for (const pkgPath of candidates) {
      try {
        if (fs.existsSync(pkgPath)) {
          const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
          if (parsed.version) return String(parsed.version);
        }
      } catch {
        // try next candidate
      }
    }
    return '1.5.0';
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
      name: 'Paijo Clip',
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
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PaijoClip-Studio' },
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
      releaseName: `Paijo Clip v${currentVersion}`,
      releaseNotes: '',
      releaseUrl: null,
      publishedAt: serverStartedAt,
      checkedAt: new Date().toISOString(),
    });
  });

  interface DesktopArtifactEntry {
    id: 'setup-exe' | 'portable-exe';
    kind: 'installer' | 'portable';
    source: 'local' | 'github';
    version: string;
    filename: string;
    sizeBytes: number;
    downloadUrl: string;
    fullPath?: string;
    updatedAtMs: number;
  }

  function resolveDesktopGithubRepo(overrideRepo?: string): string {
    const candidates = [
      overrideRepo || '',
      process.env.DESKTOP_GITHUB_REPO || '',
      process.env.VITE_DESKTOP_GITHUB_REPO || '',
      process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
        ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
        : '',
    ];
    for (const raw of candidates) {
      const clean = String(raw || '').trim();
      if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(clean)) {
        return clean;
      }
    }
    return '';
  }

  function scanLocalDesktopArtifacts(): DesktopArtifactEntry[] {
    const appVersion = readAppPackageVersion();
    const rootCandidates = [
      process.env.PAIJO_APP_ROOT || '',
      process.cwd(),
    ].filter(Boolean);
    const searchDirs = new Set<string>();
    for (const root of rootCandidates) {
      searchDirs.add(path.resolve(root, 'release'));
      searchDirs.add(path.resolve(root, 'public', 'downloads'));
    }

    const found: DesktopArtifactEntry[] = [];
    const seenNames = new Set<string>();

    for (const dir of searchDirs) {
      try {
        if (!fs.existsSync(dir)) continue;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          if (!/\.exe$/i.test(entry.name)) continue;
          if (/uninstaller/i.test(entry.name)) continue;
          if (seenNames.has(entry.name.toLowerCase())) continue;

          const fullPath = path.join(dir, entry.name);
          const stat = fs.statSync(fullPath);
          if (!stat.isFile() || stat.size < 20 * 1024 * 1024) continue;

          seenNames.add(entry.name.toLowerCase());
          const isPortable = /portable/i.test(entry.name);
          const kind: 'installer' | 'portable' = isPortable ? 'portable' : 'installer';
          const id: 'setup-exe' | 'portable-exe' = isPortable ? 'portable-exe' : 'setup-exe';
          found.push({
            id,
            kind,
            source: 'local',
            version: appVersion,
            filename: entry.name,
            sizeBytes: stat.size,
            downloadUrl: `/api/desktop/download/${id}`,
            fullPath,
            updatedAtMs: Math.round(stat.mtimeMs),
          });
        }
      } catch {
        // ignore unreadable directories
      }
    }

    return found.sort((a, b) => (a.kind === 'installer' ? -1 : 1) - (b.kind === 'installer' ? -1 : 1));
  }

  const githubReleaseCache = new Map<
    string,
    { expiresAt: number; version: string; artifacts: DesktopArtifactEntry[] }
  >();

  async function fetchGithubDesktopArtifacts(repo: string): Promise<{
    version: string;
    artifacts: DesktopArtifactEntry[];
  }> {
    if (!repo) return { version: readAppPackageVersion(), artifacts: [] };
    const cached = githubReleaseCache.get(repo);
    if (cached && cached.expiresAt > Date.now()) {
      return { version: cached.version, artifacts: cached.artifacts };
    }

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'PaijoClip-Studio',
    };
    const ghToken = process.env.GITHUB_TOKEN || process.env.DESKTOP_GITHUB_TOKEN || '';
    if (ghToken) {
      headers.Authorization = `Bearer ${ghToken}`;
    }

    const extractExeFromRelease = (rel: {
      tag_name?: string;
      name?: string;
      published_at?: string;
      draft?: boolean;
      assets?: Array<{
        name?: string;
        size?: number;
        browser_download_url?: string;
        updated_at?: string;
      }>;
    }): { version: string; artifacts: DesktopArtifactEntry[] } => {
      const assets = Array.isArray(rel.assets) ? rel.assets : [];
      const ver = String(rel.tag_name || rel.name || readAppPackageVersion())
        .replace(/^v/i, '')
        .trim() || readAppPackageVersion();

      const validExeAssets = assets.filter(
        (a) =>
          a.name &&
          a.browser_download_url &&
          /\.exe$/i.test(a.name) &&
          !/uninstaller/i.test(a.name)
      );

      const portableAsset = validExeAssets.find((a) => /portable/i.test(a.name || ''));
      const setupAsset =
        validExeAssets.find((a) => /setup/i.test(a.name || '') && !/portable/i.test(a.name || '')) ||
        validExeAssets.find((a) => !/portable/i.test(a.name || ''));

      const out: DesktopArtifactEntry[] = [];
      if (setupAsset?.name && setupAsset.browser_download_url) {
        out.push({
          id: 'setup-exe',
          kind: 'installer',
          source: 'github',
          version: ver,
          filename: setupAsset.name,
          sizeBytes: Number(setupAsset.size) || 0,
          downloadUrl: setupAsset.browser_download_url,
          updatedAtMs: Date.parse(setupAsset.updated_at || rel.published_at || '') || Date.now(),
        });
      }
      if (portableAsset?.name && portableAsset.browser_download_url) {
        out.push({
          id: 'portable-exe',
          kind: 'portable',
          source: 'github',
          version: ver,
          filename: portableAsset.name,
          sizeBytes: Number(portableAsset.size) || 0,
          downloadUrl: portableAsset.browser_download_url,
          updatedAtMs: Date.parse(portableAsset.updated_at || rel.published_at || '') || Date.now(),
        });
      }
      return { version: ver, artifacts: out };
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const latestRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);

      let parsed: { version: string; artifacts: DesktopArtifactEntry[] } = {
        version: readAppPackageVersion(),
        artifacts: [],
      };

      if (latestRes.ok) {
        parsed = extractExeFromRelease(await latestRes.json());
      }

      // If /releases/latest didn't exist or lacked .exe assets, inspect recent releases
      if (parsed.artifacts.length === 0) {
        const listController = new AbortController();
        const listTimer = setTimeout(() => listController.abort(), 6000);
        const listRes = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=5`, {
          headers,
          signal: listController.signal,
        });
        clearTimeout(listTimer);

        if (listRes.ok) {
          const list = (await listRes.json()) as Array<{
            tag_name?: string;
            name?: string;
            published_at?: string;
            draft?: boolean;
            assets?: Array<{
              name?: string;
              size?: number;
              browser_download_url?: string;
              updated_at?: string;
            }>;
          }>;
          for (const rel of Array.isArray(list) ? list : []) {
            if (rel.draft) continue;
            const candidate = extractExeFromRelease(rel);
            if (candidate.artifacts.length > 0) {
              parsed = candidate;
              break;
            }
          }
        }
      }

      githubReleaseCache.set(repo, {
        expiresAt: Date.now() + (parsed.artifacts.length > 0 ? 5 * 60 * 1000 : 60 * 1000),
        version: parsed.version,
        artifacts: parsed.artifacts,
      });
      return parsed;
    } catch {
      githubReleaseCache.set(repo, {
        expiresAt: Date.now() + 30 * 1000,
        version: readAppPackageVersion(),
        artifacts: [],
      });
      return { version: readAppPackageVersion(), artifacts: [] };
    }
  }

  async function resolveMergedDesktopArtifacts(overrideRepo?: string): Promise<{
    version: string;
    githubConfigured: boolean;
    artifacts: DesktopArtifactEntry[];
  }> {
    const localArtifacts = scanLocalDesktopArtifacts();
    const repo = resolveDesktopGithubRepo(overrideRepo);
    const ghResult = repo
      ? await fetchGithubDesktopArtifacts(repo)
      : { version: readAppPackageVersion(), artifacts: [] };

    const mergedByKind = new Map<'installer' | 'portable', DesktopArtifactEntry>();
    for (const item of ghResult.artifacts) {
      mergedByKind.set(item.kind, item);
    }
    for (const localItem of localArtifacts) {
      mergedByKind.set(localItem.kind, localItem);
    }

    const merged = Array.from(mergedByKind.values()).sort(
      (a, b) => (a.kind === 'installer' ? -1 : 1) - (b.kind === 'installer' ? -1 : 1)
    );
    const bestVersion =
      merged.find((m) => m.version)?.version || ghResult.version || readAppPackageVersion();

    return {
      version: bestVersion,
      githubConfigured: Boolean(repo),
      artifacts: merged,
    };
  }

  app.get('/api/desktop/info', async (req, res) => {
    const repoOverride = typeof req.query.repo === 'string' ? req.query.repo : undefined;
    const resolved = await resolveMergedDesktopArtifacts(repoOverride);
    const publicArtifacts = resolved.artifacts.map(({ fullPath: _fp, ...pub }) => pub);
    res.json({
      appName: 'Paijo Clip',
      version: resolved.version,
      platform: 'win32-x64',
      runtime: process.env.VERCEL ? 'vercel-serverless' : 'node-server',
      githubConfigured: resolved.githubConfigured,
      artifacts: publicArtifacts,
    });
  });

  app.get('/api/desktop/download/:artifactId', async (req, res) => {
    const artifactId = String(req.params.artifactId || '').trim();
    if (artifactId !== 'setup-exe' && artifactId !== 'portable-exe') {
      res.status(400).json({ error: 'Target unduhan desktop tidak valid.' });
      return;
    }

    const repoOverride = typeof req.query.repo === 'string' ? req.query.repo : undefined;
    const resolved = await resolveMergedDesktopArtifacts(repoOverride);
    const match = resolved.artifacts.find((a) => a.id === artifactId) || resolved.artifacts[0];

    if (!match) {
      res.status(404).json({
        error: 'Rilis Windows (.exe) belum tersedia saat ini.',
      });
      return;
    }

    if (match.source === 'local' && match.fullPath && fs.existsSync(match.fullPath)) {
      res.setHeader('Content-Type', 'application/vnd.microsoft.portable-executable');
      res.download(match.fullPath, match.filename);
      return;
    }

    if (/^https?:\/\//i.test(match.downloadUrl)) {
      res.redirect(302, match.downloadUrl);
      return;
    }

    res.status(404).json({
      error: 'Rilis Windows (.exe) belum tersedia saat ini.',
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

    const ytDlpBin = await resolveYtDlpCommand();
    if (!ytDlpBin) {
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
        ytDlpBin,
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
      const langKey = String(language || 'auto').toLowerCase();
      const langHint =
        langKey === 'auto'
          ? 'the spoken language'
          : LANGUAGE_NAME_MAP[langKey] || 'Indonesian (Bahasa Indonesia)';
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
      const langLabel = LANGUAGE_NAME_MAP[String(language || 'id').toLowerCase()] || 'Indonesian (Bahasa Indonesia)';
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
      const { cues, minDur = 30, maxDur = 90, limit = 8, uiLocale } = req.body ?? {};
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

      const preferredLang = LANGUAGE_NAME_MAP[String(uiLocale || '').toLowerCase()] || 'English or Indonesian';
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
Write "title" and "reason" in the same language as the transcript (or ${preferredLang} if mixed). "hook" must quote the verbatim opening words from startCueIndex.

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
