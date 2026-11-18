import { useMemo, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Film,
  Folder,
  FolderOpen,
  Search,
  Trash2,
} from 'lucide-react';
import type { ExportedClipRecord } from '../types/clipper';
import { downloadAllProjectsZip, downloadProjectZip } from '../utils/zipExporter';

interface ExportsViewProps {
  records: ExportedClipRecord[];
  onBackToStudio: () => void;
  onRemoveRecord: (id: string) => void;
  onRemoveProject: (projectId: string) => void;
  onClearAll: () => void;
}

interface ProjectFolderGroup {
  projectId: string;
  projectName: string;
  items: ExportedClipRecord[];
  totalSizeBytes: number;
  latestAt: number;
}

export function ExportsView({
  records,
  onBackToStudio,
  onRemoveRecord,
  onRemoveProject,
  onClearAll,
}: ExportsViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [zipBusyKey, setZipBusyKey] = useState<string | null>(null);
  const [zipProgressPct, setZipProgressPct] = useState(0);
  const [zipStatusText, setZipStatusText] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const projectFolders = useMemo<ProjectFolderGroup[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    const map = new Map<string, ProjectFolderGroup>();

    for (const rec of records) {
      const matches =
        !q ||
        rec.projectName.toLowerCase().includes(q) ||
        rec.label.toLowerCase().includes(q) ||
        rec.filename.toLowerCase().includes(q) ||
        (rec.hook && rec.hook.toLowerCase().includes(q));
      if (!matches) continue;

      const key = rec.projectId || rec.sourceLabel || 'projek-utama';
      const existing = map.get(key);
      if (existing) {
        existing.items.push(rec);
        existing.totalSizeBytes += rec.sizeBytes;
        if (rec.createdAt > existing.latestAt) existing.latestAt = rec.createdAt;
      } else {
        map.set(key, {
          projectId: key,
          projectName: rec.projectName || rec.sourceLabel || 'Projek Auto Clipper',
          items: [rec],
          totalSizeBytes: rec.sizeBytes,
          latestAt: rec.createdAt,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => b.latestAt - a.latestAt);
  }, [records, searchQuery]);

  const toggleFolder = (projectId: string, idx: number) => {
    setCollapsedFolders((prev) => {
      const currentCollapsed = prev[projectId] ?? idx > 0;
      return { ...prev, [projectId]: !currentCollapsed };
    });
  };

  const setAllFoldersExpanded = (expand: boolean) => {
    const next: Record<string, boolean> = {};
    for (const f of projectFolders) {
      next[f.projectId] = !expand;
    }
    setCollapsedFolders(next);
  };

  const handleDownloadAllZip = async () => {
    if (!records.length || zipBusyKey) return;
    setZipBusyKey('__all__');
    setZipProgressPct(5);
    setZipStatusText('Menyiapkan arsip ZIP semua projek…');
    try {
      await downloadAllProjectsZip(records, (pct, label) => {
        setZipProgressPct(pct);
        setZipStatusText(label);
      });
    } catch (err) {
      setZipStatusText(err instanceof Error ? err.message : 'Gagal membuat file ZIP.');
    } finally {
      setZipBusyKey(null);
    }
  };

  const handleDownloadFolderZip = async (folder: ProjectFolderGroup) => {
    if (!folder.items.length || zipBusyKey) return;
    setZipBusyKey(folder.projectId);
    setZipProgressPct(5);
    setZipStatusText(`Menyiapkan ZIP folder "${folder.projectName}"…`);
    try {
      await downloadProjectZip(folder.items, folder.projectName, (pct, label) => {
        setZipProgressPct(pct);
        setZipStatusText(label);
      });
    } catch (err) {
      setZipStatusText(err instanceof Error ? err.message : 'Gagal membuat file ZIP folder.');
    } finally {
      setZipBusyKey(null);
    }
  };

  const handleCopyCaption = async (rec: ExportedClipRecord) => {
    const text = [rec.label, rec.hook ? `"${rec.hook}"` : '', rec.captionText || '']
      .filter(Boolean)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(rec.id);
      window.setTimeout(() => setCopiedId((cur) => (cur === rec.id ? null : cur)), 1800);
    } catch {}
  };

  const totalBytes = records.reduce((acc, r) => acc + r.sizeBytes, 0);

  return (
    <section className="space-y-5">
      <div className="bg-[#11141c] border border-[#1e2432] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-white">Hasil Ekspor Per Folder Projek</h2>
            <p className="text-xs text-[#8f98a8] font-mono tabular-nums">
              {projectFolders.length} folder projek · {records.length} klip · {(totalBytes / (1024 * 1024)).toFixed(1)} MB total
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {records.length > 0 && (
              <button
                type="button"
                disabled={Boolean(zipBusyKey)}
                onClick={handleDownloadAllZip}
                className="px-3.5 py-2 rounded-lg bg-[#c7ff55] hover:bg-[#d6ff7d] disabled:opacity-50 text-[#111507] text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
              >
                <Archive className="w-3.5 h-3.5" />
                {zipBusyKey === '__all__'
                  ? `Mengemas ZIP (${zipProgressPct}%)…`
                  : `Unduh Semua (.zip · ${records.length} klip)`}
              </button>
            )}
            {records.length > 0 && (
              <button
                type="button"
                disabled={Boolean(zipBusyKey)}
                onClick={onClearAll}
                className="px-3.5 py-2 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-[#e8edf5] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Bersihkan Galeri
              </button>
            )}
            <button
              type="button"
              onClick={onBackToStudio}
              className="px-3.5 py-2 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-[#e8edf5] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Kembali ke Studio
            </button>
          </div>
        </div>

        {records.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-[#1e2432]">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="w-3.5 h-3.5 text-[#687285] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nama folder projek atau judul klip…"
                className="w-full bg-[#0d1017] text-[#f3f5f8] border border-[#2d3548] rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-[#ff5436]"
              />
            </div>

            {projectFolders.length > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setAllFoldersExpanded(true)}
                  className="px-2.5 py-1.5 rounded-lg bg-[#0d1017] hover:bg-[#181c27] border border-[#2d3548] text-[11.5px] font-semibold text-[#cbd2de] cursor-pointer"
                >
                  Buka Semua Folder
                </button>
                <button
                  type="button"
                  onClick={() => setAllFoldersExpanded(false)}
                  className="px-2.5 py-1.5 rounded-lg bg-[#0d1017] hover:bg-[#181c27] border border-[#2d3548] text-[11.5px] font-semibold text-[#cbd2de] cursor-pointer"
                >
                  Tutup Semua
                </button>
              </div>
            )}
          </div>
        )}

        {(zipBusyKey || zipStatusText) && (
          <div className="bg-[#0d1017] border border-[#2d3548] rounded-lg p-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#cbd2de]">{zipStatusText}</span>
              <span className="font-mono tabular-nums font-bold text-[#c7ff55]">{zipProgressPct}%</span>
            </div>
            <div className="h-1.5 bg-[#1b202c] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#c7ff55] transition-all duration-150"
                style={{ width: `${Math.max(4, Math.min(100, zipProgressPct))}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {records.length === 0 ? (
        <div className="bg-[#11141c] border border-dashed border-[#2d3548] rounded-xl p-10 text-center space-y-3">
          <Film className="w-8 h-8 text-[#687285] mx-auto" />
          <div className="text-sm font-semibold text-white">Belum ada klip yang diekspor pada sesi ini</div>
          <p className="text-xs text-[#8f98a8] max-w-md mx-auto">
            Setiap video yang diekspor akan otomatis dikelompokkan ke dalam 1 folder projek rapi dan siap diunduh sekaligus dalam file ZIP.
          </p>
          <button
            type="button"
            onClick={onBackToStudio}
            className="px-4 py-2 rounded-lg bg-[#ff5436] hover:bg-[#ff6b52] text-white text-xs font-bold cursor-pointer transition-colors"
          >
            Buka Studio Editor
          </button>
        </div>
      ) : projectFolders.length === 0 ? (
        <div className="bg-[#11141c] border border-[#1e2432] rounded-xl p-8 text-center text-xs text-[#8f98a8]">
          Tidak ada folder atau klip yang cocok dengan pencarian “{searchQuery}”.
        </div>
      ) : (
        <div className="space-y-4">
          {projectFolders.map((folder, idx) => {
            const isCollapsed = collapsedFolders[folder.projectId] ?? idx > 0;
            const isZippingThis = zipBusyKey === folder.projectId;
            const createdLabel = new Date(folder.latestAt).toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <section
                key={folder.projectId}
                className="bg-[#11141c] border border-[#1e2432] rounded-xl overflow-hidden"
              >
                {/* 1 Folder Header */}
                <div className="p-4 flex flex-wrap items-center justify-between gap-3 bg-[#11141c]">
                  <button
                    type="button"
                    onClick={() => toggleFolder(folder.projectId, idx)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer group"
                  >
                    <span className="w-9 h-9 rounded-lg bg-[#181c27] border border-[#2d3548] grid place-items-center shrink-0 text-[#c7ff55]">
                      {isCollapsed ? (
                        <Folder className="w-4 h-4" />
                      ) : (
                        <FolderOpen className="w-4 h-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white truncate group-hover:text-[#c7ff55] transition-colors">
                          {folder.projectName}
                        </span>
                        {isCollapsed ? (
                          <ChevronRight className="w-4 h-4 text-[#8f98a8] shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-[#8f98a8] shrink-0" />
                        )}
                      </div>
                      <div className="text-[11.5px] font-mono tabular-nums text-[#8f98a8] mt-0.5">
                        {folder.items.length} klip · {(folder.totalSizeBytes / (1024 * 1024)).toFixed(1)} MB · pukul {createdLabel}
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={Boolean(zipBusyKey)}
                      onClick={() => handleDownloadFolderZip(folder)}
                      className="px-3 py-1.5 rounded-lg bg-[#c7ff55] hover:bg-[#d6ff7d] disabled:opacity-50 text-[#111507] text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      {isZippingThis ? `ZIP (${zipProgressPct}%)…` : 'Unduh ZIP Folder'}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(zipBusyKey)}
                      onClick={() => onRemoveProject(folder.projectId)}
                      title={`Hapus folder ${folder.projectName}`}
                      aria-label={`Hapus folder ${folder.projectName}`}
                      className="p-2 rounded-lg bg-[#181c27] hover:bg-red-950/50 border border-[#2d3548] text-[#8f98a8] hover:text-red-300 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Folder Contents */}
                {!isCollapsed && (
                  <div className="p-4 pt-3 border-t border-[#1e2432] bg-[#0b0e14] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {folder.items.map((rec) => (
                      <article
                        key={rec.id}
                        className="bg-[#11141c] border border-[#1e2432] rounded-xl overflow-hidden flex flex-col"
                      >
                        <video
                          src={rec.url}
                          controls
                          playsInline
                          preload="metadata"
                          className="w-full aspect-[9/16] bg-[#05070a] block"
                        />
                        <div className="p-3.5 space-y-2.5 flex-1 flex flex-col justify-between">
                          <div className="space-y-1 min-w-0">
                            <h3 className="text-xs font-bold text-white truncate" title={rec.label}>
                              {rec.label}
                            </h3>
                            <div className="text-[11px] font-mono tabular-nums text-[#8f98a8]">
                              {rec.rangeText} · {(rec.sizeBytes / (1024 * 1024)).toFixed(1)} MB · {rec.ext.toUpperCase()}
                            </div>
                            {rec.hook && (
                              <p className="text-[11px] text-[#aeb6c4] line-clamp-2 italic">
                                “{rec.hook}”
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <a
                              href={rec.url}
                              download={rec.filename}
                              className="flex-1 py-2 px-3 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
                            >
                              <Download className="w-3.5 h-3.5 text-[#c7ff55]" />
                              Unduh
                            </a>
                            <button
                              type="button"
                              onClick={() => handleCopyCaption(rec)}
                              title="Salin judul & caption klip"
                              aria-label={`Salin caption ${rec.label}`}
                              className="p-2 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-[#cbd2de] hover:text-white transition-colors cursor-pointer"
                            >
                              {copiedId === rec.id ? (
                                <Check className="w-3.5 h-3.5 text-[#c7ff55]" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => onRemoveRecord(rec.id)}
                              aria-label={`Hapus ${rec.filename}`}
                              className="p-2 rounded-lg bg-[#181c27] hover:bg-red-950/50 border border-[#2d3548] text-[#8f98a8] hover:text-red-300 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
