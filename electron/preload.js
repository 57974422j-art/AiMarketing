const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  opencliCheck: () => ipcRenderer.invoke('opencli:check'),
  opencliSetupGuide: () => ipcRenderer.invoke('opencli:setup-guide'),
  cleanupResidue: () => ipcRenderer.invoke('app:cleanup-residue'),
  browserBind: () => ipcRenderer.invoke('browser:bind'),
  browserAccounts: () => ipcRenderer.invoke('browser:accounts'),
  browserBindMine: () => ipcRenderer.invoke('browser:bind-mine'),

  isElectron: true,

  // ── ADB（原有）──
  adbDevices: () => ipcRenderer.invoke('adb:devices'),
  adbShell: (deviceId, command) => ipcRenderer.invoke('adb:shell', { deviceId, command }),
  adbScreenshot: (deviceId) => ipcRenderer.invoke('adb:screenshot', { deviceId }),
  adbScreenshotDataUrl: (deviceId) => ipcRenderer.invoke('adb:screenshot', { deviceId }),
  adbMirror: (deviceId) => ipcRenderer.invoke('adb:mirror', { deviceId }),
  adbTap: (deviceId, x, y) => ipcRenderer.invoke('adb:tap', { deviceId, x, y }),
  adbInput: (deviceId, text) => ipcRenderer.invoke('adb:input', { deviceId, text }),
  adbSwipe: (deviceId, x1, y1, x2, y2, duration) => ipcRenderer.invoke('adb:swipe', { deviceId, x1, y1, x2, y2, duration }),
  adbPush: (deviceId, localPath, remotePath) => ipcRenderer.invoke('adb:push', { deviceId, localPath, remotePath }),
  adbBridge: (deviceId, port) => ipcRenderer.invoke('adb:bridge', { deviceId, port }),
  adbBridgeStop: (port) => ipcRenderer.invoke('adb:bridge:stop', { port }),

  // ── 🌐 指纹浏览器（Fingerprint Browser via Playwright）──

  /** 启动浏览器窗口 { port, accountId?, platform?, proxy? } */
  fpStart: (opts) => ipcRenderer.invoke('fp:start', opts),

  /** 停止指定端口的浏览器 */
  fpStop: (port) => ipcRenderer.invoke('fp:stop', { port }),

  /** 列出所有活跃的指纹浏览器 */
  fpList: () => ipcRenderer.invoke('fp:list'),

  /** 截图 */
  fpScreenshot: (port) => ipcRenderer.invoke('fp:screenshot', { port }),

  /** 点击坐标 */
  fpClick: (port, x, y) => ipcRenderer.invoke('fp:click', { port, x, y }),

  /** 输入文字 */
  fpType: (port, x, y, text) => ipcRenderer.invoke('fp:type', { port, x, y, text }),

  /** 按 Enter */
  fpEnter: (port) => ipcRenderer.invoke('fp:enter', { port }),

  /** 导航到 URL */
  fpNavigate: (port, url) => ipcRenderer.invoke('fp:navigate', { port, url }),

  /** 获取当前页面信息（URL、Cookie状态等） */
  fpInfo: (port) => ipcRenderer.invoke('fp:info', { port }),

  /**
   * 执行自动化模板
   * @param {number} port
   * @param {string} templateType - 'douyin-publish' | 'douyin-like' | 'douyin-comment' | 'xiaohongshu-publish'
   * @param {object} params - 模板参数
   */
  fpExecute: (port, templateType, params) => ipcRenderer.invoke('fp:execute', { port, templateType, params }),
  // 2026-08-19: 本地语音识别（sherpa-onnx——A 方案）
  asrSessionStart: () => ipcRenderer.invoke('asr:session-start'),
  asrAudio: (samples, sampleRate) => ipcRenderer.invoke('asr:audio', { samples, sampleRate }),
  asrSessionEnd: () => ipcRenderer.invoke('asr:session-end'),
  asrSessionAbort: () => ipcRenderer.invoke('asr:session-abort'),

  /** 停止当前正在执行的模板脚本 */
  fpScriptStop: () => ipcRenderer.invoke('fp:scriptStop'),

  /** 标记账号已登录（本地持久化登录态，解决“保存不住”） */
  fpMarkLogin: (accountId) => ipcRenderer.invoke('fp:markLogin', { accountId }),

  /** 查询账号本地登录态 { loggedIn } */
  fpLoginState: (accountId) => ipcRenderer.invoke('fp:loginState', { accountId }),

  /** 清除账号登录标记 */
  fpLogout: (accountId) => ipcRenderer.invoke('fp:logout', { accountId }),

  // ── 自动更新 ──
  updaterCheck: () => ipcRenderer.invoke('updater:check'),
  updaterInstall: () => ipcRenderer.invoke('updater:install'),

  // ── 版本信息（导航栏显示版本号 + 发布日期）──
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),

  onUpdateStatus: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('app:update-status', handler)
    return () => ipcRenderer.removeListener('app:update-status', handler)
  },
})
