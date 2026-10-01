/**
 * ★VF_BILLING_PERIOD_V1 自测（2026-10-01）—— 套餐额度统计口径 / 多订阅 / 边界 / 异常策略
 *
 * 背景（老板报的点数异常）：
 *   getTokenWallet 原来 `spent` 只统计「本自然月」的 point_spend，而 allowance 是整张卡的额度
 *   （年卡 monthlyTokens=29999）→ 每月 1 号额度"跳回"整额，年年不封顶。老板 uid=1 旗舰年卡
 *   （2026-08-10 起，29999 点/年）全周期已扣 12346，界面却显示 29918（= 29999 − 本月 81）→ 虚高 12235。
 *
 * 本自测**纯函数、不联网、不烧钱、不碰数据库**；生产数据来自对本机只读副本
 * （`file:G:/AiMarketing/prisma/dev.db?mode=ro`，2026-10-01 审计）：
 *   - plan#1 基础月卡 2900/1900/1月/null ｜ plan#2 季卡 8900/6900/3月/8900
 *   - plan#3 年卡 29900/19900/12月/29999 ｜ plan#4 免费周卡 0/null/0月/null
 *   - uid1 订阅 #1(plan1) 2026-06-26→2026-07-26 已过期；#4(plan3) 2026-08-10T22:26:57Z→2027-08-10T22:26:57Z 生效
 *   - uid1 point_spend 741 笔 = 12346 点（全部在 #4 起始之后：since_sub4=12346 / before=0）
 *   - 分桶(UTC)：8月 350 / 9月 11885 / 10月 111；(+8) 8月 346 / 9月 11863 / 10月 137
 *   → 期望余额 = 29999 − 12346 = 17653（旧实现 10/1 显示 29918）
 *
 * 跑法（项目根目录）：
 *   $env:TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}'
 *   npx ts-node --transpile-only scripts/vf-billing-selftest.ts
 * 退出码：全部通过 = 0，有失败 = 1。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  planMonthlyTokens,
  monthStartInBillingTz,
  allowancePeriodStart,
  pickActiveSubscription,
  computeWallet,
  ALLOWANCE_PERIOD_MODE,
  FREE_TRIAL_POINTS,
  type PlanLike,
} from '../src/lib/token-wallet'

let pass = 0
let fail = 0
function ok(cond: any, name: string, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')) }
}
function eq(a: any, b: any, name: string) {
  ok(a === b, name, `实际 ${a} / 期望 ${b}`)
}
function finiteNonNeg(n: any, name: string) {
  ok(typeof n === 'number' && Number.isFinite(n) && n >= 0, name, `实际 ${n}`)
}

const root = process.cwd()

// ── 生产库只读审计得到的真实套餐 / 订阅 ─────────────────────────────
const PLAN_MONTH: PlanLike = { name: '基础月卡', price: 2900, discountPrice: 1900, durationMonths: 1, monthlyTokens: null }
const PLAN_QUARTER: PlanLike = { name: '专业季卡', price: 8900, discountPrice: 6900, durationMonths: 3, monthlyTokens: 8900 }
const PLAN_YEAR: PlanLike = { name: '旗舰年卡', price: 29900, discountPrice: 19900, durationMonths: 12, monthlyTokens: 29999 }
const PLAN_WEEK: PlanLike = { name: '免费周卡', price: 0, discountPrice: null, durationMonths: 0, monthlyTokens: null }

const SUB1 = { planId: 1, status: 'active', startDate: new Date('2026-06-26T07:19:34Z'), endDate: new Date('2026-07-26T07:19:34Z') } // 已过期
const SUB4 = { planId: 3, status: 'active', startDate: new Date('2026-08-10T22:26:57Z'), endDate: new Date('2027-08-10T22:26:57Z') } // 年卡生效
const NOW = new Date('2026-10-01T11:01:19Z') // 老板复现时刻

const SPENT_TOTAL = 12346            // 本订阅周期累计（= 全周期，均在 #4 起始之后）
const SPENT_MONTH_UTC = 111          // 本自然月(UTC)
const SPENT_MONTH_CN = 137           // 本自然月(+8)

console.log('\n① planMonthlyTokens：四种卡额度 + 除零/NaN 防护（数据来自生产库只读）')
{
  eq(planMonthlyTokens(PLAN_MONTH), 2900, '基础月卡 = round(2900/1) = 2900')
  eq(planMonthlyTokens(PLAN_QUARTER), 8900, '专业季卡 = 手填 monthlyTokens 8900')
  eq(planMonthlyTokens(PLAN_YEAR), 29999, '旗舰年卡 = 手填 monthlyTokens 29999')
  eq(planMonthlyTokens(PLAN_WEEK), FREE_TRIAL_POINTS, '免费周卡 = 固定试用额度 500（价格 0）')
  finiteNonNeg(planMonthlyTokens(PLAN_WEEK), '周卡 durationMonths=0 不产生 NaN/Infinity')
  eq(planMonthlyTokens({ name: 'x', price: 1000, discountPrice: null, durationMonths: 0, monthlyTokens: null }), 1000,
    '有价 + durationMonths=0：max(1,0)=1，不除零')
  eq(planMonthlyTokens({ name: 'x', price: 2000, discountPrice: null, durationMonths: 2, monthlyTokens: NaN as any }), 1000,
    'monthlyTokens=NaN → 回退按价/月数自动算')
  eq(planMonthlyTokens({ name: 'x', price: -100, discountPrice: null, durationMonths: 1, monthlyTokens: null }), FREE_TRIAL_POINTS,
    '负价 → 固定试用额度（不出现负数）')
}

console.log('\n② 时区：自然月起点按 +8（北京）而非 UTC（旧实现 1 号 08:00 才重置的根因）')
{
  eq(ALLOWANCE_PERIOD_MODE, 'period', "默认口径 = 'period'（老板口径：按订阅周期累计）")
  const octStart = Date.UTC(2026, 9, 1) - 8 * 3600_000 // 2026-10-01 00:00 CST = 2026-09-30 16:00Z
  eq(monthStartInBillingTz(new Date('2026-10-01T11:00:00Z')).getTime(), octStart, '10/1 11:00Z → 本月起点 = 09/30 16:00Z')
  eq(monthStartInBillingTz(new Date('2026-09-30T22:00:00Z')).getTime(), octStart, '09/30 22:00Z（=10/1 06:00 CST）已算 10 月')
  eq(allowancePeriodStart(SUB4, 'period', NOW).getTime(), SUB4.startDate.getTime(), "period 口径起点 = 订阅 startDate")
  eq(allowancePeriodStart(SUB4, 'month', NOW).getTime(), octStart, "month 口径起点 = 本月 1 号(+8)")
  eq(allowancePeriodStart(null, 'period', NOW).getTime(), octStart, '无订阅 period → 兜底本月（不返回 null）')
}

console.log('\n③ 多订阅取用：active 且未过期中 endDate 最大者（uid1 库里 #1 与 #4 都是 active）')
{
  const picked = pickActiveSubscription([SUB1, SUB4], NOW)
  eq(picked?.planId, 3, '过期 #1 + 生效 #4 → 取 #4（年卡）')
  eq(pickActiveSubscription([SUB1], NOW), null, '仅有过期订阅 → null（不拿过期额度）')
  const A = { planId: 9, status: 'active', endDate: new Date('2027-01-01T00:00:00Z') }
  const B = { planId: 8, status: 'active', endDate: new Date('2027-08-01T00:00:00Z') }
  eq(pickActiveSubscription([A, B], NOW)?.planId, 8, '两条都生效 → 取最晚到期者')
  eq(pickActiveSubscription([{ planId: 7, status: 'cancelled', endDate: new Date('2028-01-01T00:00:00Z') }], NOW), null, 'cancelled 不参与')
}

console.log('\n④ computeWallet：老板真实数据对账（年卡应显示 17653）')
{
  const w = computeWallet({ sub: SUB4, plan: PLAN_YEAR, spentInPeriod: SPENT_TOTAL, pointBalance: 0 })
  eq(w.allowance, 29999, '年卡额度 29999')
  eq(w.spent, 12346, '本期已扣 12346')
  eq(w.subRemaining, 17653, '★ 本期剩余 = 29999 − 12346 = 17653')
  eq(w.remaining, 17653, '★ 总可用（含点卡 0）= 17653（旧实现 10/1 虚高显示 29918）')
  eq(computeWallet({ sub: SUB4, plan: PLAN_YEAR, spentInPeriod: SPENT_MONTH_UTC, pointBalance: 0 }).remaining, 29999 - SPENT_MONTH_UTC,
    '若切成按自然月(UTC 111) → 29888（对照，非默认口径）')
  eq(computeWallet({ sub: SUB4, plan: PLAN_YEAR, spentInPeriod: SPENT_MONTH_CN, pointBalance: 0 }).remaining, 29999 - SPENT_MONTH_CN,
    '若切成按自然月(+8 137) → 29862（对照，非默认口径）')

  const over = computeWallet({ sub: SUB4, plan: PLAN_YEAR, spentInPeriod: 99999, pointBalance: 250 })
  eq(over.subRemaining, 0, 'spent > allowance → 套餐剩余钳到 0（不出负数）')
  eq(over.remaining, 250, '超额后总可用 = 点卡余额（不为负）')
  const neg = computeWallet({ sub: SUB4, plan: PLAN_YEAR, spentInPeriod: -50, pointBalance: -80 })
  eq(neg.spent, 0, 'spent 为负 → 归 0')
  eq(neg.pointBalance, 0, 'pointBalance 为负 → 归 0')
  const none = computeWallet({ sub: null, plan: null, spentInPeriod: 999999, pointBalance: 123 })
  eq(none.hasSubscription, false, '无套餐 → hasSubscription=false')
  eq(none.allowance, 0, '无套餐 → allowance=0')
  eq(none.remaining, 123, '无套餐 → 总可用 = 点卡余额')
  const mixed = computeWallet({ sub: SUB4, plan: PLAN_MONTH, spentInPeriod: 2900, pointBalance: 500 })
  eq(mixed.subRemaining, 0, '月卡扣满 → 套餐剩 0；剩余走点卡')
  eq(mixed.remaining, 500, '月卡扣满 + 点卡 500 → 总可用 500')
}

console.log('\n⑤ 源码级：口径参数化 + spendTokens 不吞 + quota-checker 异常即拒（防以后被改回）')
{
  const tw = readFileSync(join(root, 'src/lib/token-wallet.ts'), 'utf-8')
  ok(/★VF_BILLING_PERIOD_V1/.test(tw), 'token-wallet.ts 有 ★VF_BILLING_PERIOD_V1 标记')
  ok(/export const ALLOWANCE_PERIOD_MODE: AllowancePeriodMode = 'period'/.test(tw), "口径常量 ALLOWANCE_PERIOD_MODE='period'（要按月只改这里）")
  ok(/export function allowancePeriodStart/.test(tw), 'allowancePeriodStart 已导出（口径函数）')
  ok(/export function pickActiveSubscription/.test(tw), 'pickActiveSubscription 已导出（多订阅取用规则）')
  ok(/export function computeWallet/.test(tw), 'computeWallet 已导出（纯函数钱包）')
  ok(/if \(!\(cost > 0\)\) return/.test(tw), 'spendTokens 挡住 0/负/NaN 的 cost')
  ok(/throw new Error\(`点数记账失败/.test(tw), 'spendTokens 记账失败 rethrow（不再静默吞）')

  const qc = readFileSync(join(root, 'src/lib/quota-checker.ts'), 'utf-8')
  ok(!/allowed: true, remaining: -1, message: '检查跳过/.test(qc), "quota-checker 已移除「异常放行」")
  ok(/配额检查暂时不可用/.test(qc), 'quota-checker 异常分支改为拒绝（与 token-wallet 策略一致）')
}

console.log('\n⑥ 扩权项：music .ok 修复 / my-subscription 口径文案 / User.plan 改读真实订阅')
{
  const music = readFileSync(join(root, 'src/app/api/music/generate/route.ts'), 'utf-8')
  ok(/if \(!tk\.allowed\)/.test(music), 'music/generate 改用 TokenCheck.allowed 判断')
  ok(!/if \(!tk\.ok\)/.test(music), 'music/generate 不再用 .ok 猜字段（原来恒真→永远402）')
  ok(!/spendTokens\([^\n]*\)\.catch\(\(\)\s*=>\s*\{\}\)/.test(music), 'music/generate 不再用空 .catch 吞记账失败')

  const usageRt = readFileSync(join(root, 'src/app/api/subscription/my-usage/route.ts'), 'utf-8')
  ok(/ALLOWANCE_PERIOD_MODE/.test(usageRt) && /allowancePeriodStart/.test(usageRt), 'my-usage 接口按口径函数下发起止')
  ok(/period\s*=\s*\{/.test(usageRt), 'my-usage 返回 period{mode,noun,start,end}')

  const page = readFileSync(join(root, 'src/app/my-subscription/page.tsx'), 'utf-8')
  ok(/period\?\.noun/.test(page), 'my-subscription 文案随 period.noun（本期/本月）')
  ok(/planPeriodNoun/.test(page), '套餐卡额度文案按有效期（年度/季度/月度/体验）')
  ok(!/'每月额度'/.test(page), 'my-subscription 不再写死"每月额度"字面量')
  ok(!/\{\s*label:\s*'已消耗'/.test(page), 'wallet.spent 不再被标成裸"已消耗"')

  const quo = readFileSync(join(root, 'src/lib/quota.ts'), 'utf-8')
  ok(/async function resolvePlanKey/.test(quo), 'quota.ts 新增 resolvePlanKey（优先真实订阅）')
  ok(/不可信/.test(quo), 'quota.ts 注明 User.plan 历史遗留、不可信')
  ok(!/PLAN_QUOTAS\[user\.plan\]/.test(quo), 'quota.ts 不再直接 PLAN_QUOTAS[user.plan]')
  ok(/plan:\s*planKey/.test(quo), 'getQuotaInfo 返回真实订阅解析出的 planKey')

  const au = readFileSync(join(root, 'src/app/api/admin/users/route.ts'), 'utf-8')
  ok(/planName:\s*subPlanNameByUser/.test(au), 'admin/users 接口返回真实订阅套餐名 planName')
  const aup = readFileSync(join(root, 'src/app/admin/users/page.tsx'), 'utf-8')
  ok(/u\.planName/.test(aup), 'admin/users 页面显示 planName（未订阅兜底）')
  ok(!/u\.plan === 'pro'/.test(aup), 'admin/users 不再猜 User.plan 的 pro/enterprise')
}

console.log(`\n${pass} 项通过 / ${fail} 项失败`)
process.exit(fail ? 1 : 0)
