// 定时清理任务（★VF_CLEANUP_V2，2026-09-30）
//
// 为什么升级：V1 只清 `public/outputs` 里超过 7 天的 mp4，而且**没有任何调度器**
//   （靠人手调 runCleanup）→ 结论等于"从来没跑过"。用户实测反馈：「那个出现的也比较多」
//   （指发布时抽的视频切片等临时文件），队友核查确认了四处真实泄漏：
//     ① 发布抽帧的帧目录 `public/frames/<uid>/<ts>/`（>1h 就是垃圾，但只在他"下次抽帧"时才清）
//     ② 系统临时目录 `agentframes-*`（抽帧下载的整段源视频 —— 这条已在 route.ts 里改成"抽完即删"，
//        这里的定时任务是**兜底**：万一进程被杀/异常退出，仍会被清掉）
//     ③ 各种诊断/自检留下的 `vf-*` 临时目录
//     ④ 出片工作目录 `<storage>/<uid>/video-factory/work_*`（逐镜片段+音轨，一条片几百 MB）
//
// 设计原则（照本项目惯例）：
//   · **失败绝不抛**：清理是"锦上添花"，任何异常都只打日志，不能影响出片/发布；
//   · **只删确定安全的**：全部用 mtime（修改时间）判龄，且工作目录留足 72 小时
//     （用户可能过两天才想起来"只重渲第 N 镜"，那份 work 还得在）；
//   · **幂等调度**：`startCleanupScheduler()` 重复调用只会启动一次（dev 热重载/多路由触发都安全）。

