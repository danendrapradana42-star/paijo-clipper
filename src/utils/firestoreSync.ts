import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  AiScene,
  AiTheme,
  CaptionSettings,
  ClipCandidate,
  ExportFormat,
  FramingMode,
  SubtitlePosition,
  SubtitleStyleId,
} from '../types/clipper';
import { OperationType, db, handleFirestoreError } from './firebase';

const VALID_STYLES = new Set<SubtitleStyleId>([
  'capcut',
  'tiktok_stroke',
  'hormozi',
  'highlight',
  'pop',
  'box3d',
  'pill_glass',
  'retro_shadow',
  'outline_hollow',
  'typewriter_box',
  'gradient',
  'karaoke_bar',
  'classic',
  'clean',
  'neon',
]);

const VALID_POSITIONS = new Set<SubtitlePosition>(['bottom', 'lower', 'center', 'top']);
const VALID_FRAMING = new Set<FramingMode>(['fit', 'motion', 'manual']);
const VALID_FORMATS = new Set<ExportFormat>(['webm', 'mp4']);
const VALID_LENGTH_RANGES = new Set(['30-60', '60-90', '90-150']);
const VALID_THEMES = new Set<AiTheme>(['cinematic', 'editorial', 'tech', 'minimal']);

export function toFirestoreSafeId(raw: string, fallback = 'item'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return cleaned || fallback;
}

export interface StudioPreferenceDoc {
  captionSettings: CaptionSettings;
  clipLengthRange: string;
  clipLimit: number;
  framingMode: FramingMode;
  exportFormat: ExportFormat;
  updatedAtMs: number;
}

export interface SavedClipProject {
  id: string;
  projectKey: string;
  projectName: string;
  sourceLabel: string;
  durationSec: number;
  clipsCount: number;
  exportedCount: number;
  clips: Array<{
    id: string;
    start: number;
    end: number;
    title: string;
    score: number;
    selected: boolean;
  }>;
  updatedAtMs: number;
}

export interface SavedAiScript {
  id: string;
  title: string;
  prompt: string;
  durationMinutes: number;
  totalDurationSec: number;
  theme: AiTheme;
  language: 'id' | 'en';
  voiceName: string;
  scenes: AiScene[];
  updatedAtMs: number;
}

function timestampToMs(ts: unknown): number {
  if (ts && typeof (ts as Timestamp).toMillis === 'function') {
    return (ts as Timestamp).toMillis();
  }
  return Date.now();
}

export function subscribeStudioPreferences(
  uid: string,
  onUpdate: (prefs: StudioPreferenceDoc | null) => void
): Unsubscribe {
  const path = `users/${uid}/preferences/studio`;
  const ref = doc(db, 'users', uid, 'preferences', 'studio');
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      const d = snap.data();
      onUpdate({
        captionSettings: {
          showCaptions: Boolean(d.showCaptions),
          fontFamily: String(d.fontFamily || '"Montserrat", "Plus Jakarta Sans", sans-serif'),
          style: VALID_STYLES.has(d.style) ? d.style : 'capcut',
          fontSize: Math.max(20, Math.min(96, Number(d.fontSize) || 43)),
          position: VALID_POSITIONS.has(d.position) ? d.position : 'bottom',
          highlightColor: /^#[0-9a-fA-F]{6}$/.test(String(d.highlightColor || ''))
            ? String(d.highlightColor)
            : '#c7ff55',
          caps: Boolean(d.caps),
          italic: Boolean(d.italic),
          fontWeight: d.fontWeight === '700' || d.fontWeight === '900' ? d.fontWeight : '800',
        },
        clipLengthRange: VALID_LENGTH_RANGES.has(String(d.clipLengthRange))
          ? String(d.clipLengthRange)
          : '60-90',
        clipLimit: Math.max(1, Math.min(30, Number(d.clipLimit) || 8)),
        framingMode: VALID_FRAMING.has(d.framingMode) ? d.framingMode : 'fit',
        exportFormat: VALID_FORMATS.has(d.exportFormat) ? d.exportFormat : 'webm',
        updatedAtMs: timestampToMs(d.updatedAt),
      });
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, path);
    }
  );
}

