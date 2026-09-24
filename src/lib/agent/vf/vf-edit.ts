/**
 * ★VF_EDIT_V1（2026-09-24 用户定案「A+B 都要」）：成片的【分镜画面文字】可编辑 + 只重渲染。
 *
 * 为什么单独做这条：
 *   · 出片后再想改一个画面大字，老流程只能整条重来（重写文案 + 重新配音，3~4 分钟且再花钱）；
 *     而且"重试"连草稿都已被销毁（chat/route.ts 里入队即清）→ 等于从头开始。
 *   · 实际上改【画面大字 / 卡型】**不需要重配音** —— 配音念的是 subtitle，大字只是画面元素。
 *   → 本文件提供：读分镜清单 / 改某几镜 / 只重渲染（`make.py --render-only`），
 *     复用 work 目录里已有的 `storyboard.voiced.json` + `voice.m4a`，1~2 分钟出片、不扣点。
 *
 * 两条入口共用本文件（逻辑只写一份，避免"一条坏两条全坏"）：
 *   A. 聊天里说「第 3 镜大字改成 XXX」→ chat/route.ts 的 `edit_video_shot` 工具 → 这里
 *   B. 客户端分镜清单改完点「重出片」→ /api/agent/video-edit → 这里
 *
 * 铁律：**只改画面文字/卡型，绝不碰 dur / voice**（镜长与配音时长是对齐的，动了就音画错位）。
 */
import path from 'path'
import fs from 'fs'
import { vfRootDir, vfStorageRoot } from '@/lib/agent/video-material'

/** 允许被编辑的字段（白名单——防止把 dur/voice/src 这类结构性字段改坏） */
const EDITABLE = ['text', 'title', 'subtitle', 'type', 'items', 'value', 'label', 'suffix',
  'left', 'right', 'leftDesc', 'rightDesc', 'cta', 'pick'] as const

/** 分镜文件名（渲染实际用哪个不确定，一律全改，避免"改了不生效"） */
const SB_FILES = ['storyboard.voiced.json', 'storyboard.ai.json', 'storyboard.json']

export interface VfTaskLite {
  id?: string
  status?: string
  work?: string
  out?: string
  bgm?: string
  url?: string
  repoName?: string
  startedAt?: string
}

function shotBrief(s: any): string {
  const big = String(s?.text || s?.title || '').trim()
  return `[${s?.type || '?'}] 大字=${big ? `「${big}」` : '（无）'}`
}

function shotLine(i: number, s: any): string {
  const sub = String(s?.subtitle || '').replace(/\s+/g, ' ').slice(0, 34)
  const dur = Number(s?.dur || 0)
  let extra = ''
  if (Array.isArray(s?.items) && s.items.length) {
    extra = ` 条目=${s.items.map((x: any) => (x && typeof x === 'object' ? String(x.label ?? x.text ?? '') : String(x))).slice(0, 4).join('/')}`
  }
  return ` ${String(i + 1).padStart(2)}. ${shotBrief(s)} ${dur ? dur.toFixed(1) + 's' : ''} 字幕=${sub}${extra}`
}

/** 找"可编辑的任务"：优先 taskId，否则最近一条【带 work 目录】的任务 */
export function findVfTask(uid: string, taskId?: string): { dir: string; file: string; task: any; work: string } | null {
  const outDir = path.join(vfStorageRoot(), String(uid), 'video-factory')
  if (!fs.existsSync(outDir)) return null
  let files = (fs.readdirSync(outDir) as string[]).filter((f) => /^vf\d+\.json$/.test(f)).sort().reverse()
  const want = String(taskId || '').trim()
  if (want) files = files.filter((f) => f.indexOf(want) >= 0)

  const pickWorkDir = (t: any): string => {
    if (t?.work && fs.existsSync(t.work)) return String(t.work)
    // ★兼容旧任务（这一版之前的任务文件没记 work 目录）：
    //   按 startedAt 找时间最接近的 work_* 目录（任务与 work 目录是同一批创建，误差在 1 分钟内）
    try {
      const ws = (fs.readdirSync(outDir) as string[])
        .filter((f) => f.startsWith('work_') && fs.statSync(path.join(outDir, f)).isDirectory())
      if (!ws.length) return ''
      const base = t?.startedAt ? new Date(t.startedAt).getTime() : Date.now()
      let best = ''
      let bestGap = Infinity
      for (const w of ws) {
        const gap = Math.abs(fs.statSync(path.join(outDir, w)).mtimeMs - base)
        if (gap < bestGap) { bestGap = gap; best = w }
      }
      // 超过 10 分钟就不敢认了（宁可报"找不到"，也不要改错一条片的画面）
      return bestGap < 10 * 60 * 1000 ? path.join(outDir, best) : ''
    } catch (e) {
      return ''
    }
  }

  for (const f of files) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8'))
      const work = pickWorkDir(t)
      if (work) return { dir: outDir, file: path.join(outDir, f), task: t, work }
    } catch (e) { /* 跳过坏文件 */ }
  }
  return null
}

