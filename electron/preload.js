const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  // 设备列表
  adbDevices: () => ipcRenderer.invoke('adb:devices'),

  // Shell 命令
  adbShell: (deviceId, command) => ipcRenderer.invoke('adb:shell', { deviceId, command }),

  // 截图
  adbScreenshot: (deviceId) => ipcRenderer.invoke('adb:screenshot', { deviceId }),
  adbScreenshotDataUrl: (deviceId) => ipcRenderer.invoke('adb:screenshot', { deviceId }),

  // 投屏
  adbMirror: (deviceId) => ipcRenderer.invoke('adb:mirror', { deviceId }),

  // 点击/输入/滑动
  adbTap: (deviceId, x, y) => ipcRenderer.invoke('adb:tap', { deviceId, x, y }),
  adbInput: (deviceId, text) => ipcRenderer.invoke('adb:input', { deviceId, text }),
  adbSwipe: (deviceId, x1, y1, x2, y2, duration) => ipcRenderer.invoke('adb:swipe', { deviceId, x1, y1, x2, y2, duration }),

  // 推文件到设备
  adbPush: (deviceId, localPath, remotePath) => ipcRenderer.invoke('adb:push', { deviceId, localPath, remotePath }),

  // 桥接
  adbBridge: (deviceId, port) => ipcRenderer.invoke('adb:bridge', { deviceId, port }),
  adbBridgeStop: (port) => ipcRenderer.invoke('adb:bridge:stop', { port }),
})
