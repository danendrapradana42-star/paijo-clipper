import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  HardDrive,
  Link2,
  MonitorDown,
  Package,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Square,
  Terminal,
} from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext';
import {
  downloadVerifiedChunkedExe,
  formatFileSize,
  type DesktopArtifactInfo,
} from '../utils/desktopDownloader';
import { subscribePublishedReleases, type AppReleaseDoc } from '../utils/firestoreSync';
import { CLIENT_APP_VERSION } from './UpdatesView';

type DesktopArtifact = DesktopArtifactInfo & {
  available?: boolean;
};

interface DesktopInfoResponse {
  appName: string;
  version: string;
  platform: string;
  runtime: string;
  githubConfigured?: boolean;
  artifacts: DesktopArtifact[];
}

interface CustomExeLinks {
  setupUrl: string;
  portableUrl: string;
}

interface DesktopDownloadViewProps {
  onBackHome: () => void;
  onOpenUpdates: () => void;
}

const REPO_STORAGE_KEY = 'autoclipper.update.githubRepo';
const CUSTOM_LINKS_STORAGE_KEY = 'autoclipper.desktop.customLinks.v1';

const AUTO_GITHUB_REPO = String(
  import.meta.env.VITE_AUTO_GITHUB_REPO || import.meta.env.VITE_DESKTOP_GITHUB_REPO || ''
).trim();

function extractGithubRepo(raw: string): string {
  const clean = String(raw || '').trim();
  if (!clean) return '';
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(clean)) return clean;
  try {
    const u = new URL(clean);
    if (u.hostname.replace(/^www\./, '').toLowerCase() === 'github.com') {
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        const candidate = `${parts[0]}/${parts[1]}`.replace(/\.git$/i, '');
        if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(candidate)) {
          return candidate;
        }
      }
    }
  } catch {
    // Ignore malformed URL
  }
  return '';
}

