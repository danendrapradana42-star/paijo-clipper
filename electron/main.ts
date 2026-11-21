import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  powerSaveBlocker,
  session,
  shell,
} from 'electron';
import dotenv from 'dotenv';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createApiApp } from '../server/apiApp';

let mainWindow: BrowserWindow | null = null;
let localServer: http.Server | null = null;
let localServerOrigin = 'http://127.0.0.1:3000';
let renderBlockerId: number | null = null;
let activeUpdateDownloadCtrl: AbortController | null = null;

// Prevent Chromium from throttling 30fps canvas/WebCodecs video renders in background
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Give 64-bit desktop renderer ample heap headroom for long video rendering without OOM crashes
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

function loadDesktopEnv(appRoot: string): void {
  const userDataDir = app.getPath('userData');
  const exeDir = path.dirname(app.getPath('exe'));
  process.env.PAIJO_APP_ROOT = appRoot;
  process.env.PAIJO_USER_DATA = userDataDir;
  process.env.PAIJO_EXE_DIR = exeDir;

  const envCandidates = [
    path.join(userDataDir, '.env'),
    path.join(exeDir, '.env'),
    path.join(appRoot, '.env'),
  ];

  for (const envPath of envCandidates) {
    try {
      if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath, override: false });
      }
    } catch {
      // Ignore unreadable optional .env locations
    }
  }
}

async function startEmbeddedServer(appRoot: string): Promise<string> {
  const devUrl = process.env.ELECTRON_START_URL;
  if (devUrl) {
    localServerOrigin = devUrl;
    return devUrl;
  }

  const expressApp = createApiApp();
  const distPath = path.join(appRoot, 'dist');

  if (fs.existsSync(distPath)) {
    expressApp.use(
      express.static(distPath, {
        index: 'index.html',
        fallthrough: true,
      })
    );
    expressApp.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'Endpoint API tidak ditemukan.' });
        return;
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  localServer = http.createServer(expressApp);

  await new Promise<void>((resolve, reject) => {
    localServer!.once('error', reject);
    localServer!.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = localServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : 3000;
  localServerOrigin = `http://localhost:${port}`;
  return localServerOrigin;
}

function configureSessionPermissions(): void {
  const allowedPermissions = new Set([
    'media',
    'mediaKeySystem',
    'clipboard-read',
    'clipboard-sanitized-write',
    'fullscreen',
  ]);

  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return allowedPermissions.has(permission);
  });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowedPermissions.has(permission));
  });

  session.defaultSession.on('will-download', (_event, item) => {
    const rawName = item.getFilename() || 'paijoclip-export';
    const safeName = rawName.replace(/[\\/:*?"<>|]/g, '-');
    if (!item.getSavePath()) {
      const targetPath = path.join(app.getPath('downloads'), safeName);
      if (!fs.existsSync(targetPath)) {
        item.setSavePath(targetPath);
      }
    }
  });
}

function isAuthPopupUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === 'accounts.google.com' ||
      u.hostname.endsWith('.firebaseapp.com') ||
      u.hostname.endsWith('.web.app') ||
      u.pathname.includes('/__/auth/')
    );
  } catch {
    return false;
  }
}

async function createMainWindow(): Promise<void> {
  const appRoot = app.getAppPath();
  loadDesktopEnv(appRoot);
  configureSessionPermissions();

  const targetUrl = await startEmbeddedServer(appRoot);
  const iconPath = path.join(appRoot, 'electron', 'resources', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'Paijo Clip',
    backgroundColor: '#070e20',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  Menu.setApplicationMenu(null);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Allow F12 / Ctrl+Shift+I DevTools shortcut when needed for diagnostics
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (
      input.type === 'keyDown' &&
      (input.key === 'F12' || (input.control && input.shift && input.key.toUpperCase() === 'I'))
    ) {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // Aborted navigation
    console.error('Paijo Clip failed load:', errorCode, errorDescription, validatedURL);
    if (mainWindow && !mainWindow.isDestroyed()) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(targetUrl).catch(() => {});
        }
      }, 600);
    }
  });

  mainWindow.webContents.on('render-process-gone', async (_event, details) => {
    if (details.reason === 'clean-exit') return;
    const choice = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Muat Ulang Paijo Clip', 'Tutup'],
      defaultId: 0,
      title: 'Paijo Clip',
      message: 'Proses rendering mengalami gangguan memori atau GPU.',
      detail: `Alasan: ${details.reason}. Klik Muat Ulang untuk memulihkan studio.`,
    });
    if (choice.response === 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(targetUrl).catch(() => {});
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAuthPopupUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 680,
          backgroundColor: '#070e20',
          autoHideMenuBar: true,
          parent: mainWindow || undefined,
        },
      };
    }

    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(targetUrl);
}

