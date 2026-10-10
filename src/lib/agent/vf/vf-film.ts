/**
 * ★VF_FILMLINE_V1（2026-10-08）—— 「素材片 / MG 线」的 AGENT 侧封装（**新增线，不动老线**）
 * =============================================================================
 * 这条线要解决的事：用户给一批素材（图片/视频帧）+ 一句主题，就要一条**好看的竖屏短片**。
 * 做法不是"AI 生成画面"，而是"**风格包 + 镜头组**"（引擎逐帧渲 HTML）—— 可复现、可验收。
 *
 * 三件事（全部落在 scripts/video-factory/html-deck/tools/ 的离线工具上，本文件只做封装）：
 *   ① capabilityBrief()  —— 给模型看的**能力清单**（它不知道这套新引擎，必须每次喂）
 *   ② orchestrate()      —— 编排：判赛道 / 选风格包 / 选镜头组 / 填文案（**只引用库内 id**）
 *        · 先让 AI 出（由上层把 brief 交给模型），再用 `validate` 校验；越界 ⇒ 自动回退
 *        · 没有 AI 也能出（`rule` 规则版，永不失败）
 *   ③ render()           —— 出片：三道闸门（素材/用字/引擎校验）→ 渲染；**失败即回退**
 *
 * ⚠ 设计纪律（与本项目其余部分一致）：本条线**不改动** deck 的 12 种制式页型契约，
 *   走独立入口 render-film.mjs ⇒ 老线（图片成片/图视混剪/PPT+图视）行为一行不变。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { vfRootDir } from '@/lib/agent/video-material'
// ★VF_CHARSET_V1（2026-10-09 用户实测「出片被 fonts 闸门拦」）：文案压回字体子集内的唯一实现
import { loadCharset, sanitizeSlots } from './charset'

/** 引擎工具目录 */
export function filmToolsDir(): string {
  return path.join(vfRootDir() || '', 'scripts', 'video-factory', 'html-deck')
}

export function filmLineReady(): boolean {
  const d = filmToolsDir()
  return fs.existsSync(path.join(d, 'tools', 'orchestrate.mjs')) && fs.existsSync(path.join(d, 'tools', 'render-film.mjs'))
}

/** 给模型的一页纸（**每次都要喂** —— 它不可能"了解"一个 2025 年的新引擎） */
export function capabilityBrief(): string {
  return [
    '【HTML成片线（可编程页 · 风格包 + 镜头组）】你可以把用户给的图片直接做成竖屏短片，做法不是 AI 生成画面，而是"HTML 逐帧渲染"，因此**画面可复现、可验收**。',
    '用户给素材（图片/视频帧）+ 一句主题 → 你只做四件事：**判赛道、选风格包、选镜头组、填文案**。',
    '铁律：**只能引用库里已有的 id**（风格包 id / 结构 id / 镜头组 id）。库外的 id 会被校验器替换成默认值（记为 fallback），所以"选得不准"没关系，"发明 id"会被回退。',
    '你不写代码、不画页面、不排时间线 —— 编排由编排器做，出片由引擎做。',
    '失败语义：出片前有三道闸门（素材齐全 / 用字在字体子集内 / 引擎校验对比度与重叠）。任一道不过 ⇒ 返回失败原因，**不会产出坏片**，此时应回退老画法（如 make_ai_video）或改文案重试。',
  ].join('\n')
}

type RunOut = { code: number; out: string }

function runNode(args: string[], timeoutMs = 15 * 60 * 1000): Promise<RunOut> {
  return new Promise((resolve) => {
    const dir = filmToolsDir()
    const child = spawn(process.execPath, args, { cwd: dir })
    let out = ''
    const t = setTimeout(() => { try { child.kill() } catch { /* ignore */ } }, timeoutMs)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? -1, out }) })
  })
}

