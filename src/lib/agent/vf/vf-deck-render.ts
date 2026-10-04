import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { vfRootDir, vfStorageRoot } from '@/lib/agent/video-material'
import { spendTokens, checkTokens } from '@/lib/token-wallet'

/**
 * ★VF_DECKCONFIRM_V1（2026-10-04 用户定案「双轨并存：确认卡上自己选老引擎/新引擎；老的保留不退役」）
 * ——「🎬 确认出片 · 新引擎」的执行体。
 *
 *   确认卡上与原「确认出片」（老 Python 链，**一个字没改、默认仍是它**）并排一个新按钮；
 *   点它 = 发机器协议串 `VF_DECK_CONFIRM:{"skin":"v1","ori":"9:16"}`。
 *   chat/route.ts 在**四条成片线分派之前**接管该协议（线上有 step='script' 草稿时各线
 *   "有草稿必接管"，晚于此会被蹭走——与 VF_I2V_OFF 同一类防线），再调用本文件。
 *
 * 与 /api/agent/vf/deck-preview 的关系（同一引擎、同一映射、同一白名单；区别只有三点）：
 *   · preview 是审核（不扣点、quotaCheck:false）；本文件是【正式出片】：收文案费（与老链
 *     同公式：ceil(字数/20)，字数 = script 优先、无则分镜 subtitle/text 总和 —— ★VF_COSTFIX_V1
 *     的口径，报价 = 实扣），入个人仓库走配额（与老链 saveToPersonalRepo 同参）。
 *   · 任务文件 vf<ts>.json 与老链**同形状**（id/status/startedAt/finishedAt/out/cost/repoName/
 *     url/tail/error）→ make-video-status 进度轮询、完成推送、入库/签名 URL 前端展示**全复用**。
 *   · 多记 engine:'deck' + skin/ori（诊断用）。
 *
 * ⚠️ 诚实口径：新引擎成片 = 动态 PPT（HTML 逐帧，与预览同画面），**无配音、无 BGM、无动图/AI 画面**
 *   （make-video.mjs 无音频参数——实测 CLI 只有 --in/--skins/--orientations/--outdir 等）。
 *   前端按钮 tooltip 与服务端日志都如实写明；动图/AI 画面那两笔钱**不收**（只少收不多收）。
 */

/** 皮肤白名单 = masters/ 的权威清单（与 deck-preview 路由逐字一致，防任意参数注入 spawn） */
export const DECK_SKINS = ['ecom', 'editorial', 'edu', 'festive', 'formal', 'health', 'mono', 'tech', 'v1', 'v2'] as const
const ORIS = ['9:16', '16:9'] as const
const MAX_SECTIONS = 10         // 每节 3 镜 ⇒ 最多消费 30 镜（与 deck-preview 同上限）
const BULLET_MAX = 28           // 引擎要点窗口上限（gen-deck W.iBullets，与 deck-preview 同窗）
const TIMEOUT_MS = 420000       // 与 deck-preview 同值（页面多时 1~3 分钟级）

/** 四条成片线的草稿 tag（★VF_DRAFT_ISOLATE_V1：一律 equals 精确匹配；素材线含历史旧 tag） */
const DRAFT_TAGS = ['vf_draft_base', 'vf_draft', 'vf_draft_ai', 'vf_draft_mix', 'vf_draft_video']

/** 解析 `VF_DECK_CONFIRM:{...}` 协议串（白名单校验；非法值回默认 v1 / 9:16，绝不透传给 spawn） */
export function deckConfirmArgsOf(m: string): { skin: string; ori: string } {
  let skin = 'v1'
  let ori = '9:16'
  try {
    const raw = String(m || '').replace(/^VF_DECK_CONFIRM\s*:\s*/, '').trim()
    const o = raw ? JSON.parse(raw) : {}
    if (typeof o?.skin === 'string' && (DECK_SKINS as readonly string[]).includes(o.skin)) skin = o.skin
    if (typeof o?.ori === 'string' && (ORIS as readonly string[]).includes(o.ori)) ori = o.ori
    // 兼容字段名 orientation（与 deck-preview 路由的入参同名）
    if (typeof o?.orientation === 'string' && (ORIS as readonly string[]).includes(o.orientation)) ori = o.orientation
  } catch { /* 解析失败用默认值 */ }
  return { skin, ori }
}

/** 草稿正文历史上串过线（"AI制片草稿:{...}"）—— 只取 JSON 部分 */
function parseDraftContent(content: string): any {
  const s = String(content || '').trim()
  try { return JSON.parse(s) } catch { /* 走下面的兜底 */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)) } catch { /* ignore */ } }
  return null
}

/**
 * 找该用户**任一条**停在出片确认步的草稿（step='script' 且有分镜）。
 * 四条线各查各的 tag，取 updatedAt 最新的一条 —— 正常任一时刻只有一条线在走；
 * 多条并存（历史残留）时取最新，与用户在确认卡上看到的是同一条。
 */