ipcMain.on('paijo:set-render-active', (_event, active: boolean) => {
  if (active) {
    if (renderBlockerId === null) {
      renderBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    }
  } else if (renderBlockerId !== null) {
    if (powerSaveBlocker.isStarted(renderBlockerId)) {
      powerSaveBlocker.stop(renderBlockerId);
    }
    renderBlockerId = null;
  }
});

function emitUpdateProgress(payload: {
  stage: 'downloading' | 'verifying' | 'done' | 'error' | 'cancelled';
  receivedBytes: number;
  totalBytes: number;
  filename?: string;
  filePath?: string;
  error?: string;
}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('paijo:download-update-progress', payload);
  }
}

ipcMain.on('paijo:cancel-update-download', () => {
  activeUpdateDownloadCtrl?.abort();
});

ipcMain.handle('paijo:open-downloaded-update', async (_event, filePath: string) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return 'File update tidak ditemukan.';
  }
  return shell.openPath(filePath);
});

ipcMain.handle('paijo:show-item-in-folder', async (_event, filePath: string) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});

ipcMain.handle(
  'paijo:download-update',
  async (
    _event,
    payload: { url: string; filename?: string; sha256?: string }
  ): Promise<{ ok: boolean; filePath?: string; filename?: string; bytes?: number; error?: string }> => {
    if (activeUpdateDownloadCtrl) {
      return { ok: false, error: 'Unduhan pembaruan lain sedang berlangsung.' };
    }

    const ctrl = new AbortController();
    activeUpdateDownloadCtrl = ctrl;

    let tempPath = '';
    try {
      const rawUrl = String(payload?.url || '').trim();
      const targetUrl = rawUrl.startsWith('/') ? new URL(rawUrl, localServerOrigin).toString() : rawUrl;
      const parsed = new URL(targetUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('URL unduhan update tidak valid.');
      }

      const rawName =
        payload?.filename ||
        decodeURIComponent(path.basename(parsed.pathname) || 'Paijo-Clip-Update.exe');
      const safeFilename = (rawName.replace(/[\\/:*?"<>|]/g, '-') || 'Paijo-Clip-Update.exe').slice(0, 120);
      const downloadsDir = app.getPath('downloads');
      await fs.promises.mkdir(downloadsDir, { recursive: true });
      const finalPath = path.join(downloadsDir, safeFilename);
      tempPath = `${finalPath}.part-${Date.now()}`;

      // Probe size and Range capability via HEAD (fall back gracefully if HEAD blocked)
      let totalSize = 0;
      let supportsRange = false;
      let serverSha256 = String(payload?.sha256 || '').trim().toLowerCase();

      try {
        const headRes = await fetch(targetUrl, {
          method: 'HEAD',
          redirect: 'follow',
          headers: { 'User-Agent': 'PaijoClip-Desktop-Updater' },
          signal: ctrl.signal,
        });
        if (headRes.ok) {
          totalSize = Number(headRes.headers.get('content-length') || '0') || 0;
          supportsRange = /bytes/i.test(headRes.headers.get('accept-ranges') || '');
          const hdrSha = headRes.headers.get('x-artifact-sha256');
          if (hdrSha && !serverSha256) serverSha256 = hdrSha.trim().toLowerCase();
        }
      } catch {
        // Ignore HEAD failures; proceed with GET
      }

      const writeStream = fs.createWriteStream(tempPath);
      const shaHash = crypto.createHash('sha256');
      let receivedBytes = 0;
      let headerBytes = Buffer.alloc(0);

      const writeChunk = async (buf: Buffer) => {
        if (headerBytes.length < 2) {
          headerBytes = Buffer.concat([headerBytes, buf.subarray(0, 2 - headerBytes.length)]);
        }
        shaHash.update(buf);
        receivedBytes += buf.length;
        if (!writeStream.write(buf)) {
          await new Promise<void>((resolve, reject) => {
            writeStream.once('drain', resolve);
            writeStream.once('error', reject);
          });
        }
        emitUpdateProgress({
          stage: 'downloading',
          receivedBytes,
          totalBytes: totalSize,
          filename: safeFilename,
        });
      };

      try {
        const CHUNK = 8 * 1024 * 1024;
        if (supportsRange && totalSize > CHUNK) {
          let offset = 0;
          while (offset < totalSize) {
            if (ctrl.signal.aborted) throw new Error('Unduhan dibatalkan.');
            const end = Math.min(totalSize - 1, offset + CHUNK - 1);
            const expectedLen = end - offset + 1;
            let chunkBuf: Buffer | null = null;
            let lastErr: unknown = null;

            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                const res = await fetch(targetUrl, {
                  method: 'GET',
                  redirect: 'follow',
                  headers: {
                    Range: `bytes=${offset}-${end}`,
                    'User-Agent': 'PaijoClip-Desktop-Updater',
                  },
                  signal: ctrl.signal,
                });
                if (res.status !== 206 && res.status !== 200) {
                  throw new Error(`HTTP ${res.status}`);
                }
                const arr = await res.arrayBuffer();
                const buf = Buffer.from(arr);
                if (res.status === 200 && totalSize > CHUNK && buf.length === totalSize) {
                  chunkBuf = buf;
                  offset = totalSize - expectedLen;
                  break;
                }
                if (buf.length !== expectedLen) {
                  throw new Error(`Ukuran bagian tidak lengkap (${buf.length}/${expectedLen})`);
                }
                chunkBuf = buf;
                break;
              } catch (err) {
                if (ctrl.signal.aborted) throw err;
                lastErr = err;
                await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
              }
            }

            if (!chunkBuf) {
              throw lastErr instanceof Error ? lastErr : new Error('Gagal mengunduh paket update.');
            }
            await writeChunk(chunkBuf);
            offset += expectedLen;
          }
        } else {
          const res = await fetch(targetUrl, {
            method: 'GET',
            redirect: 'follow',
            headers: { 'User-Agent': 'PaijoClip-Desktop-Updater' },
            signal: ctrl.signal,
          });
          if (!res.ok) {
            throw new Error(`Server mengembalikan HTTP ${res.status}`);
          }
          const hdrLen = Number(res.headers.get('content-length') || '0') || 0;
          if (hdrLen > 0) totalSize = hdrLen;
          const hdrSha = res.headers.get('x-artifact-sha256');
          if (hdrSha && !serverSha256) serverSha256 = hdrSha.trim().toLowerCase();

          if (!res.body) {
            const buf = Buffer.from(await res.arrayBuffer());
            await writeChunk(buf);
          } else {
            const reader = res.body.getReader();
            while (true) {
              if (ctrl.signal.aborted) {
                await reader.cancel().catch(() => {});
                throw new Error('Unduhan dibatalkan.');
              }
              const { done, value } = await reader.read();
              if (done) break;
              if (value && value.length > 0) {
                await writeChunk(Buffer.from(value));
              }
            }
          }
        }
      } finally {
        await new Promise<void>((resolve) => writeStream.end(() => resolve()));
      }

      emitUpdateProgress({
        stage: 'verifying',
        receivedBytes,
        totalBytes: totalSize || receivedBytes,
        filename: safeFilename,
      });

      if (totalSize > 0 && receivedBytes !== totalSize) {
        throw new Error(`Ukuran file update tidak lengkap (${receivedBytes}/${totalSize} byte).`);
      }
      if (/\.exe$/i.test(safeFilename) && (headerBytes.length < 2 || headerBytes[0] !== 0x4d || headerBytes[1] !== 0x5a)) {
        throw new Error('File yang diunduh bukan executable Windows (.exe) yang valid.');
      }
      if (serverSha256) {
        const actualSha = shaHash.digest('hex').toLowerCase();
        if (actualSha !== serverSha256) {
          throw new Error('Verifikasi checksum SHA-256 update gagal.');
        }
      }

      await fs.promises.rm(finalPath, { force: true }).catch(() => {});
      await fs.promises.rename(tempPath, finalPath);
      tempPath = '';

      emitUpdateProgress({
        stage: 'done',
        receivedBytes,
        totalBytes: receivedBytes,
        filename: safeFilename,
        filePath: finalPath,
      });

      return { ok: true, filePath: finalPath, filename: safeFilename, bytes: receivedBytes };
    } catch (err) {
      if (tempPath) {
        await fs.promises.rm(tempPath, { force: true }).catch(() => {});
      }
      const msg = err instanceof Error ? err.message : String(err);
      const cancelled = ctrl.signal.aborted || /dibatalkan/i.test(msg);
      emitUpdateProgress({
        stage: cancelled ? 'cancelled' : 'error',
        receivedBytes: 0,
        totalBytes: 0,
        error: cancelled ? undefined : msg,
      });
      return { ok: false, error: msg };
    } finally {
      if (activeUpdateDownloadCtrl === ctrl) {
        activeUpdateDownloadCtrl = null;
      }
    }
  }
);

process.on('uncaughtException', (err) => {
  console.error('Paijo Clip uncaught exception:', err);
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      await createMainWindow();
    } catch (err) {
      dialog.showErrorBox(
        'Gagal Memulai Paijo Clip',
        err instanceof Error ? err.message : String(err)
      );
      app.quit();
      return;
    }

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('will-quit', () => {
    if (renderBlockerId !== null && powerSaveBlocker.isStarted(renderBlockerId)) {
      powerSaveBlocker.stop(renderBlockerId);
      renderBlockerId = null;
    }
    if (localServer) {
      try {
        localServer.close();
      } catch {
        // ignore close errors during exit
      }
      localServer = null;
    }
  });
}
