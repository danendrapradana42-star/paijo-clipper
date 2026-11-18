import React, { useRef, useState } from 'react';
import {
  ArrowRight,
  FolderUp,
  Layers,
  Link2,
  Play,
  Sparkles,
  Square,
  Subtitles,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  BatchQueueItem,
  SubtitleMode,
  YoutubePreviewInfo,
} from '../types/clipper';
import { formatClock } from '../utils/subtitles';

interface HomeViewProps {
  activeFile: File | null;
  activeLabel: string;
  clipsCount: number;
  subtitleMode: SubtitleMode;
  onChangeSubtitleMode: (mode: SubtitleMode) => void;
  clipLengthRange: string;
  onEnqueueFiles: (files: FileList | File[]) => void;
  onPickSubtitleFile: (file: File) => void;
  subtitleFileName: string;
  ytPreview: YoutubePreviewInfo | null;
  ytStatusMsg: string;
  ytStatusTone: 'idle' | 'ok' | 'error';
  onInspectYoutube: (url: string) => void;
  onImportYoutube: (url: string, quality: string) => void;
  ytImporting: boolean;
  batchQueue: BatchQueueItem[];
  batchRunning: boolean;
  batchGoal: 'auto-export' | 'analyze-only';
  onChangeBatchGoal: (goal: 'auto-export' | 'analyze-only') => void;
  batchBannerText: string;
  batchGlobalPct: number;
  exportedCount: number;
  onStartBatch: () => void;
  onStopBatch: () => void;
  onClearDoneBatch: () => void;
  onOpenBatchItem: (id: string) => void;
  onRemoveBatchItem: (id: string) => void;
  onGoStudio: () => void;
  onGoExports: () => void;
  onGoAiVideo: () => void;
}

