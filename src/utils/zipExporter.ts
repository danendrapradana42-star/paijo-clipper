import JSZip from 'jszip';
import type { ExportedClipRecord } from '../types/clipper';

export function sanitizeZipSegment(name: string, fallback = 'projek'): string {
  const clean = String(name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  return clean || fallback;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function uniqueEntryName(used: Set<string>, desired: string): string {
  if (!used.has(desired)) {
    used.add(desired);
    return desired;
  }
  const dot = desired.lastIndexOf('.');
  const stem = dot > 0 ? desired.slice(0, dot) : desired;
  const ext = dot > 0 ? desired.slice(dot) : '';
  let counter = 2;
  while (used.has(`${stem}-${counter}${ext}`)) {
    counter++;
  }
  const finalName = `${stem}-${counter}${ext}`;
  used.add(finalName);
  return finalName;
}

function buildMetadataManifest(records: ExportedClipRecord[], projectName: string): string {
  const lines = [
    `Projek: ${projectName}`,
    `Total Klip: ${records.length}`,
    `Diekspor: ${new Date().toLocaleString('id-ID')}`,
    '',
    '========================================',
  ];
  records.forEach((rec, idx) => {
    lines.push(`${idx + 1}. ${rec.label}`);
    lines.push(`   File: ${rec.filename}`);
    lines.push(`   Rentang: ${rec.rangeText} (${rec.durationSec.toFixed(1)}s)`);
    if (rec.hook) lines.push(`   Hook: "${rec.hook}"`);
    if (rec.captionText) lines.push(`   Caption: ${rec.captionText}`);
    lines.push('');
  });
  return lines.join('\n');
}

/**
 * Packages clips from a single project into one clean .zip archive.
 */
export async function downloadProjectZip(
  records: ExportedClipRecord[],
  projectName: string,
  onProgress?: (pct: number, label: string) => void
): Promise<void> {
  if (!records.length) return;
  const zip = new JSZip();
  const folderSlug = sanitizeZipSegment(projectName, 'auto-clipper-projek');
  const usedNames = new Set<string>();

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    onProgress?.(
      Math.round(((i + 0.3) / records.length) * 60),
      `Menyiapkan file ${i + 1}/${records.length}…`
    );
    const resp = await fetch(rec.url);
    if (!resp.ok) throw new Error(`Gagal membaca klip ${rec.filename} dari memori sesi.`);
    const blob = await resp.blob();
    const safeFile = uniqueEntryName(usedNames, rec.filename || `clip-${i + 1}.${rec.ext}`);
    zip.file(safeFile, blob);
  }

  zip.file('ringkasan-klip.txt', buildMetadataManifest(records, projectName));

  const zipBlob = await zip.generateAsync(
    { type: 'blob', compression: 'STORE' },
    (meta) => {
      onProgress?.(60 + Math.round(meta.percent * 0.4), `Mengemas arsip ZIP (${Math.round(meta.percent)}%)…`);
    }
  );

  triggerBlobDownload(zipBlob, `${folderSlug}.zip`);
  onProgress?.(100, 'Arsip ZIP siap diunduh');
}

/**
 * Packages multiple projects into one .zip archive, putting each project in its own subfolder.
 */
export async function downloadAllProjectsZip(
  records: ExportedClipRecord[],
  onProgress?: (pct: number, label: string) => void
): Promise<void> {
  if (!records.length) return;
  const zip = new JSZip();
  const grouped = new Map<string, { name: string; items: ExportedClipRecord[] }>();

  for (const rec of records) {
    const key = rec.projectId || rec.sourceLabel || 'projek';
    const existing = grouped.get(key);
    if (existing) {
      existing.items.push(rec);
    } else {
      grouped.set(key, {
        name: rec.projectName || rec.sourceLabel || 'Projek Auto Clipper',
        items: [rec],
      });
    }
  }

  const usedFolders = new Set<string>();
  const totalItems = records.length;
  let processed = 0;

  for (const group of grouped.values()) {
    const folderName = uniqueEntryName(usedFolders, sanitizeZipSegment(group.name, 'projek'));
    const folder = zip.folder(folderName);
    if (!folder) continue;

    const usedFiles = new Set<string>();
    for (const rec of group.items) {
      processed++;
      onProgress?.(
        Math.round(((processed - 0.5) / totalItems) * 65),
        `Mengumpulkan ${processed}/${totalItems}: ${folderName}/${rec.filename}`
      );
      const resp = await fetch(rec.url);
      if (!resp.ok) throw new Error(`Gagal membaca ${rec.filename} dari memori sesi.`);
      const blob = await resp.blob();
      const safeFile = uniqueEntryName(usedFiles, rec.filename || `clip-${processed}.${rec.ext}`);
      folder.file(safeFile, blob);
    }

    folder.file('ringkasan-klip.txt', buildMetadataManifest(group.items, group.name));
  }

  const zipBlob = await zip.generateAsync(
    { type: 'blob', compression: 'STORE' },
    (meta) => {
      onProgress?.(65 + Math.round(meta.percent * 0.35), `Mengemas semua projek (${Math.round(meta.percent)}%)…`);
    }
  );

  const stamp = new Date().toISOString().slice(0, 10);
  triggerBlobDownload(zipBlob, `auto-clipper-semua-projek-${stamp}.zip`);
  onProgress?.(100, 'Semua projek ZIP berhasil diunduh');
}
