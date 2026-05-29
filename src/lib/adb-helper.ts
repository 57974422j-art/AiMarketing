/**
 * ADB 直连助手
 * 通过 adb 直接控制 Q1 容器（比 HTTP shell 更稳定）
 *
 * 用法:
 *   const adb = new ADB(30000) // ADB 端口
 *   await adb.inputText('引流获客')
 *   await adb.tap(540, 1200)
 *   await adb.keyEvent('KEYCODE_ENTER')
 */

import { execSync } from 'child_process'

export class ADB {
  private serial: string

  constructor(adbPort: number) {
    this.serial = `127.0.0.1:${adbPort}`
  }

  private run(cmd: string, timeoutMs = 15000): { success: boolean; output: string } {
    try {
      const out = execSync(`adb -s ${this.serial} ${cmd}`, {
        timeout: timeoutMs,
        encoding: 'utf-8',
      })
      return { success: true, output: out.trim() }
    } catch (e: any) {
      return { success: false, output: e.stderr?.trim() || e.message || 'adb 错误' }
    }
  }

  connect(): { success: boolean; output: string } {
    return this.run('connect', 3000) // 连接只等 3 秒，不通就快速降级
  }

  /** 执行任意 ADB shell 命令 */
  shell(cmd: string): { success: boolean; output: string } {
    return this.run(`shell ${cmd}`)
  }

  /** 输入文本（自动处理特殊字符） */
  inputText(text: string): { success: boolean; output: string } {
    const escaped = text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$')
    return this.run(`shell input text "${escaped}"`)
  }

  /** 点击坐标 */
  tap(x: number, y: number): { success: boolean; output: string } {
    return this.run(`shell input tap ${x} ${y}`)
  }

  /** 滑动 */
  swipe(x1: number, y1: number, x2: number, y2: number, dur = 500): { success: boolean; output: string } {
    return this.run(`shell input swipe ${x1} ${y1} ${x2} ${y2} ${dur}`)
  }

  /** 按键事件 */
  keyEvent(key: string): { success: boolean; output: string } {
    return this.run(`shell input keyevent ${key}`)
  }

  /** 上滑（刷下一条视频）*/
  scrollUp(dur = 500): { success: boolean; output: string } {
    return this.swipe(540, 1600, 540, 400, dur)
  }

  /** 强制停止 App */
  forceStop(pkg: string): { success: boolean; output: string } {
    return this.run(`shell am force-stop ${pkg}`)
  }

  /** 启动 App */
  openApp(pkg: string, act: string): { success: boolean; output: string } {
    return this.run(`shell am start -n ${pkg}/${act}`)
  }

  /** 获取屏幕文本（简化版 dump） */
  getText(): { success: boolean; output: string } {
    return this.run('shell uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml')
  }

  /** 检查 ADB 是否可用 */
  static isAvailable(): boolean {
    try {
      execSync('adb version', { timeout: 3000, encoding: 'utf-8' })
      return true
    } catch {
      return false
    }
  }
}
