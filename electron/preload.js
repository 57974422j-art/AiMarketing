const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // 设备列表
  adbDevices: () => ipcRenderer.invoke('adb:devices'),

  // Shell 命令
  adbShell: (deviceId, command) => ipcRenderer.invoke('adb:shell', { deviceId, command }),

  // 基础操作
  adbTap: (deviceId, x, y) => ipcRenderer.invoke('adb:tap', { deviceId, x, y }),
  adbInput: (deviceId, text) => ipcRenderer.invoke('adb:input', { deviceId, text }),
  adbSwipe: (deviceId, x1, y1, x2, y2, duration) =>
    ipcRenderer.invoke('adb:swipe', { deviceId, x1, y1, x2, y2, duration }),

  // 截图
  adbScreenshot: (deviceId) => ipcRenderer.invoke('adb:screenshot', { deviceId }),
  adbScreenshotDataUrl: (deviceId) => ipcRenderer.invoke('adb:screenshotDataUrl', { deviceId }),

  // 环境检测
  isElectron: true,
})
