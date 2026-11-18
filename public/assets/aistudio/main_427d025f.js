'use strict';
const { app, BrowserWindow, dialog, shell, ipcMain, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { startServer } = require('./whisper-local/server');
let mainWindow = null;
let serverHandle = null;
let stoppingServer = false;
let allowQuit = false;
const isPrimaryInstance = app.requestSingleInstanceLock();
const geminiSecretPath = () => path.join(app.getPath('userData'), 'gemini-key.bin');

async function loadGeminiKey() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    const encrypted = await fs.readFile(geminiSecretPath());
    process.env.AUTO_CLIPPER_GEMINI_KEY = safeStorage.decryptString(encrypted).trim();
  } catch {}
}

ipcMain.handle('gemini-key:set', async (_event, value) => {
  const key = String(value || '').trim();
  if (!key) throw new Error('Masukkan API key Gemini.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Penyimpanan terenkripsi Windows belum tersedia.');
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(geminiSecretPath(), safeStorage.encryptString(key));
  process.env.AUTO_CLIPPER_GEMINI_KEY = key;
  return { configured: true };
});

ipcMain.handle('gemini-key:clear', async () => {
  await fs.unlink(geminiSecretPath()).catch(() => {});
  delete process.env.AUTO_CLIPPER_GEMINI_KEY;
  return { configured: false };
});

ipcMain.handle('gemini-key:status', () => ({
  configured: Boolean(process.env.AUTO_CLIPPER_GEMINI_KEY),
  secureStorageAvailable: safeStorage.isEncryptionAvailable()
}));

ipcMain.handle('google-flow:open', async () => {
  await shell.openExternal('https://labs.google/fx/tools/flow');
  return { opened: true };
});

if (!isPrimaryInstance) {
  app.quit();
} else {
  app.setName('Auto Clipper');
  app.setAppUserModelId('com.autoclipper.desktop');
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(async () => {
    try {
      await loadGeminiKey();
      serverHandle = await startServer();
      const appUrl = 'http://127.0.0.1:' + serverHandle.port + '/';
      mainWindow = new BrowserWindow({
        title: 'Auto Clipper',
        width: 1440,
        height: 960,
        minWidth: 980,
        minHeight: 700,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: '#0e1014',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          backgroundThrottling: false,
          preload: path.join(__dirname, 'preload.js')
        }
      });
      mainWindow.removeMenu();
      mainWindow.webContents.on('page-title-updated', event => {
        event.preventDefault();
        if (mainWindow) mainWindow.setTitle('Auto Clipper');
      });
      mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        try {
          const target = new URL(url);
          if (target.protocol === 'https:') shell.openExternal(target.href);
        } catch {}
        return { action: 'deny' };
      });
      mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
        if (!targetUrl.startsWith(appUrl)) event.preventDefault();
      });
      mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());
      mainWindow.on('closed', () => { mainWindow = null; });
      await mainWindow.loadURL(appUrl);
    } catch (err) {
      dialog.showErrorBox('Auto Clipper gagal dibuka', err && err.message ? err.message : String(err));
      app.quit();
    }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (allowQuit || !serverHandle || !serverHandle.ownsServer || stoppingServer) return;
    event.preventDefault();
    stoppingServer = true;
    serverHandle.close().finally(() => { allowQuit = true; app.quit(); });
  });
}