export async function findDeckConfirmDraft(db: any, uid: number | string): Promise<{ draft: any; tag: string } | null> {
  try {
    let best: { draft: any; tag: string; ts: number } | null = null
    for (const tag of DRAFT_TAGS) {
      const row = await db.agentMemory.findFirst({
        where: { userId: String(uid), tags: { equals: tag } },
        orderBy: { updatedAt: 'desc' },
      })
      if (!row?.content) continue
      const d = parseDraftContent(String(row.content))
      if (!d || d.step !== 'script' || !Array.isArray(d.shots) || !d.shots.length) continue
      const ts = row.updatedAt ? new Date(row.updatedAt).getTime() : 0
      if (!best || ts > best.ts) best = { draft: d, tag, ts }
    }
    return best ? { draft: best.draft, tag: best.tag } : null
  } catch { return null }
}

/**
 * 【正式出片】把同一份分镜交给 HTML 逐帧引擎后台渲染（不 await 引擎——与老链 make.py 同为后台任务）。
 * 返回 { ok:true, taskId, cost } = 已入队；{ ok:false, msg } = 人话原因（预检失败/余额不足/引擎缺失/文字太少）。
 * 扣费时机：**渲染成功入库后**才扣（失败不扣；与老链 I2V_BILL_V1 的"没生成出来不收"同精神）。
 */