/** ② 规则版编排（离线保底）：永不失败 */
export async function orchestrate(opts: {
  materials: string[]
  text?: string
  pack?: string
  variant?: number
  id?: string
  outJson: string
  /** ★VF_RATIO_V1（2026-10-10）：**大图:填图 比例** 0~1（客户端比例条，默认 5:5）。
   *  一路透传：卡片 → 草稿 → planFilm → 这里 → orchestrate.mjs → arrange.mjs。 */
  plateRatio?: number
  /** ★VF_SPEC_V1（2026-10-10 用户定案「四项全部让 AI 自己规划」）：**风格语法**（L1 构图/L2 动效/L3 文本形态）。
   *  CLI 用**文件**传（实测：Windows PowerShell 传内联 JSON 会把双引号吃掉 ⇒ JSON.parse 失败）。 */
  spec?: any
}): Promise<{ ok: boolean; vertical?: string; pack?: string; scenes?: number; total?: number; note?: string }> {
  if (!opts.materials?.length) return { ok: false, note: '没有素材' }
  const args = [
    path.join('tools', 'orchestrate.mjs'), 'rule',
    '--materials', opts.materials.join(','),
    '--text', String(opts.text || ''),
    '--variant', String(opts.variant || 0),
    '--id', opts.id || 'vf-film',
    '--out', opts.outJson,
  ]
  if (opts.pack) args.push('--pack', opts.pack)
  if (Number.isFinite(Number(opts.plateRatio))) args.push('--plate-ratio', String(Number(opts.plateRatio)))
  if (opts.spec && typeof opts.spec === 'object') {
    const specRel = opts.outJson.replace(/\.json$/, '') + '.spec.json'
    fs.writeFileSync(path.join(filmToolsDir(), specRel), JSON.stringify(opts.spec, null, 2), 'utf8')
    args.push('--spec', specRel)
  }
  const r = await runNode(args, 120000)
  if (r.code !== 0 || !fs.existsSync(path.join(filmToolsDir(), opts.outJson))) return { ok: false, note: r.out.slice(-300) }
  try {
    const j = JSON.parse(fs.readFileSync(path.join(filmToolsDir(), opts.outJson), 'utf8'))
    return { ok: true, vertical: j.vertical, pack: j.pack, scenes: j.scenes?.length, total: j.total, note: (j.rationale || []).join(' / ') }
  } catch (e: any) { return { ok: false, note: String(e?.message || e) } }
}

/** ②b 校验 AI 的编排（越界回退）：AI 输出 → 合法编排 */
export async function validate(orchestrationJson: string, opts: { materials: string[]; outJson: string }) {
  const args = [path.join('tools', 'orchestrate.mjs'), 'validate', orchestrationJson, '--materials', opts.materials.join(','), '--out', opts.outJson]
  const r = await runNode(args, 120000)
  const fallbacks = (r.out.match(/fallback (\d+)/) || [])[1] || '0'
  return { ok: r.code === 0, fallbacks: Number(fallbacks), note: r.out.slice(-400) }
}

/** ★VF_FILM_CARD_V1（2026-10-08）：把出片结果变成**给前端的协议串**（成片入个人仓库 + 24h 签名 URL）。
 *  为什么独立成函数：「HTML成片」有**两个**出片调用方 ——
 *    ① 旧的一键工具路径（route.ts 的 case 'make_material_film'）；
 *    ② 新的状态机路径（vf-htmlfilm.ts 的确认卡「🎬 出片」）。
 *  契约必须只有一份实现（本项目教训：同一件事两处写，必然后面改一处漏一处）。
 *  失败语义：入库/签名失败**不判死出片** —— 回本地路径，前端如实提示（见 page.tsx 的 VF_FILM_DONE 卡）。 */
