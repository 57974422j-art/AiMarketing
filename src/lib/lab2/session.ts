/**
 * LAB2 · 会话存储（2026-11-04）
 *
 * 用户：「实验2 要能跟我实现长期会话，自己有记忆。不是这份做完了下次它连自己干什么都忘记。」
 *
 * 设计：
 *   · 一个用户可有多个会话（sid），默认 'main' 一直续着
 *   · 每个会话记：brief（在做什么）+ 历史对话 + 当前版本的文件名
 *   · 存本地 JSON：storage/lab2-sessions/<userId>.json
 *   · 每轮对话都带上「历史 + 当前 HTML」⇒ 它知道自己在改哪一版、改过什么
 *
 * 不做的事：
 *   · 不做向量检索（会话短，直接全带）
 *   · 不存 HTML 全文（只存文件名，读时从 storage 取）
 */

import fs from 'node:fs'
import path from 'node:path'

export type ChatMsg = {
  role: 'user' | 'assistant'
  /** 用户说的话 / 它回的"改了什么" */
  text: string
  /** 这一轮产出的文件名（assistant 才有） */
  htmlName?: string
  ts: string
}

export type SessionBrief = {
  /** 画布 */
  W: number
  H: number
  aspect: string
  /** 用户在做什么 */
  contentType?: string
  copyMode?: string
  decoDensity?: string
  bigImg?: number
  imgCount?: number
  /** 素材文件名（保持顺序，{{IMG_N}} 的对应关系） */
  imgs: string[]
}

export type Session = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  brief: SessionBrief
  messages: ChatMsg[]
  /** 当前版本的仓库文件名（如 gen_20261104_093748.html） */
  currentHtmlName: string
}

type Store = Record<string, Record<string, Session>>

const DIR = () => path.join(process.cwd(), 'storage', 'lab2-sessions')

function fileOf(userId: string) {
  return path.join(DIR(), String(userId).replace(/[^\w-]/g, '_') + '.json')
}

function load(userId: string): Store {
  try {
    const f = fileOf(userId)
    if (!fs.existsSync(f)) return {}
    return JSON.parse(fs.readFileSync(f, 'utf8')) as Store
  } catch {
    return {}
  }
}

function save(userId: string, s: Store) {
  try {
    fs.mkdirSync(DIR(), { recursive: true })
    fs.writeFileSync(fileOf(userId), JSON.stringify(s, null, 2), 'utf8')
  } catch { /* 存不下不影响主流程 */ }
}

/** 读一个会话；没有就建 */
export function getOrCreateSession(userId: string, sid: string, brief?: SessionBrief): Session {
  const all = load(userId)
  const list = all[userId] || (all[userId] = {})
  if (!list[sid]) {
    list[sid] = {
      id: sid,
      title: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      brief: brief || { W: 720, H: 1280, aspect: '9:16', imgs: [] },
      messages: [],
      currentHtmlName: '',
    }
  } else if (brief) {
    /* 有新的 brief 就更新（用户可能换了素材/画幅） */
    list[sid].brief = brief
  }
  save(userId, all)
  return list[sid]
}

/** 追加一条消息；htmlName 只在 assistant 时传 */
export function appendMessage(
  userId: string,
  sid: string,
  msg: ChatMsg,
  brief?: SessionBrief,
): Session {
  const all = load(userId)
  const list = all[userId] || (all[userId] = {})
  const s = list[sid] || getOrCreateSession(userId, sid, brief)
  s.messages.push(msg)
  s.updatedAt = msg.ts
  if (msg.htmlName) s.currentHtmlName = msg.htmlName
  if (!s.title && msg.role === 'user') s.title = msg.text.slice(0, 30)
  /* 最多留 60 条，防无限增长 */
  if (s.messages.length > 60) s.messages = s.messages.slice(-60)
  list[sid] = s
  save(userId, all)
  return s
}

/** 列出这个用户的所有会话（给"历史"用） */
export function listSessions(userId: string): Array<{
  id: string
  title: string
  updatedAt: string
  msgCount: number
  currentHtmlName: string
}> {
  const all = load(userId)
  const list = all[userId] || {}
  return Object.values(list)
    .map((s) => ({
      id: s.id,
      title: s.title || '(空会话)',
      updatedAt: s.updatedAt,
      msgCount: s.messages.length,
      currentHtmlName: s.currentHtmlName,
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}