export function HomeView(props: HomeViewProps) {
  const {
    activeFile,
    activeLabel,
    clipsCount,
    subtitleMode,
    onChangeSubtitleMode,
    clipLengthRange,
    onEnqueueFiles,
    onPickSubtitleFile,
    subtitleFileName,
    ytPreview,
    ytStatusMsg,
    ytStatusTone,
    onInspectYoutube,
    onImportYoutube,
    ytImporting,
    batchQueue,
    batchRunning,
    batchGoal,
    onChangeBatchGoal,
    batchBannerText,
    batchGlobalPct,
    exportedCount,
    onStartBatch,
    onStopBatch,
    onClearDoneBatch,
    onOpenBatchItem,
    onRemoveBatchItem,
    onGoStudio,
    onGoExports,
    onGoAiVideo,
  } = props;

  const [sourceTab, setSourceTab] = useState<'local' | 'youtube'>('local');
  const [dragOver, setDragOver] = useState(false);
  const [ytInput, setYtInput] = useState('');
  const [ytQuality, setYtQuality] = useState('720');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onEnqueueFiles(e.dataTransfer.files);
    }
  };

  const doneCount = batchQueue.filter((i) => i.status === 'done').length;
  const queuedCount = batchQueue.filter(
    (i) => i.status === 'queued' || i.status === 'stopped' || i.status === 'error'
  ).length;
  const totalMb = (batchQueue.reduce((sum, i) => sum + i.size, 0) / (1024 * 1024)).toFixed(1);

  return (
    <div className="space-y-8">
      {/* Hero & Command Composer */}
      <section className="max-w-3xl mx-auto pt-4 text-center space-y-5">
        <div className="space-y-2.5">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white [text-wrap:balance]">
            Video apa yang mau kita <span className="text-[#ff5436]">clip</span> hari ini?
          </h1>
          <p className="text-sm text-[#8f98a8] max-w-xl mx-auto">
            Pilih satu atau beberapa video lokal sekaligus — potong otomatis menjadi klip vertikal 9:16 lengkap dengan subtitle kustom atau bersih tanpa teks.
          </p>
        </div>

        <div className="bg-[#11141c] border border-[#2d3548] focus-within:border-[#ff5436]/70 rounded-2xl p-4 text-left transition-colors">
          {sourceTab === 'local' ? (
            <div className="space-y-3.5">
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragEnter={(e) => e.preventDefault()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`border border-dashed rounded-xl px-5 py-7 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5436] ${
                  dragOver
                    ? 'border-[#ff5436] bg-[#ff5436]/10'
                    : 'border-[#2d3548] bg-[#0d1017] hover:border-[#ff5436]/70'
                }`}
              >
                <FolderUp className="w-7 h-7 text-[#ff5436] mx-auto mb-2" />
                <div className="text-sm font-bold text-white">
                  Tarik satu atau beberapa video ke sini (Batch Processing)
                </div>
                <div className="text-xs text-[#8f98a8] mt-1">
                  MP4, WebM, MOV, MKV · diproses lokal di perangkat Anda tanpa unggahan otomatis
                </div>
                {activeFile && (
                  <div className="text-xs font-mono text-[#c7ff55] mt-2 truncate">
                    Aktif: {activeFile.name}
                  </div>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="video/*,.mp4,.webm,.mov,.m4v,.mkv,.avi,.mpeg,.mpg,.mts,.m2ts,.ts,.3gp"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    onEnqueueFiles(e.target.files);
                  }
                  e.target.value = '';
                }}
              />
              <input
                ref={srtInputRef}
                type="file"
                accept=".srt,.vtt,text/vtt,application/x-subrip"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPickSubtitleFile(f);
                  e.target.value = '';
                }}
              />

              <div className="pt-3 border-t border-[#1e2432] flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Mode subtitle"
                    value={subtitleMode}
                    onChange={(e) => onChangeSubtitleMode(e.target.value as SubtitleMode)}
                    className="bg-[#0d1017] text-[#e4e8f0] border border-[#2d3548] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#ff5436]"
                  >
                    <option value="auto">Subtitle: Deteksi Jeda / AI Opt-in</option>
                    <option value="external">Subtitle: File .srt / .vtt</option>
                    <option value="none">Tanpa Subtitle (Bersih)</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => srtInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-xs font-semibold text-[#e8edf5] inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
                  >
                    <Subtitles className="w-3.5 h-3.5 text-[#c7ff55]" />
                    {subtitleFileName ? subtitleFileName : 'Pilih .srt/.vtt'}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 rounded-lg bg-[#ff5436] hover:bg-[#ff6b52] text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Pilih Video Lokal
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  value={ytInput}
                  onChange={(e) => {
                    setYtInput(e.target.value);
                    onInspectYoutube(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onImportYoutube(ytInput, ytQuality);
                    }
                  }}
                  placeholder="Tempel link YouTube — contoh: https://www.youtube.com/watch?v=xxxxxxxxxxx"
                  className="flex-1 min-w-0 bg-transparent text-white placeholder:text-[#677082] text-sm px-2 py-2 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={ytImporting}
                  onClick={() => onImportYoutube(ytInput, ytQuality)}
                  className="w-9 h-9 rounded-lg bg-[#ff5436] hover:bg-[#ff6b52] disabled:opacity-40 text-white font-bold flex items-center justify-center shrink-0 cursor-pointer transition-colors"
                  title="Import Link YouTube"
                >
                  ↑
                </button>
              </div>

              {ytPreview && ytPreview.id && (
                <div className="flex items-center gap-3 p-2.5 rounded-lg bg-[#0d1017] border border-[#1e2432]">
                  <img
                    src={ytPreview.thumbnail}
                    alt={ytPreview.title}
                    referrerPolicy="no-referrer"
                    className="w-24 h-14 object-cover rounded-md bg-[#08090c] shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-white truncate">{ytPreview.title}</div>
                    <div className="text-[11px] text-[#8f98a8] font-mono truncate mt-0.5">
                      {ytPreview.channel}
                      {ytPreview.duration > 0 ? ` · ${formatClock(ytPreview.duration)}` : ''}
                      {ytPreview.canDownloadDirect ? ' · Siap unduh' : ' · Info metadata siap'}
                    </div>
                  </div>
                </div>
              )}

              {ytStatusMsg && (
                <div
                  className={`text-xs px-3 py-2 rounded-lg border ${
                    ytStatusTone === 'error'
                      ? 'bg-red-950/30 border-red-500/40 text-red-200'
                      : ytStatusTone === 'ok'
                        ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                        : 'bg-[#0d1017] border-[#1e2432] text-[#cbd2de]'
                  }`}
                >
                  {ytStatusMsg}
                </div>
              )}

              <div className="pt-3 border-t border-[#1e2432] flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Kualitas YouTube"
                    value={ytQuality}
                    onChange={(e) => setYtQuality(e.target.value)}
                    className="bg-[#0d1017] text-[#e4e8f0] border border-[#2d3548] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#ff5436]"
                  >
                    <option value="720">Kualitas: 720p HD</option>
                    <option value="1080">Kualitas: 1080p Full HD</option>
                    <option value="360">Kualitas: 360p Cepat</option>
                  </select>
                </div>
                <div className="text-xs font-mono tabular-nums text-[#8f98a8]">
                  Target klip {clipLengthRange} dtk · 9:16
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Source Switcher & Quick Modes */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setSourceTab('local')}
            className={`px-3.5 py-2 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
              sourceTab === 'local'
                ? 'bg-[#181c27] border-[#ff5436]/60 text-white'
                : 'bg-[#11141c] border-[#1e2432] text-[#8f98a8] hover:text-white'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            Upload File Lokal
          </button>
          <button
            type="button"
            onClick={() => setSourceTab('youtube')}
            className={`px-3.5 py-2 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
              sourceTab === 'youtube'
                ? 'bg-[#181c27] border-[#ff5436]/60 text-white'
                : 'bg-[#11141c] border-[#1e2432] text-[#8f98a8] hover:text-white'
            }`}
          >
            <Link2 className="w-3.5 h-3.5" />
            Link YouTube
          </button>
          <button
            type="button"
            onClick={() => onChangeSubtitleMode(subtitleMode === 'none' ? 'auto' : 'none')}
            className={`px-3.5 py-2 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
              subtitleMode === 'none'
                ? 'bg-[#181c27] border-[#c7ff55]/60 text-[#c7ff55]'
                : 'bg-[#11141c] border-[#1e2432] text-[#8f98a8] hover:text-white'
            }`}
          >
            Tanpa Subtitle
          </button>
          <button
            type="button"
            onClick={onGoAiVideo}
            className="px-3.5 py-2 rounded-lg border border-[#1e2432] bg-[#11141c] hover:border-[#2d3548] text-[#8f98a8] hover:text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#ff5436]" />
            Buat Video AI
          </button>
        </div>
      </section>

      {/* Batch Queue Section */}
      {batchQueue.length > 0 && (
        <section className="bg-[#11141c] border border-[#1e2432] rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#ff5436]" />
                Antrean Batch Processing
              </h2>
              <div className="text-xs font-mono tabular-nums text-[#8f98a8]">
                {batchQueue.length} video · {doneCount} selesai · {totalMb} MB
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Tujuan batch"
                value={batchGoal}
                disabled={batchRunning}
                onChange={(e) => onChangeBatchGoal(e.target.value as 'auto-export' | 'analyze-only')}
                className="bg-[#0d1017] text-[#e4e8f0] border border-[#2d3548] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#ff5436] disabled:opacity-50"
              >
                <option value="auto-export">Analisis &amp; Ekspor Semua Klip</option>
                <option value="analyze-only">Analisis &amp; Siapkan Klip Saja</option>
              </select>
              <button
                type="button"
                disabled={batchRunning}
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-xs font-semibold text-[#e8edf5] disabled:opacity-40 cursor-pointer"
              >
                + Tambah Video
              </button>
              <button
                type="button"
                disabled={batchRunning || doneCount === 0}
                onClick={onClearDoneBatch}
                className="px-3 py-1.5 rounded-lg bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-xs font-semibold text-[#e8edf5] disabled:opacity-40 cursor-pointer"
              >
                Bersihkan Selesai
              </button>
              {batchRunning ? (
                <button
                  type="button"
                  onClick={onStopBatch}
                  className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Square className="w-3 h-3 fill-current" />
                  Hentikan Antrean
                </button>
              ) : (
                <button
                  type="button"
                  disabled={queuedCount === 0}
                  onClick={onStartBatch}
                  className="px-4 py-1.5 rounded-lg bg-[#ff5436] hover:bg-[#ff6b52] disabled:opacity-40 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Play className="w-3 h-3 fill-current" />
                  Proses {queuedCount || batchQueue.length} Video Berurutan
                </button>
              )}
            </div>
          </div>

          {batchBannerText && (
            <div className="bg-[#0d1017] border border-[#2d3548] rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-[#e4e8f0]">{batchBannerText}</span>
                <div className="flex items-center gap-2.5 shrink-0">
                  <span className="font-mono tabular-nums font-bold text-[#c7ff55]">
                    {Math.round(batchGlobalPct)}%
                  </span>
                  {exportedCount > 0 && (
                    <button
                      type="button"
                      onClick={onGoExports}
                      className="text-xs font-semibold text-[#c7ff55] hover:underline cursor-pointer"
                    >
                      Lihat Hasil ({exportedCount}) →
                    </button>
                  )}
                </div>
              </div>
              <div className="h-1.5 bg-[#1b202c] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#ff5436] transition-all duration-200"
                  style={{ width: `${Math.max(0, Math.min(100, batchGlobalPct))}%` }}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            {batchQueue.map((item, idx) => {
              const active =
                item.status === 'loading' ||
                item.status === 'analyzing' ||
                item.status === 'exporting';
              return (
                <div
                  key={item.id}
                  className={`bg-[#0d1017] border rounded-lg px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 ${
                    active
                      ? 'border-[#ff5436]/70'
                      : item.status === 'done'
                        ? 'border-emerald-500/40'
                        : item.status === 'error'
                          ? 'border-red-500/45'
                          : 'border-[#1e2432]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="font-mono tabular-nums text-xs font-bold text-[#687285] w-6 shrink-0">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-xs font-bold text-white truncate">{item.name}</div>
                      <div className="text-[11.5px] text-[#8f98a8] flex flex-wrap items-center gap-1.5">
                        <span className="font-mono tabular-nums">
                          {(item.size / (1024 * 1024)).toFixed(1)} MB
                        </span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            active
                              ? 'text-[#c7ff55] font-semibold'
                              : item.status === 'done'
                                ? 'text-emerald-400 font-semibold'
                                : item.status === 'error'
                                  ? 'text-red-400 font-semibold'
                                  : 'text-[#cbd2de]'
                          }
                        >
                          {item.statusText}
                        </span>
                        {item.clipsCount > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">{item.clipsCount} klip</span>
                          </>
                        )}
                        {item.exportedCount > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums text-emerald-400">
                              {item.exportedCount} diekspor
                            </span>
                          </>
                        )}
                      </div>
                      {active && (
                        <div className="h-1 bg-[#1b202c] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#ff5436] transition-all duration-150"
                            style={{ width: `${Math.max(5, Math.min(100, item.progress))}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={batchRunning}
                      onClick={() => onOpenBatchItem(item.id)}
                      className="px-2.5 py-1.5 rounded-md bg-[#181c27] hover:bg-[#212636] border border-[#2d3548] text-xs font-semibold text-[#e8edf5] disabled:opacity-40 cursor-pointer"
                    >
                      Buka di Studio
                    </button>
                    <button
                      type="button"
                      disabled={batchRunning || active}
                      onClick={() => onRemoveBatchItem(item.id)}
                      aria-label={`Hapus ${item.name}`}
                      className="p-1.5 rounded-md bg-[#181c27] hover:bg-red-950/50 border border-[#2d3548] text-[#8f98a8] hover:text-red-300 disabled:opacity-40 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Active Session Card */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-white">Sesi Studio Aktif</h2>
          <button
            type="button"
            onClick={onGoStudio}
            className="text-xs font-semibold text-[#cbd2de] hover:text-white inline-flex items-center gap-1 cursor-pointer"
          >
            Masuk ke Studio Editor
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="bg-[#11141c] border border-[#1e2432] rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="text-sm font-bold text-white truncate">
              {activeFile ? activeLabel || activeFile.name : 'Belum ada video dimuat'}
            </div>
            <div className="text-xs font-mono tabular-nums text-[#8f98a8]">
              {activeFile
                ? `${clipsCount} kandidat klip siap · Mode: ${
                    subtitleMode === 'none'
                      ? 'Tanpa Subtitle'
                      : subtitleMode === 'external'
                        ? 'Subtitle File'
                        : 'Otomatis / AI Opt-in'
                  }`
                : 'Unggah file video di atas untuk memulai pemotongan klip 9:16 secara lokal'}
            </div>
          </div>
          <button
            type="button"
            onClick={onGoStudio}
            className="px-4 py-2 rounded-lg bg-[#ff5436] hover:bg-[#ff6b52] text-white text-xs font-bold whitespace-nowrap cursor-pointer transition-colors"
          >
            {activeFile ? 'Edit & Ekspor di Studio →' : 'Buka Studio Editor'}
          </button>
        </div>
      </section>
    </div>
  );
}
