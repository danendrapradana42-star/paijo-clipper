import { readApiJson } from './safeApiJson';

export type ScriptEngineId =
  | 'local_auto'
  | 'local_builtin'
  | 'local_ollama'
  | 'local_openai'
  | 'gemini';

export type VoiceEngineId =
  | 'local_auto'
  | 'local_voicestudio'
  | 'local_tts'
  | 'local_cadence'
  | 'gemini';

export interface LocalBinaryProbe {
  available: boolean;
  command?: string;
  binaryName?: string;
  version?: string;
  optimized?: boolean;
  accelerators?: string[];
}

export interface LocalSystemBinaries {
  ffmpeg: LocalBinaryProbe;
  whisper: LocalBinaryProbe;
}

export interface VoiceStudioProfileItem {
  id: string;
  name: string;
  language?: string;
}

export type LocalStatusPayload = {
  desktopOnly?: boolean;
  builtinStory: { available: boolean; label: string };
  ollama: { available: boolean; endpoint: string; models: string[] };
  openaiLocal: { available: boolean; endpoint: string; models: string[] };
  cloudGemini: { available: boolean };
  binaries?: LocalSystemBinaries;
  localTts: {
    osSpeechAvailable: boolean;
    osEngineName: string;
    cadenceAvailable: boolean;
    voiceStudioAvailable?: boolean;
    voiceStudioEndpoint?: string;
    voiceStudioProfilesCount?: number;
  };
};

export type LocalAiRuntimeReport = LocalStatusPayload & {
  isDesktop: boolean;
  executionMode: 'local' | 'cloud';
  checkedAt: number;
  binaries: LocalSystemBinaries;
  voiceStudioProfiles: VoiceStudioProfileItem[];
  hasOptimizedMediaRuntime: boolean;
  recommendedScriptEngine: ScriptEngineId;
  recommendedVoiceEngine: VoiceEngineId;
};

export interface VideoAiExecutionDecision {
  clientMode: 'desktop' | 'web';
  useLocalProcess: boolean;
  scriptProvider: ScriptEngineId;
  voiceProvider: VoiceEngineId;
}

export const LOCAL_BINARY_PREFS_KEY = 'autoclipper.local.binaries.v1';

export type LocalBinaryPathPrefs = {
  ffmpegPath: string;
  whisperPath: string;
};

export function loadLocalBinaryPrefs(): LocalBinaryPathPrefs {
  try {
    const raw = localStorage.getItem(LOCAL_BINARY_PREFS_KEY);
    if (!raw) return { ffmpegPath: '', whisperPath: '' };
    const parsed = JSON.parse(raw) as Partial<LocalBinaryPathPrefs>;
    return {
      ffmpegPath: String(parsed.ffmpegPath || '').trim(),
      whisperPath: String(parsed.whisperPath || '').trim(),
    };
  } catch {
    return { ffmpegPath: '', whisperPath: '' };
  }
}

export function saveLocalBinaryPrefs(prefs: Partial<LocalBinaryPathPrefs>): LocalBinaryPathPrefs {
  const current = loadLocalBinaryPrefs();
  const next: LocalBinaryPathPrefs = {
    ffmpegPath:
      prefs.ffmpegPath !== undefined ? String(prefs.ffmpegPath || '').trim() : current.ffmpegPath,
    whisperPath:
      prefs.whisperPath !== undefined ? String(prefs.whisperPath || '').trim() : current.whisperPath,
  };
  try {
    if (!next.ffmpegPath && !next.whisperPath) {
      localStorage.removeItem(LOCAL_BINARY_PREFS_KEY);
    } else {
      localStorage.setItem(LOCAL_BINARY_PREFS_KEY, JSON.stringify(next));
    }
  } catch {
    // Ignore storage quota / sandbox errors
  }
  clearLocalAiRuntimeCache();
  return next;
}