export async function filmDoneProtocol(
  uid: number | string,
  r: { mp4?: string; sheet?: string; pack?: string; vertical?: string; voiced?: boolean; voiceErr?: string },
): Promise<string> {
  const { readFile } = await import('fs/promises')
  const { saveToPersonalRepo } = await import('@/lib/personal-storage')
  const { signedUrl } = await import('@/lib/oss')
  try {
    let url = ''
    let poster = ''
    // ★VF_FILMLOCAL_V1（2026-10-09 用户定案：**成片必须"个人仓库 + 本地仓库"双落地**）：
    //   其他线（上传/图片成片）完成后都会由**客户端**调 `electronAPI.storageMirror` 落本地仓库；
    //   本线之前只落个人仓库 ⇒ 违反规则。这里把入库后的**文件名**一并带进协议串，
    //   客户端就能用 `/api/storage/file?...&name=<repoName>&persist=1` 镜像到本地仓库（见 page.tsx）。
    let repoName = ''
    let repoPoster = ''
    // ★VF_NOEMPTY_V1（2026-10-09 用户实测「视频根本打不开」·真因）：
    //   服务端混音失败时 ffmpeg 会**留下 0 字节文件**，老代码只判 `existsSync` ⇒ 当成功 ⇒
    //   把 0 字节 buffer 传上 OSS ⇒ 客户端镜像到本地就是 0.0MB 文件（本地/网页都打不开）。
    //   现口径：**空文件一律不入库**（宁可不给地址，也不给一个坏文件）。
    // （顺手修掉上次留的类型错：`r.mp4` 是 `string | undefined`，直接 statSync 过不了 TS；
    //   运行时本来就有 try/catch 兜住，这里只是把类型写对）
    const mp4Sz = (() => { try { return r.mp4 ? fs.statSync(r.mp4).size : -1 } catch { return -1 } })()
    if (r.mp4 && mp4Sz > 0) {
      const buf = await readFile(r.mp4)
      const { name } = await saveToPersonalRepo({ userId: String(uid), buffer: buf, ext: 'mp4', mime: 'video/mp4' })
      repoName = String(name || '')
      url = await signedUrl(`storage/${uid}/${name}`, 86400)
    } else if (r.mp4) {
      console.error('[film] 成片为空（' + mp4Sz + 'B）⇒ 不入库、不给地址：' + r.mp4)
    }
    if (r.sheet && fs.existsSync(r.sheet)) {
      try {
        const bufS = await readFile(r.sheet)
        const { name: nS } = await saveToPersonalRepo({ userId: String(uid), buffer: bufS, ext: 'jpg', mime: 'image/jpeg' })
        repoPoster = String(nS || '')
        poster = await signedUrl(`storage/${uid}/${nS}`, 86400)
      } catch { /* 审片图失败不影响成片 */ }
    }
    if (url) return `VF_FILM_DONE:${JSON.stringify({ url, poster, repoName, repoPoster, pack: r.pack || '', vertical: r.vertical || '', voiced: !!r.voiced, voiceErr: r.voiceErr || '' })}`
  } catch { /* 落到下面兜底 */ }
  return `VF_FILM_DONE:${JSON.stringify({ url: '', poster: '', localMp4: r.mp4 || '', pack: r.pack || '', vertical: r.vertical || '', voiced: !!r.voiced, voiceErr: r.voiceErr || '' })}`
}

