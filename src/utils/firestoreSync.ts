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
import { OperationType, db, handleFirestoreError } from './firebase';

export const DEVELOPER_ADMIN_EMAIL = 'danendrapradana44@gmail.com';

export type UpdateType = 'minor' | 'major';
export type ReleaseStatus = 'developing' | 'published';

export interface AppReleaseDoc {
  id: string;
  ownerId: string;
  version: string;
  baseVersion: string;
  updateType: UpdateType;
  status: ReleaseStatus;
  title: string;
  releaseNotes: string;
  changes: string[];
  packageUrl: string;
  buildTarget: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export function isValidSemver(ver: string): boolean {
  return /^[0-9]+\.[0-9]+\.[0-9]+$/.test(String(ver || '').trim());
}

export function compareVersions(a: string, b: string): number {
  const pa = String(a || '0.0.0')
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0.0.0')
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);

  for (let i = 0; i < 3; i++) {
    const da = pa[i] || 0;
    const dbNum = pb[i] || 0;
    if (da > dbNum) return 1;
    if (da < dbNum) return -1;
  }
  return 0;
}

/**
 * Menghitung versi berikutnya sesuai aturan:
 * - Minor: +0.0.1 (misal 1.5.0 -> 1.5.1 -> 1.5.2)
 * - Major: +0.1.0 (misal 1.5.0 -> 1.6.0, 1.5.2 -> 1.6.0)
 */
export function computeNextVersion(baseVersion: string, updateType: UpdateType): string {
  const clean = isValidSemver(baseVersion.trim()) ? baseVersion.trim() : '1.5.0';
  const [majorPart, minorPart, patchPart] = clean.split('.').map((n) => parseInt(n, 10) || 0);
  if (updateType === 'major') {
    return `${majorPart}.${minorPart + 1}.0`;
  }
  return `${majorPart}.${minorPart}.${patchPart + 1}`;
}

export function versionToReleaseDocId(version: string): string {
  const safe = String(version || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `v${safe || '1-5-1'}`;
}

function timestampToMs(ts: unknown): number {
  if (ts && typeof (ts as Timestamp).toMillis === 'function') {
    return (ts as Timestamp).toMillis();
  }
  return Date.now();
}

function mapReleaseDoc(id: string, d: Record<string, unknown>): AppReleaseDoc {
  const rawChanges = Array.isArray(d.changes) ? d.changes : [];
  return {
    id,
    ownerId: String(d.ownerId || ''),
    version: String(d.version || '1.5.0'),
    baseVersion: String(d.baseVersion || '1.5.0'),
    updateType: d.updateType === 'major' ? 'major' : 'minor',
    status: d.status === 'published' ? 'published' : 'developing',
    title: String(d.title || 'Pembaruan Paijo Clip'),
    releaseNotes: String(d.releaseNotes || ''),
    changes: rawChanges
      .slice(0, 20)
      .map((item) => String(item || '').trim())
      .filter(Boolean),
    packageUrl: String(d.packageUrl || ''),
    buildTarget: String(d.buildTarget || 'web'),
    createdAtMs: timestampToMs(d.createdAt),
    updatedAtMs: timestampToMs(d.updatedAt),
  };
}

export function subscribePublishedReleases(
  onUpdate: (releases: AppReleaseDoc[]) => void
): Unsubscribe {
  const path = 'appReleases';
  const q = query(
    collection(db, 'appReleases'),
    where('status', '==', 'published'),
    limit(20)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((docSnap) => mapReleaseDoc(docSnap.id, docSnap.data()))
        .sort((a, b) => compareVersions(b.version, a.version) || b.updatedAtMs - a.updatedAtMs);
      onUpdate(items);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export function subscribeAllReleasesForAdmin(
  onUpdate: (releases: AppReleaseDoc[]) => void
): Unsubscribe {
  const path = 'appReleases';
  const q = query(collection(db, 'appReleases'), limit(40));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((docSnap) => mapReleaseDoc(docSnap.id, docSnap.data()))
        .sort((a, b) => compareVersions(b.version, a.version) || b.updatedAtMs - a.updatedAtMs);
      onUpdate(items);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export async function saveAppReleaseToFirestore(
  uid: string,
  params: {
    releaseId?: string;
    version: string;
    baseVersion: string;
    updateType: UpdateType;
    status: ReleaseStatus;
    title: string;
    releaseNotes: string;
    changes: string[];
    packageUrl: string;
    buildTarget: string;
  }
): Promise<string> {
  const cleanVersion = params.version.trim();
  if (!isValidSemver(cleanVersion)) {
    throw new Error('Format versi harus X.Y.Z (contoh: 1.5.1 atau 1.6.0).');
  }
  const cleanBase = isValidSemver(params.baseVersion.trim()) ? params.baseVersion.trim() : '1.5.0';
  const safeId = (params.releaseId || versionToReleaseDocId(cleanVersion))
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);

  const path = `appReleases/${safeId}`;
  const ref = doc(db, 'appReleases', safeId);

  const cleanChanges = params.changes
    .map((c) => String(c || '').trim().slice(0, 240))
    .filter(Boolean)
    .slice(0, 20);

  const mutableFields = {
    version: cleanVersion.slice(0, 24),
    baseVersion: cleanBase.slice(0, 24),
    updateType: params.updateType === 'major' ? 'major' : 'minor',
    status: params.status === 'published' ? 'published' : 'developing',
    title: String(params.title || `Rilis v${cleanVersion}`).trim().slice(0, 160) || `Rilis v${cleanVersion}`,
    releaseNotes:
      String(params.releaseNotes || `Pembaruan aplikasi v${cleanVersion}`).trim().slice(0, 2000) ||
      `Pembaruan aplikasi v${cleanVersion}`,
    changes: cleanChanges,
    packageUrl: String(params.packageUrl || '').trim().slice(0, 500),
    buildTarget: String(params.buildTarget || 'web').trim().slice(0, 40) || 'web',
  };

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ownerId: uid.replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 128),
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

export async function publishAppReleaseInFirestore(releaseId: string): Promise<void> {
  const safeId = releaseId.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 96);
  const path = `appReleases/${safeId}`;
  try {
    await updateDoc(doc(db, 'appReleases', safeId), {
      status: 'published',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteAppReleaseFromFirestore(releaseId: string): Promise<void> {
  const safeId = releaseId.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 96);
  const path = `appReleases/${safeId}`;
  try {
    await deleteDoc(doc(db, 'appReleases', safeId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}
