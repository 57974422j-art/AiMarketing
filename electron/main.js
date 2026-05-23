const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { spawn, execSync } = require('child_process')

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

  // 开发模式加载 localhost，生产模式加载构建产物
  const isDev = process.env.NODE_ENV !== 'production'
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000')
    mainWindow.webContents.openDevTools()
  } else {
    // 生产模式：启动内置的 Next.js server
    const nextPath = path.join(process.resourcesPath, '..', 'server.js')
    // Fallback: try local next server first
    mainWindow.loadURL('http://localhost:3000')
  }
}

// ── IPC: 执行 ADB 命令 ──
ipcMain.handle('adb:exec', async (_event, command) => {
  try {
    const result = execSync(command, { timeout: 30000, encoding: 'utf-8' })
    return { success: true, data: result.trim() }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// ── IPC: 获取本地设备列表 ──
ipcMain.handle('adb:devices', async () => {
  try {
    const result = execSync('adb devices', { timeout: 5000, encoding: 'utf-8' })
    const lines = result.trim().split('\n').slice(1)
    const devices = lines
      .filter(l => l.trim() && !l.includes('adb'))
      .map(l => {
        const [id, status] = l.split('\t')
        const isWifi = id.includes(':')
        return {
          id: id.trim(),
          status: status?.trim() || 'unknown',
          type: isWifi ? 'wifi' : 'usb',
          name: isWifi ? `WiFi-${id.split(':')[0].slice(-4)}` : `USB-${id.slice(0, 6)}`,
        }
      })
    return { success: true, data: devices }
  } catch (e) {
    return { success: false, error: e.message, data: [] }
  }
})

// ── IPC: 本地设备一键操作（点击/输入/滑动） ──
ipcMain.handle('adb:tap', async (_event, { deviceId, x, y }) => {
  const prefix = deviceId ? `-s ${deviceId}` : ''
  try {
    execSync(`adb ${prefix} shell input tap ${x} ${y}`, { timeout: 5000 })
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('adb:input', async (_event, { deviceId, text }) => {
  const prefix = deviceId ? `-s ${deviceId}` : ''
  try {
    execSync(`adb ${prefix} shell input text ${JSON.stringify(text)}`, { timeout: 5000 })
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