function readShots(work: string): { shots: any[]; file: string } {
  for (const n of ['storyboard.voiced.json', 'storyboard.ai.json', 'storyboard.json']) {
    const p = path.join(work, n)
    if (!fs.existsSync(p)) continue
    try {
      const sb = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (Array.isArray(sb?.shots)) return { shots: sb.shots, file: n }
    } catch (e) { /* 换下一种 */ }
  }
  return { shots: [], file: '' }
}

/** 列出分镜清单（给 AI 看的紧凑文本 + 给 UI 用的结构化数据） */
export function listVfShots(uid: string, taskId?: string) {
  const found = findVfTask(uid, taskId)
  if (!found) {
    return {
      ok: false,
      msg: '找不到可编辑的成片任务（要么还没出过片，要么那条片太旧没记工程目录）。',
      shots: [] as any[],
    }
  }
  const { shots, file } = readShots(found.work)
  if (!shots.length) {
    return { ok: false, msg: `任务 ${found.task?.id || ''} 的工程目录里没有分镜文件（${found.work}）`, shots: [] as any[] }
  }
  const head = `任务 ${found.task?.id || ''} 分镜清单（共 ${shots.length} 镜，${found.task?.status === 'done' ? '已出片' : String(found.task?.status || '')}）：`
  const body = shots.map((s, i) => shotLine(i, s)).join('\n')
  const tail = `\n—— 要改就直接说，例如「第 3 镜大字改成 效率翻三倍」「第 7 镜字幕改成 …」。` +
    `改完我会【只重渲染】（复用配音，1~2 分钟、不扣点）。`
  return { ok: true, msg: head + '\n' + body + tail, shots, taskId: String(found.task?.id || ''), work: found.work, file }
}

