import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('paijoDesktop', {
  isDesktop: true,
  platform: process.platform,
  setRenderActive: (active: boolean) => {
    ipcRenderer.send('paijo:set-render-active', Boolean(active));
  },
});
