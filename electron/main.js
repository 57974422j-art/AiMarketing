const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const AdbKit = require('@devicefarmer/adbkit')
const Adb = AdbKit.default || AdbKit

let mainWindow
let adbClient

try {
  adbClient = Adb.createClient()
} catch (e) {
  console.error('[ADB] 初始化失败:', e.message)
  adbClient = null
}

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
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadURL('http://localhost:3000')
  }
}

// ── IPC: 获取本地设备列表 ──
ipcMain.handle('adb:devices', async () => {
  try {
    if (!adbClient) return { success: false, error: 'ADB 未就绪', data: [] }
    const devices = await adbClient.listDevices()
    const mapped = devices.map(d => ({
      id: d.id,
      status: d.type === 'device' ? 'device' : d.type,
      type: d.id.includes(':') ? 'wifi' : 'usb',
      name: d.id.includes(':')
        ? `WiFi-${d.id.split(':')[0].slice(-4)}`
        : `USB-${d.id.slice(0, 6)}`,
    }))
    return { success: true, data: mapped }
  } catch (e) {
    return { success: false, error: e.message, data: [] }
  }
})

// ── IPC: 执行 shell 命令 ──
ipcMain.handle('adb:shell', async (_event, { deviceId, command }) => {
  try {
    if (!adbClient) return { success: false, error: 'ADB 未就绪' }
    const result = await adbClient.shell(deviceId, command)
    const output = await AdbKit.util.readAll(result)
    return { success: true, data: output.toString().trim() }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// ── IPC: 点击 ──
ipcMain.handle('adb:tap', async (_event, { deviceId, x, y }) => {
  try {
    await adbClient.shell(deviceId, `input tap ${x} ${y}`)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// ── IPC: 输入文本 ──
ipcMain.handle('adb:input', async (_event, { deviceId, text }) => {
  try {
    await adbClient.shell(deviceId, `input text ${text.replace(/ /g, '%s').replace(/"/g, '\\"')}`)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// ── IPC: 滑动 ──
ipcMain.handle('adb:swipe', async (_event, { deviceId, x1, y1, x2, y2, duration }) => {
  try {
    await adbClient.shell(deviceId, `input swipe ${x1} ${y1} ${x2} ${y2}${duration ? ` ${duration}` : ''}`)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// ── IPC: 截图 ──
ipcMain.handle('adb:screenshot', async (_event, { deviceId }) => {
  try {
    const tmpPath = `/sdcard/screen_${Date.now()}.png`
    await adbClient.shell(deviceId, `screencap -p ${tmpPath}`)
    const transfer = await adbClient.pull(deviceId, tmpPath)
    const buf = await AdbKit.util.readAll(transfer)
    await adbClient.shell(deviceId, `rm ${tmpPath}`)
    return { success: true, data: buf.toString('base64') }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// ── IPC: 截图转 base64 数据 URL
ipcMain.handle('adb:screenshotDataUrl', async (_event, { deviceId }) => {
  try {
    const tmpPath = `/sdcard/screen_${Date.now()}.png`
    await adbClient.shell(deviceId, `screencap -p ${tmpPath}`)
    const transfer = await adbClient.pull(deviceId, tmpPath)
    const buf = await AdbKit.util.readAll(transfer)
    await adbClient.shell(deviceId, `rm ${tmpPath}`)
    const b64 = buf.toString('base64')
    return { success: true, data: `data:image/png;base64,${b64}` }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// ── IPC: 截图转 ArrayBuffer
ipcMain.handle('adb:screenshotFile', async (_event, { deviceId }) => {
  try {
    const tmpPath = `/sdcard/screen_${Date.now()}.png`
    await adbClient.shell(deviceId, `screencap -p ${tmpPath}`)
    const transfer = await adbClient.pull(deviceId, tmpPath)
    const buf = await AdbKit.util.readAll(transfer)
    await adbClient.shell(deviceId, `rm ${tmpPath}`)
    return { success: true, data: Buffer.from(buf).toJSON() }
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