const DEFAULT_BINARIES: LocalSystemBinaries = {
  ffmpeg: { available: false, optimized: false, accelerators: [] },
  whisper: { available: false },
};

let runtimeCache: {
  key: string;
  expiresAt: number;
  report: LocalAiRuntimeReport;
} | null = null;

/**
 * Checks whether the app is currently executing inside the Electron Desktop runtime.
 * Web browsers (even on localhost) return false so local AI remains Desktop-only.
 */
export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.paijoDesktop?.isDesktop);
}

export function clearLocalAiRuntimeCache(): void {
  runtimeCache = null;
}

function buildCloudOnlyReport(cloudGeminiAvailable: boolean): LocalAiRuntimeReport {
  return {
    isDesktop: false,
    executionMode: 'cloud',
    desktopOnly: true,
    checkedAt: Date.now(),
    builtinStory: { available: false, label: 'Khusus Aplikasi Desktop' },
    ollama: { available: false, endpoint: 'http://127.0.0.1:11434', models: [] },
    openaiLocal: { available: false, endpoint: 'http://127.0.0.1:1234/v1', models: [] },
    cloudGemini: { available: cloudGeminiAvailable },
    binaries: {
      ffmpeg: { available: false, optimized: false, accelerators: [] },
      whisper: { available: false },
    },
    localTts: {
      osSpeechAvailable: false,
      osEngineName: 'Gemini Cloud TTS + Voice Studio',
      cadenceAvailable: false,
      voiceStudioAvailable: false,
      voiceStudioEndpoint: 'http://127.0.0.1:3900',
      voiceStudioProfilesCount: 0,
    },
    voiceStudioProfiles: [],
    hasOptimizedMediaRuntime: false,
    recommendedScriptEngine: 'gemini',
    recommendedVoiceEngine: 'gemini',
  };
}

/**
 * Detects local AI runtimes (Built-in Story AI, Ollama, LM Studio/OpenAI-compat,
 * VoiceStudio, OS Speech) and native optimized binaries (`ffmpeg`, `whisper`)
 * on the Desktop app. On Web browsers, returns a cloud-only status report.
 */
