import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  Cloud,
  CloudUpload,
  Download,
  ExternalLink,
  FolderOpen,
  LogIn,
  LogOut,
  Pencil,
  Play,
  RefreshCw,
  Rocket,
  RotateCcw,
  Square,
  Trash2,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { useTranslation } from '../i18n/LanguageContext';
import {
  downloadVerifiedChunkedExe,
  formatFileSize,
  type DesktopArtifactInfo,
} from '../utils/desktopDownloader';
import {
  DEVELOPER_ADMIN_EMAIL,
  compareVersions,
  computeNextVersion,
  deleteAppReleaseFromFirestore,
  isValidSemver,
  publishAppReleaseInFirestore,
  saveAppReleaseToFirestore,
  subscribeAllReleasesForAdmin,
  subscribePublishedReleases,
  type AppReleaseDoc,
  type ReleaseStatus,
  type UpdateType,
} from '../utils/firestoreSync';

export const CLIENT_APP_VERSION = '1.5.0';

interface VersionInfo {
  name: string;
  version: string;
  nodeVersion: string;
  serverStartedAt: string;
  checkedAt: string;
  ytDlpReady: boolean;
  aiConfigured: boolean;
}

interface UpdateCheckResult {
  source: 'server' | 'github';
  repo?: string;
  clientVersion: string;
  serverVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseName: string;
  releaseNotes: string;
  releaseUrl: string | null;
  publishedAt: string | null;
  artifacts?: DesktopArtifactInfo[];
  checkedAt: string;
}

interface UpdatesViewProps {
  hasActiveMedia: boolean;
  exportedCount: number;
  firestoreStatus: { reachable: boolean; offline: boolean; message: string };
  firestoreProjectId: string;
  firestoreDatabaseId: string;
  fbUser: User | null;
  authReady: boolean;
  authError: string;
  onSignInGoogle: () => void;
  onSignOutGoogle: () => void;
  onBackHome: () => void;
}

const CHANGELOG: Array<{
  version: string;
  date: string;
  title: string;
  items: string[];
}> = [
  {
    version: '1.5.0',
    date: 'Rilis Saat Ini',
    title: 'Cloud Update Firestore & Standar Versi Minor (+0.0.1) / Major (+0.1.0)',
    items: [
      'Menetapkan versi aplikasi aktif menjadi v1.5.0 dengan skema kenaikan versi Minor (+0.0.1) dan Major (+0.1.0).',
      'Mendedikasikan Firebase Firestore khusus sebagai penyimpanan cloud rilis pengembangan dan pengecekan update aplikasi.',
      'Menyediakan 22+ font berkategori, 15 gaya subtitle Remotion, 4 suara narasi AI baru (5–10 menit), serta folder projek & unduh ZIP.',
    ],
  },
  {
    version: '1.4.0',
    date: 'Rilis Sebelumnya',
    title: 'Koleksi 22+ Font & 15 Gaya Subtitle Video AI / Studio',
    items: [
      'Menambahkan 22+ font (Viral, Modern, Editorial Serif, Komik, Mono) serta 5 gaya subtitle baru lengkap dengan kontrol Ketebalan & Italic.',
      'Menambahkan suara Ricky, Sikedewo, Todd, dan Nichalia Schwartz beserta pemutar contoh suara langsung pada Video AI (5–10 menit).',
    ],
  },
  {
    version: '1.3.0',
    date: 'Rilis Sebelumnya',
    title: 'Folder Projek Ekspor, Unduh ZIP & Pelacakan 1€ Filter',
    items: [
      'Mengelompokkan hasil ekspor menjadi 1 folder per projek dengan tombol unduh sekaligus dalam format .zip.',
      'Menambahkan deteksi momen viral AI, trim bar interaktif dengan magnetik jeda, serta pelacakan kamera adaptif 1€ Filter.',
    ],
  },
  {
    version: '1.2.0',
    date: 'Rilis Sebelumnya',
    title: 'Kontrol Transkripsi Subtitle & Audio Pratinjau',
    items: [
      'Menambahkan tombol Batalkan & Buat Ulang transkripsi AI serta penghitung sisa waktu di bingkai pratinjau.',
      'Mengaktifkan suara asli video saat pratinjau di Studio Editor 9:16 lengkap dengan slider volume.',
    ],
  },
];

const REPO_STORAGE_KEY = 'autoclipper.update.githubRepo';

