const { contextBridge, ipcRenderer } = require('electron')

// Custom APIs for renderer
const api = {
  dleView: {
    create: () => ipcRenderer.invoke('dle-view:create'),
    setBounds: (bounds) => ipcRenderer.invoke('dle-view:set-bounds', bounds),
    navigate: (url) => ipcRenderer.invoke('dle-view:navigate', url),
    hide: () => ipcRenderer.invoke('dle-view:hide'),
    show: () => ipcRenderer.invoke('dle-view:show'),
    destroy: () => ipcRenderer.invoke('dle-view:destroy'),
  },
  window: {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.api = api
}
