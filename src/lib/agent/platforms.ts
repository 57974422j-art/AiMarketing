// ═══════════════════════════════════════════════════════════════════════
// 发布平台唯一真源（2026-09-13 收拢）
//
// 背景：此前平台名单散落 15 处（后端 9 / 前端 2 / 客户端 4），
//       每加一个平台要改十几处，实测多次「改一处漏一处」：
//         · 加微博  → chat route 的 platMapF 漏改 → 点平台按钮报"流程未开始"
//         · 加视频号 → 前端按钮漏、platMapF 漏
//         · 加B站   → 客户端 scriptMap 漏、platUrlMap2 只配 4 个
//       更直接的证据：chat/route.ts 里 SUPPORTED_PLATFORMS 少微博，
//                     却在 UNMET_PLATFORM_ALIAS 里把微博标成"未接入"——同文件自相矛盾。
//
// 规则（硬）：以后新增/修改平台，【只改本文件】。
//          其它地方（后端映射 / 前端按钮 / 登记簿 / 客户端）全部从本文件派生。
//
// ⚠️ 本文件与「标准模式 / 自由模式」完全无关——只是平台名单数据。
// ═══════════════════════════════════════════════════════════════════════

export type PlatformDef = {
  /** 内部 id（数据库/脚本分发用）：douyin / xiaohongshu / weibo / bilibili / kuaishou / shipinhao */
  id: string
  /** 中文名（用户可见）：抖音 / 小红书 / 微博 / B站 / 快手 / 视频号 */
  name: string
  /** 发布页 URL（客户端脚本导航用） */
  publishUrl: string
  /** 登记登录页 URL（打开登录页才能把 cookie 写到该域） */
  loginUrl: string
  /** 登记簿图标 */
  icon: string
}

/** ★ 唯一真源：顺序 = 前端发布按钮展示顺序（抖音/小红书/微博/视频号/B站/快手） */
export const PLATFORMS: PlatformDef[] = [
  {
    id: 'douyin',
    name: '抖音',
    publishUrl: 'https://creator.douyin.com/creator-micro/content/upload',
    loginUrl: 'https://creator.douyin.com/',
    icon: '📕',
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    publishUrl: 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=video',
    loginUrl: 'https://creator.xiaohongshu.com/',
    icon: '📗',
  },
  {
    id: 'weibo',
    name: '微博',
    publishUrl: 'https://weibo.com',
    loginUrl: 'https://weibo.com/login.php',
    icon: '📘',
  },
  {
    id: 'shipinhao',
    name: '视频号',
    publishUrl: 'https://channels.weixin.qq.com/platform/post/create',
    loginUrl: 'https://channels.weixin.qq.com/',
    icon: '📺',
  },
  {
    id: 'bilibili',
    name: 'B站',
    publishUrl: 'https://member.bilibili.com/platform/upload/video/frame',
    // ★2026-09-17 用户实测：原来打开 passport.bilibili.com/login（纯登录表单页）——
    //   即使已登录也【永远显示登录框】，用户以为"登录态没保持住"、反复登录。
    //   改为官网首页：已登录→能看出登录态；未登录→站点自己跳登录。
    loginUrl: 'https://www.bilibili.com/',
    icon: '📙',
  },
  {
    id: 'kuaishou',
    name: '快手',
    publishUrl: 'https://cp.kuaishou.com/article/publish/video',
    // ★2026-09-17 用户实测（同一个坑）：原来打开 passport.kuaishou.com/pc/account/login/
    //   纯登录表单页 → 无论登录与否都显示登录框 → 用户"登 3 次都以为没成功"。
    //   改为官网首页：已登录→能看出登录态；未登录→站点自己跳登录。
    //   （实测：用同一 profile 打开发布页能显示账号「周涛」，证明登录态一直是好的）
    loginUrl: 'https://www.kuaishou.com/',
    icon: '⚡',
  },
]

// ── 派生映射（与原 publish-task.ts 的 API 完全一致，避免调用方改动）──

/** 中文名 → id：{ '抖音': 'douyin', ... } */
export const PLATFORM_KEY: Record<string, string> = Object.fromEntries(
  PLATFORMS.map((p) => [p.name, p.id]),
)

/** id → 中文名：{ douyin: '抖音', ... } */
export const PLATFORM_NAME: Record<string, string> = Object.fromEntries(
  PLATFORMS.map((p) => [p.id, p.name]),
)

/** id → 发布页 URL */
export const PLATFORM_URL: Record<string, string> = Object.fromEntries(
  PLATFORMS.map((p) => [p.id, p.publishUrl]),
)

/** id → 登记登录页 URL */
export const PLATFORM_LOGIN_URL: Record<string, string> = Object.fromEntries(
  PLATFORMS.map((p) => [p.id, p.loginUrl]),
)

/** id → 图标 */
export const PLATFORM_ICON: Record<string, string> = Object.fromEntries(
  PLATFORMS.map((p) => [p.id, p.icon]),
)

/** 中文名数组（前端按钮/文案按此顺序渲染）：['抖音','小红书','微博','视频号','B站','快手'] */
export const PLATFORM_NAMES: string[] = PLATFORMS.map((p) => p.name)

/** id 数组：['douyin','xiaohongshu','weibo','shipinhao','bilibili','kuaishou'] */
export const PLATFORM_IDS: string[] = PLATFORMS.map((p) => p.id)

/** 校验：id 是否已接入 */
export function isSupportedPlatform(id: string): boolean {
  return PLATFORMS.some((p) => p.id === id)
}
