/**
 * 魔云腾 RPA TCP 硬件控制客户端
 *
 * 通过 TCP 连接 RPA 端口（9083/30102），发送 JSON 指令实现硬件级触控
 * 比 ADB input tap 更接近真实手指操作，不容易被风控
 *
 * 端口映射：容器内 9083 → 宿主机 30102/30202
 * FRP 隧道已配置：30002(T0001)/30102(T0002)/30202(T0003)
 */
import * as net from 'net'

export class RPAClient {
  private socket: net.Socket | null = null
  private buffer = ''

  /** 连接 RPA 端口 */
  async connect(port: number, timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket()
      const timer = setTimeout(() => {
        this.socket?.destroy()
        reject(new Error('RPA 连接超时'))
      }, timeoutMs)

      this.socket.connect(port, '127.0.0.1', () => {
        clearTimeout(timer)
        resolve()
      })
      this.socket.on('error', (e) => { clearTimeout(timer); reject(e) })
      this.socket.on('data', (data) => { this.buffer += data.toString() })
    })
  }

  /** 发送 JSON 指令并等待响应 */
  private async send(cmd: string, params: Record<string, any> = {}): Promise<any> {
    if (!this.socket) throw new Error('RPA 未连接')
    const payload = JSON.stringify({ cmd, ...params }) + '\n'
    this.buffer = ''
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('RPA 响应超时')), 10000)
      this.socket!.write(payload)
      const check = () => {
        if (this.buffer) {
          clearTimeout(timer)
          try { resolve(JSON.parse(this.buffer)) }
          catch { resolve(this.buffer) }
        } else {
          setTimeout(check, 100)
        }
      }
      check()
    })
  }

  /** 打开设备会话 */
  async openDevice(): Promise<void> { await this.send('openDevice') }

  /** 关闭设备会话 */
  async closeDevice(): Promise<void> { await this.send('closeDevice'); this.socket?.destroy(); this.socket = null }

  /** 硬件级点击（按下+保持+抬起，模拟真实手指） */
  async touchClick(x: number, y: number): Promise<void> {
    await this.send('touchDown', { x, y })
    await new Promise(r => setTimeout(r, 50 + Math.random() * 80)) // 50-130ms 随机按压
    await this.send('touchUp')
  }

  /** 输入文字 */
  async sendText(text: string): Promise<void> {
    await this.send('sendText', { text })
  }

  /** 截屏（返回 base64 PNG） */
  async takeScreenshot(): Promise<string | null> {
    try {
      const r = await this.send('takeCaptrueCompress', { format: 'PNG' })
      return r?.data || r?.base64 || null
    } catch { return null }
  }

  /** 获取界面 XML */
  async dumpXml(): Promise<string | null> {
    try {
      const r = await this.send('dumpNodeXml')
      return r?.data || r?.xml || null
    } catch { return null }
  }

  /** 执行 shell 命令 */
  async execCmd(cmd: string): Promise<string | null> {
    try {
      const r = await this.send('execCmd', { cmd })
      return r?.data || r?.result || null
    } catch { return null }
  }

  /** 打开 App */
  async openApp(pkg: string, act?: string): Promise<void> {
    await this.send('openApp', { pkg, act: act || pkg })
  }

  /** 停止 App */
  async stopApp(pkg: string): Promise<void> {
    await this.send('stopApp', { pkg })
  }
}