export async function saveStudioPreferences(
  uid: string,
  params: {
    captionSettings: CaptionSettings;
    clipLengthRange: string;
    clipLimit: number;
    framingMode: FramingMode;
    exportFormat: ExportFormat;
  }
): Promise<void> {
  const path = `users/${uid}/preferences/studio`;
  const ref = doc(db, 'users', uid, 'preferences', 'studio');
  const cs = params.captionSettings;

  const mutableFields = {
    showCaptions: Boolean(cs.showCaptions),
    fontFamily: String(cs.fontFamily || '"Montserrat", "Plus Jakarta Sans", sans-serif').slice(0, 160),
    style: VALID_STYLES.has(cs.style) ? cs.style : 'capcut',
    fontSize: Math.max(20, Math.min(96, Math.round(Number(cs.fontSize) || 43))),
    position: VALID_POSITIONS.has(cs.position) ? cs.position : 'bottom',
    highlightColor: /^#[0-9a-fA-F]{6}$/.test(String(cs.highlightColor || ''))
      ? String(cs.highlightColor)
      : '#c7ff55',
    caps: Boolean(cs.caps),
    italic: Boolean(cs.italic),
    fontWeight: cs.fontWeight === '700' || cs.fontWeight === '900' ? cs.fontWeight : '800',
    clipLengthRange: VALID_LENGTH_RANGES.has(params.clipLengthRange)
      ? params.clipLengthRange
      : '60-90',
    clipLimit: Math.max(1, Math.min(30, Math.round(Number(params.clipLimit) || 8))),
    framingMode: VALID_FRAMING.has(params.framingMode) ? params.framingMode : 'fit',
    exportFormat: VALID_FORMATS.has(params.exportFormat) ? params.exportFormat : 'webm',
  };

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ownerId: toFirestoreSafeId(uid),
        ...mutableFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        ...mutableFields,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export function subscribeClipProjects(
  uid: string,
  onUpdate: (projects: SavedClipProject[]) => void
): Unsubscribe {
  const path = `users/${uid}/projects`;
  const q = query(
    collection(db, 'users', uid, 'projects'),
    where('ownerId', '==', uid),
    limit(25)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: SavedClipProject[] = snap.docs
        .map((docSnap) => {
          const d = docSnap.data();
          const rawClips = Array.isArray(d.clips) ? d.clips : [];
          return {
            id: docSnap.id,
            projectKey: String(d.projectKey || docSnap.id),
            projectName: String(d.projectName || 'Projek Klip'),
            sourceLabel: String(d.sourceLabel || 'Video Lokal'),
            durationSec: Number(d.durationSec) || 0,
            clipsCount: Number(d.clipsCount) || rawClips.length,
            exportedCount: Number(d.exportedCount) || 0,
            clips: rawClips.slice(0, 25).map((c: Record<string, unknown>, idx: number) => ({
              id: String(c?.id || `clip-${idx + 1}`),
              start: Number(c?.start) || 0,
              end: Number(c?.end) || 0,
              title: String(c?.title || `Klip ${idx + 1}`),
              score: Number(c?.score) || 70,
              selected: Boolean(c?.selected ?? true),
            })),
            updatedAtMs: timestampToMs(d.updatedAt),
          };
        })
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      onUpdate(items);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export async function saveClipProjectToFirestore(
  uid: string,
  params: {
    projectKey: string;
    projectName: string;
    sourceLabel: string;
    durationSec: number;
    exportedCount: number;
    clips: ClipCandidate[];
  }
): Promise<string> {
  const safeId = toFirestoreSafeId(params.projectKey || params.projectName, `proj-${Date.now()}`);
  const path = `users/${uid}/projects/${safeId}`;
  const ref = doc(db, 'users', uid, 'projects', safeId);

  const compactClips = params.clips.slice(0, 25).map((c) => ({
    id: String(c.id).slice(0, 64),
    start: Math.max(0, Math.round(c.start * 100) / 100),
    end: Math.max(0, Math.round(c.end * 100) / 100),
    title: String(c.title || 'Klip').slice(0, 120),
    score: Math.max(0, Math.min(100, Math.round(c.score || 70))),
    selected: Boolean(c.selected),
  }));

  const mutableFields = {
    projectName: String(params.projectName || 'Projek Auto Clipper').trim().slice(0, 160) || 'Projek Auto Clipper',
    sourceLabel: String(params.sourceLabel || 'Video Lokal').trim().slice(0, 160) || 'Video Lokal',
    durationSec: Math.max(0, Math.min(86400, Math.round((params.durationSec || 0) * 10) / 10)),
    clipsCount: compactClips.length,
    exportedCount: Math.max(0, Math.min(50, Math.round(params.exportedCount || 0))),
    clips: compactClips,
  };

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ownerId: toFirestoreSafeId(uid),
        projectKey: safeId,
        ...mutableFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        ...mutableFields,
        updatedAt: serverTimestamp(),
      });
    }
    return safeId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteClipProjectFromFirestore(uid: string, projectId: string): Promise<void> {
  const safeId = toFirestoreSafeId(projectId);
  const path = `users/${uid}/projects/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'projects', safeId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export function subscribeAiScripts(
  uid: string,
  onUpdate: (scripts: SavedAiScript[]) => void
): Unsubscribe {
  const path = `users/${uid}/aiScripts`;
  const q = query(
    collection(db, 'users', uid, 'aiScripts'),
    where('ownerId', '==', uid),
    limit(25)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: SavedAiScript[] = snap.docs
        .map((docSnap) => {
          const d = docSnap.data();
          const rawScenes = Array.isArray(d.scenes) ? d.scenes : [];
          return {
            id: docSnap.id,
            title: String(d.title || 'Naskah Video AI'),
            prompt: String(d.prompt || ''),
            durationMinutes: Math.max(5, Math.min(10, Number(d.durationMinutes) || 5)),
            totalDurationSec: Math.max(300, Number(d.totalDurationSec) || 300),
            theme: VALID_THEMES.has(d.theme) ? d.theme : 'cinematic',
            language: (d.language === 'en' ? 'en' : 'id') as 'id' | 'en',
            voiceName: String(d.voiceName || 'ricky'),
            scenes: rawScenes.slice(0, 30).map((s: Record<string, unknown>, idx: number) => ({
              index: Number(s?.index ?? idx),
              visualTitle: String(s?.visualTitle || `Adegan ${idx + 1}`),
              narration: String(s?.narration || ''),
              captionText: String(s?.captionText || s?.narration || ''),
              imagePrompt: String(s?.imagePrompt || ''),
              durationSec: Number(s?.durationSec) || 20,
              timestampLabel: String(s?.timestampLabel || ''),
            })),
            updatedAtMs: timestampToMs(d.updatedAt),
          };
        })
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      onUpdate(items);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export async function saveAiScriptToFirestore(
  uid: string,
  params: {
    scriptId?: string;
    title: string;
    prompt: string;
    durationMinutes: number;
    totalDurationSec: number;
    theme: AiTheme;
    language: 'id' | 'en';
    voiceName: string;
    scenes: AiScene[];
  }
): Promise<string> {
  const safeId = toFirestoreSafeId(
    params.scriptId || `${params.title.slice(0, 40)}-${Date.now()}`,
    `script-${Date.now()}`
  );
  const path = `users/${uid}/aiScripts/${safeId}`;
  const ref = doc(db, 'users', uid, 'aiScripts', safeId);

  const safeScenes = params.scenes.slice(0, 30).map((sc, idx) => ({
    index: idx,
    visualTitle: String(sc.visualTitle || `Adegan ${idx + 1}`).slice(0, 120),
    narration: String(sc.narration || '').slice(0, 900),
    captionText: String(sc.captionText || sc.narration || '').slice(0, 900),
    imagePrompt: String(sc.imagePrompt || '').slice(0, 400),
    durationSec: Math.max(10, Math.min(60, Number(sc.durationSec) || 20)),
    timestampLabel: String(sc.timestampLabel || '').slice(0, 40),
  }));

  const mutableFields = {
    title: String(params.title || 'Naskah Video AI').trim().slice(0, 160) || 'Naskah Video AI',
    prompt: String(params.prompt || params.title || 'Topik Video AI').trim().slice(0, 600) || 'Topik Video AI',
    durationMinutes: Math.max(5, Math.min(10, Math.round(Number(params.durationMinutes) || 5))),
    totalDurationSec: Math.max(300, Math.min(1200, Math.round(Number(params.totalDurationSec) || 300))),
    theme: VALID_THEMES.has(params.theme) ? params.theme : 'cinematic',
    language: params.language === 'en' ? 'en' : 'id',
    voiceName: String(params.voiceName || 'ricky').slice(0, 40),
    scenes: safeScenes,
  };

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ownerId: toFirestoreSafeId(uid),
        ...mutableFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        ...mutableFields,
        updatedAt: serverTimestamp(),
      });
    }
    return safeId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteAiScriptFromFirestore(uid: string, scriptId: string): Promise<void> {
  const safeId = toFirestoreSafeId(scriptId);
  const path = `users/${uid}/aiScripts/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'aiScripts', safeId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}