function loadSavedGithubRepo(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(REPO_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function loadSavedCustomLinks(): CustomExeLinks {
  if (typeof window === 'undefined') return { setupUrl: '', portableUrl: '' };
  try {
    const raw = localStorage.getItem(CUSTOM_LINKS_STORAGE_KEY);
    if (!raw) return { setupUrl: '', portableUrl: '' };
    const parsed = JSON.parse(raw) as Partial<CustomExeLinks>;
    return {
      setupUrl: typeof parsed.setupUrl === 'string' ? parsed.setupUrl.trim() : '',
      portableUrl: typeof parsed.portableUrl === 'string' ? parsed.portableUrl.trim() : '',
    };
  } catch {
    return { setupUrl: '', portableUrl: '' };
  }
}

function extractFilenameFromUrl(url: string, fallback: string): string {
  try {
    const u = new URL(url);
    const base = decodeURIComponent(u.pathname.split('/').pop() || '');
    if (/\.exe$/i.test(base)) return base;
  } catch {
    // fallback
  }
  return fallback;
}

async function fetchGithubReleasesBrowserFallback(
  repo: string
): Promise<{ version: string; releaseUrl: string | null; artifacts: DesktopArtifact[] } | null> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
  const parseRelease = (rel: {
    tag_name?: string;
    name?: string;
    html_url?: string;
    published_at?: string;
    draft?: boolean;
    assets?: Array<{
      name?: string;
      size?: number;
      browser_download_url?: string;
      updated_at?: string;
    }>;
  }) => {
    const assets = Array.isArray(rel.assets) ? rel.assets : [];
    const ver =
      String(rel.tag_name || rel.name || CLIENT_APP_VERSION)
        .replace(/^v/i, '')
        .trim() || CLIENT_APP_VERSION;
    const valid = assets.filter(
      (a) =>
        a.name &&
        a.browser_download_url &&
        /\.exe$/i.test(a.name) &&
        !/uninstaller/i.test(a.name)
    );
    const portable = valid.find((a) => /portable/i.test(a.name || ''));
    const setup =
      valid.find((a) => /setup/i.test(a.name || '') && !/portable/i.test(a.name || '')) ||
      valid.find((a) => !/portable/i.test(a.name || ''));
    const out: DesktopArtifact[] = [];
    if (setup?.name && setup.browser_download_url) {
      out.push({
        id: 'setup-exe',
        kind: 'installer',
        source: 'github',
        version: ver,
        filename: setup.name,
        sizeBytes: Number(setup.size) || 0,
        downloadUrl: setup.browser_download_url,
        updatedAtMs: Date.parse(setup.updated_at || rel.published_at || '') || Date.now(),
        available: true,
      });
    }
    if (portable?.name && portable.browser_download_url) {
      out.push({
        id: 'portable-exe',
        kind: 'portable',
        source: 'github',
        version: ver,
        filename: portable.name,
        sizeBytes: Number(portable.size) || 0,
        downloadUrl: portable.browser_download_url,
        updatedAtMs: Date.parse(portable.updated_at || rel.published_at || '') || Date.now(),
        available: true,
      });
    }
    return {
      version: ver,
      releaseUrl: rel.html_url || `https://github.com/${repo}/releases`,
      artifacts: out,
    };
  };

  try {
    const latestRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    let firstReleaseUrl: string | null = null;
    if (latestRes.ok) {
      const parsed = parseRelease(await latestRes.json());
      firstReleaseUrl = parsed.releaseUrl;
      if (parsed.artifacts.length > 0) return parsed;
    }
    const listRes = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=5`, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (listRes.ok) {
      const list = (await listRes.json()) as Parameters<typeof parseRelease>[0][];
      for (const rel of Array.isArray(list) ? list : []) {
        if (rel.draft) continue;
        const parsed = parseRelease(rel);
        if (!firstReleaseUrl && parsed.releaseUrl) firstReleaseUrl = parsed.releaseUrl;
        if (parsed.artifacts.length > 0) return parsed;
      }
    }
    if (firstReleaseUrl) {
      return { version: CLIENT_APP_VERSION, releaseUrl: firstReleaseUrl, artifacts: [] };
    }
  } catch {
    // Ignore browser-side network error
  }
  return null;
}

export function DesktopDownloadView({ onBackHome, onOpenUpdates }: DesktopDownloadViewProps) {
  const { t } = useTranslation();
  const linkConfigPanelRef = useRef<HTMLElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfoResponse | null>(null);
  const [githubReleasePageUrl, setGithubReleasePageUrl] = useState<string | null>(null);
  const [cloudReleases, setCloudReleases] = useState<AppReleaseDoc[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Repo & Custom Direct Link Configuration (shared with UpdatesView via localStorage)
  const [repoInput, setRepoInput] = useState<string>(() => loadSavedGithubRepo() || AUTO_GITHUB_REPO);
  const [customLinks, setCustomLinks] = useState<CustomExeLinks>(() => loadSavedCustomLinks());
  const [setupUrlDraft, setSetupUrlDraft] = useState<string>(() => loadSavedCustomLinks().setupUrl);
  const [portableUrlDraft, setPortableUrlDraft] = useState<string>(
    () => loadSavedCustomLinks().portableUrl
  );
  const [showLinkEditor, setShowLinkEditor] = useState(false);
  const [linkNotice, setLinkNotice] = useState('');
  const [linkWarning, setLinkWarning] = useState('');

  // Verified chunked download state (prevents Cloud Run 32 MiB truncation / corrupt .exe)
  const downloadAbortRef = useRef<AbortController | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [downloadTotalBytes, setDownloadTotalBytes] = useState(0);
  const [downloadStage, setDownloadStage] = useState<
    'idle' | 'downloading' | 'verifying' | 'done' | 'error'
  >('idle');
  const [downloadError, setDownloadError] = useState('');

  const isRunningDesktop = typeof window !== 'undefined' && Boolean(window.paijoDesktop?.isDesktop);

  // Developer-only diagnostics & build instructions
  const [devUnlocked, setDevUnlocked] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('dev') === '1' || window.location.hash === '#dev') {
        sessionStorage.setItem('paijoclip.devMode', '1');
        return true;
      }
      return sessionStorage.getItem('paijoclip.devMode') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === 'D') {
        e.preventDefault();
        setDevUnlocked((prev) => {
          const next = !prev;
          try {
            if (next) sessionStorage.setItem('paijoclip.devMode', '1');
            else sessionStorage.removeItem('paijoclip.devMode');
          } catch {}
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Derive GitHub repo from published Firestore release packageUrl if not explicitly set
  const cloudDerivedRepo = useMemo(() => {
    for (const rel of cloudReleases) {
      if (rel.status !== 'published' || !rel.packageUrl) continue;
      const extracted = extractGithubRepo(rel.packageUrl);
      if (extracted) return extracted;
    }
    return '';
  }, [cloudReleases]);

  const effectiveGithubRepo = useMemo(() => {
    return (
      extractGithubRepo(repoInput) ||
      extractGithubRepo(AUTO_GITHUB_REPO) ||
      cloudDerivedRepo ||
      ''
    );
  }, [repoInput, cloudDerivedRepo]);

  const loadDesktopDownloads = useCallback(
    async (overrideRepo?: string): Promise<DesktopInfoResponse | null> => {
      const targetRepo = extractGithubRepo(overrideRepo ?? effectiveGithubRepo);
      const infoEndpoint = targetRepo
        ? `/api/desktop/info?repo=${encodeURIComponent(targetRepo)}`
        : '/api/desktop/info';

      try {
        const res = await fetch(infoEndpoint, { cache: 'no-store' });
        const data: DesktopInfoResponse | null = res.ok ? await res.json() : null;
        if (data && Array.isArray(data.artifacts) && data.artifacts.length > 0) {
          const normalized: DesktopInfoResponse = {
            ...data,
            artifacts: data.artifacts.map((a) => ({ ...a, available: true })),
          };
          setDesktopInfo(normalized);
          if (targetRepo) {
            setGithubReleasePageUrl(`https://github.com/${targetRepo}/releases/latest`);
          }
          return normalized;
        }

        if (targetRepo) {
          const ghFallback = await fetchGithubReleasesBrowserFallback(targetRepo);
          if (ghFallback) {
            setGithubReleasePageUrl(
              ghFallback.releaseUrl || `https://github.com/${targetRepo}/releases`
            );
            if (ghFallback.artifacts.length > 0) {
              const synthetic: DesktopInfoResponse = {
                appName: 'Paijo Clip',
                version: ghFallback.version,
                platform: 'win32-x64',
                runtime: 'github-browser',
                githubConfigured: true,
                artifacts: ghFallback.artifacts,
              };
              setDesktopInfo(synthetic);
              return synthetic;
            }
          } else {
            setGithubReleasePageUrl(`https://github.com/${targetRepo}/releases`);
          }
        } else {
          setGithubReleasePageUrl(null);
        }

        if (data) {
          setDesktopInfo(data);
          return data;
        }
      } catch {
        if (targetRepo) {
          const ghFallback = await fetchGithubReleasesBrowserFallback(targetRepo);
          if (ghFallback && ghFallback.artifacts.length > 0) {
            const synthetic: DesktopInfoResponse = {
              appName: 'Paijo Clip',
              version: ghFallback.version,
              platform: 'win32-x64',
              runtime: 'github-browser',
              githubConfigured: true,
              artifacts: ghFallback.artifacts,
            };
            setDesktopInfo(synthetic);
            return synthetic;
          }
        }
      }
      return null;
    },
    [effectiveGithubRepo]
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadDesktopDownloads().finally(() => {
      if (active) setLoading(false);
    });

    const unsub = subscribePublishedReleases((list) => {
      if (active) setCloudReleases(list);
    });

    return () => {
      active = false;
      unsub();
      downloadAbortRef.current?.abort();
    };
  }, [loadDesktopDownloads]);

  // Firestore published desktop / direct .exe release
  const cloudDesktopRelease = useMemo(() => {
    return (
      cloudReleases.find(
        (rel) =>
          rel.status === 'published' &&
          Boolean(rel.packageUrl && /^https?:\/\//i.test(rel.packageUrl)) &&
          (rel.buildTarget === 'desktop' ||
            rel.buildTarget === 'all' ||
            rel.buildTarget === 'fullstack' ||
            /\.exe(\?|$)/i.test(rel.packageUrl) ||
            /github\.com\/[^/]+\/[^/]+\/releases/i.test(rel.packageUrl))
      ) || null
    );
  }, [cloudReleases]);

  const displayVersion = desktopInfo?.version || cloudDesktopRelease?.version || CLIENT_APP_VERSION;

  // Merge server/GitHub artifacts with Firestore direct .exe & user custom URLs
  const { setupArtifact, portableArtifact, hasLiveExe } = useMemo(() => {
    const serverArtifacts = desktopInfo?.artifacts || [];
    let setup: DesktopArtifact | null =
      serverArtifacts.find((a) => a.kind === 'installer') || null;
    let portable: DesktopArtifact | null =
      serverArtifacts.find((a) => a.kind === 'portable') || null;

    if (setup) setup = { ...setup, available: true };
    if (portable) portable = { ...portable, available: true };

    // Apply Firestore published direct .exe URL if needed
    const cloudUrl = cloudDesktopRelease?.packageUrl?.trim() || '';
    if (cloudUrl && /\.exe(\?|$)/i.test(cloudUrl)) {
      const isPortable = /portable/i.test(cloudUrl);
      const ver = cloudDesktopRelease?.version || displayVersion;
      if (isPortable && !portable) {
        portable = {
          id: 'portable-exe',
          kind: 'portable',
          source: 'firestore',
          version: ver,
          filename: extractFilenameFromUrl(cloudUrl, `Paijo Clip-${ver}-Portable-x64.exe`),
          sizeBytes: 0,
          downloadUrl: cloudUrl,
          available: true,
        };
      } else if (!isPortable && !setup) {
        setup = {
          id: 'setup-exe',
          kind: 'installer',
          source: 'firestore',
          version: ver,
          filename: extractFilenameFromUrl(cloudUrl, `Paijo Clip-${ver}-Setup-x64.exe`),
          sizeBytes: 0,
          downloadUrl: cloudUrl,
          available: true,
        };
      }
    }

    // Apply user-saved direct .exe links from localStorage
    if (!setup && customLinks.setupUrl && /^https?:\/\//i.test(customLinks.setupUrl)) {
      setup = {
        id: 'setup-exe',
        kind: 'installer',
        source: 'github',
        version: displayVersion,
        filename: extractFilenameFromUrl(
          customLinks.setupUrl,
          `Paijo Clip-${displayVersion}-Setup-x64.exe`
        ),
        sizeBytes: 0,
        downloadUrl: customLinks.setupUrl,
        available: true,
      };
    }

    if (!portable && customLinks.portableUrl && /^https?:\/\//i.test(customLinks.portableUrl)) {
      portable = {
        id: 'portable-exe',
        kind: 'portable',
        source: 'github',
        version: displayVersion,
        filename: extractFilenameFromUrl(
          customLinks.portableUrl,
          `Paijo Clip-${displayVersion}-Portable-x64.exe`
        ),
        sizeBytes: 0,
        downloadUrl: customLinks.portableUrl,
        available: true,
      };
    }

    const anyLive = Boolean(setup?.available || portable?.available);

    // Always expose Setup & Portable download cards + endpoint links in Download menu
    const resolvedSetup: DesktopArtifact = setup || {
      id: 'setup-exe',
      kind: 'installer',
      source: 'local',
      version: displayVersion,
      filename: `Paijo Clip-${displayVersion}-Setup-x64.exe`,
      sizeBytes: 0,
      downloadUrl: '/api/desktop/download/setup-exe',
      available: false,
    };

    const resolvedPortable: DesktopArtifact = portable || {
      id: 'portable-exe',
      kind: 'portable',
      source: 'local',
      version: displayVersion,
      filename: `Paijo Clip-${displayVersion}-Portable-x64.exe`,
      sizeBytes: 0,
      downloadUrl: '/api/desktop/download/portable-exe',
      available: false,
    };

    return {
      setupArtifact: resolvedSetup,
      portableArtifact: resolvedPortable,
      hasLiveExe: anyLive,
    };
  }, [desktopInfo, cloudDesktopRelease, customLinks, displayVersion]);

  const primaryArtifact = setupArtifact.available
    ? setupArtifact
    : portableArtifact.available
      ? portableArtifact
      : setupArtifact;

  const resolveAbsoluteUrl = (url: string) => {
    if (/^https?:\/\//i.test(url)) return url;
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}${url}`;
    }
    return url;
  };

  const handleCopyLink = (id: string, rawUrl: string) => {
    const abs = resolveAbsoluteUrl(rawUrl);
    navigator.clipboard?.writeText(abs).catch(() => {});
    setCopiedId(id);
    window.setTimeout(() => {
      setCopiedId((prev) => (prev === id ? null : prev));
    }, 1800);
  };

  const handleCancelDownload = () => {
    downloadAbortRef.current?.abort();
    downloadAbortRef.current = null;
    setDownloadingId(null);
    setDownloadStage('idle');
    setDownloadedBytes(0);
    setDownloadTotalBytes(0);
  };

  const handleRefreshChecks = async () => {
    setRefreshing(true);
    setLinkNotice('');
    setLinkWarning('');
    const result = await loadDesktopDownloads();
    setRefreshing(false);
    if (result && result.artifacts.length > 0) {
      setLinkNotice(`Ditemukan ${result.artifacts.length} file .exe siap unduh (v${result.version}).`);
    } else {
      setLinkWarning(
        'File .exe lokal belum ditemukan di server ini. Masukkan repositori GitHub atau link download .exe di bawah.'
      );
      setShowLinkEditor(true);
    }
  };

  const handleDownloadVerifiedChunked = async (artifact: DesktopArtifact) => {
    if (downloadingId) return;

    // If not yet verified live, probe server/GitHub once before guiding user to link config
    if (!artifact.available) {
      setRefreshing(true);
      const fresh = await loadDesktopDownloads();
      setRefreshing(false);
      const matched = fresh?.artifacts.find((a) => a.id === artifact.id || a.kind === artifact.kind);
      if (!matched) {
        setShowLinkEditor(true);
        setLinkWarning(
          `File ${artifact.filename} belum terpasang di server ini. Hubungkan repositori GitHub Releases atau tempelkan URL .exe langsung di bawah.`
        );
        window.setTimeout(() => {
          linkConfigPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 60);
        return;
      }
      artifact = { ...matched, available: true };
    }

    const totalSize = artifact.sizeBytes;
    if (!totalSize || totalSize <= 0) {
      const a = document.createElement('a');
      a.href = artifact.downloadUrl;
      a.download = artifact.filename;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    const ctrl = new AbortController();
    downloadAbortRef.current = ctrl;
    setDownloadingId(artifact.id);
    setDownloadStage('downloading');
    setDownloadError('');
    setDownloadedBytes(0);
    setDownloadTotalBytes(totalSize);

    try {
      await downloadVerifiedChunkedExe(artifact, {
        signal: ctrl.signal,
        onProgress: (received, total, stage) => {
          setDownloadedBytes(received);
          setDownloadTotalBytes(total);
          setDownloadStage(stage);
        },
      });
      setDownloadStage('done');
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || ctrl.signal.aborted) {
        setDownloadStage('idle');
      } else {
        setDownloadStage('error');
        setDownloadError(
          err instanceof Error ? err.message : 'Gagal mengunduh file .exe. Silakan coba lagi.'
        );
      }
    } finally {
      if (downloadAbortRef.current === ctrl) {
        downloadAbortRef.current = null;
      }
      setDownloadingId(null);
    }
  };

  const handleSaveGithubAndCustomLinks = async () => {
    setLinkNotice('');
    setLinkWarning('');
    const cleanRepo = extractGithubRepo(repoInput);
    if (repoInput.trim() && !cleanRepo) {
      setLinkWarning('Format GitHub tidak valid. Gunakan "pemilik/nama-repo" atau URL github.com.');
      return;
    }

    const nextSetupUrl = setupUrlDraft.trim();
    const nextPortableUrl = portableUrlDraft.trim();
    if (nextSetupUrl && !/^https?:\/\//i.test(nextSetupUrl)) {
      setLinkWarning('Link Setup (.exe) harus diawali https:// atau http://.');
      return;
    }
    if (nextPortableUrl && !/^https?:\/\//i.test(nextPortableUrl)) {
      setLinkWarning('Link Portable (.exe) harus diawali https:// atau http://.');
      return;
    }

    try {
      if (cleanRepo) localStorage.setItem(REPO_STORAGE_KEY, cleanRepo);
      else localStorage.removeItem(REPO_STORAGE_KEY);

      const nextCustom: CustomExeLinks = { setupUrl: nextSetupUrl, portableUrl: nextPortableUrl };
      if (nextSetupUrl || nextPortableUrl) {
        localStorage.setItem(CUSTOM_LINKS_STORAGE_KEY, JSON.stringify(nextCustom));
      } else {
        localStorage.removeItem(CUSTOM_LINKS_STORAGE_KEY);
      }
      setCustomLinks(nextCustom);
      if (cleanRepo) setRepoInput(cleanRepo);
    } catch {
      // ignore storage quota errors
    }

    setRefreshing(true);
    const loaded = await loadDesktopDownloads(cleanRepo);
    setRefreshing(false);

    if (loaded && loaded.artifacts.length > 0) {
      setLinkNotice(
        `Link download .exe berhasil dimuat (${loaded.artifacts.length} paket, v${loaded.version}).`
      );
      setShowLinkEditor(false);
    } else if (nextSetupUrl || nextPortableUrl) {
      setLinkNotice('Link download langsung .exe berhasil disimpan dan siap digunakan.');
      setShowLinkEditor(false);
    } else if (cleanRepo) {
      setLinkWarning(
        `Repositori "${cleanRepo}" tersimpan, namun belum ditemukan aset .exe pada GitHub Releases.`
      );
    } else {
      setLinkNotice('Pengaturan link direset ke deteksi otomatis server.');
    }
  };

  const handleResetSavedLinks = async () => {
    setRepoInput(AUTO_GITHUB_REPO);
    setSetupUrlDraft('');
    setPortableUrlDraft('');
    setCustomLinks({ setupUrl: '', portableUrl: '' });
    setLinkNotice('');
    setLinkWarning('');
    try {
      localStorage.removeItem(REPO_STORAGE_KEY);
      localStorage.removeItem(CUSTOM_LINKS_STORAGE_KEY);
    } catch {}
    setRefreshing(true);
    await loadDesktopDownloads(AUTO_GITHUB_REPO);
    setRefreshing(false);
  };

  const formatDownloadBtnLabel = (artifact: DesktopArtifact) => {
    if (!artifact.available) {
      return artifact.kind === 'installer'
        ? 'Unduh Setup (.exe)'
        : 'Unduh Portable (.exe)';
    }
    if (artifact.sizeBytes > 0) {
      return t('download.btnExe', { size: formatFileSize(artifact.sizeBytes) });
    }
    return artifact.kind === 'installer'
      ? 'Unduh Setup (.exe)'
      : 'Unduh Portable (.exe)';
  };

  const renderArtifactButton = (artifact: DesktopArtifact, primaryStyle = true) => {
    const isThisDownloading = downloadingId === artifact.id;
    const isAnyDownloading = Boolean(downloadingId) || refreshing;
    const pct = downloadTotalBytes
      ? Math.min(100, Math.round((downloadedBytes / downloadTotalBytes) * 100))
      : 0;

    if (artifact.available && artifact.source !== 'local') {
      return (
        <a
          href={artifact.downloadUrl}
          download={artifact.filename}
          target="_blank"
          rel="noopener noreferrer"
          className={`px-4 py-3 rounded-lg text-white text-xs font-extrabold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
            primaryStyle
              ? 'bg-[#ff6b00] hover:bg-[#ff8224]'
              : 'bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173]'
          }`}
        >
          <Download className={`w-4 h-4 shrink-0 ${primaryStyle ? '' : 'text-[#ff6b00]'}`} />
          <span>{formatDownloadBtnLabel(artifact)}</span>
        </a>
      );
    }

    if (isThisDownloading) {
      return (
        <button
          type="button"
          onClick={handleCancelDownload}
          className="px-4 py-3 rounded-lg bg-[#16264d] hover:bg-red-950/50 border border-[#ff6b00] text-white text-xs font-bold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Square className="w-3.5 h-3.5 fill-current text-[#ff6b00]" />
          <span className="font-mono tabular-nums">
            {downloadStage === 'verifying'
              ? 'SHA-256…'
              : `${pct}% (${formatFileSize(downloadedBytes)} / ${formatFileSize(downloadTotalBytes)})`}
          </span>
        </button>
      );
    }

    return (
      <button
        type="button"
        disabled={isAnyDownloading}
        onClick={() => handleDownloadVerifiedChunked(artifact)}
        className={`px-4 py-3 rounded-lg text-white text-xs font-extrabold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 cursor-pointer ${
          primaryStyle
            ? 'bg-[#ff6b00] hover:bg-[#ff8224]'
            : 'bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173]'
        }`}
      >
        <Download className={`w-4 h-4 shrink-0 ${primaryStyle ? '' : 'text-[#ff6b00]'}`} />
        <span>{formatDownloadBtnLabel(artifact)}</span>
      </button>
    );
  };

  const progressPct = downloadTotalBytes
    ? Math.min(100, Math.round((downloadedBytes / downloadTotalBytes) * 100))
    : 0;

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3.5 max-w-2xl">
          <img
            src="/assets/aistudio/paijoclip-icon_f8577a46.png"
            alt="Paijo Clip logo"
            referrerPolicy="no-referrer"
            className="w-11 h-14 object-contain shrink-0 rounded-lg"
          />
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight text-balance">
              {t('download.title')}
            </h1>
            <p className="text-xs sm:text-sm text-[#93a7cc] leading-relaxed">
              {t('download.subtitle')}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#93a7cc] font-mono tabular-nums pt-0.5">
              <span>Paijo Clip v{displayVersion}</span>
              <span aria-hidden="true">·</span>
              <span>Windows 10 / 11 (x64)</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={refreshing}
            onClick={handleRefreshChecks}
            className="px-3 py-2 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Cek Ulang .exe</span>
          </button>
          <button
            type="button"
            onClick={() => setShowLinkEditor((prev) => !prev)}
            className="px-3 py-2 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Settings2 className="w-3.5 h-3.5 text-[#ff8224]" />
            <span>Atur Link .exe</span>
          </button>
          <button
            type="button"
            onClick={onBackHome}
            className="px-3.5 py-2 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            {t('download.backHome')}
          </button>
        </div>
      </div>

      {/* Already Running Desktop Banner */}
      {isRunningDesktop && (
        <div className="bg-[#101d3d] border border-[#c7ff55]/45 rounded-xl px-4 py-3 flex items-center gap-2.5 text-xs font-semibold text-[#e4ecfa]">
          <CheckCircle2 className="w-4 h-4 text-[#c7ff55] shrink-0" />
          <span>{t('download.runningDesktop')}</span>
        </div>
      )}

      {/* Link Configuration Feedback Banner */}
      {(linkNotice || linkWarning) && (
        <div
          className={`rounded-xl px-4 py-3 text-xs flex items-start gap-2.5 border ${
            linkWarning
              ? 'bg-amber-950/35 border-amber-500/45 text-amber-100'
              : 'bg-[#171d12] border-[#c7ff55]/45 text-[#c7ff55]'
          }`}
        >
          {linkWarning ? (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-[#c7ff55] shrink-0 mt-0.5" />
          )}
          <span>{linkWarning || linkNotice}</span>
        </div>
      )}

      {/* Active Verified Chunk Download Progress / Error / Done Banner */}
      {(downloadingId || downloadStage === 'done' || (downloadStage === 'error' && downloadError)) && (
        <section
          className={`bg-[#101d3d] rounded-xl p-4 space-y-2 border ${
            downloadStage === 'error'
              ? 'border-red-500/55'
              : downloadStage === 'done'
                ? 'border-[#c7ff55]/55'
                : 'border-[#ff6b00]/60'
          }`}
        >
          {downloadStage === 'error' ? (
            <div className="flex items-start gap-2.5 text-xs text-red-200">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{downloadError}</span>
            </div>
          ) : downloadStage === 'done' ? (
            <div className="flex items-center gap-2.5 text-xs font-semibold text-[#c7ff55]">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                File .exe terverifikasi utuh (SHA-256 cocok) dan siap dijalankan di Windows Anda.
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs text-[#e4ecfa]">
                <span className="font-semibold">
                  {downloadStage === 'verifying'
                    ? 'Memverifikasi integritas SHA-256 file .exe…'
                    : 'Mengunduh paket .exe per bagian terverifikasi (anti-corrupt)…'}
                </span>
                <span className="font-mono tabular-nums font-bold text-[#c7ff55]">
                  {progressPct}% · {formatFileSize(downloadedBytes)} / {formatFileSize(downloadTotalBytes)}
                </span>
              </div>
              <div className="h-2 bg-[#1a2d59] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#ff6b00] transition-all duration-150"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}
        </section>
      )}

      {/* Primary Download Section */}
      {loading ? (
        <div className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-6 text-xs text-[#93a7cc]">
          {t('download.checking')}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Featured Primary Direct Download Card */}
          <section className="bg-[#101d3d] border border-[#ff6b00]/60 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1.5 min-w-0 flex-1">
              <div className="inline-flex items-center gap-2 text-xs font-bold text-[#ff8224]">
                <MonitorDown className="w-4 h-4 shrink-0" />
                <span className="font-mono tabular-nums">
                  Windows 10 / 11 (64-bit) · v{primaryArtifact.version || displayVersion}
                </span>
              </div>
              <div className="text-base sm:text-lg font-extrabold text-white truncate">
                {primaryArtifact.filename}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#b8c7e3]">
                {primaryArtifact.sizeBytes > 0 && (
                  <>
                    <span className="font-mono tabular-nums font-semibold text-[#c7ff55]">
                      {formatFileSize(primaryArtifact.sizeBytes)}
                    </span>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                {primaryArtifact.sha256 && (
                  <>
                    <span className="font-mono text-[11px] text-[#93a7cc]">
                      SHA-256: {primaryArtifact.sha256.slice(0, 12)}…
                    </span>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[#dce6f7] truncate max-w-full">
                  <Link2 className="w-3.5 h-3.5 shrink-0 text-[#ff6b00]" />
                  <span className="truncate">{resolveAbsoluteUrl(primaryArtifact.downloadUrl)}</span>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleCopyLink(primaryArtifact.id, primaryArtifact.downloadUrl)}
                className="px-3 py-3 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-[#e4ecfa] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                aria-label="Salin tautan unduhan"
              >
                {copiedId === primaryArtifact.id ? (
                  <Check className="w-4 h-4 text-[#c7ff55]" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
              {renderArtifactButton(primaryArtifact, true)}
            </div>
          </section>

          {/* Setup Installer & Portable (.exe) Dual Cards — Always Visible */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <article className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-5 flex flex-col justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-white font-bold text-base">
                    <MonitorDown className="w-4 h-4 text-[#ff6b00] shrink-0" />
                    <span>{t('download.installerTitle')}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyLink('card-setup', setupArtifact.downloadUrl)}
                    className="p-1.5 rounded-md bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-[#dce6f7] cursor-pointer"
                    aria-label="Salin link Setup .exe"
                  >
                    {copiedId === 'card-setup' ? (
                      <Check className="w-3.5 h-3.5 text-[#c7ff55]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-[#93a7cc] leading-relaxed">
                  {t('download.installerDesc')}
                </p>
                <div className="text-[11px] font-mono tabular-nums text-[#b8c7e3] truncate">
                  {setupArtifact.filename}
                  {setupArtifact.sizeBytes > 0 ? ` · ${formatFileSize(setupArtifact.sizeBytes)}` : ''}
                </div>
                <div className="text-[11px] font-mono text-[#ff8224] truncate">
                  {resolveAbsoluteUrl(setupArtifact.downloadUrl)}
                </div>
              </div>
              <div className="w-full flex flex-col">{renderArtifactButton(setupArtifact, true)}</div>
            </article>

            <article className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-5 flex flex-col justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-white font-bold text-base">
                    <Package className="w-4 h-4 text-[#ff8224] shrink-0" />
                    <span>{t('download.portableTitle')}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyLink('card-portable', portableArtifact.downloadUrl)}
                    className="p-1.5 rounded-md bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-[#dce6f7] cursor-pointer"
                    aria-label="Salin link Portable .exe"
                  >
                    {copiedId === 'card-portable' ? (
                      <Check className="w-3.5 h-3.5 text-[#c7ff55]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-[#93a7cc] leading-relaxed">
                  {t('download.portableDesc')}
                </p>
                <div className="text-[11px] font-mono tabular-nums text-[#b8c7e3] truncate">
                  {portableArtifact.filename}
                  {portableArtifact.sizeBytes > 0
                    ? ` · ${formatFileSize(portableArtifact.sizeBytes)}`
                    : ''}
                </div>
                <div className="text-[11px] font-mono text-[#ff8224] truncate">
                  {resolveAbsoluteUrl(portableArtifact.downloadUrl)}
                </div>
              </div>
              <div className="w-full flex flex-col">
                {renderArtifactButton(portableArtifact, !setupArtifact.available)}
              </div>
            </article>
          </div>

          {/* GitHub Releases Direct Link (when repo is configured) */}
          {githubReleasePageUrl && (
            <section className="bg-[#101d3d] border border-[#2a4173] rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5 min-w-0 flex-1">
                <div className="text-xs font-bold text-white">Halaman Rilis Resmi GitHub (.exe)</div>
                <a
                  href={githubReleasePageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-[11px] font-mono text-[#ff8224] hover:underline truncate"
                >
                  {githubReleasePageUrl}
                </a>
              </div>
              <a
                href={githubReleasePageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-bold text-white inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5 text-[#ff8224]" />
                <span>Buka GitHub Releases</span>
              </a>
            </section>
          )}

          {/* Published Cloud Desktop Release from Firestore */}
          {cloudDesktopRelease && (
            <section className="bg-[#101d3d] border border-[#2a4173] rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1 min-w-0 flex-1">
                <div className="text-sm font-bold text-white">
                  {t('download.cloudTitle', { version: `v${cloudDesktopRelease.version}` })}
                </div>
                <div className="text-xs text-[#93a7cc] truncate">{cloudDesktopRelease.title}</div>
                <a
                  href={cloudDesktopRelease.packageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-[11px] font-mono text-[#ff8224] hover:underline truncate"
                >
                  {cloudDesktopRelease.packageUrl}
                </a>
              </div>
              <a
                href={cloudDesktopRelease.packageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-5 py-3 rounded-lg bg-[#ff6b00] hover:bg-[#ff8224] text-white text-xs font-extrabold inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>{t('download.cloudBtn')}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </section>
          )}

          {/* Inline Link Config Panel (shown automatically if no live .exe linked yet, or when toggled) */}
          {(showLinkEditor || !hasLiveExe) && (
            <section
              ref={linkConfigPanelRef}
              className="bg-[#101d3d] border border-[#2a4173] rounded-xl p-5 space-y-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-bold text-white">
                    <Link2 className="w-4 h-4 text-[#ff8224] shrink-0" />
                    <span>Hubungkan Link Download .exe (GitHub Releases / URL Langsung)</span>
                  </div>
                  <p className="text-xs text-[#93a7cc] leading-relaxed">
                    Masukkan repositori GitHub tempat GitHub Actions menerbitkan file{' '}
                    <span className="font-mono text-[#e4ecfa]">Setup-x64.exe</span> &amp;{' '}
                    <span className="font-mono text-[#e4ecfa]">Portable-x64.exe</span>, atau tempelkan
                    tautan unduhan langsung file <span className="font-mono text-[#e4ecfa]">.exe</span>.
                  </p>
                </div>
                {devUnlocked && (
                  <button
                    type="button"
                    onClick={onOpenUpdates}
                    className="px-3 py-1.5 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {t('download.openUpdates')}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="block text-[11px] font-semibold text-[#b8c7e3]">
                    Repositori GitHub (owner/repo)
                  </label>
                  <input
                    type="text"
                    value={repoInput}
                    onChange={(e) => setRepoInput(e.target.value)}
                    placeholder="pemilik/paijo-clip"
                    className="w-full bg-[#070e20] text-white font-mono border border-[#2a4173] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#ff6b00]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] font-semibold text-[#b8c7e3]">
                    URL Setup Installer (.exe) (Opsional)
                  </label>
                  <input
                    type="url"
                    value={setupUrlDraft}
                    onChange={(e) => setSetupUrlDraft(e.target.value)}
                    placeholder="https://github.com/.../Paijo-Clip-Setup-x64.exe"
                    className="w-full bg-[#070e20] text-white font-mono border border-[#2a4173] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#ff6b00]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] font-semibold text-[#b8c7e3]">
                    URL Portable (.exe) (Opsional)
                  </label>
                  <input
                    type="url"
                    value={portableUrlDraft}
                    onChange={(e) => setPortableUrlDraft(e.target.value)}
                    placeholder="https://github.com/.../Paijo-Clip-Portable-x64.exe"
                    className="w-full bg-[#070e20] text-white font-mono border border-[#2a4173] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#ff6b00]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={refreshing}
                  onClick={handleSaveGithubAndCustomLinks}
                  className="px-4 py-2 rounded-lg bg-[#ff6b00] hover:bg-[#ff8224] disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{refreshing ? 'Memeriksa…' : 'Simpan & Muat Link .exe'}</span>
                </button>
                <button
                  type="button"
                  disabled={refreshing}
                  onClick={handleResetSavedLinks}
                  className="px-3.5 py-2 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-[#dce6f7] cursor-pointer"
                >
                  Reset
                </button>
              </div>

              {devUnlocked && (
                <div className="bg-[#0c1733] border border-[#1e3159] rounded-lg p-3.5 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#b8c7e3]">
                    <Terminal className="w-3.5 h-3.5 text-[#ff6b00]" />
                    <span>{t('download.buildCmdLabel')}</span>
                  </div>
                  <pre className="text-xs font-mono text-[#c7ff55] overflow-x-auto">
                    npm install && npm run dist:win
                  </pre>
                  <p className="text-[11px] text-[#93a7cc]">
                    Server auto-sync:{' '}
                    {desktopInfo?.githubConfigured
                      ? 'DESKTOP_GITHUB_REPO / direct URL active'
                      : 'Set DESKTOP_GITHUB_REPO=owner/repo (atau isi input di atas)'}
                  </p>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* Desktop Optimizations Grid */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-white">{t('download.optTitle')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <Cpu className="w-4 h-4 text-[#ff6b00] shrink-0" />
              <span>{t('download.opt1Title')}</span>
            </div>
            <p className="text-xs text-[#93a7cc] leading-relaxed">{t('download.opt1Desc')}</p>
          </div>
          <div className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <HardDrive className="w-4 h-4 text-[#ff6b00] shrink-0" />
              <span>{t('download.opt2Title')}</span>
            </div>
            <p className="text-xs text-[#93a7cc] leading-relaxed">{t('download.opt2Desc')}</p>
          </div>
          <div className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <ShieldCheck className="w-4 h-4 text-[#ff6b00] shrink-0" />
              <span>{t('download.opt3Title')}</span>
            </div>
            <p className="text-xs text-[#93a7cc] leading-relaxed">{t('download.opt3Desc')}</p>
          </div>
        </div>
      </section>

      {/* Setup & Usage Steps */}
      <section className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-bold text-white">{t('download.guideTitle')}</h2>
        <ol className="space-y-2 text-xs text-[#b8c7e3] leading-relaxed">
          <li>{t('download.step1')}</li>
          <li>{t('download.step2')}</li>
          <li>{t('download.step3')}</li>
        </ol>
      </section>
    </div>
  );
}
