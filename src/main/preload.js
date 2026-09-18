const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  readDir:       (p) => ipcRenderer.invoke('read-dir', p),
  getDrives:     ()  => ipcRenderer.invoke('get-drives'),
  getSpecialPaths: () => ipcRenderer.invoke('get-special-paths'),
  openFile:      (p) => ipcRenderer.invoke('open-file', p),
  openTrash:     ()  => ipcRenderer.invoke('open-trash'),
  readText:      (p) => ipcRenderer.invoke('read-text', p),
  readImage:     (p) => ipcRenderer.invoke('read-image', p),
  copyPath:      (src, destDir) => ipcRenderer.invoke('copy-path', src, destDir),
  movePath:      (src, destDir) => ipcRenderer.invoke('move-path', src, destDir),
  deletePath:    (p) => ipcRenderer.invoke('delete-path', p),
  pickExePath:   () => ipcRenderer.invoke('pick-exe-path'),
  runExe:        (exePath, args) => ipcRenderer.invoke('run-exe', exePath, args),
  findTortoiseGit: () => ipcRenderer.invoke('find-tortoisegit'),
  createDir:  (p) => ipcRenderer.invoke('create-dir', p),
  createFile: (p) => ipcRenderer.invoke('create-file', p),
});
