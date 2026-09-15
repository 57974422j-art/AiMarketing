// ⚠️ 本文件由 scripts/gen-platforms-js.mjs 自动生成 —— 请勿手改
// 源：src/lib/agent/platforms.ts（唯一真源）
// 生成时间：2026-09-15T07:53:32.794Z
'use strict'

const PLATFORMS = [
  {
    "id": "douyin",
    "name": "抖音",
    "publishUrl": "https://creator.douyin.com/creator-micro/content/upload",
    "loginUrl": "https://creator.douyin.com/",
    "icon": "📕"
  },
  {
    "id": "xiaohongshu",
    "name": "小红书",
    "publishUrl": "https://creator.xiaohongshu.com/publish/publish?from=menu&target=video",
    "loginUrl": "https://creator.xiaohongshu.com/",
    "icon": "📗"
  },
  {
    "id": "weibo",
    "name": "微博",
    "publishUrl": "https://weibo.com",
    "loginUrl": "https://weibo.com/login.php",
    "icon": "📘"
  },
  {
    "id": "shipinhao",
    "name": "视频号",
    "publishUrl": "https://channels.weixin.qq.com/platform/post/create",
    "loginUrl": "https://channels.weixin.qq.com/",
    "icon": "📺"
  },
  {
    "id": "bilibili",
    "name": "B站",
    "publishUrl": "https://member.bilibili.com/platform/upload/video/frame",
    "loginUrl": "https://passport.bilibili.com/login",
    "icon": "📙"
  },
  {
    "id": "kuaishou",
    "name": "快手",
    "publishUrl": "https://cp.kuaishou.com/article/publish/video",
    "loginUrl": "https://passport.kuaishou.com/pc/account/login/",
    "icon": "⚡"
  }
]

const PLATFORM_KEY = Object.fromEntries(PLATFORMS.map((p) => [p.name, p.id]))
const PLATFORM_NAME = Object.fromEntries(PLATFORMS.map((p) => [p.id, p.name]))
const PLATFORM_URL = Object.fromEntries(PLATFORMS.map((p) => [p.id, p.publishUrl]))
const PLATFORM_LOGIN_URL = Object.fromEntries(PLATFORMS.map((p) => [p.id, p.loginUrl]))
const PLATFORM_ICON = Object.fromEntries(PLATFORMS.map((p) => [p.id, p.icon]))
const PLATFORM_NAMES = PLATFORMS.map((p) => p.name)
const PLATFORM_IDS = PLATFORMS.map((p) => p.id)

module.exports = {
  PLATFORMS,
  PLATFORM_KEY,
  PLATFORM_NAME,
  PLATFORM_URL,
  PLATFORM_LOGIN_URL,
  PLATFORM_ICON,
  PLATFORM_NAMES,
  PLATFORM_IDS,
}