export async function runDeckVideoTask({ uid, draft, skin, ori, log }: {
  uid: number | string
  draft: any
  skin: string
  ori: string
  log?: (u: any, m: string) => void
}): Promise<{ ok: boolean; taskId?: string; cost?: number; msg?: string }> {
  const uidS = String(uid)
  const uidN = Number(uid) || 0        // checkTokens/spendTokens 要 number（route.ts 老链同口径）
  const vflog = (m: string) => { try { (log || (() => {}))(uidS, m) } catch { /* ignore */ } }
  try {
    const shots: any[] = Array.isArray(draft?.shots) ? draft.shots : []
    if (!shots.length) return { ok: false, msg: '没有可出片的分镜' }

    // ── 计费（与老链 make_ai_video ★VF_COSTFIX_V1 同公式）：script 优先，无则分镜 subtitle/text 总和 ──
    let chars = String(draft?.script || '').length
    if (!chars) chars = shots.reduce((a: number, s: any) => a + String((s && (s.subtitle || s.text)) || '').length, 0)
    const cost = Math.max(1, Math.ceil(chars / 20))
    const chk = await checkTokens(uidN, cost)
    if (!chk?.allowed) return { ok: false, msg: String(chk?.message || '点数不足') }

    // ── 分镜 → copy.md（与 /api/agent/vf/deck-preview 同一映射：首 title 镜=封面；每 3 镜并一节；引擎自动尾页）──
    const bulletOf = (s: any): string => {
      const text = String(s?.text || '').trim()
      const sub = String(s?.subtitle || '').trim()
      let b = text && sub && text !== sub ? `${text}：${sub}` : (text || sub)
      if (b.length > BULLET_MAX) b = b.slice(0, BULLET_MAX - 1) + '…'
      return b.length >= 6 ? b : ''
    }
    const mid = shots.slice(1).map(bulletOf).filter(Boolean)
    if (mid.length < 6) {
      return { ok: false, msg: `分镜可用的文字太少（可用要点 ${mid.length} 条，新引擎至少需要 6 条 ≈ 6 镜）。回「重试」重排，或用左边「确认出片」走老引擎。` }
    }
    const lines: string[] = []
    const first = shots.find((s) => String(s?.text || '').trim() || String(s?.subtitle || '').trim())
    lines.push(`# ${String(first?.text || '').trim() || '成片'}`, String(first?.subtitle || '').trim(), '')
    let used = 0
    for (let i = 0; i + 3 <= mid.length && used < MAX_SECTIONS; i += 3, used++) {
      const grp = mid.slice(i, i + 3)
      lines.push(`## ${grp[0].split('：')[0].slice(0, 12)}`, ...grp.map((b) => `- ${b}`), '')
    }

    // ── 引擎在位检查（standalone 部署下用 vfRootDir 多候选找，与 make_ai_video 同防线）──
    const engDir = path.join(vfRootDir() || '', 'scripts', 'video-factory', 'html-deck')
    const mkP = path.join(engDir, 'make-video.mjs')
    if (!fs.existsSync(mkP)) {
      return { ok: false, msg: '服务端缺少 html-deck 引擎（scripts/video-factory/html-deck 未部署）' }
    }

    // ── 任务目录 + 任务文件（与老链同形状 → make-video-status 轮询/入库/推送全复用）──
    const outDir = path.join(vfStorageRoot(), uidS, 'video-factory')
    fs.mkdirSync(outDir, { recursive: true })
    const taskId = 'vf' + Date.now()
    const taskFile = path.join(outDir, taskId + '.json')
    const writeTask = (o: Record<string, any>) => {
      try {
        let prev: any = {}
        try { prev = JSON.parse(fs.readFileSync(taskFile, 'utf-8')) || {} } catch { /* 首次写 */ }
        fs.writeFileSync(taskFile, JSON.stringify({ ...prev, ...o }, null, 2))
      } catch { /* 任务文件写失败不阻塞渲染本体 */ }
    }
    writeTask({ id: taskId, status: 'running', startedAt: new Date().toISOString(),
      cost, script: String(draft?.script || '').slice(0, 200), engine: 'deck', skin, ori, uid: uidS })

    // ── 后台渲染（不 await；超时 kill；close 后入库/扣费/收尾，异常全部就地消化）──
    const workDir = path.join(outDir, 'deck_' + Date.now())
    const od = path.join(workDir, 'out')
    fs.mkdirSync(od, { recursive: true })
    const mdP = path.join(workDir, 'copy.md')
    fs.writeFileSync(mdP, lines.filter((l) => l !== '').join('\n') + '\n', 'utf8')
    writeTask({ work: workDir })
    vflog(`[新引擎出片] 入队 ${taskId}：skin=${skin} ${ori} · ${used + 2} 页预计 · 报价 ${cost} 点（=文案费；无配音/BGM/动图费）`)

    let so = ''
    const push = (d: any) => { so = (so + String(d)).slice(-20000) }
    const finish = async (code: number | null) => {
      const finishedAt = new Date().toISOString()
      const tail = so.split('\n').filter(Boolean).slice(-40)
      const mp4s: string[] = []
      const walk = (d: string) => {
        try {
          for (const it of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, it.name)
            if (it.isDirectory()) walk(p)
            else if (it.name.toLowerCase().endsWith('.mp4')) mp4s.push(p)
          }
        } catch { /* 目录缺失时按"无产物"处理 */ }
      }
      walk(od)
      const okDone = code === 0 && mp4s.length === 1 && (() => { try { return fs.statSync(mp4s[0]).size > 0 } catch { return false } })()
      if (!okDone) {
        const reason = code !== 0 ? `make-video.mjs 退出码 ${code}` : `产物数异常（${mp4s.length} 条 MP4，应恰好 1）`
        writeTask({ status: 'failed', finishedAt, error: reason, tail })
        vflog(`[新引擎出片] 失败：${reason}（不扣点）`)
        return
      }
      const { readFile } = await import('node:fs/promises')
      const { saveToPersonalRepo } = await import('@/lib/personal-storage')
      const { signedUrl } = await import('@/lib/oss')
      const buf = await readFile(mp4s[0])
      const { name } = await saveToPersonalRepo({ userId: uidS, buffer: buf, ext: 'mp4', mime: 'video/mp4' })
      const url = await signedUrl(`storage/${uidS}/${name}`, 86400)
      let pages = used + 2
      try {
        const rep = JSON.parse(fs.readFileSync(path.join(od, 'make-report.json'), 'utf8'))
        const row = (rep.rows || [])[0] || {}
        if (row.pages) pages = Number(row.pages) || pages
      } catch { /* 报告缺失不阻塞（MP4 已验证存在且非空） */ }
      writeTask({ status: 'done', finishedAt, out: mp4s[0], repoName: name, url, pages, tail })
      // 扣费：渲染成功入库后才扣（失败不扣）
      spendTokens(uidN, cost, 'make_ai_video').catch(() => {})
      vflog(`[新引擎出片] 成功：${name}（skin=${skin} ${ori} · ${pages} 页 · 实扣 ${cost} 点）`)
      try { fs.rmSync(workDir, { recursive: true, force: true }) } catch { /* 清理失败不影响结果 */ }
    }

    try {
      const ch = spawn(process.execPath, [mkP, '--in', mdP, '--skins', skin, '--orientations', ori, '--outdir', od],
        { windowsHide: true, cwd: engDir })
      ch.stdout.on('data', push)
      ch.stderr.on('data', push)
      const t = setTimeout(() => { try { ch.kill() } catch { /* ignore */ } }, TIMEOUT_MS)
      ch.on('error', (e: any) => {
        clearTimeout(t)
        finish(-1).catch(() => {
          writeTask({ status: 'failed', finishedAt: new Date().toISOString(), error: '无法启动 node：' + String(e?.message || e).slice(0, 120) })
        })
      })
      ch.on('close', (code: number | null) => {
        clearTimeout(t)
        finish(code).catch((eF: any) => {
          writeTask({ status: 'failed', finishedAt: new Date().toISOString(), error: String(eF?.message || eF).slice(0, 200) })
          vflog('[新引擎出片] 收尾异常: ' + String(eF?.message || eF).slice(0, 120))
        })
      })
    } catch (eS: any) {
      writeTask({ status: 'failed', finishedAt: new Date().toISOString(), error: String(eS?.message || eS).slice(0, 200) })
      return { ok: false, msg: '后台渲染启动失败：' + String(eS?.message || eS).slice(0, 120) }
    }
    return { ok: true, taskId, cost }
  } catch (e: any) {
    return { ok: false, msg: String(e?.message || e).slice(0, 160) }
  }
}