import { existsSync, readdirSync, rmSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** V1 保留：清理 public/outputs 里超过 N 天的 mp4（老出口，别删 —— 可能还有调用方） */
export function cleanupOldFiles(daysOld: number = 7): { deleted: string[], errors: string[] } {
  const outputsDir = join(process.cwd(), 'public', 'outputs')
  const deleted: string[] = []
  const errors: string[] = []

  if (!existsSync(outputsDir)) return { deleted, errors }

  const now = Date.now()
  const maxAge = daysOld * DAY

  try {
    for (const file of readdirSync(outputsDir)) {
      if (!file.endsWith('.mp4')) continue
      const filePath = join(outputsDir, file)
      try {
        if (now - statSync(filePath).mtimeMs > maxAge) {
          unlinkSync(filePath)
          deleted.push(file)
        }
      } catch (err) {
        errors.push(`${file}: ${err instanceof Error ? err.message : err}`)
      }
    }
  } catch (err) {
    errors.push(`读取目录失败: ${err instanceof Error ? err.message : err}`)
  }
  return { deleted, errors }
}

/** 删掉某个目录下所有"够旧"的子项（目录就整棵删）。返回删除数量。 */
function purgeOldChildren(dir: string, maxAgeMs: number, prefix = ''): number {
  let n = 0
  try {
    if (!existsSync(dir)) return 0
    const now = Date.now()
    for (const name of readdirSync(dir)) {
      if (prefix && !name.startsWith(prefix)) continue
      const p = join(dir, name)
      try {
        if (now - statSync(p).mtimeMs <= maxAgeMs) continue
        rmSync(p, { recursive: true, force: true })
        n++
      } catch { /* 单个失败不影响其它 */ }
    }
  } catch { /* 目录读不到就算了 */ }
  return n
}

/** ① 发布抽帧的帧目录：public/frames/<uid>/<ts>/ —— 帧只是用来"选封面"，>1h 即可删 */
function cleanupPublishFrames(maxAgeMs = 1 * HOUR): number {
  const roots = [
    join(process.cwd(), '.next', 'standalone', 'public', 'frames'),
    join(process.cwd(), 'public', 'frames'),
  ]
  let n = 0
  for (const root of roots) {
    try {
      if (!existsSync(root)) continue
      for (const uid of readdirSync(root)) {
        n += purgeOldChildren(join(root, uid), maxAgeMs)
      }
    } catch { /* ignore */ }
  }
  return n
}

/** ② 系统临时目录里的本项目残留（发布源视频 / 诊断自检目录） */
function cleanupOsTemp(maxAgeMs = 2 * HOUR): number {
  const dir = tmpdir()
  let n = 0
  // agentframes-*：发布抽帧下载的整段源视频（route.ts 已改成抽完即删，这里是兜底）
  n += purgeOldChildren(dir, maxAgeMs, 'agentframes-')
  // vf-*：诊断工具/自检/风格预览/图表验证留下的目录（vf-local 的临时 py 也在其中）
  n += purgeOldChildren(dir, maxAgeMs, 'vf-')
  return n
}

/** ③ 出片工作目录：<storage>/<uid>/video-factory/work_* 与 preview_work_* —— 留 72h（"只重渲第 N 镜"要用） */
function cleanupVfWorkDirs(maxAgeMs = 72 * HOUR): number {
  const storages = [
    process.env.BU_STORAGE_ROOT || '',
    join(process.cwd(), 'storage'),
    '/root/AiMarketing/storage',
  ].filter(Boolean)
  let n = 0
  for (const root of storages) {
    try {
      if (!existsSync(root)) continue
      for (const uid of readdirSync(root)) {
        const vf = join(root, uid, 'video-factory')
        n += purgeOldChildren(vf, maxAgeMs, 'work_')
        n += purgeOldChildren(vf, maxAgeMs, 'preview_work_')
      }
    } catch { /* ignore */ }
  }
  return n
}

/** 跑一遍全部清理，返回汇总（供日志/接口用） */
export function runCleanupAll(): {
  outputs: number; frames: number; osTemp: number; workDirs: number; errors: string[]
} {
  const errors: string[] = []
  let outputs = 0, frames = 0, osTemp = 0, workDirs = 0
  try { outputs = cleanupOldFiles(7).deleted.length } catch (e: any) { errors.push('outputs: ' + String(e?.message || e)) }
  try { frames = cleanupPublishFrames() } catch (e: any) { errors.push('frames: ' + String(e?.message || e)) }
  try { osTemp = cleanupOsTemp() } catch (e: any) { errors.push('tmp: ' + String(e?.message || e)) }
  try { workDirs = cleanupVfWorkDirs() } catch (e: any) { errors.push('work: ' + String(e?.message || e)) }
  return { outputs, frames, osTemp, workDirs, errors }
}

/** V1 保留：老的"跑一次清理"出口 */
export async function runCleanup() {
  const r = runCleanupAll()
  console.log(`[清理] outputs ${r.outputs} / 发布帧 ${r.frames} / 临时 ${r.osTemp} / 出片工作目录 ${r.workDirs}`
    + (r.errors.length ? `（${r.errors.length} 项异常，已忽略）` : ''))
  return r
}

// ★VF_CLEANUP_V2：调度器 —— 启动后先跑一次，之后每小时一次。
//   ⚠️ 幂等：用 globalThis 打标记，dev 热重载 / 多个路由同时触发都只会启动一次；
//   ⚠️ 永不抛：整段包 try/catch，清理挂了也绝不影响出片。
let _started = false
export function startCleanupScheduler(): void {
  try {
    const g = globalThis as any
    if (_started || g.__vfCleanupStarted) return
    _started = true
    g.__vfCleanupStarted = true
    const tick = () => { try { runCleanupAll() } catch { /* 静默 */ } }
    // 启动后延迟 30s 再跑（别和服务器启动/首个请求抢 IO），之后每小时
    setTimeout(() => { tick(); setInterval(tick, HOUR) }, 30 * 1000)
    console.log('[清理] 定时清理已启动（启动后 30s 首次，之后每小时；只删超过 1h~72h 的确定垃圾）')
  } catch { /* ignore */ }
}
