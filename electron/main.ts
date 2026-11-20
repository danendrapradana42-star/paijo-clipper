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
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createApiApp } from '../server/apiApp';

let mainWindow: BrowserWindow | null = null;
let localServer: http.Server | null = null;
let renderBlockerId: number | null = null;

// Prevent Chromium from throttling 30fps canvas/WebCodecs video renders in background
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

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
  return `http://localhost:${port}`;
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
