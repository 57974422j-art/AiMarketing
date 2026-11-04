/**
 * 公开分享页（2026-11-04）
 *
 * 用户："在制成这里帮我加一个分享，我想知道这个分享出去什么样。"
 *
 * 分享出去的形态：
 *   · 黑底全屏，只有一个播放器（打开就自动播）
 *   · 手机上竖屏铺满，PC 上按比例居中
 *   · 没有工具栏、没有代码、没有登录要求
 *
 * URL：/w/<repoId>/<文件名>.html
 *   ⇒ 底层还是 /api/lab2/file（那个接口本来就不鉴权，只校验文件名格式）
 *
 * ⚠️ 本项目是 Next 14 ⇒ params 是**同步对象**（不是 Promise）
 */

import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

type Params = { repoId: string; name: string }

export function generateMetadata({ params }: { params: Params }): Metadata {
  return {
    title: String(params.name || '').replace(/\.html?$/i, '') || '成片',
    robots: { index: false, follow: false },
  }
}

export default function WatchPage({ params }: { params: Params }) {
  const repoId = String(params.repoId || '1')
  const name = String(params.name || '')
  const src = '/api/lab2/file?name=' + encodeURIComponent(name)
    + '&repoId=' + encodeURIComponent(repoId)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <iframe
        src={src}
        title="成片"
        allow="autoplay; fullscreen"
        style={{
          width: '100%', height: '100%', border: 'none', display: 'block',
          background: '#000',
        }}
      />
    </div>
  )
}
