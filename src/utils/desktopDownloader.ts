export interface DesktopArtifactInfo {
  id: 'setup-exe' | 'portable-exe' | string;
  kind: 'installer' | 'portable';
  source?: 'local' | 'github' | 'firestore';
  version?: string;
  filename: string;
  sizeBytes: number;
  sha256?: string;
  downloadUrl: string;
  updatedAtMs?: number;
}

export const CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // 8 MiB per request (safely below Cloud Run 32 MiB limit)

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export async function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface ChunkedDownloadCallbacks {
  signal: AbortSignal;
  onProgress: (downloadedBytes: number, totalBytes: number, stage: 'downloading' | 'verifying') => void;
}

export async function downloadVerifiedChunkedExe(
  artifact: Pick<DesktopArtifactInfo, 'downloadUrl' | 'filename' | 'sizeBytes' | 'sha256'>,
  callbacks: ChunkedDownloadCallbacks
): Promise<void> {
  const totalSize = artifact.sizeBytes;
  if (!totalSize || totalSize <= 0) {
    window.location.assign(artifact.downloadUrl);
    return;
  }

  const parts: ArrayBuffer[] = [];
  let offset = 0;

  while (offset < totalSize) {
    if (callbacks.signal.aborted) {
      throw new DOMException('Unduhan dibatalkan.', 'AbortError');
    }

    const end = Math.min(totalSize - 1, offset + CHUNK_SIZE_BYTES - 1);
    const expectedLen = end - offset + 1;

    let chunkBuf: ArrayBuffer | null = null;
    let lastErr: unknown = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(artifact.downloadUrl, {
          method: 'GET',
          headers: {
            Range: `bytes=${offset}-${end}`,
          },
          cache: 'no-store',
          signal: callbacks.signal,
        });

        if (res.status !== 206 && res.status !== 200) {
          throw new Error(`HTTP ${res.status}`);
        }

        const buf = await res.arrayBuffer();
        if (res.status === 200 && buf.byteLength === totalSize) {
          chunkBuf = buf;
          offset = totalSize - expectedLen;
          break;
        }
        if (buf.byteLength !== expectedLen) {
          throw new Error(`Ukuran bagian tidak cocok (${buf.byteLength} / ${expectedLen} byte)`);
        }

        chunkBuf = buf;
        break;
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError' || callbacks.signal.aborted) {
          throw err;
        }
        lastErr = err;
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }

    if (!chunkBuf) {
      throw lastErr instanceof Error ? lastErr : new Error('Gagal mengunduh bagian file .exe.');
    }

    parts.push(chunkBuf);
    offset += expectedLen;
    callbacks.onProgress(Math.min(totalSize, offset), totalSize, 'downloading');
  }

  callbacks.onProgress(totalSize, totalSize, 'verifying');
  const finalBlob = new Blob(parts, {
    type: 'application/vnd.microsoft.portable-executable',
  });
  parts.length = 0;

  if (finalBlob.size !== totalSize) {
    throw new Error(
      `Ukuran file tidak lengkap (${finalBlob.size} dari ${totalSize} byte). Silakan coba unduh ulang.`
    );
  }

  if (artifact.sha256 && typeof crypto !== 'undefined' && crypto.subtle) {
    const fullBuffer = await finalBlob.arrayBuffer();
    const actualHash = await computeSha256Hex(fullBuffer);
    if (actualHash.toLowerCase() !== artifact.sha256.toLowerCase()) {
      throw new Error(
        'Pemeriksaan integritas SHA-256 gagal karena file terpotong saat transfer. Klik Unduh Ulang.'
      );
    }
  }

  const blobUrl = URL.createObjectURL(finalBlob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = artifact.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
