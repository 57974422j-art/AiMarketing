/**
 * ★VF_THEMENAME_FIX_V1（2026-09-30）—— 画面风格 id → 用户看得懂的中文名（**唯一真相源**）
 *
 * 用户实测（本文件的由来）：
 *   表单里明明选的是 `"theme":"dark"`（深蓝墨），确认卡上却显示「风格 **深蓝科技**」（那是 `blue`）。
 *   根因：卡片里的 `themeName` 映射是 2026-09-20 写的，只有 dark/tech/light 三条，且把
 *   `dark` 错标成了「深蓝科技」——后来 09-29 主题扩到 8 套、09-30 又加了 news/data，
 *   这张表却一直没跟着更新 → 显示错位。
 *
 * 与 `src/app/agent/page.tsx` 的表单按钮一一对应（去掉 emoji 后就是这里的中文名）：
 *   dark=🌌 深蓝墨 / blue=🔷 深蓝科技 / tech=🧊 深青科技 / mint=🌿 清新薄荷 /
 *   light=📄 浅色纸感 / journal=📔 手账暖色 / vivid=🔥 高饱和电商 / mono=⬛ 杂志黑白 /
 *   news=📰 新闻资讯 / data=📊 科技数据
 * ⚠️ 主题的**唯一真相源**是 scripts/video-factory/themes.py（渲染侧）；本文件只管"中文显示名"。
 *    新增主题时：themes.py + page.tsx 按钮 + **这里**（三处一起加，自测脚本会断言 10 个 id）。
 */

/** 显示名（不含 emoji —— 卡片里是「风格 深蓝墨」这种短语） */
export const THEME_LABELS: Record<string, string> = {
  dark: '深蓝墨',
  blue: '深蓝科技',
  tech: '深青科技',
  mint: '清新薄荷',
  light: '浅色纸感',
  journal: '手账暖色',
  vivid: '高饱和电商',
  mono: '杂志黑白',
  news: '新闻资讯',
  data: '科技数据',
}

/** 主题 id → 中文名（未知 id → 默认 `dark` 的名字，绝不返回 undefined） */
export function themeLabel(id: string | null | undefined): string {
  const k = String(id || 'dark')
  return THEME_LABELS[k] || THEME_LABELS.dark
}
