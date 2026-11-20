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
import { useTranslation } from '../i18n/LanguageContext';
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
  const { t } = useTranslation();
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
            {t('home.heroTitleBefore')}
            <span className="text-[#ff6b00]">{t('home.heroTitleHighlight')}</span>
            {t('home.heroTitleAfter')}
          </h1>
          <p className="text-sm text-[#93a7cc] max-w-xl mx-auto">
            {t('home.heroDesc')}
          </p>
        </div>

        <div className="bg-[#101d3d] border border-[#2a4173] focus-within:border-[#ff6b00]/70 rounded-2xl p-4 text-left transition-colors">
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
                className={`border border-dashed rounded-xl px-5 py-7 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6b00] ${
                  dragOver
                    ? 'border-[#ff6b00] bg-[#ff6b00]/10'
                    : 'border-[#2a4173] bg-[#0c1733] hover:border-[#ff6b00]/70'
                }`}
              >
                <FolderUp className="w-7 h-7 text-[#ff6b00] mx-auto mb-2" />
                <div className="text-sm font-bold text-white">
                  {t('home.dropTitle')}
                </div>
                <div className="text-xs text-[#93a7cc] mt-1">
                  {t('home.dropDesc')}
                </div>
                {activeFile && (
                  <div className="text-xs font-mono text-[#c7ff55] mt-2 truncate">
                    {t('home.activeFile', { name: activeFile.name })}
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

              <div className="pt-3 border-t border-[#1e3159] flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Subtitle mode"
                    value={subtitleMode}
                    onChange={(e) => onChangeSubtitleMode(e.target.value as SubtitleMode)}
                    className="bg-[#0c1733] text-[#e4ecfa] border border-[#2a4173] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#ff6b00]"
                  >
                    <option value="auto">{t('home.subModeAuto')}</option>
                    <option value="external">{t('home.subModeExternal')}</option>
                    <option value="none">{t('home.subModeNone')}</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => srtInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-[#e4ecfa] inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
                  >
                    <Subtitles className="w-3.5 h-3.5 text-[#c7ff55]" />
                    {subtitleFileName ? subtitleFileName : t('home.pickSrt')}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 rounded-lg bg-[#ff6b00] hover:bg-[#ff8224] text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {t('home.pickLocalVideo')}
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
                  placeholder={t('home.ytPlaceholder')}
                  className="flex-1 min-w-0 bg-transparent text-white placeholder:text-[#6d83ad] text-sm px-2 py-2 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={ytImporting}
                  onClick={() => onImportYoutube(ytInput, ytQuality)}
                  className="w-9 h-9 rounded-lg bg-[#ff6b00] hover:bg-[#ff8224] disabled:opacity-40 text-white font-bold flex items-center justify-center shrink-0 cursor-pointer transition-colors"
                  title={t('home.ytImportTitle')}
                >
                  ↑
                </button>
              </div>

              {ytPreview && ytPreview.id && (
                <div className="flex items-center gap-3 p-2.5 rounded-lg bg-[#0c1733] border border-[#1e3159]">
                  <img
                    src={ytPreview.thumbnail}
                    alt={ytPreview.title}
                    referrerPolicy="no-referrer"
                    className="w-24 h-14 object-cover rounded-md bg-[#070e20] shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-white truncate">{ytPreview.title}</div>
                    <div className="text-[11px] text-[#93a7cc] font-mono truncate mt-0.5">
                      {ytPreview.channel}
                      {ytPreview.duration > 0 ? ` · ${formatClock(ytPreview.duration)}` : ''}
                      {ytPreview.canDownloadDirect ? ` · ${t('home.ytReady')}` : ` · ${t('home.ytMetaReady')}`}
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
                        : 'bg-[#0c1733] border-[#1e3159] text-[#dce6f7]'
                  }`}
                >
                  {ytStatusMsg}
                </div>
              )}

              <div className="pt-3 border-t border-[#1e3159] flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <select
                    aria-label="YouTube Quality"
                    value={ytQuality}
                    onChange={(e) => setYtQuality(e.target.value)}
                    className="bg-[#0c1733] text-[#e4ecfa] border border-[#2a4173] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#ff6b00]"
                  >
                    <option value="720">{t('home.ytQuality720')}</option>
                    <option value="1080">{t('home.ytQuality1080')}</option>
                    <option value="360">{t('home.ytQuality360')}</option>
                  </select>
                </div>
                <div className="text-xs font-mono tabular-nums text-[#93a7cc]">
                  {t('home.ytTargetInfo', { range: clipLengthRange })}
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
                ? 'bg-[#16264d] border-[#ff6b00]/60 text-white'
                : 'bg-[#101d3d] border-[#1e3159] text-[#93a7cc] hover:text-white'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            {t('home.tabLocal')}
          </button>
          <button
            type="button"
            onClick={() => setSourceTab('youtube')}
            className={`px-3.5 py-2 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
              sourceTab === 'youtube'
                ? 'bg-[#16264d] border-[#ff6b00]/60 text-white'
                : 'bg-[#101d3d] border-[#1e3159] text-[#93a7cc] hover:text-white'
            }`}
          >
            <Link2 className="w-3.5 h-3.5" />
            {t('home.tabYoutube')}
          </button>
          <button
            type="button"
            onClick={() => onChangeSubtitleMode(subtitleMode === 'none' ? 'auto' : 'none')}
            className={`px-3.5 py-2 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
              subtitleMode === 'none'
                ? 'bg-[#16264d] border-[#c7ff55]/60 text-[#c7ff55]'
                : 'bg-[#101d3d] border-[#1e3159] text-[#93a7cc] hover:text-white'
            }`}
          >
            {t('home.tabNoSub')}
          </button>
          <button
            type="button"
            onClick={onGoAiVideo}
            className="px-3.5 py-2 rounded-lg border border-[#1e3159] bg-[#101d3d] hover:border-[#2a4173] text-[#93a7cc] hover:text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#ff6b00]" />
            {t('home.tabAiVideo')}
          </button>
        </div>
      </section>

      {/* Batch Queue Section */}
      {batchQueue.length > 0 && (
        <section className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#ff6b00]" />
                {t('home.batchTitle')}
              </h2>
              <div className="text-xs font-mono tabular-nums text-[#93a7cc]">
                {t('home.batchMeta', { total: batchQueue.length, done: doneCount, mb: totalMb })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={t('home.batchTitle')}
                value={batchGoal}
                disabled={batchRunning}
                onChange={(e) => onChangeBatchGoal(e.target.value as 'auto-export' | 'analyze-only')}
                className="bg-[#0c1733] text-[#e4ecfa] border border-[#2a4173] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[#ff6b00] disabled:opacity-50"
              >
                <option value="auto-export">{t('home.batchGoalExport')}</option>
                <option value="analyze-only">{t('home.batchGoalAnalyze')}</option>
              </select>
              <button
                type="button"
                disabled={batchRunning}
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-[#e4ecfa] disabled:opacity-40 cursor-pointer"
              >
                {t('home.batchAdd')}
              </button>
              <button
                type="button"
                disabled={batchRunning || doneCount === 0}
                onClick={onClearDoneBatch}
                className="px-3 py-1.5 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-[#e4ecfa] disabled:opacity-40 cursor-pointer"
              >
                {t('home.batchClearDone')}
              </button>
              {batchRunning ? (
                <button
                  type="button"
                  onClick={onStopBatch}
                  className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Square className="w-3 h-3 fill-current" />
                  {t('home.batchStop')}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={queuedCount === 0}
                  onClick={onStartBatch}
                  className="px-4 py-1.5 rounded-lg bg-[#ff6b00] hover:bg-[#ff8224] disabled:opacity-40 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Play className="w-3 h-3 fill-current" />
                  {t('home.batchStart', { count: queuedCount || batchQueue.length })}
                </button>
              )}
            </div>
          </div>

          {batchBannerText && (
            <div className="bg-[#0c1733] border border-[#2a4173] rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-[#e4ecfa]">{batchBannerText}</span>
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
                      {t('home.batchViewExports', { count: exportedCount })}
                    </button>
                  )}
                </div>
              </div>
              <div className="h-1.5 bg-[#1a2d59] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#ff6b00] transition-all duration-200"
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
                  className={`bg-[#0c1733] border rounded-lg px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 ${
                    active
                      ? 'border-[#ff6b00]/70'
                      : item.status === 'done'
                        ? 'border-emerald-500/40'
                        : item.status === 'error'
                          ? 'border-red-500/45'
                          : 'border-[#1e3159]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="font-mono tabular-nums text-xs font-bold text-[#6d83ad] w-6 shrink-0">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-xs font-bold text-white truncate">{item.name}</div>
                      <div className="text-[11.5px] text-[#93a7cc] flex flex-wrap items-center gap-1.5">
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
                                  : 'text-[#dce6f7]'
                          }
                        >
                          {item.statusText}
                        </span>
                        {item.clipsCount > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {t('session.clipsCount', { count: item.clipsCount })}
                            </span>
                          </>
                        )}
                        {item.exportedCount > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums text-emerald-400">
                              {t('home.batchExportedCount', { count: item.exportedCount })}
                            </span>
                          </>
                        )}
                      </div>
                      {active && (
                        <div className="h-1 bg-[#1a2d59] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#ff6b00] transition-all duration-150"
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
                      className="px-2.5 py-1.5 rounded-md bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-[#e4ecfa] disabled:opacity-40 cursor-pointer"
                    >
                      {t('home.batchOpenStudio')}
                    </button>
                    <button
                      type="button"
                      disabled={batchRunning || active}
                      onClick={() => onRemoveBatchItem(item.id)}
                      aria-label={item.name}
                      className="p-1.5 rounded-md bg-[#16264d] hover:bg-red-950/50 border border-[#2a4173] text-[#93a7cc] hover:text-red-300 disabled:opacity-40 cursor-pointer"
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
          <h2 className="text-sm font-bold text-white">{t('home.sessionTitle')}</h2>
          <button
            type="button"
            onClick={onGoStudio}
            className="text-xs font-semibold text-[#dce6f7] hover:text-white inline-flex items-center gap-1 cursor-pointer"
          >
            {t('home.sessionGoStudio')}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="text-sm font-bold text-white truncate">
              {activeFile ? activeLabel || activeFile.name : t('home.sessionNoVideo')}
            </div>
            <div className="text-xs font-mono tabular-nums text-[#93a7cc]">
              {activeFile
                ? t('home.sessionReadyInfo', {
                    count: clipsCount,
                    mode:
                      subtitleMode === 'none'
                        ? t('home.modeNone')
                        : subtitleMode === 'external'
                          ? t('home.modeExternal')
                          : t('home.modeAuto'),
                  })
                : t('home.sessionEmptyInfo')}
            </div>
          </div>
          <button
            type="button"
            onClick={onGoStudio}
            className="px-4 py-2 rounded-lg bg-[#ff6b00] hover:bg-[#ff8224] text-white text-xs font-bold whitespace-nowrap cursor-pointer transition-colors"
          >
            {activeFile ? t('home.ctaEditStudio') : t('home.ctaOpenStudio')}
          </button>
        </div>
      </section>
    </div>
  );
}
