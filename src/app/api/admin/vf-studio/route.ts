import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
import { getAuthFromHeaders } from '@/lib/api-auth'

/**
 * ★VF_STUDIOADMIN_V1（2026-10-08 用户定案 ①②③④⑤）
 *
 * 「风格库 / 实验室」后台（admin 专用）——它**不自己渲染**，而是探活**本机小服务**
 * （`node scripts/video-factory/html-deck/tools/studio-server.mjs`，只监听 127.0.0.1）。
 *
 * 为什么这么做（用户定案）：
 *   ③ 抽帧 / 试片 / 出片都要 ffmpeg + 超帧引擎 ⇒ **只在管理员本机跑**：生产服务器上不启、
 *      普通用户机器没有 ffmpeg、用户也不参与试片。本接口只做"探活 + 给人话指引"。
 *   ① 权限：**只 admin**（沿用 admin 既有口径：`auth.role !== 'admin'` → 403）。
 *
 * 库与产物的落盘（在引擎侧，见 studio-server.mjs 的 ★VF_STUDIORUNTIME_V1）：
 *   ② 风格包写 **运行时库** `storage/_studio/styles/`（内置库 `html-deck/styles/` 只读，
 *      要"固化进内置库"由 AI 提交进仓库 —— 避免在生产服务器上写代码目录导致 git 冲突）；
 *   ③ 试片/成片/抽帧产物落 `storage/_studio/out/`。
 *
 * ⚠️ 本页要在**本机**用 `http://localhost:3000/admin/vf-studio` 打开：
 *    本地服务是 http://127.0.0.1:7788，若从 https 的生产站点嵌 iframe 会被浏览器按
 *    "混合内容"拦截（本地自测场景不存在这个问题）。
 */

/** 本机工作室地址（可用 VF_STUDIO_URL 覆盖），默认 7788 */
const STUDIO_URL = (process.env.VF_STUDIO_URL || 'http://127.0.0.1:7788').replace(/\/+$/, '')

/** 探活本机服务（2.5 秒超时；失败只回 ok:false，绝不抛错连累页面） */
async function pingLocal(): Promise<any> {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 2500)
    const r = await fetch(STUDIO_URL + '/api/ping', { signal: ctl.signal, cache: 'no-store' })
    clearTimeout(t)
    return await r.json()
  } catch (e: any) {
    return { ok: false, err: String(e?.message || e).slice(0, 160) }
  }
}

export async function GET(req: NextRequest) {
  const auth = getAuthFromHeaders(req)
  if (!auth?.userId || auth.role !== 'admin') {
    return NextResponse.json({ success: false, message: '仅管理员' }, { status: 403 })
  }
  const info = await pingLocal()
  const online = !!info?.ok
  return NextResponse.json({
    success: true,
    data: {
      url: STUDIO_URL,
      online,
      info,
      // 没启动 → 给人话指引（可复制），不让用户去猜
      hint: online
        ? ''
        : '本机服务没启动。在项目根执行：\n  node scripts/video-factory/html-deck/tools/studio-server.mjs\n'
          + '（Windows 也可以双击 scripts\\video-factory\\html-deck\\tools\\「启动风格管理器.cmd」）\n'
          + '启动后本页会自动出现「风格库」和「实验室」两个面板。',
    },
  })
}
