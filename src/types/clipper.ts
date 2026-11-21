export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
  _chunks?: string[][];
  _chunksFor?: string;
}

export interface ClipCandidate {
  id: string;
  start: number;
  end: number;
  title: string;
  reasons: string[];
  quote: string;
  hook?: string;
  aiScored?: boolean;
  score: number;
  selected: boolean;
}

export type SubtitleMode = 'auto' | 'external' | 'none';

export type SubtitleStyleId =
  | 'capcut'
  | 'tiktok_stroke'
  | 'hormozi'
  | 'highlight'
  | 'pop'
  | 'box3d'
  | 'pill_glass'
  | 'retro_shadow'
  | 'outline_hollow'
  | 'typewriter_box'
  | 'gradient'
  | 'karaoke_bar'
  | 'classic'
  | 'clean'
  | 'neon'
  | 'glitch_rgb'
  | 'comic_boom'
  | 'fire_glow'
  | 'kinetic_underline'
  | 'editorial_frame';

export type SubtitlePosition = 'bottom' | 'lower' | 'center' | 'top';

export type FramingMode = 'fit' | 'motion' | 'manual';

export type ExportFormat = 'webm' | 'mp4';

export interface CaptionSettings {
  showCaptions: boolean;
  fontFamily: string;
  style: SubtitleStyleId;
  fontSize: number;
  position: SubtitlePosition;
  highlightColor: string;
  caps: boolean;
  italic?: boolean;
  fontWeight?: '700' | '800' | '900';
}

export interface AudioEnvelopeData {
  hop: number;
  rms: Float32Array;
  n: number;
  thr: number;
  peaks: number[];
}

export interface MotionState {
  previous: Uint8ClampedArray | null;
  focusX: number;
  targetX: number;
  lastSampleTime: number;
  filteredX: number | null;
  prevDerivative: number;
  prevFilterTime: number | null;
  prevMeanLum: number | null;
}

export interface ExportedClipRecord {
  id: string;
  projectId: string;
  projectName: string;
  url: string;
  filename: string;
  ext: string;
  rangeText: string;
  durationSec: number;
  sizeBytes: number;
  label: string;
  sourceLabel: string;
  hook?: string;
  captionText?: string;
  createdAt: number;
}

export type BatchItemStatus = 'queued' | 'loading' | 'analyzing' | 'exporting' | 'done' | 'error' | 'stopped';

export interface BatchQueueItem {
  id: string;
  file: File;
  name: string;
  size: number;
  status: BatchItemStatus;
  statusText: string;
  progress: number;
  clipsCount: number;
  exportedCount: number;
}

export interface YoutubePreviewInfo {
  id: string;
  url: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: number;
  canDownloadDirect: boolean;
  state: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
}

export type AppView = 'home' | 'aivideo' | 'studio' | 'exports' | 'download' | 'updates';
export type StudioTab = 'clips' | 'style' | 'export';

export interface PaijoUpdateDownloadProgress {
  stage: 'downloading' | 'verifying' | 'done' | 'error' | 'cancelled';
  receivedBytes: number;
  totalBytes: number;
  filename?: string;
  filePath?: string;
  error?: string;
}

export interface PaijoDesktopBridge {
  isDesktop: boolean;
  platform: string;
  setRenderActive?: (active: boolean) => void;
  downloadUpdate?: (payload: {
    url: string;
    filename?: string;
    sha256?: string;
  }) => Promise<{ ok: boolean; filePath?: string; filename?: string; bytes?: number; error?: string }>;
  cancelUpdateDownload?: () => void;
  onUpdateDownloadProgress?: (
    cb: (progress: PaijoUpdateDownloadProgress) => void
  ) => () => void;
  openDownloadedUpdate?: (filePath: string) => Promise<string>;
  showItemInFolder?: (filePath: string) => Promise<boolean>;
}

declare global {
  interface Window {
    paijoDesktop?: PaijoDesktopBridge;
  }
}

export interface AiScene {
  index: number;
  visualTitle: string;
  narration: string;
  captionText: string;
  imagePrompt: string;
  durationSec: number;
  timestampLabel: string;
  customImageUrl?: string;
}

export interface AiVoiceTrack {
  url: string;
  durationSec: number;
  source: 'tts' | 'microphone';
}

export type AiVisualEffect =
  | 'kenburns'
  | 'cinematic'
  | 'pulse'
  | 'pan_sweep'
  | 'handheld'
  | 'vhs_retro'
  | 'glitch_rgb'
  | 'none';
export type AiTransitionStyle =
  | 'fade'
  | 'zoom'
  | 'slide'
  | 'wipe_up'
  | 'whip_blur'
  | 'flash_white'
  | 'iris_circle'
  | 'none';
export type AiTheme = 'cinematic' | 'editorial' | 'tech' | 'minimal';
