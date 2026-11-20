import React, { useEffect, useRef, useState } from 'react';
import {
  Archive,
  Download,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Sparkles,
  Square,
  Subtitles,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type {
  AudioEnvelopeData,
  CaptionSettings,
  ClipCandidate,
  ExportFormat,
  ExportedClipRecord,
  FramingMode,
  StudioTab,
  SubtitleCue,
  SubtitleMode,
  YoutubePreviewInfo,
} from '../types/clipper';
import { useTranslation } from '../i18n/LanguageContext';
import { APP_LANGUAGES } from '../i18n/translations';
import {
  createMotionState,
  drawIdleCanvas,
  drawVideoFrame,
  updateMotionFocus,
} from '../utils/canvasRenderer';
import { ensureFontLoaded } from '../utils/fontCatalog';
import { formatClock, formatTimeDecimal } from '../utils/subtitles';
import { supportedExportMime, syncPreviewAudio } from '../utils/videoExporter';
import { downloadProjectZip } from '../utils/zipExporter';
import { CaptionStylePanel } from './CaptionStylePanel';
import { TrimBar } from './TrimBar';

interface StudioViewProps {
  activeTab: StudioTab;
  onChangeTab: (tab: StudioTab) => void;
  videoElRef: React.RefObject<HTMLVideoElement | null>;
  videoReady: boolean;
  videoDuration: number;
  videoDims: { w: number; h: number };
  activeLabel: string;
  ytPreview: YoutubePreviewInfo | null;
  subtitleMode: SubtitleMode;
  onChangeSubtitleMode: (mode: SubtitleMode) => void;
  importedSubName: string;
  onPickSubtitleFile: (file: File) => void;
  onResetSubtitleFile: () => void;
  cues: SubtitleCue[];
  transcriptEditorText: string;
  onChangeTranscriptEditorText: (v: string) => void;
  onApplyTranscriptEdit: () => void;
  onDownloadSrt: () => void;
  aiTranscribeConsent: boolean;
  onChangeAiTranscribeConsent: (v: boolean) => void;
  aiTranscribeLang: string;
  onChangeAiTranscribeLang: (v: string) => void;
  aiTranscribing: boolean;
  transcribeProgressPct: number;
  transcribeElapsedSec: number;
  transcribeEstimatedSec: number;
  transcribeStageLabel: string;
  transcribeError: string;
  onRunAiTranscribe: () => void;
  onCancelAiTranscribe: () => void;
  clipLengthRange: string;
  onChangeClipLengthRange: (v: string) => void;
  clipLimit: number;
  onChangeClipLimit: (v: number) => void;
  onReanalyzeClips: () => void;
  aiFindingHighlights: boolean;
  onFindAiHighlights: () => void;
  clips: ClipCandidate[];
  onToggleClip: (id: string) => void;
  onNudgeClip: (id: string, edge: 'start' | 'end', delta: number) => void;
  onSetClipRange: (id: string, start: number, end: number) => void;
  captionSettings: CaptionSettings;
  onChangeCaptionSettings: (patch: Partial<CaptionSettings>) => void;
  framingMode: FramingMode;
  onChangeFramingMode: (mode: FramingMode) => void;
  manualPanX: number;
  onChangeManualPanX: (x: number) => void;
  exportFormat: ExportFormat;
  onChangeExportFormat: (fmt: ExportFormat) => void;
  exporting: boolean;
  exportProgressPct: number;
  exportProgressLabel: string;
  statusMessage: string;
  onStartExport: () => void;
  onStopExport: () => void;
  latestDownloads: Array<{ url: string; filename: string; rangeText: string; ext: string }>;
  latestExportRecords: ExportedClipRecord[];
  audioEnv: AudioEnvelopeData | null;
  onChangeSourceHome: () => void;
}

export function StudioView(props: StudioViewProps) {
  const { t } = useTranslation();
  const {
    activeTab,
    onChangeTab,
    videoElRef,
    videoReady,
    videoDuration,
    videoDims,
    activeLabel,
    ytPreview,
    subtitleMode,
    onChangeSubtitleMode,
    importedSubName,
    onPickSubtitleFile,
    onResetSubtitleFile,
    cues,
    transcriptEditorText,
    onChangeTranscriptEditorText,
    onApplyTranscriptEdit,
    onDownloadSrt,
    aiTranscribeConsent,
    onChangeAiTranscribeConsent,
    aiTranscribeLang,
    onChangeAiTranscribeLang,
    aiTranscribing,
    transcribeProgressPct,
    transcribeElapsedSec,
    transcribeEstimatedSec,
    transcribeStageLabel,
    transcribeError,
    onRunAiTranscribe,
    onCancelAiTranscribe,
    clipLengthRange,
    onChangeClipLengthRange,
    clipLimit,
    onChangeClipLimit,
    onReanalyzeClips,
    aiFindingHighlights,
    onFindAiHighlights,
    clips,
    onToggleClip,
    onNudgeClip,
    onSetClipRange,
    captionSettings,
    onChangeCaptionSettings,
    framingMode,
    onChangeFramingMode,
    manualPanX,
    onChangeManualPanX,
    exportFormat,
    onChangeExportFormat,
    exporting,
    exportProgressPct,
    exportProgressLabel,
    statusMessage,
    onStartExport,
    onStopExport,
    latestDownloads,
    latestExportRecords,
    audioEnv,
    onChangeSourceHome,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);
  const motionRef = useRef(createMotionState());

  const [selectedClipIdx, setSelectedClipIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [showTranscriptEditor, setShowTranscriptEditor] = useState(false);
  const [previewVolume, setPreviewVolume] = useState(1);
  const [previewMuted, setPreviewMuted] = useState(false);
  const [zipExporting, setZipExporting] = useState(false);

  const activeClip = clips[selectedClipIdx] || clips[0] || null;

  useEffect(() => {
    if (selectedClipIdx >= clips.length && clips.length > 0) {
      setSelectedClipIdx(0);
    }
  }, [clips.length, selectedClipIdx]);

  // Jump preview when switching clip
  const selectClipForPreview = (idx: number) => {
    setSelectedClipIdx(idx);
    const clip = clips[idx];
    const vid = videoElRef.current;
    if (clip && vid && vid.readyState >= 1 && !exporting) {
      vid.pause();
      setIsPlaying(false);
      vid.currentTime = clip.start;
      setCurrentTime(clip.start);
    }
  };

  // Preload Google Font for crisp canvas text
  useEffect(() => {
    const primaryFont = captionSettings.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    if (document.fonts && typeof document.fonts.load === 'function' && primaryFont) {
      document.fonts.load(`800 ${captionSettings.fontSize}px "${primaryFont}"`).catch(() => {});
    }
  }, [captionSettings.fontFamily, captionSettings.fontSize]);

  // Main live preview render loop
  useEffect(() => {
    let rafId = 0;
    const renderLoop = () => {
      const cvs = canvasRef.current;
      const vid = videoElRef.current;
      if (cvs) {
        const ctx = cvs.getContext('2d', { alpha: false });
        if (ctx) {
          if (vid && vid.readyState >= 2) {
            if (!vid.paused && !vid.ended && framingMode === 'motion') {
              updateMotionFocus(vid, motionRef.current);
            }
            drawVideoFrame(vid, cvs, ctx, {
              framingMode,
              manualPanX,
              motionState: motionRef.current,
              cues,
              captionSettings,
              audioEnv,
            });
            setCurrentTime(vid.currentTime);
            if (!exporting && activeClip && !vid.paused && vid.currentTime >= activeClip.end) {
              vid.pause();
              vid.currentTime = activeClip.end;
              setIsPlaying(false);
            }
          } else {
            drawIdleCanvas(cvs, ctx, ytPreview);
          }
        }
      }
      rafId = requestAnimationFrame(renderLoop);
    };
    rafId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafId);
  }, [
    videoElRef,
    framingMode,
    manualPanX,
    cues,
    captionSettings,
    audioEnv,
    ytPreview,
    activeClip,
    exporting,
  ]);

  useEffect(() => {
    ensureFontLoaded(
      captionSettings.fontFamily,
      Boolean(captionSettings.italic),
      captionSettings.fontWeight || '800'
    );
  }, [captionSettings.fontFamily, captionSettings.italic, captionSettings.fontWeight]);

  // Keyboard shortcuts for comfortable editing (Space play/pause, Left/Right seek 2s)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const vid = videoElRef.current;
      if (!vid || !videoReady || exporting) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (vid.paused) {
          if (activeClip && (vid.currentTime < activeClip.start || vid.currentTime >= activeClip.end)) {
            vid.currentTime = activeClip.start;
          }
          syncPreviewAudio(vid, previewVolume, previewMuted).catch(() => {});
          vid.play().then(() => setIsPlaying(true)).catch(() => {});
        } else {
          vid.pause();
          setIsPlaying(false);
        }
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        vid.currentTime = Math.max(0, vid.currentTime - 2);
        setCurrentTime(vid.currentTime);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        vid.currentTime = Math.min(videoDuration || vid.duration || 0, vid.currentTime + 2);
        setCurrentTime(vid.currentTime);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [videoElRef, videoReady, exporting, activeClip, videoDuration, previewVolume, previewMuted]);

  useEffect(() => {
    const vid = videoElRef.current;
    if (!vid || exporting) return;
    syncPreviewAudio(vid, previewVolume, previewMuted).catch(() => {});
  }, [videoElRef, videoReady, exporting, previewVolume, previewMuted]);

  const handleTogglePlay = async () => {
    const vid = videoElRef.current;
    if (!vid || !videoReady || exporting) return;
    if (!vid.paused) {
      vid.pause();
      setIsPlaying(false);
      return;
    }
    if (activeClip && (vid.currentTime < activeClip.start || vid.currentTime >= activeClip.end)) {
      vid.currentTime = activeClip.start;
    }
    try {
      await syncPreviewAudio(vid, previewVolume, previewMuted);
      await vid.play();
      setIsPlaying(true);
    } catch {}
  };

  const handleScrub = (ratio: number) => {
    const vid = videoElRef.current;
    if (!vid || !videoReady || exporting) return;
    const minT = activeClip ? activeClip.start : 0;
    const maxT = activeClip ? activeClip.end : videoDuration;
    const target = minT + ratio * Math.max(0.1, maxT - minT);
    vid.currentTime = target;
    setCurrentTime(target);
  };

  const handleStep = (delta: number) => {
    const vid = videoElRef.current;
    if (!vid || !videoReady || exporting) return;
    const next = Math.max(0, Math.min(videoDuration || vid.duration || 0, vid.currentTime + delta));
    vid.currentTime = next;
    setCurrentTime(next);
  };

  const clipStart = activeClip ? activeClip.start : 0;
  const clipEnd = activeClip ? activeClip.end : Math.max(1, videoDuration);
  const clipSpan = Math.max(0.1, clipEnd - clipStart);
  const seekRatio = Math.max(0, Math.min(1, (currentTime - clipStart) / clipSpan));
  const selectedCount = clips.filter((c) => c.selected).length;
  const resolvedMime = supportedExportMime(exportFormat);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[316px_minmax(0,1fr)] gap-6 items-start">
      {/* Left Sticky 9:16 Live Preview */}
      <aside className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-4 flex flex-col items-center gap-3 lg:sticky lg:top-20">
        <div
          className="w-full text-center text-xs font-semibold truncate pb-2 border-b border-[#1e3159] text-[#c7ff55]"
          title={activeLabel || t('studio.noVideo')}
        >
          {activeLabel || t('studio.noVideo')}
        </div>

        <div className="relative w-full max-w-[264px]">
          <canvas
            ref={canvasRef}
            width={720}
            height={1280}
            className="w-full aspect-[9/16] bg-[#070e20] border border-[#2a4173] rounded-xl shadow-xl block"
          />

          {aiTranscribing && (
            <div className="absolute inset-0 rounded-xl bg-[#070e20]/88 backdrop-blur-sm border border-[#ff6b00]/50 p-4 flex flex-col items-center justify-center text-center gap-3">
              <div className="text-[11px] font-bold tracking-wide text-[#ff6b00]">
                {t('studio.aiTranscribingBadge')}
              </div>
              <div className="font-mono tabular-nums text-3xl font-extrabold text-white">
                {transcribeEstimatedSec > transcribeElapsedSec
                  ? formatClock(transcribeEstimatedSec - transcribeElapsedSec)
                  : '±0:02'}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-[#93a7cc]">
                {transcribeEstimatedSec > transcribeElapsedSec
                  ? t('studio.estRemaining', { elapsed: formatClock(transcribeElapsedSec) })
                  : t('studio.finishing', { elapsed: formatClock(transcribeElapsedSec) })}
              </div>
              <div className="w-full max-w-[190px] space-y-1.5">
                <div className="h-1.5 bg-[#1a2d59] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#ff6b00] transition-all duration-300"
                    style={{ width: `${Math.max(6, Math.min(98, Math.round(transcribeProgressPct)))}%` }}
                  />
                </div>
                <div className="text-[11px] text-[#dce6f7] leading-snug">
                  {transcribeStageLabel}
                </div>
              </div>
              <button
                type="button"
                onClick={onCancelAiTranscribe}
                className="mt-1 px-3.5 py-1.5 rounded-lg bg-[#16264d] hover:bg-red-950/60 border border-[#2a4173] hover:border-red-500/60 text-xs font-bold text-white inline-flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                {t('studio.cancel')}
              </button>
            </div>
          )}
        </div>

        <div className="w-full space-y-2.5">
          <select
            aria-label={t('studio.noClipsOption')}
            disabled={!clips.length || exporting}
            value={activeClip ? String(selectedClipIdx) : ''}
            onChange={(e) => selectClipForPreview(Number(e.target.value))}
            className="w-full bg-[#0c1733] text-[#f1f5fc] border border-[#2a4173] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#ff6b00] disabled:opacity-45"
          >
            {clips.length === 0 ? (
              <option value="">{t('studio.noClipsOption')}</option>
            ) : (
              clips.map((c, idx) => (
                <option key={c.id} value={idx}>
                  {t('studio.clipOption', {
                    idx: idx + 1,
                    start: formatClock(c.start),
                    end: formatClock(c.end),
                  })}
                </option>
              ))
            )}
          </select>

          <div className="grid grid-cols-[1fr_auto_auto] gap-1.5">
            <button
              type="button"
              disabled={!videoReady || exporting}
              onClick={handleTogglePlay}
              className="py-2 px-3 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isPlaying ? t('studio.pause') : t('studio.play')}
            </button>
            <button
              type="button"
              disabled={!videoReady || exporting}
              onClick={() => handleStep(-2)}
              title={t('studio.stepBack')}
              className="px-2.5 py-2 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-[11px] font-mono text-[#dce6f7] disabled:opacity-40 cursor-pointer"
            >
              -2s
            </button>
            <button
              type="button"
              disabled={!videoReady || exporting}
              onClick={() => handleStep(2)}
              title={t('studio.stepForward')}
              className="px-2.5 py-2 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-[11px] font-mono text-[#dce6f7] disabled:opacity-40 cursor-pointer"
            >
              +2s
            </button>
          </div>

          {/* Preview Sound Volume & Mute */}
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[#0c1733] border border-[#1e3159]">
            <button
              type="button"
              disabled={!videoReady || exporting}
              onClick={() => setPreviewMuted((m) => !m)}
              title={previewMuted ? t('studio.unmutePreview') : t('studio.mutePreview')}
              className="p-1 text-[#dce6f7] hover:text-white disabled:opacity-40 cursor-pointer"
            >
              {previewMuted || previewVolume === 0 ? (
                <VolumeX className="w-3.5 h-3.5 text-[#f87171]" />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-[#c7ff55]" />
              )}
            </button>
            <input
              type="range"
              aria-label={t('studio.mutePreview')}
              min={0}
              max={100}
              disabled={!videoReady || exporting}
              value={previewMuted ? 0 : Math.round(previewVolume * 100)}
              onChange={(e) => {
                const v = Number(e.target.value) / 100;
                setPreviewVolume(v);
                if (v > 0 && previewMuted) setPreviewMuted(false);
              }}
              className="flex-1 cursor-pointer disabled:opacity-40"
            />
            <span className="font-mono tabular-nums text-[10.5px] text-[#93a7cc] w-8 text-right">
              {previewMuted ? '0%' : `${Math.round(previewVolume * 100)}%`}
            </span>
          </div>

          <input
            type="range"
            aria-label="Timeline"
            min={0}
            max={1000}
            disabled={!videoReady || exporting}
            value={Math.round(seekRatio * 1000)}
            onChange={(e) => handleScrub(Number(e.target.value) / 1000)}
            className="w-full cursor-pointer disabled:opacity-40"
          />

          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-[#93a7cc]">
            <span>{videoReady ? formatTimeDecimal(currentTime) : '0:00.0'}</span>
            <span>
              {activeClip
                ? `${formatClock(activeClip.start)} – ${formatClock(activeClip.end)}`
                : '9:16 · 720×1280'}
            </span>
          </div>

          {/* Quick Set In / Out from Playhead */}
          {activeClip && videoReady && (
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              <button
                type="button"
                disabled={exporting}
                onClick={() => onSetClipRange(activeClip.id, currentTime, activeClip.end)}
                className="py-1.5 px-2 rounded-md bg-[#0c1733] hover:bg-[#16264d] border border-[#2a4173] text-[11px] font-semibold text-[#dce6f7] disabled:opacity-40 cursor-pointer"
              >
                {t('studio.setClipStart')}
              </button>
              <button
                type="button"
                disabled={exporting}
                onClick={() => onSetClipRange(activeClip.id, activeClip.start, currentTime)}
                className="py-1.5 px-2 rounded-md bg-[#0c1733] hover:bg-[#16264d] border border-[#2a4173] text-[11px] font-semibold text-[#dce6f7] disabled:opacity-40 cursor-pointer"
              >
                {t('studio.setClipEnd')}
              </button>
            </div>
          )}

          {/* Decoded Audio Waveform Overview */}
          {audioEnv && audioEnv.peaks.length > 0 && videoDuration > 0 && (
            <div className="pt-1 space-y-1">
              <div className="h-8 bg-[#070e20] border border-[#1e3159] rounded-md px-1 flex items-center gap-[1px] overflow-hidden relative">
                {audioEnv.peaks.map((pk, idx) => {
                  const barTime = (idx / audioEnv.peaks.length) * videoDuration;
                  const insideClip = activeClip && barTime >= activeClip.start && barTime <= activeClip.end;
                  return (
                    <span
                      key={idx}
                      className={`flex-1 rounded-full ${insideClip ? 'bg-[#ff6b00]' : 'bg-[#2a4173]'}`}
                      style={{ height: `${Math.round(pk * 88)}%` }}
                    />
                  );
                })}
              </div>
              <div className="text-[10.5px] font-mono tabular-nums text-[#6d83ad] text-center">
                {videoDims.w}×{videoDims.h} · {formatClock(videoDuration)} · {t('studio.spaceShortcut')}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Right Inspector Panels */}
      <div className="space-y-4 min-w-0">
        {/* 3-Tab Studio Navigation */}
        <div
          role="tablist"
          aria-label="Studio Settings"
          className="grid grid-cols-3 gap-1 p-1 bg-[#101d3d] border border-[#1e3159] rounded-xl"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'clips'}
            onClick={() => onChangeTab('clips')}
            className={`py-2 px-3 rounded-lg text-xs font-semibold truncate cursor-pointer transition-colors ${
              activeTab === 'clips'
                ? 'bg-[#16264d] text-white border border-[#2a4173]'
                : 'text-[#93a7cc] hover:text-white'
            }`}
          >
            {t('studio.tabClips')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'style'}
            onClick={() => onChangeTab('style')}
            className={`py-2 px-3 rounded-lg text-xs font-semibold truncate cursor-pointer transition-colors ${
              activeTab === 'style'
                ? 'bg-[#16264d] text-white border border-[#2a4173]'
                : 'text-[#93a7cc] hover:text-white'
            }`}
          >
            {t('studio.tabStyle')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'export'}
            onClick={() => onChangeTab('export')}
            className={`py-2 px-3 rounded-lg text-xs font-semibold truncate cursor-pointer transition-colors ${
              activeTab === 'export'
                ? 'bg-[#16264d] text-white border border-[#2a4173]'
                : 'text-[#93a7cc] hover:text-white'
            }`}
          >
            {t('studio.tabExport')}
          </button>
        </div>

        {/* TAB 1: SUBTITLE & CLIPS */}
        {activeTab === 'clips' && (
          <div className="space-y-4">
            <div className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-white">{t('studio.sourceTitle')}</h2>
                  <p className="text-xs text-[#93a7cc] mt-0.5">
                    {t('studio.sourceDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onChangeSourceHome}
                  className="px-3 py-1.5 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-[#e4ecfa] cursor-pointer"
                >
                  {t('studio.changeVideo')}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1 p-1 bg-[#0c1733] border border-[#1e3159] rounded-lg">
                <button
                  type="button"
                  onClick={() => onChangeSubtitleMode('auto')}
                  className={`py-2 px-2.5 rounded-md text-xs font-semibold truncate cursor-pointer transition-colors ${
                    subtitleMode === 'auto'
                      ? 'bg-[#16264d] text-white border border-[#2a4173]'
                      : 'text-[#93a7cc] hover:text-white'
                  }`}
                >
                  {t('studio.modeAuto')}
                </button>
                <button
                  type="button"
                  onClick={() => onChangeSubtitleMode('external')}
                  className={`py-2 px-2.5 rounded-md text-xs font-semibold truncate cursor-pointer transition-colors ${
                    subtitleMode === 'external'
                      ? 'bg-[#16264d] text-white border border-[#2a4173]'
                      : 'text-[#93a7cc] hover:text-white'
                  }`}
                >
                  {t('studio.modeExternal')}
                </button>
                <button
                  type="button"
                  onClick={() => onChangeSubtitleMode('none')}
                  className={`py-2 px-2.5 rounded-md text-xs font-semibold truncate cursor-pointer transition-colors ${
                    subtitleMode === 'none'
                      ? 'bg-[#16264d] text-[#c7ff55] border border-[#2a4173]'
                      : 'text-[#93a7cc] hover:text-white'
                  }`}
                >
                  {t('studio.modeNone')}
                </button>
              </div>

              {subtitleMode !== 'none' && (
                <div className="bg-[#0c1733] border border-[#1e3159] rounded-lg p-3.5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-[#e4ecfa] flex items-center gap-1.5">
                        <Subtitles className="w-3.5 h-3.5 text-[#c7ff55]" />
                        {t('studio.extSubTitle')}
                      </div>
                      <div className="text-[11.5px] font-mono text-[#93a7cc] truncate mt-0.5">
                        {importedSubName
                          ? t('studio.cuesActiveNamed', { name: importedSubName, count: cues.length })
                          : cues.length > 0
                            ? t('studio.cuesActiveCount', { count: cues.length })
                            : t('studio.noCuesYet')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
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
                      <button
                        type="button"
                        onClick={() => srtInputRef.current?.click()}
                        className="px-3 py-1.5 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        {t('home.pickSrt')}
                      </button>
                      {importedSubName && (
                        <button
                          type="button"
                          onClick={onResetSubtitleFile}
                          className="px-2.5 py-1.5 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs text-[#dce6f7] cursor-pointer"
                        >
                          {t('studio.reset')}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Opt-in AI Speech-to-Text Section */}
                  {subtitleMode === 'auto' && (
                    <div className="pt-3 border-t border-[#1e3159] space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-[#ff6b00]" />
                          {t('studio.aiSttTitle')}
                        </div>
                        <select
                          aria-label={t('studio.aiSttTitle')}
                          value={aiTranscribeLang}
                          onChange={(e) => onChangeAiTranscribeLang(e.target.value)}
                          className="bg-[#101d3d] text-[#e4ecfa] border border-[#2a4173] rounded-md px-2.5 py-1 text-xs"
                        >
                          {APP_LANGUAGES.map((lang) => (
                            <option key={lang.code} value={lang.code}>
                              {lang.nativeName}
                            </option>
                          ))}
                          <option value="auto">{t('studio.langAuto')}</option>
                        </select>
                      </div>
                      <label className="flex items-start gap-2 text-xs text-[#b8c7e3] cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={aiTranscribeConsent}
                          onChange={(e) => onChangeAiTranscribeConsent(e.target.checked)}
                          className="mt-0.5"
                        />
                        <span>{t('studio.aiConsentText')}</span>
                      </label>
                      {transcribeError && !aiTranscribing && (
                        <div className="p-2.5 rounded-lg bg-red-950/35 border border-red-500/45 text-xs text-red-200 flex flex-wrap items-center justify-between gap-2">
                          <span className="flex-1 min-w-[180px]">{transcribeError}</span>
                          <button
                            type="button"
                            disabled={!videoReady || !aiTranscribeConsent || exporting}
                            onClick={onRunAiTranscribe}
                            className="px-2.5 py-1 rounded-md bg-red-500/20 hover:bg-red-500/35 border border-red-400/40 text-xs font-bold text-white inline-flex items-center gap-1 cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                            {t('studio.retry')}
                          </button>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        {aiTranscribing ? (
                          <>
                            <div className="flex-1 py-2 px-3 rounded-lg bg-[#16264d] border border-[#2a4173] text-xs font-semibold text-[#dce6f7] flex items-center justify-between gap-2">
                              <span className="truncate">{transcribeStageLabel}</span>
                              <span className="font-mono tabular-nums text-[#c7ff55] shrink-0">
                                {transcribeEstimatedSec > transcribeElapsedSec
                                  ? t('studio.remainingShort', {
                                      time: formatClock(transcribeEstimatedSec - transcribeElapsedSec),
                                    })
                                  : formatClock(transcribeElapsedSec)}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={onCancelAiTranscribe}
                              className="py-2 px-3.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                              {t('studio.cancel')}
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={!videoReady || !aiTranscribeConsent || exporting}
                              onClick={onRunAiTranscribe}
                              className="flex-1 py-2 px-4 rounded-lg bg-[#ff6b00] hover:bg-[#ff8224] disabled:opacity-40 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                            >
                              {cues.length > 0 ? (
                                <>
                                  <RotateCcw className="w-3.5 h-3.5" />
                                  {t('studio.regenerateSub')}
                                </>
                              ) : (
                                <>
                                  <Sparkles className="w-3.5 h-3.5" />
                                  {t('studio.generateSub')}
                                </>
                              )}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Clip Parameters */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11.5px] text-[#b8c7e3] font-medium mb-1">
                    {t('studio.clipTargetDur')}
                  </label>
                  <select
                    value={clipLengthRange}
                    onChange={(e) => onChangeClipLengthRange(e.target.value)}
                    className="w-full bg-[#0c1733] text-[#f1f5fc] border border-[#2a4173] rounded-lg px-3 py-2 text-xs"
                  >
                    <option value="30-60">30–60 {t('studio.secSuffix')}</option>
                    <option value="60-90">60–90 {t('studio.secSuffix')}</option>
                    <option value="90-150">90–150 {t('studio.secSuffix')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11.5px] text-[#b8c7e3] font-medium mb-1">
                    {t('studio.clipMaxCount')}
                  </label>
                  <select
                    value={clipLimit}
                    onChange={(e) => onChangeClipLimit(Number(e.target.value))}
                    className="w-full bg-[#0c1733] text-[#f1f5fc] border border-[#2a4173] rounded-lg px-3 py-2 text-xs"
                  >
                    {[3, 5, 8, 10, 12, 15, 20].map((n) => (
                      <option key={n} value={n}>
                        {t('session.clipsCount', { count: n })}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end gap-1.5">
                  <button
                    type="button"
                    disabled={!videoReady || exporting}
                    onClick={onReanalyzeClips}
                    className="flex-1 py-2 px-3 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                  >
                    <Scissors className="w-3.5 h-3.5 text-[#c7ff55]" />
                    {t('studio.reanalyze')}
                  </button>
                  <button
                    type="button"
                    disabled={!videoReady || cues.length < 3 || exporting || aiFindingHighlights}
                    onClick={onFindAiHighlights}
                    title={cues.length < 3 ? t('studio.aiHighlightsNeedSub') : t('studio.aiHighlightsTip')}
                    className="flex-1 py-2 px-3 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-[#c7ff55] inline-flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#ff6b00]" />
                    {aiFindingHighlights ? t('studio.analyzing') : t('studio.aiHighlights')}
                  </button>
                </div>
              </div>

              {/* Inline Subtitle Text Editor */}
              {cues.length > 0 && subtitleMode !== 'none' && (
                <div className="pt-2 border-t border-[#1e3159] space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowTranscriptEditor((v) => !v)}
                    className="text-xs font-bold text-[#c7ff55] hover:underline cursor-pointer"
                  >
                    {showTranscriptEditor
                      ? t('studio.hideTranscriptEditor')
                      : t('studio.showTranscriptEditor', { count: cues.length })}
                  </button>
                  {showTranscriptEditor && (
                    <div className="space-y-2">
                      <div className="text-[11px] text-[#93a7cc]">
                        {t('studio.transcriptEditHint')}
                      </div>
                      <textarea
                        value={transcriptEditorText}
                        onChange={(e) => onChangeTranscriptEditorText(e.target.value)}
                        rows={7}
                        className="w-full bg-[#070e20] text-[#e4ecfa] border border-[#2a4173] rounded-lg p-2.5 font-mono text-xs leading-relaxed focus:outline-none focus:border-[#ff6b00]"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={onApplyTranscriptEdit}
                          className="px-3 py-1.5 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-white cursor-pointer"
                        >
                          {t('studio.applyEdits')}
                        </button>
                        <button
                          type="button"
                          onClick={onDownloadSrt}
                          className="px-3 py-1.5 rounded-lg bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-xs font-semibold text-[#dce6f7] inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          {t('studio.downloadSrt')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Clip List with Interactive Fine-Trim */}
            <div className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-white">
                    {t('studio.clipListTitle', { selected: selectedCount, total: clips.length })}
                  </h2>
                  <p className="text-xs text-[#93a7cc]">
                    {t('studio.clipListDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!clips.length}
                  onClick={() => onChangeTab('export')}
                  className="px-3.5 py-1.5 rounded-lg bg-[#ff6b00] hover:bg-[#ff8224] disabled:opacity-40 text-white text-xs font-bold cursor-pointer"
                >
                  {t('studio.nextToExport')}
                </button>
              </div>

              {activeClip && (
                <TrimBar
                  start={activeClip.start}
                  end={activeClip.end}
                  maxDuration={videoDuration}
                  cues={cues}
                  audioEnv={audioEnv}
                  disabled={exporting}
                  onCommit={(nextStart, nextEnd) => onSetClipRange(activeClip.id, nextStart, nextEnd)}
                />
              )}

              {clips.length === 0 ? (
                <div className="border border-dashed border-[#2a4173] rounded-lg p-6 text-center text-xs text-[#93a7cc] bg-[#0c1733]">
                  {t('studio.emptyClipsHint')}
                </div>
              ) : (
                <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                  {clips.map((clip, idx) => {
                    const isActive = idx === selectedClipIdx;
                    return (
                      <article
                        key={clip.id}
                        onClick={() => selectClipForPreview(idx)}
                        className={`rounded-xl border p-3.5 cursor-pointer transition-colors space-y-2 ${
                          isActive
                            ? 'bg-[#142347] border-[#ff6b00]/70'
                            : 'bg-[#0c1733] border-[#1e3159] hover:border-[#2a4173]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={clip.selected}
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => onToggleClip(clip.id)}
                              className="mt-1 cursor-pointer"
                            />
                            <div className="min-w-0">
                              <h3 className="text-xs font-bold text-white leading-snug">
                                {clip.title}
                              </h3>
                              <div className="text-[11.5px] font-mono tabular-nums text-[#c7ff55] mt-0.5">
                                {formatTimeDecimal(clip.start)} – {formatTimeDecimal(clip.end)} · {t('studio.durationLabel')}{' '}
                                {formatClock(clip.end - clip.start)}
                                {clip.aiScored ? ` · ${t('studio.scoreLabel', { score: Math.round(clip.score) })}` : ''}
                              </div>
                            </div>
                          </div>

                          {/* Fine Trim Nudges */}
                          <div
                            className="flex items-center gap-1 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => onNudgeClip(clip.id, 'start', -0.5)}
                              title="-0.5s"
                              className="px-1.5 py-0.5 rounded bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-[10.5px] font-mono text-[#dce6f7] cursor-pointer"
                            >
                              -0.5s
                            </button>
                            <button
                              type="button"
                              onClick={() => onNudgeClip(clip.id, 'start', 0.5)}
                              title="+0.5s"
                              className="px-1.5 py-0.5 rounded bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-[10.5px] font-mono text-[#dce6f7] cursor-pointer"
                            >
                              +0.5s
                            </button>
                            <span className="text-[#3e578f] text-xs px-0.5">|</span>
                            <button
                              type="button"
                              onClick={() => onNudgeClip(clip.id, 'end', -0.5)}
                              title="-0.5s"
                              className="px-1.5 py-0.5 rounded bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-[10.5px] font-mono text-[#dce6f7] cursor-pointer"
                            >
                              -0.5s
                            </button>
                            <button
                              type="button"
                              onClick={() => onNudgeClip(clip.id, 'end', 0.5)}
                              title="+0.5s"
                              className="px-1.5 py-0.5 rounded bg-[#16264d] hover:bg-[#1e3363] border border-[#2a4173] text-[10.5px] font-mono text-[#dce6f7] cursor-pointer"
                            >
                              +0.5s
                            </button>
                          </div>
                        </div>

                        {clip.hook && (
                          <p className="text-[11px] text-[#dce6f7]">
                            <strong className="text-[#ff6b00]">{t('studio.hookLabel')}</strong> “{clip.hook}”
                          </p>
                        )}
                        <p className="text-[11.5px] text-[#b8c7e3]">
                          <strong className="text-[#dce6f7]">{t('studio.reasonLabel')}</strong>{' '}
                          {clip.reasons.join(' ')}
                        </p>
                        {clip.quote && (
                          <p className="text-[11px] text-[#93a7cc] italic">“{clip.quote}”</p>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: FONT & STYLE */}
        {activeTab === 'style' && (
          <div className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-white">{t('studio.styleTitle')}</h2>
                <p className="text-xs text-[#93a7cc] mt-0.5">
                  {t('studio.styleDesc')}
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#e4ecfa] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={captionSettings.showCaptions}
                  onChange={(e) => onChangeCaptionSettings({ showCaptions: e.target.checked })}
                />
                <span>{t('studio.showCaptions')}</span>
              </label>
            </div>

            {(!captionSettings.showCaptions || subtitleMode === 'none') && (
              <div className="bg-[#0c1733] border border-[#2a4173] rounded-lg p-3 text-xs text-[#dce6f7]">
                {t('studio.captionsHiddenNotice')}
              </div>
            )}

            <CaptionStylePanel
              settings={captionSettings}
              onChange={onChangeCaptionSettings}
            />
          </div>
        )}

        {/* TAB 3: FRAMING & EXPORT */}
        {activeTab === 'export' && (
          <div className="bg-[#101d3d] border border-[#1e3159] rounded-xl p-5 space-y-4">
            <div>
              <h2 className="text-sm font-bold text-white">{t('studio.framingTitle')}</h2>
              <p className="text-xs text-[#93a7cc] mt-0.5">
                {t('studio.framingDesc', { count: selectedCount })}
              </p>
            </div>

            <div className="space-y-2">
              <label
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  framingMode === 'fit'
                    ? 'border-[#ff6b00]/60 bg-[#ff6b00]/5'
                    : 'border-[#1e3159] bg-[#0c1733]'
                }`}
              >
                <input
                  type="radio"
                  name="framingMode"
                  checked={framingMode === 'fit'}
                  onChange={() => onChangeFramingMode('fit')}
                  className="mt-1"
                />
                <div>
                  <div className="text-xs font-bold text-white">{t('studio.framingFit')}</div>
                  <div className="text-[11.5px] text-[#93a7cc] mt-0.5">
                    {t('studio.framingFitDesc')}
                  </div>
                </div>
              </label>

              <label
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  framingMode === 'motion'
                    ? 'border-[#ff6b00]/60 bg-[#ff6b00]/5'
                    : 'border-[#1e3159] bg-[#0c1733]'
                }`}
              >
                <input
                  type="radio"
                  name="framingMode"
                  checked={framingMode === 'motion'}
                  onChange={() => onChangeFramingMode('motion')}
                  className="mt-1"
                />
                <div>
                  <div className="text-xs font-bold text-white">
                    {t('studio.framingMotion')}
                  </div>
                  <div className="text-[11.5px] text-[#93a7cc] mt-0.5">
                    {t('studio.framingMotionDesc')}
                  </div>
                </div>
              </label>

              <label
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  framingMode === 'manual'
                    ? 'border-[#ff6b00]/60 bg-[#ff6b00]/5'
                    : 'border-[#1e3159] bg-[#0c1733]'
                }`}
              >
                <input
                  type="radio"
                  name="framingMode"
                  checked={framingMode === 'manual'}
                  onChange={() => onChangeFramingMode('manual')}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white">{t('studio.framingManual')}</div>
                  <div className="text-[11.5px] text-[#93a7cc] mt-0.5">
                    {t('studio.framingManualDesc')}
                  </div>
                  {framingMode === 'manual' && (
                    <div className="mt-2.5 flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(manualPanX * 100)}
                        onChange={(e) => onChangeManualPanX(Number(e.target.value) / 100)}
                        className="flex-1 cursor-pointer"
                      />
                      <span className="font-mono tabular-nums text-xs text-[#c7ff55] w-10 text-right">
                        {Math.round(manualPanX * 100)}%
                      </span>
                      <button
                        type="button"
                        onClick={() => onChangeManualPanX(0.5)}
                        className="p-1 rounded bg-[#16264d] border border-[#2a4173] text-[#dce6f7] cursor-pointer"
                        title="50%"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              </label>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs text-[#b8c7e3] font-medium">{t('studio.exportFormatLabel')}</label>
                <span className="text-[11px] font-mono text-[#93a7cc]">
                  {t('studio.activeCodec', {
                    codec: resolvedMime ? resolvedMime.split(';')[0] : t('studio.unsupported'),
                  })}
                </span>
              </div>
              <select
                value={exportFormat}
                disabled={exporting}
                onChange={(e) => onChangeExportFormat(e.target.value as ExportFormat)}
                className="w-full bg-[#0c1733] text-[#f1f5fc] border border-[#2a4173] rounded-lg px-3 py-2 text-xs"
              >
                <option value="webm">{t('studio.formatWebm')}</option>
                <option value="mp4">{t('studio.formatMp4')}</option>
              </select>
            </div>

            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                disabled={!videoReady || selectedCount === 0 || exporting || !resolvedMime}
                onClick={onStartExport}
                className="flex-1 py-2.5 px-4 rounded-lg bg-[#ff6b00] hover:bg-[#ff8224] disabled:opacity-40 text-white text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                {exporting ? t('studio.exporting') : t('studio.exportBtn', { count: selectedCount })}
              </button>
              {exporting && (
                <button
                  type="button"
                  onClick={onStopExport}
                  className="py-2.5 px-4 rounded-lg bg-[#16264d] hover:bg-red-950/50 border border-[#2a4173] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  {t('studio.stop')}
                </button>
              )}
            </div>

            {(exporting || exportProgressPct > 0) && (
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#dce6f7]">{exportProgressLabel}</span>
                  <span className="font-mono tabular-nums font-bold text-[#c7ff55]">
                    {Math.round(exportProgressPct)}%
                  </span>
                </div>
                <div className="h-1.5 bg-[#1a2d59] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#ff6b00] transition-all duration-150"
                    style={{ width: `${Math.max(0, Math.min(100, exportProgressPct))}%` }}
                  />
                </div>
              </div>
            )}

            <div className="text-xs text-[#b8c7e3] min-h-[18px]">{statusMessage}</div>

            {latestDownloads.length > 0 && (
              <div className="space-y-2.5 pt-2 border-t border-[#1e3159]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#dce6f7]">
                    {t('studio.readyDownloadCount', { count: latestDownloads.length })}
                  </span>
                  {latestExportRecords.length > 0 && (
                    <button
                      type="button"
                      disabled={zipExporting}
                      onClick={async () => {
                        if (zipExporting || !latestExportRecords.length) return;
                        setZipExporting(true);
                        try {
                          await downloadProjectZip(
                            latestExportRecords,
                            activeLabel || latestExportRecords[0]?.projectName || 'Paijo Clip'
                          );
                        } finally {
                          setZipExporting(false);
                        }
                      }}
                      className="px-3.5 py-2 rounded-lg bg-[#ff6b00] hover:bg-[#ff8224] disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      {zipExporting
                        ? t('studio.packingZip')
                        : t('studio.downloadAllZipCount', { count: latestExportRecords.length })}
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {latestDownloads.map((dl) => (
                    <a
                      key={dl.url}
                      href={dl.url}
                      download={dl.filename}
                      className="px-3.5 py-2 rounded-lg bg-[#c7ff55] hover:bg-[#d6ff7d] text-[#111507] text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {t('studio.downloadClipRange', { range: dl.rangeText, ext: dl.ext.toUpperCase() })}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
