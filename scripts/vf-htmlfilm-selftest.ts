// ★VF_HTMLSTD_V1（2026-10-08）自检：「HTML成片」状态机三步流程 + 严格匹配。
//
// 为什么需要它：这条线从 `kind:'tool'`（一键）改成了 `kind:'machine'`（状态机：素材卡 → 风格卡 → 确认卡），
//   本项目在"状态机"上踩过三次同一个坑（PPT成片 / 视频混剪 / 获客线）：**第二步协议串被标准模式闸门锁死**。
//   本自检把"三步的卡能不能一路出来、风格包清单读不读得到、认不出的串会不会乱接"钉死。
//
// 运行：npx tsx scripts/vf-htmlfilm-selftest.ts
//
// 说明：用**内存假 prisma**（只实现本线用到的 4 个方法）⇒ 不连数据库、不碰 OSS、不真出片、不花钱。
import {
  handleHtmlFilmLine, htmlFilmPacks, saveHtmlFilmDraft, pickFilmMaterials, deriveCopyFromSummary,
  FILM_MAT_MAX, FILM_POOL_MAX, FILM_DEFAULT_RECENT, FILM_LINE_VERSION,
} from '../src/lib/agent/vf/vf-htmlfilm'
import { matchStdCommand } from '../src/lib/agent/standard-commands'

/** 假的 agentMemory（够本线用：findFirst / create / update / deleteMany） */
function fakePrisma() {
  const rows: any[] = []
  let seq = 1
  return {
    rows,
    agentMemory: {
      async findFirst({ where }: any) {
        const hit = rows.filter((r) => r.userId === where?.userId && (!where?.tags?.equals || r.tags === where.tags.equals))
        return hit.length ? hit[hit.length - 1] : null
      },
      async create({ data }: any) {
        const r = { id: seq++, ...data, updatedAt: new Date() }
        rows.push(r)
        return r
      },
      async update({ where, data }: any) {
        const r = rows.find((x) => x.id === where.id)
        if (r) Object.assign(r, data, { updatedAt: new Date() })
        return r
      },
      async deleteMany({ where }: any) {
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i].userId === where?.userId && (!where?.tags?.equals || rows[i].tags === where.tags.equals)) rows.splice(i, 1)
        }
        return { count: 0 }
      },
    },
  }
}

const parse = (s: string | null) => {
  if (!s) return null
  if (!s.startsWith('VF_JSON:')) return { __proto: s }
  try { return JSON.parse(s.slice(8)) } catch { return null }
}

