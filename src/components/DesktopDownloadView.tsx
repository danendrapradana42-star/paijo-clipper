import { useEffect, useState } from 'react';
import {
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
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext';
import { subscribePublishedReleases, type AppReleaseDoc } from '../utils/firestoreSync';
import { CLIENT_APP_VERSION } from './UpdatesView';

interface DesktopArtifact {
  id: 'setup-exe' | 'portable-exe';
  kind: 'installer' | 'portable';
  filename: string;
  sizeBytes: number;
  downloadUrl: string;
  updatedAtMs: number;
}

interface DesktopInfoResponse {
  appName: string;
  version: string;
  platform: string;
  runtime: string;
  artifacts: DesktopArtifact[];
}

interface DesktopDownloadViewProps {
  onBackHome: () => void;
  onOpenUpdates: () => void;
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export function DesktopDownloadView({ onBackHome, onOpenUpdates }: DesktopDownloadViewProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfoResponse | null>(null);
  const [cloudReleases, setCloudReleases] = useState<AppReleaseDoc[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const isRunningDesktop = typeof window !== 'undefined' && Boolean(window.paijoDesktop?.isDesktop);

  // Developer-only CLI / build instructions hidden from regular users
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

  useEffect(() => {
    let active = true;
    fetch('/api/desktop/info', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: DesktopInfoResponse | null) => {
        if (active && data) setDesktopInfo(data);
      })
      .catch(() => {
        // ignore network errors
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const unsub = subscribePublishedReleases((list) => {
      if (active) setCloudReleases(list);
    });

    return () => {
      active = false;
      unsub();
    };
  }, []);

  const artifacts = desktopInfo?.artifacts || [];
  const setupArtifact = artifacts.find((a) => a.kind === 'installer') || null;
  const portableArtifact = artifacts.find((a) => a.kind === 'portable') || null;

  const cloudDesktopRelease = cloudReleases.find(
    (rel) =>
      rel.status === 'published' &&
      (rel.buildTarget === 'desktop' || rel.buildTarget === 'all') &&
      Boolean(rel.packageUrl && /^https?:\/\//i.test(rel.packageUrl))
  );

  const primaryArtifact = setupArtifact || portableArtifact || null;
  const hasAnyDownload = Boolean(setupArtifact || portableArtifact || cloudDesktopRelease);
  const displayVersion = desktopInfo?.version || CLIENT_APP_VERSION;

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
            <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
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
        <button
          type="button"
          onClick={onBackHome}
          className="px-3.5 py-2 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
        >
          {t('download.backHome')}
        </button>
      </div>

      {/* Already Running Desktop Banner */}
      {isRunningDesktop && (
        <div className="bg-[#101d3d] border border-[#c7ff55]/45 rounded-xl px-4 py-3 flex items-center gap-2.5 text-xs font-semibold text-[#e4ecfa]">
          <CheckCircle2 className="w-4 h-4 text-[#c7ff55] shrink-0" />
          <span>{t('download.runningDesktop')}</span>
        </div>
      )}

      {/* Primary Download Section */}
      {loading ? (
        <div className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-6 text-xs text-[#93a7cc]">
          {t('download.checking')}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Featured Primary Direct Download Hero when a Windows .exe build is hosted */}
          {primaryArtifact && (
            <section className="bg-gradient-to-br from-[#101d3d] to-[#0c1733] border border-[#ff6b00]/60 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4 shadow-lg">
              <div className="space-y-1.5 min-w-0 flex-1">
                <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#ff8224]">
                  <MonitorDown className="w-4 h-4 shrink-0" />
                  <span>Windows 64-bit (.exe) · v{displayVersion}</span>
                </div>
                <div className="text-base sm:text-lg font-extrabold text-white truncate">
                  {primaryArtifact.filename}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#b8c7e3]">
                  <span className="font-mono tabular-nums font-semibold text-[#c7ff55]">
                    {formatFileSize(primaryArtifact.sizeBytes)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <a
                    href={primaryArtifact.downloadUrl}
                    download={primaryArtifact.filename}
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-[#dce6f7] hover:text-[#ff8224] underline underline-offset-2 truncate max-w-full"
                  >
                    <Link2 className="w-3.5 h-3.5 shrink-0 text-[#ff6b00]" />
                    <span className="truncate">{resolveAbsoluteUrl(primaryArtifact.downloadUrl)}</span>
                  </a>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleCopyLink(primaryArtifact.id, primaryArtifact.downloadUrl)}
                  className="px-3 py-3 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-[#e4ecfa] inline-flex items-center gap-1.5 cursor-pointer"
                  title="Salin tautan unduhan langsung"
                >
                  {copiedId === primaryArtifact.id ? (
                    <Check className="w-4 h-4 text-[#c7ff55]" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
                <a
                  href={primaryArtifact.downloadUrl}
                  download={primaryArtifact.filename}
                  className="px-5 py-3 rounded-lg bg-[#ff6b00] hover:bg-[#ff8224] text-white text-sm font-extrabold inline-flex items-center justify-center gap-2 shadow-md transition-colors whitespace-nowrap"
                >
                  <Download className="w-4 h-4 shrink-0" />
                  <span>{t('download.btnExe', { size: formatFileSize(primaryArtifact.sizeBytes) })}</span>
                </a>
              </div>
            </section>
          )}

          {/* Individual Windows Artifact Cards (.exe Installer / Portable) */}
          {(setupArtifact || portableArtifact) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {setupArtifact && (
                <article className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-5 flex flex-col justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-white font-bold text-base">
                      <MonitorDown className="w-4 h-4 text-[#ff6b00] shrink-0" />
                      <span>{t('download.installerTitle')}</span>
                    </div>
                    <p className="text-xs text-[#93a7cc] leading-relaxed">
                      {t('download.installerDesc')}
                    </p>
                    <div className="text-[11px] font-mono tabular-nums text-[#b8c7e3] truncate">
                      {setupArtifact.filename} · {formatFileSize(setupArtifact.sizeBytes)}
                    </div>
                    <a
                      href={setupArtifact.downloadUrl}
                      download={setupArtifact.filename}
                      className="block text-[11px] font-mono text-[#ff8224] hover:underline truncate"
                    >
                      {setupArtifact.downloadUrl}
                    </a>
                  </div>
                  <a
                    href={setupArtifact.downloadUrl}
                    download={setupArtifact.filename}
                    className="w-full px-4 py-3 rounded-lg bg-[#ff6b00] hover:bg-[#ff8224] text-white text-xs font-extrabold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                  >
                    <Download className="w-4 h-4 shrink-0" />
                    <span>{t('download.btnExe', { size: formatFileSize(setupArtifact.sizeBytes) })}</span>
                  </a>
                </article>
              )}

              {portableArtifact && (
                <article className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-5 flex flex-col justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-white font-bold text-base">
                      <Package className="w-4 h-4 text-[#ff8224] shrink-0" />
                      <span>{t('download.portableTitle')}</span>
                    </div>
                    <p className="text-xs text-[#93a7cc] leading-relaxed">
                      {t('download.portableDesc')}
                    </p>
                    <div className="text-[11px] font-mono tabular-nums text-[#b8c7e3] truncate">
                      {portableArtifact.filename} · {formatFileSize(portableArtifact.sizeBytes)}
                    </div>
                    <a
                      href={portableArtifact.downloadUrl}
                      download={portableArtifact.filename}
                      className="block text-[11px] font-mono text-[#ff8224] hover:underline truncate"
                    >
                      {portableArtifact.downloadUrl}
                    </a>
                  </div>
                  <a
                    href={portableArtifact.downloadUrl}
                    download={portableArtifact.filename}
                    className="w-full px-4 py-3 rounded-lg bg-[#ff6b00] hover:bg-[#ff8224] text-white text-xs font-extrabold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                  >
                    <Download className="w-4 h-4 shrink-0" />
                    <span>{t('download.btnExe', { size: formatFileSize(portableArtifact.sizeBytes) })}</span>
                  </a>
                </article>
              )}
            </div>
          )}

          {/* Published Cloud Desktop Release from Firestore */}
          {cloudDesktopRelease && (
            <section className="bg-[#101d3d] border border-[#2a4173] rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1 min-w-0 flex-1">
                <div className="text-sm font-bold text-white">
                  {t('download.cloudTitle', { version: `v${cloudDesktopRelease.version}` })}
                </div>
                <div className="text-xs text-[#93a7cc] truncate">
                  {cloudDesktopRelease.title}
                </div>
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

          {/* Fallback when no binary is present on serverless web host */}
          {!hasAnyDownload && (
            <section className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-5 space-y-3.5">
              <div className="space-y-1">
                <h2 className="text-sm font-bold text-white">{t('download.unavailableTitle')}</h2>
                <p className="text-xs text-[#93a7cc] leading-relaxed">
                  {t('download.unavailableDesc')}
                </p>
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
                </div>
              )}
              <div>
                <button
                  type="button"
                  onClick={onOpenUpdates}
                  className="px-3.5 py-2 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {t('download.openUpdates')}
                </button>
              </div>
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