export async function detectLocalAiRuntime(options?: {
  endpoint?: string;
  ffmpegPath?: string;
  whisperPath?: string;
  forceRefresh?: boolean;
  cacheTtlMs?: number;
}): Promise<LocalAiRuntimeReport> {
  const isDesktop = isDesktopRuntime();
  const savedPrefs = loadLocalBinaryPrefs();
  const endpoint = String(options?.endpoint || '').trim();
  const ffmpegPath = String(options?.ffmpegPath ?? savedPrefs.ffmpegPath ?? '').trim();
  const whisperPath = String(options?.whisperPath ?? savedPrefs.whisperPath ?? '').trim();
  const forceRefresh = Boolean(options?.forceRefresh);
  const ttlMs = Math.max(2_000, options?.cacheTtlMs ?? 20_000);
  const cacheKey = `${isDesktop ? 'desktop' : 'web'}|${endpoint}|${ffmpegPath}|${whisperPath}`;

  if (!forceRefresh && runtimeCache && runtimeCache.key === cacheKey && runtimeCache.expiresAt > Date.now()) {
    return runtimeCache.report;
  }

  if (!isDesktop) {
    let cloudAvailable = false;
    try {
      const res = await fetch('/api/health');
      const health = await readApiJson<{ aiConfigured?: boolean }>(
        res,
        'Gagal memeriksa status server.'
      );
      cloudAvailable = Boolean(health.aiConfigured);
    } catch {
      cloudAvailable = false;
    }
    const report = buildCloudOnlyReport(cloudAvailable);
    runtimeCache = { key: cacheKey, expiresAt: Date.now() + ttlMs, report };
    return report;
  }

  const params = new URLSearchParams({ mode: 'desktop' });
  if (endpoint) params.set('endpoint', endpoint);
  if (ffmpegPath) params.set('ffmpegPath', ffmpegPath);
  if (whisperPath) params.set('whisperPath', whisperPath);
  if (forceRefresh) params.set('refresh', '1');

  const [localRes, vsRes] = await Promise.all([
    fetch(`/api/ai-video/local-status?${params.toString()}`),
    fetch('/api/voice-studio/status?mode=desktop'),
  ]);

  const data = await readApiJson<LocalStatusPayload>(
    localRes,
    'Gagal memeriksa mesin AI lokal.'
  );

  let vsProfiles: VoiceStudioProfileItem[] = [];
  if (vsRes.ok) {
    try {
      const vsData = await readApiJson<{ profiles?: VoiceStudioProfileItem[] }>(
        vsRes,
        'Gagal membaca profil VoiceStudio.'
      );
      vsProfiles = Array.isArray(vsData.profiles) ? vsData.profiles : [];
    } catch {
      vsProfiles = [];
    }
  }

  const binaries: LocalSystemBinaries = data.binaries || DEFAULT_BINARIES;

  const recommendedScriptEngine: ScriptEngineId =
    data.ollama?.available && data.ollama.models.length > 0
      ? 'local_ollama'
      : data.openaiLocal?.available
        ? 'local_openai'
        : data.builtinStory?.available
          ? 'local_builtin'
          : 'local_auto';

  const recommendedVoiceEngine: VoiceEngineId = data.localTts?.voiceStudioAvailable
    ? 'local_voicestudio'
    : data.localTts?.osSpeechAvailable || data.localTts?.cadenceAvailable
      ? 'local_auto'
      : 'gemini';

  const hasOptimizedMediaRuntime = Boolean(
    binaries.ffmpeg?.available ||
      binaries.whisper?.available ||
      data.localTts?.voiceStudioAvailable ||
      data.localTts?.osSpeechAvailable
  );

  const report: LocalAiRuntimeReport = {
    ...data,
    isDesktop: true,
    executionMode: 'local',
    checkedAt: Date.now(),
    binaries,
    voiceStudioProfiles: vsProfiles,
    hasOptimizedMediaRuntime,
    recommendedScriptEngine,
    recommendedVoiceEngine,
  };

  runtimeCache = { key: cacheKey, expiresAt: Date.now() + ttlMs, report };
  return report;
}

/**
 * Resolves whether Video AI script & voice generation should execute locally or via Cloud API.
 * Strictly switches to local execution when `isRunningDesktop` is true (unless user explicitly picks Cloud),
 * and strictly locks to Gemini Cloud API when running on Web.
 */
export function resolveVideoAiExecution(params: {
  isRunningDesktop?: boolean;
  runtime?: LocalAiRuntimeReport | null;
  requestedScriptEngine?: ScriptEngineId;
  requestedVoiceEngine?: VoiceEngineId;
}): VideoAiExecutionDecision {
  const desktop = params.isRunningDesktop ?? isDesktopRuntime();
  if (!desktop) {
    return {
      clientMode: 'web',
      useLocalProcess: false,
      scriptProvider: 'gemini',
      voiceProvider: 'gemini',
    };
  }

  const reqScript = params.requestedScriptEngine || 'local_auto';
  const reqVoice = params.requestedVoiceEngine || 'local_auto';
  const runtime = params.runtime;

  let scriptProvider: ScriptEngineId = reqScript;
  if (reqScript === 'local_auto' && runtime) {
    scriptProvider = runtime.recommendedScriptEngine || 'local_auto';
  }

  let voiceProvider: VoiceEngineId = reqVoice;
  if (reqVoice === 'local_auto' && runtime) {
    voiceProvider = runtime.recommendedVoiceEngine || 'local_auto';
  }

  return {
    clientMode: 'desktop',
    useLocalProcess: scriptProvider !== 'gemini' || voiceProvider !== 'gemini',
    scriptProvider,
    voiceProvider,
  };
}
