const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // ADB 命令直通
  adbExec: (command) => ipcRenderer.invoke('adb:exec', command),
  adbDevices: () => ipcRenderer.invoke('adb:devices'),
  adbTap: (deviceId, x, y) => ipcRenderer.invoke('adb:tap', { deviceId, x, y }),
  adbInput: (deviceId, text) => ipcRenderer.invoke('adb:input', { deviceId, text }),

  // 环境检测
  isElectron: true,
})
