import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';

export const CLIENT_APP_VERSION = '2.4.0';

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
  fbSignedIn: boolean;
  fbUserEmail: string | null;
  onBackHome: () => void;
}

const CHANGELOG: Array<{
  version: string;
  date: string;
  title: string;
  items: string[];
}> = [
  {
    version: '2.4.0',
    date: 'Rilis Saat Ini',
    title: 'Koleksi 22+ Font, 15 Gaya Subtitle & Menu Pembaruan',
    items: [
      'Menambahkan 22+ font berkategori (Viral, Modern, Editorial Serif, Komik, Mono) dengan pemuatan dinamis di Studio 9:16 dan Video AI.',
      'Menambahkan 5 gaya subtitle baru (Remotion TikTok Stroke, Glass Pill, Retro Offset, Hollow Outline, Editorial Tape) + kontrol Ketebalan & Italic.',
      'Menambahkan menu Versi & Pembaruan Aplikasi untuk mengecek rilis terbaru dan menyegarkan aset aplikasi.',
    ],
  },
  {
    version: '2.3.0',
    date: 'Pembaruan Sebelumnya',
    title: '4 Suara Narasi AI Baru & Video AI Minimal 5–10 Menit',
    items: [
      'Menambahkan pilihan suara Ricky, Sikedewo, Todd, dan Nichalia Schwartz beserta pemutar contoh suara langsung.',
      'Menetapkan durasi pembuatan Video AI minimal 5 menit hingga 10 menit (15–28 adegan) dengan panduan langkah demi langkah.',
    ],
  },
  {
    version: '2.2.0',
    date: 'Pembaruan Sebelumnya',
    title: 'Folder Projek Ekspor, Unduh ZIP & Pelacakan 1€ Filter',
    items: [
      'Mengelompokkan hasil ekspor menjadi 1 folder per projek dengan tombol unduh sekaligus dalam format .zip.',
      'Menambahkan deteksi momen viral AI, trim bar interaktif dengan magnetik jeda, serta pelacakan kamera adaptif 1€ Filter.',
    ],
  },
  {
    version: '2.1.0',
    date: 'Pembaruan Sebelumnya',
    title: 'Kontrol Transkripsi Subtitle & Audio Pratinjau',
    items: [
      'Menambahkan tombol Batalkan & Buat Ulang transkripsi AI serta penghitung sisa waktu di bingkai pratinjau.',
      'Mengaktifkan suara asli video saat pratinjau di Studio Editor 9:16 lengkap dengan slider volume.',
    ],
  },
];

const REPO_STORAGE_KEY = 'autoclipper.update.githubRepo';

function formatTimestamp(iso?: string | null): string {
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
    return iso;
  }
}

export function UpdatesView({
  hasActiveMedia,
  exportedCount,
  firestoreStatus,
  firestoreProjectId,
  fbSignedIn,
  fbUserEmail,
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

  const serverVersion = versionInfo?.version || CLIENT_APP_VERSION;
  const serverHasNewer =
    checkResult?.updateAvailable ||
    (versionInfo?.version && versionInfo.version !== CLIENT_APP_VERSION);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white">
            Versi &amp; Pembaruan Aplikasi
          </h1>
          <p className="text-xs text-[#8f98a8] mt-1">
            Pantau versi aplikasi yang sedang berjalan, periksa rilis terbaru, dan perbarui ke versi terkini.
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
              Versi Aplikasi Terpasang
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
              Versi server aktif: v{serverVersion}
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
              {checking ? 'Memeriksa…' : 'Cek Pembaruan Server'}
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

        {/* Update Status Result Banner */}
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
                {serverHasNewer ? (
                  <span>
                    Versi terbaru tersedia: <span className="font-mono">v{checkResult.latestVersion}</span>
                  </span>
                ) : (
                  <span>
                    Aplikasi sudah menggunakan versi terbaru (<span className="font-mono">v{CLIENT_APP_VERSION}</span>).
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
              {serverHasNewer && checkResult.source === 'server' && (
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
            <div className="text-[11px] text-[#8f98a8]">Layanan Gemini AI</div>
            <div className="text-xs font-bold text-white mt-0.5">
              {versionInfo ? (versionInfo.aiConfigured ? 'Aktif & Siap' : 'Belum Dikonfigurasi') : 'Memeriksa…'}
            </div>
          </div>
          <div className="bg-[#0d1017] border border-[#1e2432] rounded-lg p-3">
            <div className="text-[11px] text-[#8f98a8]">Database Firestore</div>
            <div className="text-xs font-bold text-white mt-0.5 truncate" title={firestoreProjectId}>
              {firestoreStatus.offline
                ? 'Offline'
                : firestoreStatus.reachable
                  ? fbSignedIn
                    ? `Sinkron Aktif · ${firestoreProjectId}`
                    : `Terhubung · ${firestoreProjectId}`
                  : 'Memeriksa…'}
            </div>
            {fbUserEmail && (
              <div className="text-[10.5px] text-[#c7ff55] truncate mt-0.5">{fbUserEmail}</div>
            )}
          </div>
          <div className="bg-[#0d1017] border border-[#1e2432] rounded-lg p-3">
            <div className="text-[11px] text-[#8f98a8]">Mode Pemrosesan Video</div>
            <div className="text-xs font-bold text-white mt-0.5">Lokal 9:16 (Canvas &amp; WebAudio)</div>
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

      {/* Optional External GitHub Release Check */}
      <section className="bg-[#11141c] border border-[#1e2432] rounded-xl p-5 space-y-3">
        <div>
          <h2 className="text-sm font-bold text-white">Cek Rilis dari Repositori GitHub (Opsional)</h2>
          <p className="text-xs text-[#8f98a8] mt-0.5">
            Masukkan repositori rilis dengan format <code className="text-[#cbd2de]">pemilik/nama-repo</code> jika Anda merilis build sendiri melalui GitHub Releases.
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