/** 改某几镜（白名单字段）—— 只写分镜文件，不触发渲染 */
function applyEdits(work: string, edits: any[]): { applied: string[]; subtitleChanged: boolean } {
  const applied: string[] = []
  let subtitleChanged = false
  for (const n of SB_FILES) {
    const p = path.join(work, n)
    if (!fs.existsSync(p)) continue
    let sb: any
    try { sb = JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { continue }
    const shots = Array.isArray(sb?.shots) ? sb.shots : []
    let touched = 0
    for (const e of edits || []) {
      const i = parseInt(e?.index) - 1
      if (!(i >= 0 && i < shots.length)) continue
      const s = shots[i]
      const before = shotBrief(s)
      let changed = false
      for (const k of EDITABLE) {
        const v = (e as any)[k]
        if (v === undefined || v === null) continue
        // ★VF_EDIT_P0_V1：文本类字段允许"清空"（清空大字后，渲染侧会用该镜字幕兜底）；
        //   但结构性字段（卡型/数值/条目）不能清成空串，否则整卡没内容。
        if (v === '' && (k === 'type' || k === 'value' || k === 'items')) continue
        if (k === 'subtitle' && String(v) !== String(s[k] ?? '')) subtitleChanged = true
        if (JSON.stringify(s[k]) !== JSON.stringify(v)) { (s as any)[k] = v; changed = true }
      }
      if (changed) {
        touched++
        // 同一镜在多个文件里都要改：只在第一个文件里记一次变更说明
        if (n === SB_FILES.find((x) => fs.existsSync(path.join(work, x)))) {
          applied.push(`第 ${i + 1} 镜：${before} → ${shotBrief(s)}`)
        }
      }
    }
    if (touched) fs.writeFileSync(p, JSON.stringify(sb, null, 2))
  }
  return { applied, subtitleChanged }
}

function writeTaskFile(taskFile: string, o: Record<string, any>) {
  try {
    let prev: any = {}
    try { prev = JSON.parse(fs.readFileSync(taskFile, 'utf8')) || {} } catch (e) { /* 首次写 */ }
    fs.writeFileSync(taskFile, JSON.stringify({ ...prev, ...o }, null, 2))
  } catch (e) { /* 落盘失败不阻塞渲染 */ }
}

/** 起一个"只重渲染"任务：复用 work 目录的配音与分镜，跑完照旧传 OSS + 写任务文件 */
export async function startRenderOnly(uid: string, srcTask: any, work: string): Promise<{ ok: boolean; taskId?: string; msg?: string }> {
  const root = vfRootDir()
  if (!root) return { ok: false, msg: 'TOOL_REJECT:未找到本地成片脚本（scripts/video-factory/make.py）' }
  const { spawn } = await import('child_process')
  const mkPy = path.join(root, 'scripts', 'video-factory', 'make.py')
  const outDir = path.dirname(work)
  const newId = 'vf' + Date.now()
  const newOut = path.join(outDir, `vf_${Date.now()}.mp4`)
  const taskFile = path.join(outDir, newId + '.json')
  const py = process.env.BU_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  const argsRun = [mkPy, '--render-only', '--workdir', work, '--out', newOut]
  const bgm = String(srcTask?.bgm || '')
  if (bgm && fs.existsSync(bgm)) argsRun.push('--bgm', bgm)

  const startedAt = new Date().toISOString()
  writeTaskFile(taskFile, {
    id: newId, status: 'running', startedAt, out: newOut, work,
    uid: String(uid), cost: 0, renderOnly: true, from: String(srcTask?.id || ''),
  })
  try {
    const ch = spawn(py, argsRun, { windowsHide: true })
    let so = ''
    const push = (d: any) => { so = (so + String(d)).slice(-20000) }
    ch.stdout.on('data', push)
    ch.stderr.on('data', push)
    ch.on('close', async (code: number | null) => {
      const okDone = code === 0 && fs.existsSync(newOut)
      let extra: Record<string, any> = {}
      if (okDone) {
        try {
          const { readFile } = await import('fs/promises')
          const { saveToPersonalRepo } = await import('@/lib/personal-storage')
          const { signedUrl } = await import('@/lib/oss')
          const buf = await readFile(newOut)
          const { name } = await saveToPersonalRepo({
            userId: String(uid), buffer: buf, ext: 'mp4', mime: 'video/mp4',
          })
          extra = { repoName: name, url: await signedUrl(`storage/${uid}/${name}`, 86400) }
        } catch (e: any) {
          extra = { repoError: String(e?.message || e).slice(0, 200) }
        }
      }
      writeTaskFile(taskFile, {
        status: okDone ? 'done' : 'failed', finishedAt: new Date().toISOString(), code,
        tail: so.split('\n').filter(Boolean).slice(-40), ...extra,
      })
    })
    ch.on('error', (e: any) => {
      writeTaskFile(taskFile, { status: 'failed', finishedAt: new Date().toISOString(), error: String(e).slice(0, 300) })
    })
  } catch (e: any) {
    writeTaskFile(taskFile, { status: 'failed', finishedAt: new Date().toISOString(), error: String(e).slice(0, 300) })
    return { ok: false, msg: 'TOOL_REJECT:重出片启动失败 ' + String(e).slice(0, 120) }
  }
  return { ok: true, taskId: newId }
}

/**
 * 改分镜 + 只重渲染。
 * @param edits 形如 [{index:3, text:'新大字'}, {index:7, subtitle:'新字幕'}]
 */
export async function editVfShots(uid: string, edits: any[], taskId?: string) {
  const found = findVfTask(uid, taskId)
  if (!found) {
    return { ok: false, msg: '找不到可编辑的成片任务（要么还没出过片，要么那条片太旧没记工程目录）。' }
  }
  const { task, work } = found
  if (String(task?.status) === 'running') {
    return { ok: false, msg: '这条片还在渲染中（约 1~2 分钟），等它出完再改更稳 —— 稍后再跟我说一次。' }
  }
  const { shots } = readShots(work)
  if (!shots.length) {
    return { ok: false, msg: `找不到分镜文件（${work}）` }
  }
  const { applied, subtitleChanged } = applyEdits(work, edits || [])
  if (!applied.length) {
    return {
      ok: false,
      msg: `没有实际改动（镜号要在 1~${shots.length} 之间，且内容要真的变）。\n` +
        shots.map((s, i) => shotLine(i, s)).join('\n'),
    }
  }
  const r = await startRenderOnly(uid, task, work)
  if (!r.ok) return { ok: false, msg: r.msg || '重出片启动失败' }
  const warn = subtitleChanged
    ? '\n⚠️ 你改了字幕文字，但【配音没有重录】（声音还是原来那句）。要求声音也跟着变，请说「重新配音出片」重跑整条流程。'
    : ''
  return {
    ok: true,
    taskId: r.taskId,
    applied,
    // ★MAKE_VIDEO_TASK 必须原样出现在回复里：客户端靠它启动"进度轮询 + 出片完成卡"
    //   （轮询是 `content.includes('MAKE_VIDEO_TASK:')` + `match(/MAKE_VIDEO_TASK:(\S+)/)`，
    //    不要求行首，但放行首最稳）
    msg: `MAKE_VIDEO_TASK:${r.taskId} 已按你的修改重新出片（只重渲染、复用已有配音，` +
      `不重新 TTS、本次不扣点，约 1~2 分钟）：\n· ${applied.join('\n· ')}${warn}`,
  }
}

/** 给前端用的精简分镜清单（B 入口：渲染可编辑列表） */
export function shotsForUi(uid: string, taskId?: string) {
  const found = findVfTask(uid, taskId)
  if (!found) return { ok: false, taskId: '', shots: [] as any[] }
  const { shots } = readShots(found.work)
  return {
    ok: shots.length > 0,
    taskId: String(found.task?.id || ''),
    status: String(found.task?.status || ''),
    shots: shots.map((s, i) => ({
      index: i + 1,
      type: s?.type || '',
      text: String(s?.text || ''),
      title: String(s?.title || ''),
      subtitle: String(s?.subtitle || ''),
      dur: Number(s?.dur || 0),
    })),
  }
}