/** ③ 出片：三道闸门 → 渲染（失败返回 stage，调用方据此回退） */
export async function render(filmJson: string, outDir: string): Promise<{ ok: boolean; mp4?: string; sheet?: string; stage?: string; err?: string }> {
  const r = await runNode([path.join('tools', 'render-film.mjs'), filmJson, '--outdir', outDir], 30 * 60 * 1000)
  // ★VF_FILM_PATH_V1（2026-10-08 用户实测：协议串里 `localMp4` 是
  //   `…/film.mp4（6 段 · 30s）` —— 路径后面粘着**说明文字**）：
  //   原来靠 stdout 正则 `成片：(.*?)\n` 抓路径，而 render-film 那行打印是
  //   `成片：<相对路径>（N 段 · Ms）` ⇒ 抓到的"路径"根本不存在 ⇒ 后续 `readFile` 失败
  //   ⇒ 入个人仓库/签名整条断掉（前端于是只剩"没拿到可播放地址"）。
  //   现口径：**按目录找文件**（最稳，不看 stdout 文案）——
  //     成片 = outDir 下最大的 .mp4（渲染产物只有一个）；审片图 = sheet.jpg（或 *sheet*.jpg）。
  //   都找不到才退回"清洗过的"stdout 路径（去掉行尾说明文字/括号）。
  if (r.code === 0) {
    const dirAbs = path.isAbsolute(outDir) ? outDir : path.join(filmToolsDir(), outDir)
    let mp4 = ''
    let sheet = ''
    try {
      const names = fs.readdirSync(dirAbs)
      const sizeOf = (p: string) => { try { return fs.statSync(p).size } catch { return 0 } }
      const mp4s = names.filter((n) => /\.mp4$/i.test(n))
        .map((n) => ({ p: path.join(dirAbs, n), sz: sizeOf(path.join(dirAbs, n)) }))
        .sort((a, b) => b.sz - a.sz)
      if (mp4s.length && mp4s[0].sz > 0) mp4 = mp4s[0].p
      const sh = names.find((n) => /^sheet\.jpe?g$/i.test(n)) || names.find((n) => /sheet.*\.jpe?g$/i.test(n))
      if (sh) sheet = path.join(dirAbs, sh)
    } catch { /* 目录读不到 → 走下面兜底 */ }
    if (!mp4) {
      const m = r.out.match(/成片[:：]\s*([^\s（(]+)/)   // 只取到空白/括号为止，别把说明文字带进来
      if (m) {
        const cand = path.isAbsolute(m[1]) ? m[1].trim() : path.join(filmToolsDir(), m[1].trim())
        // ★VF_NOEMPTY_V1（2026-10-09 服务端实测 0 字节还报成功）：stdout 兜底路径也**必须非空**
        //   （ffmpeg/引擎失败会先留下 0 字节文件 ⇒ 只判 existsSync 会把空文件当成功）
        try { if (fs.existsSync(cand) && fs.statSync(cand).size > 0) mp4 = cand } catch { /* 读不到就不认它 */ }
      }
    }
    return { ok: true, mp4, sheet }
  }
  const stage = (r.out.match(/stage=(\w+)/) || [])[1] || 'unknown'
  const why = (r.out.split('\n').find((l) => l.includes('原因：')) || '').replace('原因：', '').trim()
  return { ok: false, stage, err: why || r.out.slice(-300) }
}

/** ★VF_FILMVOICE_V1（2026-10-09 用户定案「先校准流程」）：**配音 + 字幕出口**。
 *  实现口径：**只调 `tools/film-voice.mjs`**（audio-first 五步都在那个工具里）——
 *  本文件**不重写一遍** TTS/字幕/混音（本项目教训：同一件事两处实现必然分叉）。
 *  那个工具里的 TTS 默认走**纯 Node**（`tools/tts-node.mjs`，协议与 src/lib/ai-providers.ts 的
 *  dashscopeTTS 逐字对齐）⇒ **生产服务器没有 python 也能配音**；口播没给时按"在屏文案"兜底。
 *  ⚠️ 产物落位（与工具约定）：`<outDir>/<film.id>-voiced.mp4` + `<outDir>/render/sheet.jpg` */
async function voiceFilm(
  filmJsonRel: string, outDir: string, voice?: string,
): Promise<{ ok: boolean; mp4?: string; sheet?: string; stage?: string; err?: string }> {
  const args = [path.join('tools', 'film-voice.mjs'), filmJsonRel, '--outdir', outDir]
  if (voice) args.push('--voice', voice)
  const r = await runNode(args, 30 * 60 * 1000)
  const dirAbs = path.isAbsolute(outDir) ? outDir : path.join(filmToolsDir(), outDir)
  // ★VF_FILMVOICE_V1d（2026-10-09 用户实测「明明渲染成功了却报配音失败」）：
  //   成片路径**只认工具自己打的那行** `FINAL_MP4:<绝对路径>`（最可靠）；拿不到再按目录兜底找
  //   `*-voiced.mp4`（或最大的 mp4）。不再猜 `<id>-voiced.mp4` 这个名字 ——
  //   旧实现在"源 film.json 没有 id"时**必然找不到** ⇒ 误报失败 ⇒ 白回退成无声版（就是这么踩的）。
  const mFin = String(r.out || '').match(/FINAL_MP4:([^\r\n]+)/)
  let mp4 = mFin ? mFin[1].trim() : ''
  if (!mp4 || !fs.existsSync(mp4)) {
    const scan = (re: RegExp) => {
      try { return fs.readdirSync(dirAbs).filter((n) => re.test(n)).map((n) => path.join(dirAbs, n)) } catch { return [] as string[] }
    }
    const hit = scan(/-voiced\.mp4$/i)
    const all = hit.length ? hit : scan(/\.mp4$/i)
    mp4 = all.sort((a, b) => { try { return fs.statSync(b).size - fs.statSync(a).size } catch { return 0 } })[0] || ''
  }
  // ★VF_NOEMPTY_V1（2026-10-09 服务端实测「0 字节 mp4 却报成功」）：成片**非空**才算成功。
  //   空文件一律当"配音失败"⇒ 上层回退无声版并如实告知；**绝不把空文件传上去**
  //   （传上 OSS 后客户端会镜像成本地 0.0MB 文件，本地/网页都打不开 —— 就是用户这次踩的坑）。
  const voicedOk = (() => { try { return fs.statSync(mp4).size >= 20 * 1024 } catch { return false } })()
  if (r.code === 0 && mp4 && fs.existsSync(mp4) && voicedOk) {
    const sheet = path.join(dirAbs, 'render', 'sheet.jpg')
    return { ok: true, mp4, sheet: fs.existsSync(sheet) ? sheet : '' }
  }
  const stage = (r.out.match(/stage=(\w+)/) || [])[1] || 'voice'
  const why = (r.out.split('\n').find((l) => l.includes('原因：')) || '').replace('原因：', '').trim()
  return { ok: false, stage, err: why || String(r.out).slice(-300) }
}

/** ★VF_FILMCOPY_V1（2026-10-09 用户定案「B该用模型就用模型 / 让 AI 先总结素材 / **不要乱出片**」）：
 *  **只出骨架、不渲染** —— 先拿到"这条片会怎么排"（每段结构 + 该段素材），
 *  好让 AI 按骨架写**逐镜文案**；用户看过确认卡、点「出片」之后再真出片（不再"直接乱出片"）。
 *  ⚠️ arrange 是**确定性**的（同样素材+风格 ⇒ 同样骨架）⇒ 这里拿到的骨架与真正出片时一致，序号可对齐。 */
export async function planFilm(opts: {
  materials: string[]
  text?: string
  pack?: string
  variant?: number
  workDir: string
  /** ★VF_RATIO_V1：大图:填图 比例（0~1，默认 5:5）——骨架按它排，并写进 film.json 供出片核对 */
  plateRatio?: number
  /** ★VF_SPEC_V1：风格语法（L1/L2/L3）——写进 film.json，由渲染器解释 */
  spec?: any
}): Promise<{ ok: boolean; scenes?: Array<{ structure: string; media: string[]; dur: number }>; pack?: string; vertical?: string; err?: string
  /** ★VF_FILMSRC_V1：**整份 film.json**（含 requirePlate/plateCount/total 等顶层字段）——
   *  调用方把它存进草稿，出片时原样复用 ⇒ 骨架**只编一次**，不可能与文案错位。 */
  film?: any }> {
  fs.mkdirSync(opts.workDir, { recursive: true })
  const filmJson = path.join(opts.workDir, 'film.json')
  const rel = path.relative(filmToolsDir(), filmJson).replace(/\\/g, '/')
  const o = await orchestrate({ materials: opts.materials, text: opts.text, pack: opts.pack, variant: opts.variant, id: 'vf-film', outJson: rel, plateRatio: opts.plateRatio, spec: opts.spec })
  if (!o.ok) return { ok: false, err: o.note }
  try {
    const j = JSON.parse(fs.readFileSync(filmJson, 'utf8'))
    return {
      ok: true,
      film: j,   // ★VF_FILMSRC_V1：整份带回去（顶层 requirePlate 等也一起，出片复用不丢闸门）
      scenes: (j.scenes || []).map((s: any) => ({
        structure: String(s.structure || ''),
        media: (s.media || []).map((m: any) => path.basename(String(m))),
        dur: Number(s.dur) || 0,
      })),
      pack: o.pack,
      vertical: o.vertical,
    }
  } catch (e: any) { return { ok: false, err: '读骨架失败：' + String(e?.message || e).slice(0, 120) } }
}

/** ★VF_NOCOPY_V1（2026-10-09 用户定案「分镜没有任何文案就不许出片」）：
 *  判"这一镜到底有没有文案"——与 `tools/film-voice.mjs:deriveVoice` **同一口径**
 *  （title/title1/title2/sub 为主，其次 eyebrow/foot/tail，再看 chips/rows/nums）。
 *  为什么必须有它：配音线的**镜头时长与字幕全靠分镜文本** ——
 *  没文本 ⇒ 不调 TTS ⇒ 音轨全静音、0 条字幕、每镜时长只能落 2.2s 下限
 *  ⇒ 成片就是"没字没声的快闪哑片"（用户实测：8 段 = 8×2.2 = 17.6s）。 */
function slotsHasText(slots: any): boolean {
  const v = slots || {}
  const one = ['title', 'title1', 'title2', 'sub', 'eyebrow', 'foot', 'tail']
    .map((k) => String(v[k] || '').trim()).join('')
  const arr = ['chips', 'rows', 'nums']
    .map((k) => (Array.isArray(v[k]) ? v[k].join('') : '')).join('')
  return !!(one.trim() || arr.trim())
}

/** 端到端一步到位：素材 → 编排 → 出片（试点线用；AI 想自己编排时改用 orchestrate + validate）
 *  ★VF_FILMVOICE_V1：`voiced=true` ⇒ 走 audio-first（TTS 实测时长 + 字幕 + 混音 + 烧字幕）。
 *  ⚠️ 配音失败**不判死出片**：回退"无声版"并在 `voiceErr` 里如实带原因（与"失败即回退"同口径）。 */
export async function makeFilmFromMaterials(opts: {
  materials: string[]
  text?: string
  pack?: string
  variant?: number
  workDir: string
  voiced?: boolean
  voice?: string
  /** ★VF_RATIO_V1：大图:填图 比例（0~1）——只在"没有定稿骨架、需要现场编排"时才用到 */
  plateRatio?: number
  /** ★VF_SPEC_V1：风格语法（L1/L2/L3）——同上，只在现场编排时用到 */
  spec?: any
  /** ★VF_FILMCOPY_V1：AI 写好的逐镜文案（与骨架同序；key 名按结构：title1/sub/chips/rows…） */
  copy?: any[]
  /** ★VF_FILMSRC_V1：**写文案那一步编好的整份 film.json**（草稿里存的那份）。
   *  给了它 ⇒ **不再重新编排**，只把每段的素材名换成这次工作目录里的真实绝对路径
   *  （老实现出片会再 orchestrate 一次；素材一变 ⇒ 段数一变 ⇒ 整片文案错位）。 */
  planJson?: any
  /** 与 planJson 配套：赛道（老实现从 orchestrate 的返回里拿） */
  vertical?: string
}): Promise<{ ok: boolean; mp4?: string; sheet?: string; stage?: string; err?: string; vertical?: string; pack?: string; voiced?: boolean; voiceErr?: string }> {
  fs.mkdirSync(opts.workDir, { recursive: true })
  const filmJson = path.join(opts.workDir, 'film.json')
  const rel = path.relative(filmToolsDir(), filmJson).replace(/\\/g, '/')
  // ★VF_FILMSRC_V1：**骨架只有一个真源** —— 有定稿就用定稿（只重绑素材路径），没有才现场编排。
  let o: { ok: boolean; vertical?: string; pack?: string; note?: string }
  if (opts.planJson && Array.isArray(opts.planJson.scenes) && opts.planJson.scenes.length) {
    const byName = new Map<string, string>()
    for (const f of opts.materials) byName.set(path.basename(String(f)), String(f))
    const miss: string[] = []
    const scenes = (opts.planJson.scenes as any[]).map((s: any) => {
      const media = (s.media || []).map((m: any) => {
        const abs = byName.get(path.basename(String(m)))
        if (!abs) { miss.push(path.basename(String(m))); return '' }
        return abs
      }).filter(Boolean)
      return Object.assign({}, s, { media })
    })
    // 素材对不上就**明确报错**（绝不静默换图：换了图，文案就张冠李戴）
    if (miss.length) {
      return { ok: false, stage: 'media', err: '定稿骨架里的素材在本次工作目录里找不到：' + miss.slice(0, 3).join('、') }
    }
    const j = Object.assign({}, opts.planJson, {
      id: opts.planJson.id || 'vf-film',
      fps: Number(opts.planJson.fps) || 25,
      scenes,
    })
    fs.writeFileSync(filmJson, JSON.stringify(j, null, 2) + '\n', 'utf8')
    o = { ok: true, vertical: String(opts.vertical || ''), pack: String(j.pack || '') }
    console.log('[film] 沿用定稿骨架：' + scenes.length + ' 段（不重排）')
  } else {
    o = await orchestrate({ materials: opts.materials, text: opts.text, pack: opts.pack, variant: opts.variant, id: 'vf-film', outJson: rel, plateRatio: opts.plateRatio, spec: opts.spec })
  }
  if (!o.ok) return { ok: false, stage: 'orchestrate', err: o.note }
  // ★VF_FILMCOPY_V3（2026-10-09 用户实测「卡片上文案齐全、成片没字没声」· 根因，已确认）：
  //   **形状分叉** —— 服务端生成的 copy 是 `{ slots: {...} }`
  //   （`vf-htmlfilm.ts:311` `copy.push({ slots })`；提示词也要求"元素形如 {\"slots\":{…}}"；
  //     确认卡 `page.tsx:2085` 也是按 `c.slots` 渲染的 ⇒ 所以卡片上那 8 条文案显示得好好的），
  //   而**这里**老代码按"扁平 key"合并（看注释还写着"key 名按结构：title1/sub/chips/rows…"）⇒
  //   唯一的顶层 key 就是 `slots` ⇒ 只用 `String(对象)` 写进一个 `slots.slots = "[object Object]"`，
  //   **title/sub/eyebrow/chips/rows 一个都没进分镜**。
  //   后果（与用户实测逐项吻合）：分镜无文案 ⇒ 不调 TTS（音轨全静音 -91dB）+ 0 条字幕 +
  //   每镜时长落 2.2s 下限 ⇒ 成片 = "8×2.2 = 17.6s 快闪哑片"。
  //   现口径：**两种形状都认**（`c.slots` 优先，其次扁平），并杜绝"slots 套 slots"。
  if (Array.isArray(opts.copy) && opts.copy.length) {
    try {
      const j = JSON.parse(fs.readFileSync(filmJson, 'utf8'))
      j.scenes = (j.scenes || []).map((s: any, i: number) => {
        const c: any = (opts.copy as any[])[i]
        if (!c || typeof c !== 'object') return s
        const src: any = (c.slots && typeof c.slots === 'object') ? c.slots : c   // ★兼容两种形状
        const slots: any = Object.assign({}, s.slots || {})
        for (const k of Object.keys(src)) {
          if (k === 'slots') continue                 // 防"套娃"：绝不把 slots 塞进 slots
          const v = src[k]
          if (v === undefined || v === null || String(v) === '') continue
          slots[k] = Array.isArray(v) ? v.map((x: any) => String(x)) : String(v)
        }
        return Object.assign({}, s, { slots })
      })
      fs.writeFileSync(filmJson, JSON.stringify(j, null, 2) + '\n', 'utf8')
    } catch (e: any) {
      // ★VF_FILMCOPY_V3：**不再静默吞**（老代码 `catch { /* 忽略 */ }` ⇒ 合并失败没人知道，
      //   最后只表现为"没字没声的哑片"，排查成本极高）。合并失败 = 直接不出片、如实报因。
      return { ok: false, stage: 'copy', err: '文案并进分镜失败：' + String(e?.message || e).slice(0, 160) }
    }
  }
  // ★VF_CHARSET_V1（2026-10-09 用户实测「动不动就出问题 · 出片被 fonts 闸门拦」）：**出片前的自净**。
  //   引擎的 fonts 闸门（check-page-fonts.mjs）是"缺字就拦死"——它的存在是对的（缺字在服务器上
  //   会渲成豆腐块），但对用户就是"出片失败"。凡可能往分镜里写文案的入口（AGENT 确认卡 / 实验室 /
  //   别的调用方），到这一步都过一遍"压回字表内"（charset.ts：涮→烫、其余表外字删掉，只做减法
  //   不换词不编造），并把改动**如实打出来**（不许静默改文案）。
  try {
    const j = JSON.parse(fs.readFileSync(filmJson, 'utf8'))
    const set = loadCharset(path.join(filmToolsDir(), 'fonts', 'chars-cmn.txt'))
    if (set.size) {
      const log: string[] = []
      j.scenes = (j.scenes || []).map((s: any, i: number) => {
        const r = sanitizeSlots(s && s.slots, set)
        for (const d of r.drops) log.push('第 ' + i + ' 镜 ' + d.k + '「' + d.from + '」→「' + d.to + '」')
        return Object.assign({}, s, { slots: r.slots })
      })
      if (log.length) {
        fs.writeFileSync(filmJson, JSON.stringify(j, null, 2) + '\n', 'utf8')
        console.log('[film] 字表自净 ' + log.length + ' 处：' + log.slice(0, 4).join('；') + (log.length > 4 ? ' …' : ''))
      }
    }
  } catch (e: any) {
    // 不判死（引擎那道 fonts 闸门仍在，且现在会如实报"是哪个字"）；但绝不静默：
    console.log('[film] 字表自净跳过：' + String(e?.message || e).slice(0, 120))
  }
  // ★VF_NOCOPY_V1（2026-10-09 用户定案「分镜没有任何文案就不许出片」）：
  //   配音模式下**每镜都必须有文案** —— 缺一镜就是 2.2s 静音快闪，整片就废了。
  //   ⇒ 缺就用 stage=copy 拦下（宁可不做，也不给假成片）。
  if (opts.voiced) {
    const missing: number[] = []
    try {
      const j = JSON.parse(fs.readFileSync(filmJson, 'utf8'))
      ;(j.scenes || []).forEach((s: any, k: number) => { if (!slotsHasText(s && s.slots)) missing.push(k) })
    } catch { missing.push(-1) }
    if (missing.length) {
      return {
        ok: false, stage: 'copy',
        err: '分镜里' + (missing[0] === -1 ? '读不出文案' : ('第 ' + missing.slice(0, 6).join('、') + ' 镜没有文案'))
          + '（共 ' + missing.length + ' 镜）⇒ 未出片；配音线的时长/字幕全靠分镜文本，缺文案只会得到快闪哑片。请点「← 换风格」重写一次文案',
      }
    }
  }
  const outDirRel = path.join('out', 'film', path.basename(opts.workDir))
  if (opts.voiced) {
    const v = await voiceFilm(rel, outDirRel, opts.voice)
    if (v.ok) return { ...v, voiced: true, vertical: o.vertical, pack: o.pack }
    const s = await render(rel, outDirRel)
    return { ...s, vertical: o.vertical, pack: o.pack, voiceErr: String(v.err || v.stage || '配音失败').slice(0, 200) }
  }
  const r = await render(rel, outDirRel)
  return { ...r, vertical: o.vertical, pack: o.pack }
}
