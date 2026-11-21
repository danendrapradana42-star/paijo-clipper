export async function readApiJson<T extends Record<string, unknown>>(
  res: Response,
  fallbackError: string
): Promise<T> {
  const rawText = await res.text();
  const trimmed = rawText.trim();

  if (!trimmed) {
    if (!res.ok) {
      throw new Error(`${fallbackError} (HTTP ${res.status})`);
    }
    return {} as T;
  }

  const looksHtml = /^<!doctype\b|^<html\b|^<head\b|^<body\b/i.test(trimmed);
  if (looksHtml) {
    if (res.status === 504 || res.status === 502 || res.status === 408) {
      throw new Error(
        `Server timeout saat memproses permintaan AI (HTTP ${res.status}). Coba pilih durasi lebih singkat atau ulangi beberapa saat lagi.`
      );
    }
    throw new Error(
      `Endpoint server mengembalikan halaman HTML bukan JSON (HTTP ${res.status}). Pastikan server API aktif atau deploy ulang dengan konfigurasi /api.`
    );
  }

  let data: T;
  try {
    data = JSON.parse(trimmed) as T;
  } catch {
    throw new Error(
      res.ok
        ? 'Respons server tidak valid saat membaca JSON.'
        : `${fallbackError} (HTTP ${res.status})`
    );
  }

  if (!res.ok) {
    const errMsg = typeof data.error === 'string' && data.error.trim() ? data.error : fallbackError;
    throw new Error(errMsg);
  }

  return data;
}