let bad = 0
const ok = (cond: boolean, label: string, extra = '') => {
  if (!cond) bad++
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? '  ' + extra : ''}`)
}

async function main() {
  // ── ① 命令表：HTML成片 = machine（状态机），旧说法仍可进
  const c = matchStdCommand('HTML成片')
  ok(!!c && c.id === 'film' && c.kind === 'machine', '命令表：HTML成片 → film（kind=machine）', `kind=${c?.kind}`)
  ok(matchStdCommand('素材片')?.id === 'film', '旧说法「素材片」仍可进（alias）')

  // ── ② 风格包清单：读内置库 styles/index.json
  const packs = htmlFilmPacks()
  ok(packs.length >= 5, '风格包清单读到了', `${packs.length} 套（首套=${packs[0]?.name || '-'}）`)

  // ── ③ 三步流程（内存假 prisma）
  const db: any = fakePrisma()
  const uid = 1791464198911

  const c1 = await handleHtmlFilmLine({ uid, userMessage: 'HTML成片', prisma: db, isEntry: true })
  const j1 = parse(c1)
  ok(j1?.step === 'film_mat', '第 1 步：进线 → 素材卡', `step=${j1?.step}`)
  ok(db.rows.length === 1, '铁律①：进线就落了草稿（否则第 2 步会被闸门锁死）', `agentMemory 行数=${db.rows.length}`)

  const c2 = await handleHtmlFilmLine({ uid, userMessage: 'VF_FILM_FORM:{"at":"mat","names":["a.jpg","b.jpg"]}', prisma: db })
  const j2 = parse(c2)
  ok(j2?.step === 'film_style', '第 2 步：素材卡下一步 → 风格卡', `step=${j2?.step}`)
  ok(Array.isArray(j2?.packs) && j2.packs.length === packs.length, '风格卡带上了风格包清单', `packs=${j2?.packs?.length}`)

  const c3 = await handleHtmlFilmLine({ uid, userMessage: 'VF_FILM_FORM:{"at":"style","pack":"pipeline-green"}', prisma: db })
  const j3 = parse(c3)
  // ⚠️ 这一条**改过**（2026-10-10 ★VF_FILMSRC_V1 顺手对齐）：
  //   老自检在这里期望 `step==='film_confirm'`，但那是 `VF_FILMCOPY_V1`（2026-10-09）**之前**的契约 ——
  //   现行契约是"**没接文案模型 / 没素材 ⇒ 不出确认卡、不出片**"（宁可不做，也不乱做）。
  //   所以这里断言的是"**明确拒绝**"（而不是"照样出卡"）。
  ok(!j3 || j3.step !== 'film_confirm', '第 3 步：没接文案模型 ⇒ 明确拒绝、**不出确认卡**（不放行乱出片）', `step=${j3?.step}`)
  ok(typeof c3 === 'string' && /没能让 AI 按素材写好文案|没有可用图片/.test(String(c3)),
    '且给出的是一条**明确的失败说明**（不是崩溃、不是空白卡）', String(c3).slice(0, 34))

  // ── ④ 回退与兜底
  const c4 = await handleHtmlFilmLine({ uid, userMessage: 'VF_FILM_FORM:{"at":"back_mat"}', prisma: db })
  ok(parse(c4)?.step === 'film_mat', '「← 换素材」回到素材卡')
  const c5 = await handleHtmlFilmLine({ uid, userMessage: 'VF_FILM_FORM:{"at":"style","pack":"no-such-pack"}', prisma: db })
  ok(typeof c5 === 'string' && parse(c5)?.step !== 'film_confirm',
    '非法风格包 id **不炸**（同上：明确拒绝，不出确认卡；风格兜底由编排器做）')
  const c6 = await handleHtmlFilmLine({ uid, userMessage: '今天天气不错', prisma: db })
  ok(c6 === null, '不认识的话 → 返回 null（交给后面的流程，不抢话）')

  // ── ⑤ 出片协议串的形态（只验正则识别，不真出片）
  ok(/^VF_FILM_GO\s*[:{]/.test('VF_FILM_GO:{"pack":"x"}'), '确认卡「🎬 出片」的协议串形态可被识别')
  ok(/^VF_FILM_FORM\s*[:{]/.test('VF_FILM_FORM:{"at":"mat"}'), '卡片「下一步」的协议串形态可被识别')

  // ── ⑥ ★VF_FILMSRC_V1：素材单一真源 + 骨架/文案一致性硬校验（今天这条修复的自检）
  await selftestFilmSrc(db, uid, ok)

  console.log(bad ? `===== ❌ ${bad} 项不符 =====` : '===== ✅ 全部通过 =====')
  process.exit(bad ? 1 : 0)
}

/* ── ★VF_FILMSRC_V1（2026-10-10）新增：素材单一真源 + 骨架/文案一致性硬校验 ──
   背景（用户实测）：同一条单，卡片按 12 张排 8 段、出片按 17 张排 12 段 ⇒
   文案按下标合并就错位（后 4 镜空）⇒ 被 copy 闸门拦。
   这一节把"根因"钉在自检里：① 上限只有一个常量；② 缺图**进 missing 不静默换**；
   ③ 骨架段数 ≠ 文案条数 ⇒ **拒渲**。全部离线可跑（不连库、不碰 OSS、不花钱）。 */
async function selftestFilmSrc(db: any, uid: number, ok: (c: boolean, l: string, e?: string) => void) {
  ok(FILM_MAT_MAX >= 20 && FILM_POOL_MAX >= FILM_MAT_MAX,
    '上限常量只有一处且自洽（FILM_MAT_MAX 是唯一使用上限；可用 VF_FILM_MAT_MAX 覆盖）',
    `MAT_MAX=${FILM_MAT_MAX} POOL_MAX=${FILM_POOL_MAX} 默认最近 ${FILM_DEFAULT_RECENT} 张`)

  const pEmpty = await pickFilmMaterials(uid, [])
  ok(Array.isArray(pEmpty.picked), 'pickFilmMaterials 离线不抛（返回空池 ⇒ 调用方据此报"没有可用图片"）',
    `picked=${pEmpty.picked.length}`)

  const pMiss = await pickFilmMaterials(uid, ['不存在的图.jpg'])
  ok(pMiss.missing.length === 1, '勾选的文件找不到 ⇒ 进 missing（**绝不静默换素材**，换了文案就张冠李戴）',
    `missing=${pMiss.missing.join(',')}`)

  // ★VF_FILMSRC_V2（P1）：**旧版本草案** ⇒ 出片前作废、明确要求重来（不做"旧文案配新骨架"）
  await saveHtmlFilmDraft(db, uid, {
    step: 'confirm', names: ['a.jpg'], pack: '',
    copy: [{ slots: { title: 'x' } }],
  } as any)   // ← 故意不带 ver（= 部署前留下的在飞草案）
  const cOld = await handleHtmlFilmLine({ uid, userMessage: 'VF_FILM_GO:{"voiced":false}', prisma: db })
  ok(String(cOld).includes('旧版本') && String(cOld).includes('已把它作废'),
    '旧版本草案 ⇒ **作废并提示重走**（部署即作废在飞草案的实现）', String(cOld).slice(0, 30))

  // 骨架 12 段 + 文案 8 条 ⇒ 必须拒渲（就是那次事故的形状；这次带上**当前版本**以绕过版本戳）
  await saveHtmlFilmDraft(db, uid, {
    step: 'confirm', names: ['a.jpg'], pack: '', ver: FILM_LINE_VERSION,
    filmJson: { scenes: new Array(12).fill({ structure: 'plate-top', media: ['a.jpg'] }) },
    copy: new Array(8).fill({ slots: { title: 'x' } }),
  } as any)
  const cBad = await handleHtmlFilmLine({ uid, userMessage: 'VF_FILM_GO:{"voiced":false}', prisma: db })
  ok(String(cBad).startsWith('TOOL_REJECT') && String(cBad).includes('12 段') && String(cBad).includes('8 条'),
    '骨架 12 段 / 文案 8 条 ⇒ **拒渲**（不做"旧文案塞新骨架"的硬合并）', String(cBad).slice(0, 44))

  // ★VF_FILMCOPY_V4（P2）：**降级拼句不许写"做法"** —— 视觉模型最容易猜错做法
  //   （现场实例：把一盘生毛肚读成「烤制牛肚」）⇒ 含做法动词的读图词整条丢掉。
  try {
    const copy = deriveCopyFromSummary(
      '这是一组火锅实拍。\n烤制牛肚\n冰镇虾滑\n肥牛卷摆盘\n墨鱼仔配酱料',
      [{ structure: 'plate-top', media: ['a.jpg'] }, { structure: 'plate-bottom', media: ['b.jpg'] }] as any)
    const txt = JSON.stringify(copy)
    ok(copy.length === 2 && !/烤/.test(txt), '降级拼句：丢掉"做法"词（烤制牛肚），数量与骨架一致（2 段/2 条）',
      txt.slice(0, 60))
  } catch (e: any) {
    ok(false, '降级拼句自检可运行', String(e?.message || e).slice(0, 80))
  }

  // ★VF_FILMFORK_V1（2026-10-10）：**结构表 ↔ 引擎**一致性 —— 引擎实现的每个结构都必须在
  // `elements/structures.json` 里登记。为什么钉这条：库里少了 `fullbleed`（只写了原型名
  // `fullbleed-kenburns`）⇒ 校验器把满屏段当非法结构**悄悄改成开场卡**（用户看到"某页莫名变封面"）。
  try {
    const fs = await import('node:fs')
    // ⚠️ 刻意**不 import 引擎的 .mjs**（实测：tsx 下 import 它会让进程退出时踩 libuv 断言
    //   `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` ⇒ 断言全过却拿非 0 退出码，
    //   CI/脚本会误判成失败）。改成**读源码文本取 FILM_STRUCTS**（一行正则，稳定且零副作用）。
    const src = fs.readFileSync(new URL('../scripts/video-factory/html-deck/tools/film-to-page.mjs', import.meta.url), 'utf8')
    const line = src.split(/\r?\n/).find((l: string) => /export const FILM_STRUCTS\s*=/.test(l)) || ''
    const FILM_STRUCTS = (line.match(/'([a-z0-9-]+)'/g) || []).map((x: string) => x.replace(/'/g, ''))
    const sj = JSON.parse(fs.readFileSync(new URL('../scripts/video-factory/html-deck/elements/structures.json', import.meta.url), 'utf8'))
    const ids = new Set((sj.items || []).map((x: any) => String(x.id)))
    const lack = FILM_STRUCTS.filter((s) => !ids.has(s))
    ok(FILM_STRUCTS.length > 0 && lack.length === 0,
      '引擎实现的结构**都登记在** elements/structures.json（防"库里没有 ⇒ 被悄悄改掉"）',
      `引擎 ${FILM_STRUCTS.length} 种；缺登记：${lack.join('、') || '无'}`)
  } catch (e: any) {
    ok(false, '结构表↔引擎一致性自检可运行', String(e?.message || e).slice(0, 80))
  }
}

main().catch((e) => { console.error('自检异常：', e); process.exit(1) })
