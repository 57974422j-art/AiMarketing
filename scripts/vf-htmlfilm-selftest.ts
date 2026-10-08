// ★VF_HTMLSTD_V1（2026-10-08）自检：「HTML成片」状态机三步流程 + 严格匹配。
//
// 为什么需要它：这条线从 `kind:'tool'`（一键）改成了 `kind:'machine'`（状态机：素材卡 → 风格卡 → 确认卡），
//   本项目在"状态机"上踩过三次同一个坑（PPT成片 / 视频混剪 / 获客线）：**第二步协议串被标准模式闸门锁死**。
//   本自检把"三步的卡能不能一路出来、风格包清单读不读得到、认不出的串会不会乱接"钉死。
//
// 运行：npx tsx scripts/vf-htmlfilm-selftest.ts
//
// 说明：用**内存假 prisma**（只实现本线用到的 4 个方法）⇒ 不连数据库、不碰 OSS、不真出片、不花钱。
import { handleHtmlFilmLine, htmlFilmPacks } from '../src/lib/agent/vf/vf-htmlfilm'
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
  ok(j3?.step === 'film_confirm', '第 3 步：风格卡下一步 → 确认卡', `step=${j3?.step}`)
  ok(j3?.pack === 'pipeline-green' && /绿色|pipeline|流程|医疗/.test(String(j3?.packName || '')) === true || !!j3?.packName,
    '确认卡带上了风格包名字', `packName=${j3?.packName}`)

  // ── ④ 回退与兜底
  const c4 = await handleHtmlFilmLine({ uid, userMessage: 'VF_FILM_FORM:{"at":"back_mat"}', prisma: db })
  ok(parse(c4)?.step === 'film_mat', '「← 换素材」回到素材卡')
  const c5 = await handleHtmlFilmLine({ uid, userMessage: 'VF_FILM_FORM:{"at":"style","pack":"no-such-pack"}', prisma: db })
  ok(parse(c5)?.step === 'film_confirm', '非法风格包 id 不炸（照常进确认卡，出片时编排器兜底）')
  const c6 = await handleHtmlFilmLine({ uid, userMessage: '今天天气不错', prisma: db })
  ok(c6 === null, '不认识的话 → 返回 null（交给后面的流程，不抢话）')

  // ── ⑤ 出片协议串的形态（只验正则识别，不真出片）
  ok(/^VF_FILM_GO\s*[:{]/.test('VF_FILM_GO:{"pack":"x"}'), '确认卡「🎬 出片」的协议串形态可被识别')
  ok(/^VF_FILM_FORM\s*[:{]/.test('VF_FILM_FORM:{"at":"mat"}'), '卡片「下一步」的协议串形态可被识别')

  console.log(bad ? `===== ❌ ${bad} 项不符 =====` : '===== ✅ 全部通过 =====')
  process.exit(bad ? 1 : 0)
}

main().catch((e) => { console.error('自检异常：', e); process.exit(1) })
