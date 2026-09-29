/**
 * ★VF_LEAD_V1「智能获客」自测（2026-09-29）
 *
 * 目标：**不联网、不烧钱、不碰数据库**地证明老板交办的这几件事都立住了 ——
 *   ① 命令登记命中：「智能获客」是标准模式白名单里的一条 machine 命令（否则被锁死）；
 *      并且它与前端 FEATURE_TIPS 里的按钮文字【一字不差】（项目铁律：命令=按钮）；
 *   ② 未登录平台默认不勾（老板「首先要确认有用户登录态」）；
 *   ③ 话术清洗与限长：去 emoji + 压缩空白 + 硬截断到 120 字（老板「去 emoji、限长」）；
 *   ④ 速度档映射到数值（含**极速档不设上限**=0 语义）与自定义覆盖/钳制；
 *   ⑤ pin 等**别线字段**进不了本线草稿（字段白名单）——本线草稿 tag 也与成片线完全不同；
 *   ⑥ 保存的草稿结构（平台 / 话术 / 速度 / 数据源）与预演输出齐全。
 *
 * 跑法（项目根目录；ts-node 已在 devDependencies 里）：
 *   PowerShell:  npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/vf-lead-selftest.ts
 *   bash/zsh:    npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/vf-lead-selftest.ts
 * 退出码：全部通过 = 0，有失败 = 1。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { matchStdCommand, STD_COMMANDS, STD_UNSUPPORTED_REPLY } from '../src/lib/agent/standard-commands'
import {
  LEAD_ENTRY_WORD, LEAD_PLATFORMS, LEAD_SPEED_PRESETS, LEAD_DATA_SOURCES, LEAD_DEFAULT_TIER,
  LEAD_SCRIPT_MAX, LEAD_TAG, LEAD_CFG_PREFIX,
  matchesLeadLine, defaultCheckedPlatforms, defaultCheckedSources, cleanLeadText, normalizeLeadScripts,
  resolveLeadSpeed, applyLeadPatch, newLeadDraft, buildLeadPreview, buildLeadSetupCard, parseLeadCfg,
} from '../src/lib/agent/lead'

let pass = 0
let fail = 0
function ok(cond: any, name: string, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')) }
}
function eq(a: any, b: any, name: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), name, `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`)
}

// 注意：不带 g 标志 —— 带 g 的 RegExp.test 会保留 lastIndex，产生假阳/假阴
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u

const ROOT = join(__dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

async function main() {
  console.log('\n① 命令登记命中 + 按钮文字一字不差')
  {
    const hit = matchStdCommand('智能获客')
    ok(!!hit && hit.id === 'lead', '"智能获客" 命中命令表且 id=lead')
    eq(hit?.kind, 'machine', 'kind=machine（标准模式会强制进状态机、清旧草稿）')
    ok(!!matchStdCommand('智能  获客'), '带空格也命中（去空白后严格相等）')
    ok(matchStdCommand('智能获客一下') === null, '"智能获客一下" 不命中（严格相等，不做包含）')
    ok(matchStdCommand('获客') === null, '"获客" 不命中（没登记，宁可锁死也不猜）')
    ok(STD_UNSUPPORTED_REPLY.includes('智能获客'), '锁死提示清单里能看到「智能获客」')
    ok(matchesLeadLine('智能获客'), 'matchesLeadLine("智能获客") = true')
    ok(!matchesLeadLine('智能获客 帮我'), 'matchesLeadLine 严格：带尾巴 = false')
    // 命令表每条 text 都在前端 FEATURE_TIPS 里出现（两处一字不差）
    const pageSrc = read('src/app/agent/page.tsx')
    const missing = STD_COMMANDS.filter((c) => !pageSrc.includes(`'${c.text}'`))
    eq(missing.map((m) => m.text), [], 'STD_COMMANDS 每条 text 都出现在 page.tsx（按钮=命令）')
  }

  console.log('\n② 未登录平台默认不勾（老板：先确认登录态）')
  {
    eq(defaultCheckedPlatforms([{ id: 'douyin', loggedIn: true }, { id: 'xiaohongshu', loggedIn: false }, { id: 'weibo', loggedIn: true }]),
      ['douyin', 'weibo'], '只勾已登录的平台（按 platforms.ts 顺序）')
    eq(defaultCheckedPlatforms([]), [], '空登录态 → 一个都不勾')
    eq(defaultCheckedPlatforms(undefined as any), [], '未传登录态 → 一个都不勾')
    eq(defaultCheckedPlatforms([{ id: 'x', loggedIn: true }]), [], '不在 6 平台名单里的不算')
    eq(LEAD_PLATFORMS.map((p) => p.id), ['douyin', 'xiaohongshu', 'weibo', 'shipinhao', 'bilibili', 'kuaishou'], '平台 = 6 个（来自 platforms.ts）')
  }

  console.log('\n③ 话术清洗与限长（去 emoji + 限长）')
  {
    ok(!EMOJI_RE.test(cleanLeadText('🔥你好 世界✨')), 'emoji 被清掉')
    eq(cleanLeadText('🔥你好 世界✨'), '你好 世界', '清 emoji 后内容不变（空格保留单空格）')
    eq(cleanLeadText('  你好\n\n世界  '), '你好 世界', '换行/多空格压成单空格 + 去首尾空白')
    eq(cleanLeadText('“报价多少？”'), '报价多少？', '去首尾引号')
    const long = '好'.repeat(300)
    eq(cleanLeadText(long).length, LEAD_SCRIPT_MAX, `超长硬截断到 ${LEAD_SCRIPT_MAX} 字`)
    const ns = normalizeLeadScripts([{ scene: '🔥问价', text: '你好' }, { text: '' }, { text: '你好' }, { text: '✨在吗' }])
    eq(ns.length, 2, '空话术丢掉 + 重复话术去重')
    eq(ns[0].scene, '问价', '场景也去 emoji')
    eq(ns[1], { scene: '通用', text: '在吗' }, '没写场景 → 兜底「通用」')
  }

  console.log('\n④ 速度档映射到数值（含极速档）')
  {
    eq(resolveLeadSpeed('slow'), { tier: 'slow', commentPerDay: 30, dmPerDay: 10, gapMin: 90, gapMax: 180 }, '慢档 = 30/10 · 90~180')
    eq(resolveLeadSpeed('medium'), { tier: 'medium', commentPerDay: 100, dmPerDay: 30, gapMin: 45, gapMax: 120 }, '中档 = 100/30 · 45~120')
    eq(resolveLeadSpeed('fast'), { tier: 'fast', commentPerDay: 300, dmPerDay: 80, gapMin: 20, gapMax: 60 }, '快档 = 300/80 · 20~60')
    const turbo = resolveLeadSpeed('turbo')
    eq(turbo.tier, 'turbo', '极速档 = turbo')
    eq([turbo.commentPerDay, turbo.dmPerDay], [0, 0], '极速档 = 不设上限（0 语义）')
    eq(LEAD_SPEED_PRESETS.length, 4, '共 4 档')
    eq(LEAD_DEFAULT_TIER, 'slow', '默认档 = 慢（最稳）')
    eq(resolveLeadSpeed('不存在的档').tier, 'slow', '认不出的档位 → 回默认档（不抛错）')
    eq(resolveLeadSpeed('fast', { commentPerDay: 500, dmPerDay: 0 }).commentPerDay, 500, '自定义数字覆盖预设')
    eq(resolveLeadSpeed('fast', { commentPerDay: 500, dmPerDay: 0 }).dmPerDay, 0, '自定义 0 = 不设上限')
    const clamp = resolveLeadSpeed('slow', { gapMin: 0, gapMax: 0 })
    ok(clamp.gapMin >= 1 && clamp.gapMax >= clamp.gapMin, '间隔被钳制（≥1 秒，gapMax ≥ gapMin）')
    eq(resolveLeadSpeed('slow', { gapMin: 9999 }).gapMax, 3600, '间隔上限 3600 秒')
  }

  console.log('\n⑤ 字段白名单：pin 等别线字段进不来；草稿 tag 与成片线完全不同')
  {
    const d0 = newLeadDraft()
    const d1 = applyLeadPatch(d0, {
      action: 'save',
      pin: 'off',            // 成片线字段
      topic: '不该进来',      // 素材线字段
      voice: 'longxiaochun', // 成片线字段
      platforms: ['douyin', 'bogus_platform', 'kuaishou'],
      sources: ['hotspot', 'bogus_source'],
      keywords: '装修, 二手房, 本地, 第四个要被丢掉',
      scripts: [{ scene: '问价', text: '✨你好🔥' }],
      speed: { tier: 'fast', commentPerDay: 200 },
    })
    ok(!Object.prototype.hasOwnProperty.call(d1, 'pin'), 'pin 没进草稿')
    ok(!Object.prototype.hasOwnProperty.call(d1, 'topic'), 'topic 没进草稿')
    ok(!Object.prototype.hasOwnProperty.call(d1, 'voice'), 'voice 没进草稿')
    ok(!('action' in d1), 'action 没进草稿（只是指令，不是数据）')
    eq(d1.platforms, ['douyin', 'kuaishou'], '平台白名单：非 6 平台被丢掉')
    eq(d1.sources, ['hotspot'], '数据来源白名单：非法 id 被丢掉')
    eq(d1.keywords.length, 3, '关键词最多 3 个')
    eq(d1.scripts, [{ scene: '问价', text: '你好' }], '话术入库前已清洗')
    eq(d1.speed.commentPerDay, 200, '速度覆盖生效')
    eq(LEAD_TAG, 'vf_draft_lead', '本线草稿 tag = vf_draft_lead')
    ok(!['vf_draft_base', 'vf_draft_ai', 'vf_draft_mix', 'vf_draft_video'].includes(LEAD_TAG), 'tag 与成片四线都不同')
    eq(parseLeadCfg(LEAD_CFG_PREFIX + JSON.stringify({ action: 'preview', platforms: ['douyin'] }))?.action, 'preview', 'parseLeadCfg 认 LEAD_CFG: 前缀')
    ok(parseLeadCfg('VF_FORM:{}') === null, 'parseLeadCfg 不认别线前缀')
    ok(/^LEAD_CFG:/.test(LEAD_CFG_PREFIX), '协议前缀独立（不与 VF_FORM 混）')
  }

  console.log('\n⑥ 草稿结构 + 预演（平台/话术/速度/数据源齐全）')
  {
    const d = applyLeadPatch(newLeadDraft(), {
      platforms: ['douyin', 'xiaohongshu'],
      sources: ['hotspot', 'trending'],
      keywords: ['装修', '二手房'],
      scripts: [{ scene: '问价', text: '你好，看到你在问装修' }, { scene: '预算', text: '预算多少我帮你算下' }],
      speed: { tier: 'medium' },
    })
    for (const k of ['step', 'platforms', 'scripts', 'keywords', 'speed', 'sources']) {
      ok(Object.prototype.hasOwnProperty.call(d, k), `草稿根级有 ${k}（供下一版执行器读）`)
    }
    eq(d.sources, ['hotspot', 'trending'], '数据来源已保存')
    eq(d.scripts.length, 2, '话术已保存')

    const pv = buildLeadPreview(d)
    ok(Array.isArray(pv.actions) && pv.actions.length >= 7, '预演输出动作清单（≥7 条）')
    eq(pv.perDay.comment, 200, '合计评论/天 = 100 × 2 平台 = 200')
    eq(pv.perDay.dm, 60, '合计私信/天 = 30 × 2 平台 = 60')
    ok(pv.cadence.includes('45~120'), '节奏串含档位间隔')
    ok(/不执行|不会真的|预览/.test(pv.scopeNote), '范围说明写明"本轮不执行"')
    const turb = buildLeadPreview(applyLeadPatch(d, { speed: { tier: 'turbo' } }))
    eq(turb.perDay.comment, 0, '极速档合计 = 0（不设上限，执行器按此解释）')
    ok(/封号|风险自担/.test(turb.riskNote), '极速档如实标注风险（不美化）')

    const card = buildLeadSetupCard(d)
    eq(card.step, 'lead_setup', '面板卡 step=lead_setup')
    eq(card.platforms.length, 6, '面板带 6 个平台')
    eq(card.sources.length, LEAD_DATA_SOURCES.length, '面板带全部数据来源')
    eq(card.speedPresets.length, 4, '面板带 4 档预设')
    eq(card.checked, d.platforms, '面板回显已勾平台')
    eq(defaultCheckedSources(), ['hotspot', 'trending', 'lead_pool'], '默认勾的数据来源 = 客户端可用的三项')
  }

  console.log('\n⑦ 源码接线对账（防"改了库里没接线"）')
  {
    const routeSrc = read('src/app/api/agent/chat/route.ts')
    const pageSrc = read('src/app/agent/page.tsx')
    const stdSrc = read('src/lib/agent/standard-commands.ts')
    ok(/from '@\/lib\/agent\/lead'/.test(routeSrc), 'route.ts 引入 lead 模块')
    ok(/shouldTakeOverLeadLine\(/.test(routeSrc) && /handleLeadLine\(/.test(routeSrc), 'route.ts 有本线接管判定 + 主流程调用')
    ok(/clearLeadDraft\(/.test(routeSrc), 'stdClearAllDrafts 清本线草稿（命令=重来）')
    ok(/hasLeadDraft\(/.test(routeSrc), 'stdHasAnyDraft 认本线草稿（否则面板提交被锁死）')
    ok(/VIDEO_RESULT\|LEAD_CFG\)/.test(routeSrc), 'vfProtoWord 收 LEAD_CFG（卡片提交不掉出状态机）')
    ok(/text: '智能获客'/.test(stdSrc), 'standard-commands.ts 登记了「智能获客」')
    ok(/step === 'lead_setup'/.test(pageSrc) && /LeadSetupCard/.test(pageSrc), 'page.tsx 渲染 lead_setup 面板卡')
    ok(/step === 'lead_preview'/.test(pageSrc) && /LeadPreviewCard/.test(pageSrc), 'page.tsx 渲染 lead_preview 预演卡')
    ok(/'智能获客'/.test(pageSrc), 'page.tsx FEATURE_TIPS 有「智能获客」按钮')
    ok(/LEAD_ENTRY_WORD/.test(read('src/lib/agent/lead.ts')), 'lead.ts 定义入口词常量')
    // 本轮【不做执行器】：文件里只能有注释 TODO，不能有真的发送/评论/私信调用
    const leadSrc = read('src/lib/agent/lead.ts')
    ok(!/executeToolCall\(|sendPrivateMessage\(|\bfetch\(/.test(leadSrc), 'lead.ts 本轮不含任何实际执行调用（只配置+预演）')
    ok(/TODO\(★VF_LEAD_V1/.test(leadSrc), '执行器以 TODO 注释留档（下一版做）')
  }

  console.log('\n⑧ 入口词常量一致性')
  {
    eq(LEAD_ENTRY_WORD, '智能获客', 'LEAD_ENTRY_WORD = 智能获客')
    const stdSrc = read('src/lib/agent/standard-commands.ts')
    ok(stdSrc.includes(`text: '${LEAD_ENTRY_WORD}'`), '命令表 text 与 LEAD_ENTRY_WORD 一致')
    ok(read('src/app/agent/page.tsx').includes(`'${LEAD_ENTRY_WORD}'`), 'page.tsx 出现入口词常量原文')
  }

  console.log(`\n===== 自测结果：${pass} 项通过，${fail} 项失败 =====\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('自测崩溃:', e); process.exit(1) })
