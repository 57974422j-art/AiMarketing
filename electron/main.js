const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execSync } = require('child_process')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../public/icon.png'),
  })

  const isDev = process.env.NODE_ENV !== 'production'
  const serverUrl = process.env.SERVER_URL || 'http://120.55.43.195:3000'
  mainWindow.loadURL(serverUrl)
  if (isDev) mainWindow.webContents.openDevTools()
}

// ── 找 adb.exe ──
function findAdb() {
  const candidates = [
    path.join(__dirname, '..', 'scripts', 'platform-tools', 'adb.exe'),
    path.join(__dirname, '..', 'scripts', 'platform-tools', 'adb'),
    'adb.exe',
    'adb',
  ]
  for (const c of candidates) {
    if (c === 'adb.exe' || c === 'adb') return c // rely on PATH
    if (fs.existsSync(c)) return c
  }
  return process.platform === 'win32' ? 'adb.exe' : 'adb'
}

// ── IPC: 获取本地设备列表 ──
ipcMain.handle('adb:devices', async () => {
  try {
    const adb = findAdb()
    const out = execSync(`"${adb}" devices`, { timeout: 5000, encoding: 'utf-8' })
    const lines = out.trim().split('\n').slice(1)
    const devices = lines.filter(l => l.trim() && !l.includes('adb')).map(l => {
      const [id, status] = l.split('\t')
      const isWifi = id.includes(':')
      return { id: id.trim(), status: status?.trim() || 'unknown', type: isWifi ? 'wifi' : 'usb', name: isWifi ? `WiFi-${id.split(':')[0].slice(-4)}` : `USB-${id.slice(0, 6)}` }
    })
    return { success: true, data: devices }
  } catch (e) {
    return { success: false, error: e.message, data: [] }
  }
})

// ── IPC: shell 命令 ──
ipcMain.handle('adb:shell', async (_event, { deviceId, command }) => {
  try {
    const adb = findAdb()
    const out = execSync(`"${adb}" -s ${deviceId} shell ${command}`, { timeout: 15000, encoding: 'utf-8' })
    return { success: true, data: out.trim() }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// ── IPC: 截图 ──
ipcMain.handle('adb:screenshot', async (_event, { deviceId }) => {
  try {
    const adb = findAdb()
    const tmpFile = path.join(os.tmpdir(), `screenshot_${deviceId.replace(/[^a-zA-Z0-9]/g, '_')}.png`)
    execSync(`"${adb}" -s ${deviceId} shell screencap -p /sdcard/screen_tmp.png`, { timeout: 15000 })
    execSync(`"${adb}" -s ${deviceId} pull /sdcard/screen_tmp.png "${tmpFile}"`, { timeout: 15000 })
    execSync(`"${adb}" -s ${deviceId} shell rm /sdcard/screen_tmp.png`, { timeout: 5000 })
    // 用系统默认图片查看器打开
    const { shell } = require('electron')
    shell.openPath(tmpFile)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// ── IPC: 点击 ──
ipcMain.handle('adb:tap', async (_event, { deviceId, x, y }) => {
  try {
    const adb = findAdb()
    execSync(`"${adb}" -s ${deviceId} shell input tap ${x} ${y}`, { timeout: 5000 })
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// ── IPC: 输入 ──
ipcMain.handle('adb:input', async (_event, { deviceId, text }) => {
  try {
    const adb = findAdb()
    execSync(`"${adb}" -s ${deviceId} shell input text "${text.replace(/"/g, '\\"').replace(/ /g, '%s')}"`, { timeout: 5000 })
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// ── IPC: 滑动 ──
ipcMain.handle('adb:swipe', async (_event, { deviceId, x1, y1, x2, y2, duration }) => {
  try {
    const adb = findAdb()
    execSync(`"${adb}" -s ${deviceId} shell input swipe ${x1} ${y1} ${x2} ${y2}${duration ? ` ${duration}` : ''}`, { timeout: 5000 })
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// ── IPC: 投屏（启动 scrcpy） ──
ipcMain.handle('adb:mirror', async (_event, { deviceId }) => {
  try {
    const scrcpyPath = path.join(__dirname, '..', 'scripts', 'scrcpy', 'scrcpy-noconsole.vbs')
    if (!fs.existsSync(scrcpyPath)) {
      return { success: false, error: '未找到 scrcpy，请先下载' }
    }
    const { spawn } = require('child_process')
    spawn(scrcpyPath, ['-s', deviceId, '--max-size', '1080', '--window-title', deviceId, '--always-on-top', '--no-console'], {
      cwd: path.dirname(scrcpyPath),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref()
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