function formatTimestamp(iso: string | number | null | undefined, bcp47 = 'id-ID'): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(bcp47, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

export function UpdatesView({
  hasActiveMedia,
  exportedCount,
  firestoreStatus,
  firestoreProjectId,
  firestoreDatabaseId,
  fbUser,
  authReady,
  authError,
  onSignInGoogle,
  onSignOutGoogle,
  onBackHome,
}: UpdatesViewProps) {
  const { t, bcp47 } = useTranslation();
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [githubRepo, setGithubRepo] = useState(() => {
    try {
      return localStorage.getItem(REPO_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(null);

  const isRunningDesktop = typeof window !== 'undefined' && Boolean(window.paijoDesktop?.isDesktop);
  const webDownloadAbortRef = useRef<AbortController | null>(null);
  const [downloadingArtId, setDownloadingArtId] = useState<string | null>(null);
  const [dlReceivedBytes, setDlReceivedBytes] = useState(0);
  const [dlTotalBytes, setDlTotalBytes] = useState(0);
  const [dlStage, setDlStage] = useState<'idle' | 'downloading' | 'verifying' | 'done' | 'error'>('idle');
  const [dlFilename, setDlFilename] = useState('');
  const [dlFilePath, setDlFilePath] = useState('');
  const [dlError, setDlError] = useState('');

  // Firestore Cloud Updates State
  const [publishedReleases, setPublishedReleases] = useState<AppReleaseDoc[]>([]);
  const [adminReleases, setAdminReleases] = useState<AppReleaseDoc[]>([]);
  const [cloudNotice, setCloudNotice] = useState('');
  const [cloudError, setCloudError] = useState('');
  const [savingRelease, setSavingRelease] = useState(false);

  // Developer Release Composer State
  const [editingReleaseId, setEditingReleaseId] = useState<string | undefined>(undefined);
  const [updateType, setUpdateType] = useState<UpdateType>('minor');
  const [releaseVersion, setReleaseVersion] = useState(() =>
    computeNextVersion(CLIENT_APP_VERSION, 'minor')
  );
  const [releaseStatus, setReleaseStatus] = useState<ReleaseStatus>('developing');
  const [releaseTitle, setReleaseTitle] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [changesText, setChangesText] = useState('');
  const [packageUrl, setPackageUrl] = useState('');
  const [buildTarget, setBuildTarget] = useState('web');

  const isDeveloperAdmin = Boolean(
    fbUser &&
      fbUser.emailVerified &&
      fbUser.email?.toLowerCase() === DEVELOPER_ADMIN_EMAIL.toLowerCase()
  );

  // Developer-only panel visibility (hidden from regular users by default)
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
  const [devTapCount, setDevTapCount] = useState(0);

  const showDeveloperTools = devUnlocked || isDeveloperAdmin;

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

  useEffect(() => {
    if (devTapCount <= 0) return;
    const timer = window.setTimeout(() => setDevTapCount(0), 1600);
    return () => window.clearTimeout(timer);
  }, [devTapCount]);

  const handleVersionTap = () => {
    const next = devTapCount + 1;
    if (next >= 5) {
      setDevTapCount(0);
      setDevUnlocked((prev) => {
        const toggled = !prev;
        try {
          if (toggled) sessionStorage.setItem('paijoclip.devMode', '1');
          else sessionStorage.removeItem('paijoclip.devMode');
        } catch {}
        return toggled;
      });
    } else {
      setDevTapCount(next);
    }
  };

  // Highest known version (client 1.5.0 vs latest Firestore release)
  const highestKnownVersion = useMemo(() => {
    const pool = [
      CLIENT_APP_VERSION,
      ...publishedReleases.map((r) => r.version),
      ...adminReleases.map((r) => r.version),
    ].filter(isValidSemver);
    return pool.sort((a, b) => compareVersions(b, a))[0] || CLIENT_APP_VERSION;
  }, [publishedReleases, adminReleases]);

  // Auto-suggest next version when switching minor (+0.0.1) / major (+0.1.0) while not editing
  useEffect(() => {
    if (!editingReleaseId) {
      setReleaseVersion(computeNextVersion(highestKnownVersion, updateType));
    }
  }, [updateType, highestKnownVersion, editingReleaseId]);

  const loadServerVersion = useCallback(async () => {
    try {
      const res = await fetch('/api/app/version', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as VersionInfo;
      setVersionInfo(data);
    } catch {
      // Non-fatal
    }
  }, []);

  useEffect(() => {
    loadServerVersion();
  }, [loadServerVersion]);

  // Listen to native Electron update download progress events
  useEffect(() => {
    const unsub = window.paijoDesktop?.onUpdateDownloadProgress?.((prog) => {
      if (prog.filename) setDlFilename(prog.filename);
      if (prog.stage === 'downloading') {
        setDlStage('downloading');
        setDlReceivedBytes(prog.receivedBytes || 0);
        setDlTotalBytes(prog.totalBytes || 0);
      } else if (prog.stage === 'verifying') {
        setDlStage('verifying');
        setDlReceivedBytes(prog.receivedBytes || 0);
        setDlTotalBytes(prog.totalBytes || 0);
      } else if (prog.stage === 'done') {
        setDlStage('done');
        setDownloadingArtId(null);
        if (prog.filePath) setDlFilePath(prog.filePath);
      } else if (prog.stage === 'cancelled') {
        setDlStage('idle');
        setDownloadingArtId(null);
      } else if (prog.stage === 'error') {
        setDlStage('error');
        setDownloadingArtId(null);
        setDlError(prog.error || 'Gagal mengunduh update.');
      }
    });
    return () => {
      if (unsub) unsub();
      webDownloadAbortRef.current?.abort();
    };
  }, []);

  // Subscribe to published updates in Firestore
  useEffect(() => {
    let unsub: (() => void) | undefined;
    try {
      unsub = subscribePublishedReleases((items) => {
        setPublishedReleases(items);
      });
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : String(err));
    }
    return () => {
      if (unsub) unsub();
    };
  }, []);

  // Subscribe to all releases (developing + published) when signed in as developer admin
  useEffect(() => {
    if (!isDeveloperAdmin) {
      setAdminReleases([]);
      return;
    }
    let unsub: (() => void) | undefined;
    try {
      unsub = subscribeAllReleasesForAdmin((items) => {
        setAdminReleases(items);
      });
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : String(err));
    }
    return () => {
      if (unsub) unsub();
    };
  }, [isDeveloperAdmin]);

  const latestCloudPublished = publishedReleases[0] || null;
  const cloudUpdateAvailable = Boolean(
    latestCloudPublished && compareVersions(latestCloudPublished.version, CLIENT_APP_VERSION) > 0
  );

  const handleCheckUpdates = useCallback(
    async (useGithub = false) => {
      setChecking(true);
      setErrorMsg('');
      try {
        const cleanRepo = useGithub ? githubRepo.trim() : '';
        if (useGithub && !cleanRepo) {
          setErrorMsg('Masukkan nama repositori GitHub dengan format pemilik/nama-repo.');
          return;
        }
        if (useGithub) {
          try {
            localStorage.setItem(REPO_STORAGE_KEY, cleanRepo);
          } catch {}
        }

        const autoRepo = String(
          import.meta.env.VITE_AUTO_GITHUB_REPO || import.meta.env.VITE_DESKTOP_GITHUB_REPO || ''
        ).trim();

        const res = await fetch('/api/app/check-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({
            clientVersion: CLIENT_APP_VERSION,
            githubRepo: cleanRepo || autoRepo || undefined,
            packageUrl: !useGithub ? latestCloudPublished?.packageUrl || undefined : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Gagal memeriksa pembaruan aplikasi.');
        }
        setCheckResult(data as UpdateCheckResult);
        await loadServerVersion();
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setChecking(false);
      }
    },
    [githubRepo, latestCloudPublished?.packageUrl, loadServerVersion]
  );

  // Auto-check for updates on mount and whenever cloud release packageUrl changes
  useEffect(() => {
    handleCheckUpdates(false);
  }, [handleCheckUpdates]);

  const handleCancelUpdateDownload = () => {
    if (isRunningDesktop && window.paijoDesktop?.cancelUpdateDownload) {
      window.paijoDesktop.cancelUpdateDownload();
    }
    webDownloadAbortRef.current?.abort();
    webDownloadAbortRef.current = null;
    setDownloadingArtId(null);
    setDlStage('idle');
    setDlReceivedBytes(0);
    setDlTotalBytes(0);
  };

  const handleDownloadUpdateArtifact = async (artifact: DesktopArtifactInfo) => {
    if (downloadingArtId) return;
    setDlError('');
    setDlFilePath('');
    setDlFilename(artifact.filename);
    setDlReceivedBytes(0);
    setDlTotalBytes(artifact.sizeBytes || 0);
    setDownloadingArtId(artifact.id);
    setDlStage('downloading');

    if (isRunningDesktop && window.paijoDesktop?.downloadUpdate) {
      const res = await window.paijoDesktop.downloadUpdate({
        url: artifact.downloadUrl,
        filename: artifact.filename,
        sha256: artifact.sha256,
      });
      if (!res.ok) {
        if (!/dibatalkan/i.test(res.error || '')) {
          setDlStage('error');
          setDlError(res.error || 'Gagal mengunduh file update.');
        } else {
          setDlStage('idle');
        }
        setDownloadingArtId(null);
      } else {
        setDlStage('done');
        if (res.filePath) setDlFilePath(res.filePath);
        setDownloadingArtId(null);
      }
      return;
    }

    if (artifact.source === 'github' || (!artifact.sizeBytes && /^https?:\/\//i.test(artifact.downloadUrl))) {
      const a = document.createElement('a');
      a.href = artifact.downloadUrl;
      a.download = artifact.filename;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setDownloadingArtId(null);
      setDlStage('idle');
      return;
    }

    const ctrl = new AbortController();
    webDownloadAbortRef.current = ctrl;
    try {
      await downloadVerifiedChunkedExe(artifact, {
        signal: ctrl.signal,
        onProgress: (received, total, stage) => {
          setDlReceivedBytes(received);
          setDlTotalBytes(total);
          setDlStage(stage);
        },
      });
      setDlStage('done');
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || ctrl.signal.aborted) {
        setDlStage('idle');
      } else {
        setDlStage('error');
        setDlError(err instanceof Error ? err.message : 'Gagal mengunduh pembaruan (.exe).');
      }
    } finally {
      if (webDownloadAbortRef.current === ctrl) {
        webDownloadAbortRef.current = null;
      }
      setDownloadingArtId(null);
    }
  };

  const applyAppUpdateReload = async () => {
    setUpdating(true);
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.update().catch(() => {})));
      }
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n).catch(() => false)));
      }
    } catch {
      // Continue to clean reload
    }
    const url = new URL(window.location.href);
    url.searchParams.set('v', String(Date.now()));
    window.location.replace(url.toString());
  };

  const handleRequestUpdate = () => {
    if (hasActiveMedia || exportedCount > 0) {
      setConfirmReload(true);
      return;
    }
    applyAppUpdateReload();
  };

  const resetComposer = (nextType: UpdateType = 'minor') => {
    setEditingReleaseId(undefined);
    setUpdateType(nextType);
    setReleaseVersion(computeNextVersion(highestKnownVersion, nextType));
    setReleaseStatus('developing');
    setReleaseTitle('');
    setReleaseNotes('');
    setChangesText('');
    setPackageUrl('');
    setBuildTarget('web');
  };

  const handleSaveCloudRelease = async () => {
    if (!fbUser || !isDeveloperAdmin || savingRelease) return;
    setCloudError('');
    setCloudNotice('');

    const cleanVer = releaseVersion.trim();
    if (!isValidSemver(cleanVer)) {
      setCloudError('Format versi harus X.Y.Z (contoh Minor: 1.5.1, Major: 1.6.0).');
      return;
    }
    if (!releaseTitle.trim()) {
      setCloudError('Masukkan judul pembaruan sebelum menyimpan ke Firestore.');
      return;
    }

    setSavingRelease(true);
    try {
      const changes = changesText
        .split(/\r?\n/)
        .map((line) => line.replace(/^[-•*]\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 20);

      await saveAppReleaseToFirestore(fbUser.uid, {
        releaseId: editingReleaseId,
        version: cleanVer,
        baseVersion: CLIENT_APP_VERSION,
        updateType,
        status: releaseStatus,
        title: releaseTitle.trim(),
        releaseNotes: releaseNotes.trim() || releaseTitle.trim(),
        changes,
        packageUrl: packageUrl.trim(),
        buildTarget,
      });

      setCloudNotice(
        releaseStatus === 'published'
          ? `Rilis v${cleanVer} berhasil disimpan & diterbitkan di Firestore!`
          : `Draft pengembangan v${cleanVer} berhasil disimpan di Firestore.`
      );
      resetComposer(updateType);
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : 'Gagal menyimpan pembaruan ke Firestore.');
    } finally {
      setSavingRelease(false);
    }
  };

  const serverVersion = versionInfo?.version || CLIENT_APP_VERSION;
  const serverHasNewer =
    Boolean(checkResult?.updateAvailable) ||
    cloudUpdateAvailable ||
    (versionInfo?.version && compareVersions(versionInfo.version, CLIENT_APP_VERSION) > 0);

  // Collect direct .exe update packages from server/GitHub check + Firestore published packageUrl
  const updateExeArtifacts = useMemo(() => {
    const out: DesktopArtifactInfo[] = [];
    const seenUrls = new Set<string>();
    const targetVer =
      (latestCloudPublished && compareVersions(latestCloudPublished.version, CLIENT_APP_VERSION) > 0
        ? latestCloudPublished.version
        : checkResult?.latestVersion) || CLIENT_APP_VERSION;

    const addArtifact = (art: DesktopArtifactInfo) => {
      if (!art.downloadUrl || seenUrls.has(art.downloadUrl)) return;
      seenUrls.add(art.downloadUrl);
      out.push(art);
    };

    const serverArtifacts = checkResult?.artifacts || [];
    for (const art of serverArtifacts) {
      const artVer = art.version || checkResult?.latestVersion || CLIENT_APP_VERSION;
      if (compareVersions(artVer, CLIENT_APP_VERSION) > 0 || checkResult?.updateAvailable) {
        addArtifact(art);
      }
    }

    const pkgUrl = latestCloudPublished?.packageUrl?.trim() || '';
    if (
      cloudUpdateAvailable &&
      pkgUrl &&
      /^https?:\/\//i.test(pkgUrl) &&
      (/\.exe(\?|$)/i.test(pkgUrl) || /\/api\/desktop\/download\//i.test(pkgUrl))
    ) {
      const cleanName = (() => {
        try {
          const u = new URL(pkgUrl);
          const base = decodeURIComponent(u.pathname.split('/').pop() || '');
          if (/\.exe$/i.test(base)) return base;
        } catch {}
        return `Paijo-Clip-${targetVer}-Update-x64.exe`;
      })();
      addArtifact({
        id: /portable/i.test(cleanName) ? 'portable-exe' : 'setup-exe',
        kind: /portable/i.test(cleanName) ? 'portable' : 'installer',
        source: 'firestore',
        version: targetVer,
        filename: cleanName,
        sizeBytes: 0,
        downloadUrl: pkgUrl,
      });
    }

    return out;
  }, [checkResult, cloudUpdateAvailable, latestCloudPublished]);

  const dlProgressPct = dlTotalBytes > 0
    ? Math.min(100, Math.round((dlReceivedBytes / dlTotalBytes) * 100))
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white">
            {t('updates.title')}
          </h1>
          {showDeveloperTools && (
            <p className="text-xs text-[#93a7cc] mt-1">
              {t('updates.subtitle')}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onBackHome}
          className="px-3.5 py-2 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white cursor-pointer"
        >
          {t('updates.backHome')}
        </button>
      </div>

      {/* Current Version & Update Actions */}
      <section className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <img
              src="/assets/aistudio/paijoclip-icon_f8577a46.png"
              alt="Paijo Clip logo"
              referrerPolicy="no-referrer"
              className="w-11 h-14 object-contain shrink-0 rounded-lg"
            />
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#93a7cc]">
                {t('updates.activeVersion')}
              </div>
              <div className="flex items-baseline gap-3">
                <span
                  onClick={handleVersionTap}
                  className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-white select-none"
                >
                  v{CLIENT_APP_VERSION}
                </span>
                <span className="text-xs font-semibold text-[#ff8224]">
                  Paijo Clip{isRunningDesktop ? ' Desktop' : ''}
                </span>
              </div>
              {showDeveloperTools && (
                <div className="text-xs text-[#93a7cc] font-mono tabular-nums">
                  Server: v{serverVersion}
                  {versionInfo?.nodeVersion ? ` · Runtime ${versionInfo.nodeVersion}` : ''}
                  {versionInfo?.serverStartedAt
                    ? ` · ${formatTimestamp(versionInfo.serverStartedAt, bcp47)}`
                    : ''}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={checking || updating}
              onClick={() => handleCheckUpdates(false)}
              className="px-3.5 py-2 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
              {checking ? t('updates.checking') : t('updates.checkUpdates')}
            </button>

            {isRunningDesktop && updateExeArtifacts.length > 0 ? (
              <button
                type="button"
                disabled={Boolean(downloadingArtId)}
                onClick={() => handleDownloadUpdateArtifact(updateExeArtifacts[0])}
                className="px-4 py-2 rounded-lg bg-[#ff6b00] hover:bg-[#ff8224] disabled:opacity-40 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                {t('updates.downloadUpdateBtn', {
                  version: `v${updateExeArtifacts[0].version || latestCloudPublished?.version || checkResult?.latestVersion || CLIENT_APP_VERSION}`,
                  label: updateExeArtifacts[0].kind === 'installer' ? 'Setup' : 'Portable',
                })}
              </button>
            ) : !isRunningDesktop ? (
              <button
                type="button"
                disabled={updating}
                onClick={handleRequestUpdate}
                className="px-4 py-2 rounded-lg bg-[#ff6b00] hover:bg-[#ff8224] disabled:opacity-40 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowUpCircle className="w-3.5 h-3.5" />
                {updating ? t('updates.updating') : t('updates.updateLatest')}
              </button>
            ) : null}
          </div>
        </div>

        {/* Active In-App Update Download Progress / Ready State */}
        {(downloadingArtId || dlStage === 'done' || (dlStage === 'error' && dlError)) && (
          <div
            className={`rounded-lg border p-3.5 space-y-2.5 ${
              dlStage === 'error'
                ? 'bg-red-950/35 border-red-500/50'
                : dlStage === 'done'
                  ? 'bg-[#171d12] border-[#c7ff55]/50'
                  : 'bg-[#0c1733] border-[#ff6b00]/60'
            }`}
          >
            {dlStage === 'error' ? (
              <div className="flex items-start gap-2 text-xs text-red-200">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{dlError}</span>
              </div>
            ) : dlStage === 'done' ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#c7ff55]">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{t('updates.downloadDone', { filename: dlFilename || 'Paijo-Clip-Update.exe' })}</span>
                </div>
                {isRunningDesktop && dlFilePath && (
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => window.paijoDesktop?.showItemInFolder?.(dlFilePath)}
                      className="px-3 py-1.5 rounded-md bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      {t('updates.openFolderBtn')}
                    </button>
                    <button
                      type="button"
                      onClick={() => window.paijoDesktop?.openDownloadedUpdate?.(dlFilePath)}
                      className="px-3.5 py-1.5 rounded-md bg-[#ff6b00] hover:bg-[#ff8224] text-xs font-bold text-white inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      {t('updates.runInstallerBtn')}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#e4ecfa]">
                  <span className="font-semibold">
                    {dlStage === 'verifying' ? t('updates.verifyingUpdate') : t('updates.downloadingUpdate')}
                  </span>
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono tabular-nums font-bold text-[#c7ff55]">
                      {dlTotalBytes > 0
                        ? `${dlProgressPct}% · ${formatFileSize(dlReceivedBytes)} / ${formatFileSize(dlTotalBytes)}`
                        : formatFileSize(dlReceivedBytes)}
                    </span>
                    <button
                      type="button"
                      onClick={handleCancelUpdateDownload}
                      className="px-2 py-1 rounded bg-[#16264d] hover:bg-red-950/60 border border-[#2a4173] text-[11px] font-semibold text-white inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Square className="w-3 h-3 fill-current text-[#ff6b00]" />
                      {t('updates.cancel')}
                    </button>
                  </div>
                </div>
                <div className="h-2 bg-[#1a2d59] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#ff6b00] transition-all duration-150"
                    style={{ width: `${dlTotalBytes > 0 ? dlProgressPct : 45}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Cloud Published Update Alert */}
        {cloudUpdateAvailable && latestCloudPublished && (
          <div className="bg-[#171d12] border border-[#c7ff55]/45 rounded-lg p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <Rocket className="w-4 h-4 text-[#c7ff55]" />
                <span>
                  {t('updates.cloudAlert')}{' '}
                  <span className="font-mono text-[#c7ff55]">v{latestCloudPublished.version}</span>{' '}
                  ({latestCloudPublished.updateType === 'major' ? 'Major +0.1.0' : 'Minor +0.0.1'})
                </span>
              </div>
              <span className="text-[11px] font-mono text-[#93a7cc]">
                {formatTimestamp(latestCloudPublished.updatedAtMs, bcp47)}
              </span>
            </div>
            <div className="text-xs font-semibold text-white">{latestCloudPublished.title}</div>
            <p className="text-xs text-[#dce6f7] whitespace-pre-line">
              {latestCloudPublished.releaseNotes}
            </p>
            {latestCloudPublished.changes.length > 0 && (
              <ul className="list-disc list-inside text-xs text-[#b8c7e3] space-y-0.5">
                {latestCloudPublished.changes.map((c, idx) => (
                  <li key={idx}>{c}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {updateExeArtifacts.map((art) => (
                <button
                  key={`${art.id}-${art.downloadUrl}`}
                  type="button"
                  disabled={Boolean(downloadingArtId)}
                  onClick={() => handleDownloadUpdateArtifact(art)}
                  className="px-3.5 py-1.5 rounded-md bg-[#ff6b00] hover:bg-[#ff8224] disabled:opacity-45 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>
                    {t('updates.downloadUpdateBtn', {
                      version: `v${art.version || latestCloudPublished.version}`,
                      label: art.kind === 'installer' ? 'Setup' : 'Portable',
                    })}
                    {art.sizeBytes > 0 ? ` · ${formatFileSize(art.sizeBytes)}` : ''}
                  </span>
                </button>
              ))}
              {!isRunningDesktop && (
                <button
                  type="button"
                  onClick={handleRequestUpdate}
                  className="px-3 py-1.5 rounded-md bg-[#c7ff55] hover:bg-[#d6ff7d] text-[#111507] text-xs font-bold cursor-pointer"
                >
                  {t('updates.applyNow')}
                </button>
              )}
              {latestCloudPublished.packageUrl && updateExeArtifacts.length === 0 && (
                <a
                  href={latestCloudPublished.packageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-md bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white inline-flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {t('updates.openBuildLink')}
                </a>
              )}
            </div>
          </div>
        )}

        {/* Unsaved Session Warning before Reload */}
        {confirmReload && (
          <div className="bg-[#1a1714] border border-amber-500/50 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 text-xs text-amber-100">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">{t('updates.reloadTitle')}</div>
                <p className="text-amber-200/80 mt-0.5">{t('updates.reloadDesc')}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setConfirmReload(false)}
                className="px-3 py-1.5 rounded-md bg-[#16264d] border border-[#2a4173] text-xs font-semibold text-[#dce6f7] cursor-pointer"
              >
                {t('updates.cancel')}
              </button>
              <button
                type="button"
                onClick={applyAppUpdateReload}
                className="px-3.5 py-1.5 rounded-md bg-[#ff6b00] hover:bg-[#ff8224] text-xs font-bold text-white inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t('updates.continueUpdate')}
              </button>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="bg-red-950/35 border border-red-500/45 rounded-lg p-3 text-xs text-red-200">
            {errorMsg}
          </div>
        )}

        {checkResult && !errorMsg && (
          <div
            className={`rounded-lg border p-3.5 space-y-2 ${
              serverHasNewer
                ? 'bg-[#171d12] border-[#c7ff55]/45'
                : 'bg-[#0c1733] border-[#1e3159]'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <CheckCircle2
                  className={`w-4 h-4 shrink-0 ${
                    serverHasNewer ? 'text-[#c7ff55]' : 'text-emerald-400'
                  }`}
                />
                {checkResult.updateAvailable ? (
                  <span>
                    {t('updates.newVersionAvail')} <span className="font-mono">v{checkResult.latestVersion}</span>
                  </span>
                ) : (
                  <span>
                    {t('updates.upToDate')} (<span className="font-mono">v{CLIENT_APP_VERSION}</span>).
                  </span>
                )}
              </div>
              <span className="text-[11px] font-mono tabular-nums text-[#93a7cc]">
                {t('updates.checkedAt', { time: formatTimestamp(checkResult.checkedAt, bcp47) })}
              </span>
            </div>

            {checkResult.releaseNotes && (
              <pre className="text-[11.5px] text-[#dce6f7] whitespace-pre-wrap font-sans leading-relaxed bg-[#070e20] border border-[#1e3159] rounded-md p-2.5">
                {checkResult.releaseNotes}
              </pre>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {checkResult.updateAvailable && updateExeArtifacts.map((art) => (
                <button
                  key={`chk-${art.id}-${art.downloadUrl}`}
                  type="button"
                  disabled={Boolean(downloadingArtId)}
                  onClick={() => handleDownloadUpdateArtifact(art)}
                  className="px-3.5 py-1.5 rounded-md bg-[#ff6b00] hover:bg-[#ff8224] disabled:opacity-45 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>
                    {t('updates.downloadUpdateBtn', {
                      version: `v${art.version || checkResult.latestVersion}`,
                      label: art.kind === 'installer' ? 'Setup' : 'Portable',
                    })}
                    {art.sizeBytes > 0 ? ` · ${formatFileSize(art.sizeBytes)}` : ''}
                  </span>
                </button>
              ))}
              {!isRunningDesktop && checkResult.updateAvailable && checkResult.source === 'server' && (
                <button
                  type="button"
                  onClick={handleRequestUpdate}
                  className="px-3 py-1.5 rounded-md bg-[#c7ff55] hover:bg-[#d6ff7d] text-[#111507] text-xs font-bold cursor-pointer"
                >
                  {t('updates.applyServerNow')}
                </button>
              )}
              {checkResult.releaseUrl && (
                <a
                  href={checkResult.releaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-md bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white inline-flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {t('updates.openGithubRelease')}
                </a>
              )}
            </div>
          </div>
        )}

        {/* Developer-Only Environment Summary Grid */}
        {showDeveloperTools && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1">
            <div className="bg-[#0c1733] border border-[#1e3159] rounded-lg p-3">
              <div className="text-[11px] text-[#93a7cc]">{t('updates.firestoreStorage')}</div>
              <div className="text-xs font-bold text-white mt-0.5 truncate" title={firestoreDatabaseId}>
                {firestoreStatus.offline
                  ? 'Offline'
                  : firestoreStatus.reachable
                    ? t('updates.connected', { project: firestoreProjectId })
                    : t('updates.checking')}
              </div>
              <div className="text-[10.5px] text-[#c7ff55] font-mono truncate mt-0.5">
                {t('updates.publishedCount', { count: publishedReleases.length })}
                {isDeveloperAdmin ? ` · ${adminReleases.filter((r) => r.status === 'developing').length} draft` : ''}
              </div>
            </div>
            <div className="bg-[#0c1733] border border-[#1e3159] rounded-lg p-3">
              <div className="text-[11px] text-[#93a7cc]">{t('updates.versionRules')}</div>
              <div className="text-xs font-bold text-white mt-0.5 font-mono">
                Minor +0.0.1 · Major +0.1.0
              </div>
              <div className="text-[10.5px] text-[#93a7cc] font-mono mt-0.5">
                {t('updates.nextLabel')} v{computeNextVersion(highestKnownVersion, 'minor')} / v
                {computeNextVersion(highestKnownVersion, 'major')}
              </div>
            </div>
            <div className="bg-[#0c1733] border border-[#1e3159] rounded-lg p-3">
              <div className="text-[11px] text-[#93a7cc]">{t('updates.geminiService')}</div>
              <div className="text-xs font-bold text-white mt-0.5">
                {versionInfo ? (versionInfo.aiConfigured ? t('updates.activeReady') : t('updates.notConfigured')) : t('updates.checking')}
              </div>
            </div>
            <div className="bg-[#0c1733] border border-[#1e3159] rounded-lg p-3">
              <div className="text-[11px] text-[#93a7cc]">{t('updates.ytStream')}</div>
              <div className="text-xs font-bold text-white mt-0.5">
                {versionInfo
                  ? versionInfo.ytDlpReady
                    ? 'yt-dlp Ready'
                    : t('updates.webUploadMode')
                  : t('updates.checking')}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Developer-Only Firestore Cloud Development & Release Staging */}
      {showDeveloperTools && (
      <section className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Cloud className="w-4 h-4 text-[#c7ff55] shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-bold text-white">
                {t('updates.cloudStagingTitle')}
              </h2>
              <p className="text-xs text-[#93a7cc] mt-0.5">
                {t('updates.cloudStagingDesc')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {fbUser ? (
              <div className="flex items-center gap-2 bg-[#0c1733] border border-[#2a4173] rounded-lg px-2.5 py-1.5">
                <div className="text-right">
                  <div className="text-[11px] font-bold text-white leading-tight">
                    {fbUser.displayName || 'Google'}
                  </div>
                  <div className="text-[10px] text-[#93a7cc] leading-tight">{fbUser.email}</div>
                </div>
                <button
                  type="button"
                  onClick={onSignOutGoogle}
                  title={t('updates.signOutTitle')}
                  className="p-1.5 rounded-md bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-[#dce6f7] hover:text-white cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!authReady}
                onClick={onSignInGoogle}
                className="px-3.5 py-2 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5 text-[#c7ff55]" />
                {t('updates.signInGoogle')}
              </button>
            )}
          </div>
        </div>

        {authError && (
          <div className="bg-amber-950/30 border border-amber-500/40 rounded-lg p-3 text-xs text-amber-200">
            {authError}
          </div>
        )}

        {cloudError && (
          <div className="bg-red-950/35 border border-red-500/45 rounded-lg p-3 text-xs text-red-200">
            {cloudError}
          </div>
        )}

        {cloudNotice && (
          <div className="bg-[#171d12] border border-[#c7ff55]/45 rounded-lg p-3 text-xs text-[#c7ff55]">
            {cloudNotice}
          </div>
        )}

        {fbUser && !isDeveloperAdmin && (
          <div className="bg-[#0c1733] border border-[#2a4173] rounded-lg p-3 text-xs text-[#dce6f7]">
            {t('updates.readOnlyNotice', { email: fbUser.email || '', admin: DEVELOPER_ADMIN_EMAIL })}
          </div>
        )}

        {isDeveloperAdmin && (
          <div className="bg-[#0c1733] border border-[#1e3159] rounded-xl p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-white">
                {editingReleaseId
                  ? t('updates.composerEdit', { id: editingReleaseId })
                  : t('updates.composerTitle')}
              </div>
              {editingReleaseId && (
                <button
                  type="button"
                  onClick={() => resetComposer('minor')}
                  className="text-[11px] font-semibold text-[#93a7cc] hover:text-white cursor-pointer"
                >
                  {t('updates.cancelEdit')}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              <div>
                <label className="block text-[11px] text-[#b8c7e3] mb-1">{t('updates.updateType')}</label>
                <div className="grid grid-cols-2 gap-1 p-1 bg-[#070e20] border border-[#2a4173] rounded-lg">
                  <button
                    type="button"
                    onClick={() => setUpdateType('minor')}
                    className={`py-1.5 px-2 rounded text-[11px] font-bold cursor-pointer transition-colors ${
                      updateType === 'minor'
                        ? 'bg-[#16264d] text-[#c7ff55] border border-[#2a4173]'
                        : 'text-[#93a7cc] hover:text-white'
                    }`}
                  >
                    Minor (+0.0.1)
                  </button>
                  <button
                    type="button"
                    onClick={() => setUpdateType('major')}
                    className={`py-1.5 px-2 rounded text-[11px] font-bold cursor-pointer transition-colors ${
                      updateType === 'major'
                        ? 'bg-[#16264d] text-[#ff6b00] border border-[#2a4173]'
                        : 'text-[#93a7cc] hover:text-white'
                    }`}
                  >
                    Major (+0.1.0)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-[#b8c7e3] mb-1">{t('updates.targetVersion')}</label>
                <input
                  type="text"
                  value={releaseVersion}
                  onChange={(e) => setReleaseVersion(e.target.value)}
                  placeholder="1.5.1"
                  className="w-full bg-[#070e20] text-white font-mono border border-[#2a4173] rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:border-[#ff6b00]"
                />
              </div>

              <div>
                <label className="block text-[11px] text-[#b8c7e3] mb-1">{t('updates.devStatus')}</label>
                <select
                  value={releaseStatus}
                  onChange={(e) => setReleaseStatus(e.target.value as ReleaseStatus)}
                  className="w-full bg-[#070e20] text-white border border-[#2a4173] rounded-lg px-2.5 py-2 text-xs"
                >
                  <option value="developing">{t('updates.statusDeveloping')}</option>
                  <option value="published">{t('updates.statusPublished')}</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-[#b8c7e3] mb-1">{t('updates.platformTarget')}</label>
                <select
                  value={buildTarget}
                  onChange={(e) => setBuildTarget(e.target.value)}
                  className="w-full bg-[#070e20] text-white border border-[#2a4173] rounded-lg px-2.5 py-2 text-xs"
                >
                  <option value="web">Web App (Studio)</option>
                  <option value="desktop">Desktop App</option>
                  <option value="fullstack">Fullstack Build</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-[#b8c7e3] mb-1">{t('updates.releaseTitleLabel')}</label>
                <input
                  type="text"
                  value={releaseTitle}
                  onChange={(e) => setReleaseTitle(e.target.value)}
                  placeholder="Render 9:16 + Multi-Language..."
                  className="w-full bg-[#070e20] text-white border border-[#2a4173] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#ff6b00]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#b8c7e3] mb-1">
                  {t('updates.packageUrlLabel')}
                </label>
                <input
                  type="url"
                  value={packageUrl}
                  onChange={(e) => setPackageUrl(e.target.value)}
                  placeholder="https://github.com/..."
                  className="w-full bg-[#070e20] text-white border border-[#2a4173] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#ff6b00]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-[#b8c7e3] mb-1">
                  {t('updates.releaseNotesLabel')}
                </label>
                <textarea
                  rows={3}
                  value={releaseNotes}
                  onChange={(e) => setReleaseNotes(e.target.value)}
                  placeholder="..."
                  className="w-full bg-[#070e20] text-white border border-[#2a4173] rounded-lg p-2.5 text-xs focus:outline-none focus:border-[#ff6b00]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#b8c7e3] mb-1">
                  {t('updates.changesLabel')}
                </label>
                <textarea
                  rows={3}
                  value={changesText}
                  onChange={(e) => setChangesText(e.target.value)}
                  placeholder="- Feature A&#10;- Fix B"
                  className="w-full bg-[#070e20] text-white border border-[#2a4173] rounded-lg p-2.5 text-xs focus:outline-none focus:border-[#ff6b00]"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-[#93a7cc]">
                {t('updates.highestBasis')} <strong className="font-mono text-white">v{highestKnownVersion}</strong>
              </span>
              <button
                type="button"
                disabled={savingRelease}
                onClick={handleSaveCloudRelease}
                className="px-4 py-2 rounded-lg bg-[#ff6b00] hover:bg-[#ff8224] disabled:opacity-40 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <CloudUpload className="w-3.5 h-3.5" />
                {savingRelease
                  ? t('updates.saving')
                  : editingReleaseId
                    ? t('updates.updateFirestoreBtn')
                    : t('updates.saveFirestoreBtn')}
              </button>
            </div>
          </div>
        )}

        {/* List of Cloud Releases */}
        {(() => {
          const displayedReleases = isDeveloperAdmin ? adminReleases : publishedReleases;
          if (!displayedReleases.length) {
            return (
              <div className="border border-dashed border-[#2a4173] rounded-lg p-4 text-xs text-[#93a7cc] bg-[#0c1733]">
                {isDeveloperAdmin
                  ? t('updates.emptyReleasesAdmin')
                  : t('updates.emptyReleasesPublic')}
              </div>
            );
          }

          return (
            <div className="space-y-2.5">
              <div className="text-xs font-bold text-white">
                {isDeveloperAdmin
                  ? t('updates.listAdmin', { count: displayedReleases.length })
                  : t('updates.listPublic', { count: displayedReleases.length })}
              </div>
              <div className="space-y-2">
                {displayedReleases.map((rel) => (
                  <article
                    key={rel.id}
                    className="bg-[#0c1733] border border-[#1e3159] rounded-lg p-3.5 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className="font-mono text-xs font-extrabold text-[#c7ff55]">
                          v{rel.version}
                        </span>
                        <span className="text-[11px] font-mono text-[#93a7cc]">
                          ({rel.updateType === 'major' ? 'Major +0.1.0' : 'Minor +0.0.1'})
                        </span>
                        <span
                          className={`text-[10.5px] font-semibold px-2 py-0.5 rounded border ${
                            rel.status === 'published'
                              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                              : 'bg-amber-950/40 border-amber-500/40 text-amber-300'
                          }`}
                        >
                          {rel.status === 'published' ? t('updates.badgePublished') : t('updates.badgeDeveloping')}
                        </span>
                        <h3 className="text-xs font-bold text-white truncate">{rel.title}</h3>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10.5px] font-mono text-[#93a7cc] mr-1">
                          {formatTimestamp(rel.updatedAtMs, bcp47)}
                        </span>
                        {isDeveloperAdmin && (
                          <>
                            {rel.status === 'developing' && (
                              <button
                                type="button"
                                onClick={async () => {
                                  setCloudError('');
                                  try {
                                    await publishAppReleaseInFirestore(rel.id);
                                    setCloudNotice(`v${rel.version} published!`);
                                  } catch (err) {
                                    setCloudError(
                                      err instanceof Error ? err.message : 'Publish failed.'
                                    );
                                  }
                                }}
                                className="px-2 py-1 rounded bg-[#c7ff55] hover:bg-[#d6ff7d] text-[#111507] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Rocket className="w-3 h-3" />
                                {t('updates.publishBtn')}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setEditingReleaseId(rel.id);
                                setUpdateType(rel.updateType);
                                setReleaseVersion(rel.version);
                                setReleaseStatus(rel.status);
                                setReleaseTitle(rel.title);
                                setReleaseNotes(rel.releaseNotes);
                                setChangesText(rel.changes.join('\n'));
                                setPackageUrl(rel.packageUrl);
                                setBuildTarget(rel.buildTarget);
                              }}
                              title="Edit"
                              className="p-1.5 rounded bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-[#dce6f7] hover:text-white cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                setCloudError('');
                                try {
                                  await deleteAppReleaseFromFirestore(rel.id);
                                  setCloudNotice(`v${rel.version} deleted.`);
                                } catch (err) {
                                  setCloudError(
                                    err instanceof Error ? err.message : 'Delete failed.'
                                  );
                                }
                              }}
                              title="Delete"
                              className="p-1.5 rounded bg-[#16264d] hover:bg-red-950/50 border border-[#2a4173] text-[#b8c7e3] hover:text-red-300 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {rel.releaseNotes && (
                      <p className="text-xs text-[#b8c7e3] whitespace-pre-line">{rel.releaseNotes}</p>
                    )}

                    {rel.changes.length > 0 && (
                      <ul className="list-disc list-inside text-[11.5px] text-[#dce6f7] space-y-0.5">
                        {rel.changes.map((ch, idx) => (
                          <li key={idx}>{ch}</li>
                        ))}
                      </ul>
                    )}

                    {rel.packageUrl && (
                      <a
                        href={rel.packageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-[#c7ff55] hover:underline"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {rel.packageUrl}
                      </a>
                    )}
                  </article>
                ))}
              </div>
            </div>
          );
        })()}
      </section>
      )}

      {/* Optional External GitHub Release Check (Developer Only) */}
      {showDeveloperTools && (
        <section className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-5 space-y-3">
          <div>
            <h2 className="text-sm font-bold text-white">{t('updates.githubSectionTitle')}</h2>
            <p className="text-xs text-[#93a7cc] mt-0.5">{t('updates.githubSectionDesc')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              placeholder="owner/paijo-clip"
              className="flex-1 min-w-[220px] bg-[#070e20] text-[#f1f5fc] border border-[#2a4173] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#ff6b00]"
            />
            <button
              type="button"
              disabled={checking}
              onClick={() => handleCheckUpdates(true)}
              className="px-4 py-2 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white disabled:opacity-40 cursor-pointer"
            >
              {checking ? t('updates.checking') : t('updates.checkGithubBtn')}
            </button>
          </div>
        </section>
      )}

      {/* Changelog */}
      <section className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-5 space-y-3.5">
        <h2 className="text-sm font-bold text-white">{t('updates.changelogTitle')}</h2>
        <div className="space-y-3">
          {CHANGELOG.map((rel) => (
            <article
              key={rel.version}
              className="bg-[#0c1733] border border-[#1e3159] rounded-lg p-3.5 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono tabular-nums text-xs font-extrabold text-[#c7ff55]">
                    v{rel.version}
                  </span>
                  <h3 className="text-xs font-bold text-white">{rel.title}</h3>
                </div>
                <span className="text-[11px] text-[#93a7cc]">{rel.date}</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-xs text-[#b8c7e3]">
                {rel.items.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
