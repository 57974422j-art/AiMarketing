// ★VF_FILMLINE_V1（2026-10-08）自检：确认新线命令已登记进标准模式命令表，且**严格匹配**生效。
//
// 为什么需要它（用户实测提出的问题）：「新的制作模式我怎么在 AGENT 页测试」——
//   标准模式是"命令白名单，锁死"，新线**漏登记命令表**就会被锁死回复拦住
//   （历史同款坑：图视混剪 2026-09-24 建好后漏登记，用户实测被拦）。
//   本自检把"该命中的命中、不该命中的绝不命中"钉死，避免以后再犯。
//
// ★VF_HTMLCMD_V1（2026-10-08 用户定案「不要叫素材片吧，你直接 HTML成片。素材这个词用的太多」）：
//   主命令 = **HTML成片**（= 前端按钮文字），旧说法「素材片」等降级为**别名**（照旧能进，但不进清单）。
//
// 运行：npx tsx scripts/vf-stdcmd-selftest.ts
import { matchStdCommand, STD_COMMANDS } from '../src/lib/agent/standard-commands'

const cases: Array<[string, string | null]> = [
  ['HTML成片', 'film'],           // 主命令（= 前端按钮文字）
  [' HTML 成片 ', 'film'],        // 规矩：忽略所有空白（半角/全角/换行）
  ['html成片', null],            // 大小写也必须一致（"少一个字、错一个字都不执行"）
  ['素材片', 'film'],             // 旧说法（保留为 alias，用户手打仍可进）
  ['素材短片', 'film'],           // alias
  ['做条素材片', 'film'],          // alias
  ['素材集', 'film'],             // alias
  ['showreel', 'film'],          // alias
  ['帮我做个素材片', null],         // 含额外字 → **不执行**（严格：去空白后完全相等）
  ['素材片！', null],              // 标点也不行
  ['HTML成片！', null],            // 同一规矩
  ['图片成片', 'vf_local'],        // 老命令不受影响
  ['PPT成片', 'vf_ppt'],
  ['素材+AI', 'vf_mix'],
]

let bad = 0
for (const [msg, want] of cases) {
  const got = matchStdCommand(msg)?.id ?? null
  const ok = got === want
  if (!ok) bad++
  console.log(`${ok ? '✅' : '❌'} 「${msg}」 → ${got}（期望 ${want}）`)
}

const film = STD_COMMANDS.find((c) => c.id === 'film')
console.log(`命令总数 ${STD_COMMANDS.length}；film 在表里：${film ? '是' : '否'}（kind=${film?.kind || '-'}，text=${film?.text || '-'}）`)
if (!film) bad++
if (film && film.kind !== 'machine') { console.log('❌ film 的 kind 必须是 machine（★VF_HTMLSTD_V1：已改成状态机：素材卡→风格卡→确认卡）'); bad++ }
if (film && film.text !== 'HTML成片') { console.log('❌ film 的 text 必须是「HTML成片」（★VF_HTMLCMD_V1）'); bad++ }
// ★VF_HTMLCMD_V1：锁死回复里**只能出现** HTML成片（不许再列"素材片"）
if (film && (film.alias || []).includes(film.text)) { console.log('❌ text 不该出现在 alias 里'); bad++ }
console.log(bad ? `===== ❌ ${bad} 项不符 =====` : '===== ✅ 全部通过 =====')
process.exit(bad ? 1 : 0)
