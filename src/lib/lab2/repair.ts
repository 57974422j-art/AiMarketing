/**
 * ★★★ 2026-11-06 用户：「你说救活了，这2单在哪里？怎么看？你救到哪里去了。」
 *
 * 之前三次「救活」都只在本地 temp 里验证，**线上原文件没动** ⇒ 用户看不到。
 * 现在把三条确定性修复抽成公共模块，**两处都用**：
 *   ① 生成时（/api/lab2）—— 新单不进坑
 *   ② 读取时（/api/lab2/file）—— **历史旧单打开时也自动修好**
 *
 * 三条都是"AI 写了但没写完"的半成品，代码能确定性补：
 *   1. 动画死锁：CSS 写 `[data-p="1"]`，但 p 在"可见"时永远到不了 1
 *   2. 段落 id 缺失：CSS 用 `#s1 .big`，HTML 的 section 没 id ⇒ 段落样式全废
 *   3. 动画终态缺失：JS `classList.add('in')`，但 CSS 漏了 `.anim-up.in`
 */

export type RepairResult = {
  html: string
  /** 修掉的数据锁处数（[data-p="1"] ⇒ [data-p]） */
  deadlock: number
  /** 补上的 section id 个数 */
  ids: number
  /** 补上的动画终态条数 */
  animIn: number
  /** 总共改了几处（0 = 这份没问题） */
  total: number
}

export function repairHtml(input: string): RepairResult {
  let html = input

  /* ── ① 动画死锁：[data-p="1"] ⇒ [data-p] ── */
  let deadlock = 0
  html = html.replace(/\[data-p\s*=\s*["']?1(?:\.0+)?["']?\]/g, () => {
    deadlock++
    return '[data-p]'
  })

  /* ── ② 段落 id：CSS 用到 #s1..#sN，就按顺序给第 N 个 section 补 id ── */
  let ids = 0
  {
    const used = new Set<number>()
    const re = /#s(\d+)\b/g
    let mm: RegExpExecArray | null
    while ((mm = re.exec(html)) !== null) {
      const n = Number(mm[1])
      if (n >= 1 && n <= 60) used.add(n)
    }
    const maxN = used.size ? Math.max(...used) : 0

    const secRe = /<section\b([^>]*\bclass="[^"]*\bsec\b[^"]*"[^>]*)>/g
    const secs = [...html.matchAll(secRe)]

    if (maxN > 0 && secs.length >= maxN) {
      const needFix = secs.some((m, i) => {
        const idm = m[1].match(/\bid="([^"]*)"/)
        return !idm || idm[1] !== 's' + (i + 1)
      })
      if (needFix) {
        let i = 0
        html = html.replace(secRe, (whole, attrs: string) => {
          i++
          let a = String(attrs)
          if (/\bid="[^"]*"/.test(a)) a = a.replace(/\bid="[^"]*"/, 'id="s' + i + '"')
          else a = ' id="s' + i + '"' + a
          ids++
          return '<section' + a + '>'
        })
      }
    }
  }

  /* ── ③ 动画终态：JS 加 .in，但 CSS 漏了对应规则就补上 ── */
  let animIn = 0
  {
    const usesIn = /classList\.add\(\s*['"]in['"]\s*\)/.test(html)
    if (usesIn) {
      const need: Array<[string, string]> = [
        ['anim-up', '.anim-up.in { transform: translateY(0); opacity: 1; }'],
        ['anim-scale', '.anim-scale.in { transform: scale(1); opacity: 1; }'],
        ['mask-reveal', '.mask-reveal.in { clip-path: inset(0); opacity: 1; }'],
        ['fade-in', '.fade-in.in { opacity: 1; }'],
        ['reveal', '.reveal.in { opacity: 1; transform: none; }'],
      ]
      const missing: string[] = []
      for (const [cls, rule] of need) {
        const usedInHtml = new RegExp('class="[^"]*\\b' + cls + '\\b').test(html)
        if (!usedInHtml) continue
        const hasRule = new RegExp('\\.' + cls + '\\.in\\s*\\{').test(html)
        if (!hasRule) missing.push(rule)
      }
      if (missing.length) {
        const inject = '\n/* ★ lab2 auto-fix（2026-11-06）：JS 会加 .in 但原片漏了这些终态 */\n'
          + missing.join('\n') + '\n'
        if (html.includes('</style>')) {
          html = html.replace('</style>', inject + '</style>')
        } else {
          html = html.replace(/<\/head>/i, '<style>' + inject + '</style></head>')
        }
        animIn = missing.length
      }
    }
  }

  return { html, deadlock, ids, animIn, total: deadlock + ids + animIn }
}
