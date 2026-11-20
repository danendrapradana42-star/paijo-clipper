import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  Cloud,
  CloudUpload,
  ExternalLink,
  LogIn,
  LogOut,
  Pencil,
  RefreshCw,
  Rocket,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type { User } from 'firebase/auth';
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

function formatTimestamp(iso?: string | number | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('id-ID', {
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

  const handleCheckUpdates = async (useGithub = false) => {
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

      const res = await fetch('/api/app/check-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          clientVersion: CLIENT_APP_VERSION,
          githubRepo: cleanRepo || undefined,
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

  const latestCloudPublished = publishedReleases[0] || null;
  const cloudUpdateAvailable = Boolean(
    latestCloudPublished && compareVersions(latestCloudPublished.version, CLIENT_APP_VERSION) > 0
  );

  const serverVersion = versionInfo?.version || CLIENT_APP_VERSION;
  const serverHasNewer =
    Boolean(checkResult?.updateAvailable) ||
    cloudUpdateAvailable ||
    (versionInfo?.version && compareVersions(versionInfo.version, CLIENT_APP_VERSION) > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white">
            Versi &amp; Pembaruan Aplikasi
          </h1>
          <p className="text-xs text-[#8f98a8] mt-1">
            Firestore dikhususkan untuk menyimpan build pengembangan &amp; rilis update aplikasi (Minor +0.0.1 / Major +0.1.0).
          </p>
        </div>
        <button
          type="button"
          onClick={onBackHome}
          className="px-3.5 py-2 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-xs font-semibold text-white cursor-pointer"
        >
          ← Kembali ke Beranda
        </button>
      </div>

      {/* Current Version & Update Actions */}
      <section className="bg-[#11141c] border border-[#1e2432] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8f98a8]">
              Versi Aplikasi Aktif
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-white">
                v{CLIENT_APP_VERSION}
              </span>
              <span className="text-xs font-semibold text-[#c7ff55]">
                Auto Clipper Studio
              </span>
            </div>
            <div className="text-xs text-[#8f98a8] font-mono tabular-nums">
              Server: v{serverVersion}
              {versionInfo?.nodeVersion ? ` · Runtime ${versionInfo.nodeVersion}` : ''}
              {versionInfo?.serverStartedAt
                ? ` · Mulai ${formatTimestamp(versionInfo.serverStartedAt)}`
                : ''}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={checking || updating}
              onClick={() => handleCheckUpdates(false)}
              className="px-3.5 py-2 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-xs font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
              {checking ? 'Memeriksa…' : 'Cek Pembaruan'}
            </button>
            <button
              type="button"
              disabled={updating}
              onClick={handleRequestUpdate}
              className="px-4 py-2 rounded-lg bg-[#ff5436] hover:bg-[#ff6b52] disabled:opacity-40 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowUpCircle className="w-3.5 h-3.5" />
              {updating ? 'Memperbarui…' : 'Update ke Versi Terbaru'}
            </button>
          </div>
        </div>

        {/* Cloud Published Update Alert */}
        {cloudUpdateAvailable && latestCloudPublished && (
          <div className="bg-[#171d12] border border-[#c7ff55]/45 rounded-lg p-3.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <Rocket className="w-4 h-4 text-[#c7ff55]" />
                <span>
                  Update Cloud Tersedia dari Firestore:{' '}
                  <span className="font-mono text-[#c7ff55]">v{latestCloudPublished.version}</span>{' '}
                  ({latestCloudPublished.updateType === 'major' ? 'Major +0.1.0' : 'Minor +0.0.1'})
                </span>
              </div>
              <span className="text-[11px] font-mono text-[#8f98a8]">
                {formatTimestamp(latestCloudPublished.updatedAtMs)}
              </span>
            </div>
            <div className="text-xs font-semibold text-white">{latestCloudPublished.title}</div>
            <p className="text-xs text-[#cbd2de] whitespace-pre-line">
              {latestCloudPublished.releaseNotes}
            </p>
            {latestCloudPublished.changes.length > 0 && (
              <ul className="list-disc list-inside text-xs text-[#aeb6c4] space-y-0.5">
                {latestCloudPublished.changes.map((c, idx) => (
                  <li key={idx}>{c}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleRequestUpdate}
                className="px-3 py-1.5 rounded-md bg-[#c7ff55] hover:bg-[#d6ff7d] text-[#111507] text-xs font-bold cursor-pointer"
              >
                Terapkan Pembaruan Sekarang
              </button>
              {latestCloudPublished.packageUrl && (
                <a
                  href={latestCloudPublished.packageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-md bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-xs font-semibold text-white inline-flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Buka Tautan Build
                </a>
              )}
            </div>
          </div>
        )}

        {/* Unsaved Session Warning before Reload */}
        {confirmReload && (
          <div className="bg-[#181410] border border-amber-500/50 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 text-xs text-amber-100">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Muat ulang untuk menerapkan pembaruan?</div>
                <p className="text-amber-200/80 mt-0.5">
                  Video aktif atau daftar hasil ekspor di memori sesi ini akan dibersihkan saat halaman dimuat ulang. Pastikan klip penting sudah diunduh terlebih dahulu.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setConfirmReload(false)}
                className="px-3 py-1.5 rounded-md bg-[#181c27] border border-[#2d3548] text-xs font-semibold text-[#cbd2de] cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={applyAppUpdateReload}
                className="px-3.5 py-1.5 rounded-md bg-[#ff5436] hover:bg-[#ff6b52] text-xs font-bold text-white inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Lanjutkan Update
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
                : 'bg-[#0d1017] border-[#1e2432]'
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
                    Versi terbaru tersedia: <span className="font-mono">v{checkResult.latestVersion}</span>
                  </span>
                ) : (
                  <span>
                    Aplikasi sudah menggunakan versi aktif (<span className="font-mono">v{CLIENT_APP_VERSION}</span>).
                  </span>
                )}
              </div>
              <span className="text-[11px] font-mono tabular-nums text-[#8f98a8]">
                Diperiksa {formatTimestamp(checkResult.checkedAt)}
              </span>
            </div>

            {checkResult.releaseNotes && (
              <pre className="text-[11.5px] text-[#cbd2de] whitespace-pre-wrap font-sans leading-relaxed bg-[#080a0f] border border-[#1e2432] rounded-md p-2.5">
                {checkResult.releaseNotes}
              </pre>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {checkResult.updateAvailable && checkResult.source === 'server' && (
                <button
                  type="button"
                  onClick={handleRequestUpdate}
                  className="px-3 py-1.5 rounded-md bg-[#c7ff55] hover:bg-[#d6ff7d] text-[#111507] text-xs font-bold cursor-pointer"
                >
                  Terapkan Versi Server Sekarang
                </button>
              )}
              {checkResult.releaseUrl && (
                <a
                  href={checkResult.releaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-md bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-xs font-semibold text-white inline-flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Buka Halaman Rilis GitHub
                </a>
              )}
            </div>
          </div>
        )}

        {/* Environment Summary Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1">
          <div className="bg-[#0d1017] border border-[#1e2432] rounded-lg p-3">
            <div className="text-[11px] text-[#8f98a8]">Penyimpanan Update Firestore</div>
            <div className="text-xs font-bold text-white mt-0.5 truncate" title={firestoreDatabaseId}>
              {firestoreStatus.offline
                ? 'Offline'
                : firestoreStatus.reachable
                  ? `Terhubung · ${firestoreProjectId}`
                  : 'Memeriksa…'}
            </div>
            <div className="text-[10.5px] text-[#c7ff55] font-mono truncate mt-0.5">
              {publishedReleases.length} rilis terbit
              {isDeveloperAdmin ? ` · ${adminReleases.filter((r) => r.status === 'developing').length} draft dev` : ''}
            </div>
          </div>
          <div className="bg-[#0d1017] border border-[#1e2432] rounded-lg p-3">
            <div className="text-[11px] text-[#8f98a8]">Aturan Penulisan Versi</div>
            <div className="text-xs font-bold text-white mt-0.5 font-mono">
              Minor +0.0.1 · Major +0.1.0
            </div>
            <div className="text-[10.5px] text-[#8f98a8] font-mono mt-0.5">
              Berikutnya: v{computeNextVersion(highestKnownVersion, 'minor')} / v
              {computeNextVersion(highestKnownVersion, 'major')}
            </div>
          </div>
          <div className="bg-[#0d1017] border border-[#1e2432] rounded-lg p-3">
            <div className="text-[11px] text-[#8f98a8]">Layanan Gemini AI</div>
            <div className="text-xs font-bold text-white mt-0.5">
              {versionInfo ? (versionInfo.aiConfigured ? 'Aktif & Siap' : 'Belum Dikonfigurasi') : 'Memeriksa…'}
            </div>
          </div>
          <div className="bg-[#0d1017] border border-[#1e2432] rounded-lg p-3">
            <div className="text-[11px] text-[#8f98a8]">Impor Stream YouTube</div>
            <div className="text-xs font-bold text-white mt-0.5">
              {versionInfo
                ? versionInfo.ytDlpReady
                  ? 'yt-dlp Aktif'
                  : 'Mode Upload Lokal (Web)'
                : 'Memeriksa…'}
            </div>
          </div>
        </div>
      </section>

      {/* Firestore Cloud Development & Release Staging */}
      <section className="bg-[#11141c] border border-[#1e2432] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Cloud className="w-4 h-4 text-[#c7ff55] shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-bold text-white">
                Penyimpanan Cloud Update Aplikasi (Firestore)
              </h2>
              <p className="text-xs text-[#8f98a8] mt-0.5">
                Simpan build &amp; catatan fitur yang sedang di-develop untuk update selanjutnya. Minor otomatis bertambah <code className="text-[#cbd2de]">+0.0.1</code>, Major bertambah <code className="text-[#cbd2de]">+0.1.0</code>.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {fbUser ? (
              <div className="flex items-center gap-2 bg-[#0d1017] border border-[#2d3548] rounded-lg px-2.5 py-1.5">
                <div className="text-right">
                  <div className="text-[11px] font-bold text-white leading-tight">
                    {fbUser.displayName || 'Akun Google'}
                  </div>
                  <div className="text-[10px] text-[#8f98a8] leading-tight">{fbUser.email}</div>
                </div>
                <button
                  type="button"
                  onClick={onSignOutGoogle}
                  title="Keluar akun Google"
                  className="p-1.5 rounded-md bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-[#cbd2de] hover:text-white cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!authReady}
                onClick={onSignInGoogle}
                className="px-3.5 py-2 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-xs font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5 text-[#c7ff55]" />
                Masuk Google Developer
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
          <div className="bg-[#0d1017] border border-[#2d3548] rounded-lg p-3 text-xs text-[#cbd2de]">
            Akun <strong>{fbUser.email}</strong> hanya memiliki akses baca untuk rilis yang sudah dipublikasikan. Pengelolaan paket update dalam pengembangan khusus untuk akun pengembang ({DEVELOPER_ADMIN_EMAIL}).
          </div>
        )}

        {isDeveloperAdmin && (
          <div className="bg-[#0d1017] border border-[#1e2432] rounded-xl p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-white">
                {editingReleaseId
                  ? `Edit Rilis Cloud (${editingReleaseId})`
                  : 'Catat & Simpan Update yang Sedang Dikembangkan'}
              </div>
              {editingReleaseId && (
                <button
                  type="button"
                  onClick={() => resetComposer('minor')}
                  className="text-[11px] font-semibold text-[#8f98a8] hover:text-white cursor-pointer"
                >
                  Batal Edit
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              <div>
                <label className="block text-[11px] text-[#b7c0cf] mb-1">Jenis Update</label>
                <div className="grid grid-cols-2 gap-1 p-1 bg-[#080a0f] border border-[#2d3548] rounded-lg">
                  <button
                    type="button"
                    onClick={() => setUpdateType('minor')}
                    className={`py-1.5 px-2 rounded text-[11px] font-bold cursor-pointer transition-colors ${
                      updateType === 'minor'
                        ? 'bg-[#181c27] text-[#c7ff55] border border-[#2d3548]'
                        : 'text-[#8f98a8] hover:text-white'
                    }`}
                  >
                    Minor (+0.0.1)
                  </button>
                  <button
                    type="button"
                    onClick={() => setUpdateType('major')}
                    className={`py-1.5 px-2 rounded text-[11px] font-bold cursor-pointer transition-colors ${
                      updateType === 'major'
                        ? 'bg-[#181c27] text-[#ff5436] border border-[#2d3548]'
                        : 'text-[#8f98a8] hover:text-white'
                    }`}
                  >
                    Major (+0.1.0)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-[#b7c0cf] mb-1">Versi Target</label>
                <input
                  type="text"
                  value={releaseVersion}
                  onChange={(e) => setReleaseVersion(e.target.value)}
                  placeholder="1.5.1"
                  className="w-full bg-[#080a0f] text-white font-mono border border-[#2d3548] rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:border-[#ff5436]"
                />
              </div>

              <div>
                <label className="block text-[11px] text-[#b7c0cf] mb-1">Status Pengembangan</label>
                <select
                  value={releaseStatus}
                  onChange={(e) => setReleaseStatus(e.target.value as ReleaseStatus)}
                  className="w-full bg-[#080a0f] text-white border border-[#2d3548] rounded-lg px-2.5 py-2 text-xs"
                >
                  <option value="developing">Sedang Dikembangkan (Draft)</option>
                  <option value="published">Publikasikan Update (Rilis)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-[#b7c0cf] mb-1">Target Platform</label>
                <select
                  value={buildTarget}
                  onChange={(e) => setBuildTarget(e.target.value)}
                  className="w-full bg-[#080a0f] text-white border border-[#2d3548] rounded-lg px-2.5 py-2 text-xs"
                >
                  <option value="web">Web App (Studio)</option>
                  <option value="desktop">Desktop App</option>
                  <option value="fullstack">Fullstack Build</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-[#b7c0cf] mb-1">Judul Pembaruan</label>
                <input
                  type="text"
                  value={releaseTitle}
                  onChange={(e) => setReleaseTitle(e.target.value)}
                  placeholder="Contoh: Optimasi Render 9:16 & Preset Subtitle Baru"
                  className="w-full bg-[#080a0f] text-white border border-[#2d3548] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#ff5436]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#b7c0cf] mb-1">
                  Tautan Paket Build / Repo (Opsional)
                </label>
                <input
                  type="url"
                  value={packageUrl}
                  onChange={(e) => setPackageUrl(e.target.value)}
                  placeholder="https://github.com/..."
                  className="w-full bg-[#080a0f] text-white border border-[#2d3548] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#ff5436]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-[#b7c0cf] mb-1">
                  Catatan Pengembangan (Release Notes)
                </label>
                <textarea
                  rows={3}
                  value={releaseNotes}
                  onChange={(e) => setReleaseNotes(e.target.value)}
                  placeholder="Ringkasan apa yang sedang dikembangkan pada versi ini…"
                  className="w-full bg-[#080a0f] text-white border border-[#2d3548] rounded-lg p-2.5 text-xs focus:outline-none focus:border-[#ff5436]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#b7c0cf] mb-1">
                  Poin Perubahan (1 baris per poin, maks 20)
                </label>
                <textarea
                  rows={3}
                  value={changesText}
                  onChange={(e) => setChangesText(e.target.value)}
                  placeholder={'Perbaikan sinkronisasi audio\nPenambahan filter warna video\nOptimasi ekspor ZIP'}
                  className="w-full bg-[#080a0f] text-white border border-[#2d3548] rounded-lg p-2.5 text-xs focus:outline-none focus:border-[#ff5436]"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-[#8f98a8]">
                Basis versi tertinggi saat ini: <strong className="font-mono text-white">v{highestKnownVersion}</strong>
              </span>
              <button
                type="button"
                disabled={savingRelease}
                onClick={handleSaveCloudRelease}
                className="px-4 py-2 rounded-lg bg-[#ff5436] hover:bg-[#ff6b52] disabled:opacity-40 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <CloudUpload className="w-3.5 h-3.5" />
                {savingRelease
                  ? 'Menyimpan…'
                  : editingReleaseId
                    ? 'Perbarui di Firestore'
                    : 'Simpan Update ke Firestore'}
              </button>
            </div>
          </div>
        )}

        {/* List of Cloud Releases */}
        {(() => {
          const displayedReleases = isDeveloperAdmin ? adminReleases : publishedReleases;
          if (!displayedReleases.length) {
            return (
              <div className="border border-dashed border-[#2d3548] rounded-lg p-4 text-xs text-[#8f98a8] bg-[#0d1017]">
                {isDeveloperAdmin
                  ? 'Belum ada build pengembangan atau rilis di Firestore. Gunakan formulir di atas untuk menyimpan draft update v1.5.1 (Minor +0.0.1) atau v1.6.0 (Major +0.1.0).'
                  : 'Belum ada rilis pembaruan baru yang dipublikasikan di Firestore saat ini.'}
              </div>
            );
          }

          return (
            <div className="space-y-2.5">
              <div className="text-xs font-bold text-white">
                {isDeveloperAdmin
                  ? `Daftar Cloud Pengembangan & Rilis (${displayedReleases.length})`
                  : `Rilis Terpublikasi di Cloud (${displayedReleases.length})`}
              </div>
              <div className="space-y-2">
                {displayedReleases.map((rel) => (
                  <article
                    key={rel.id}
                    className="bg-[#0d1017] border border-[#1e2432] rounded-lg p-3.5 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className="font-mono text-xs font-extrabold text-[#c7ff55]">
                          v{rel.version}
                        </span>
                        <span className="text-[11px] font-mono text-[#8f98a8]">
                          ({rel.updateType === 'major' ? 'Major +0.1.0' : 'Minor +0.0.1'})
                        </span>
                        <span
                          className={`text-[10.5px] font-semibold px-2 py-0.5 rounded border ${
                            rel.status === 'published'
                              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                              : 'bg-amber-950/40 border-amber-500/40 text-amber-300'
                          }`}
                        >
                          {rel.status === 'published' ? 'Dirilis' : 'Sedang Dikembangkan'}
                        </span>
                        <h3 className="text-xs font-bold text-white truncate">{rel.title}</h3>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10.5px] font-mono text-[#8f98a8] mr-1">
                          {formatTimestamp(rel.updatedAtMs)}
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
                                    setCloudNotice(`v${rel.version} berhasil dipublikasikan!`);
                                  } catch (err) {
                                    setCloudError(
                                      err instanceof Error ? err.message : 'Gagal mempublikasikan rilis.'
                                    );
                                  }
                                }}
                                className="px-2 py-1 rounded bg-[#c7ff55] hover:bg-[#d6ff7d] text-[#111507] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Rocket className="w-3 h-3" />
                                Terbitkan
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
                              title="Edit rilis"
                              className="p-1.5 rounded bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-[#cbd2de] hover:text-white cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                setCloudError('');
                                try {
                                  await deleteAppReleaseFromFirestore(rel.id);
                                  setCloudNotice(`Rilis v${rel.version} dihapus dari Firestore.`);
                                } catch (err) {
                                  setCloudError(
                                    err instanceof Error ? err.message : 'Gagal menghapus rilis.'
                                  );
                                }
                              }}
                              title="Hapus dari Firestore"
                              className="p-1.5 rounded bg-[#181c27] hover:bg-red-950/50 border border-[#2d3548] text-[#aeb6c4] hover:text-red-300 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {rel.releaseNotes && (
                      <p className="text-xs text-[#aeb6c4] whitespace-pre-line">{rel.releaseNotes}</p>
                    )}

                    {rel.changes.length > 0 && (
                      <ul className="list-disc list-inside text-[11.5px] text-[#cbd2de] space-y-0.5">
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

      {/* Optional External GitHub Release Check */}
      <section className="bg-[#11141c] border border-[#1e2432] rounded-xl p-5 space-y-3">
        <div>
          <h2 className="text-sm font-bold text-white">Cek Rilis dari Repositori GitHub (Opsional)</h2>
          <p className="text-xs text-[#8f98a8] mt-0.5">
            Masukkan repositori rilis dengan format <code className="text-[#cbd2de]">pemilik/nama-repo</code> jika Anda merilis build melalui GitHub Releases.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={githubRepo}
            onChange={(e) => setGithubRepo(e.target.value)}
            placeholder="Contoh: username/auto-clipper-studio"
            className="flex-1 min-w-[220px] bg-[#080a0f] text-[#f3f5f8] border border-[#2d3548] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#ff5436]"
          />
          <button
            type="button"
            disabled={checking}
            onClick={() => handleCheckUpdates(true)}
            className="px-4 py-2 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-xs font-semibold text-white disabled:opacity-40 cursor-pointer"
          >
            {checking ? 'Memeriksa…' : 'Cek Rilis GitHub'}
          </button>
        </div>
      </section>

      {/* Changelog */}
      <section className="bg-[#11141c] border border-[#1e2432] rounded-xl p-5 space-y-3.5">
        <h2 className="text-sm font-bold text-white">Riwayat Pembaruan (Changelog)</h2>
        <div className="space-y-3">
          {CHANGELOG.map((rel) => (
            <article
              key={rel.version}
              className="bg-[#0d1017] border border-[#1e2432] rounded-lg p-3.5 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono tabular-nums text-xs font-extrabold text-[#c7ff55]">
                    v{rel.version}
                  </span>
                  <h3 className="text-xs font-bold text-white">{rel.title}</h3>
                </div>
                <span className="text-[11px] text-[#8f98a8]">{rel.date}</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-xs text-[#aeb6c4]">
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
