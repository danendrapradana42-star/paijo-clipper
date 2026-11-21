import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('paijoDesktop', {
  isDesktop: true,
  platform: process.platform,
  setRenderActive: (active: boolean) => {
    ipcRenderer.send('paijo:set-render-active', Boolean(active));
  },
  downloadUpdate: (payload: { url: string; filename?: string; sha256?: string }) =>
    ipcRenderer.invoke('paijo:download-update', payload),
  cancelUpdateDownload: () => {
    ipcRenderer.send('paijo:cancel-update-download');
  },
  onUpdateDownloadProgress: (cb: (progress: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => cb(data);
    ipcRenderer.on('paijo:download-update-progress', handler);
    return () => {
      ipcRenderer.removeListener('paijo:download-update-progress', handler);
    };
  },
  openDownloadedUpdate: (filePath: string) =>
    ipcRenderer.invoke('paijo:open-downloaded-update', filePath),
  showItemInFolder: (filePath: string) =>
    ipcRenderer.invoke('paijo:show-item-in-folder', filePath),
});
