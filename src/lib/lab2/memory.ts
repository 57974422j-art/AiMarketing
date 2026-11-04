/**
 * ★LAB2 记忆（2026-11-02）
 *
 * 目的：**每个用户独立记忆**，不是全局模型进化。
 *   用户 A 要求多 ⇒ A 的 lessons 越攒越多 ⇒ A 越用越准
 *   用户 B 不在乎 ⇒ B 的 lessons 是空的 ⇒ B 一直是基线
 *
 * 存储：本地 JSON 文件（`storage/lab2-memory.json`），不依赖数据库。
 *   结构：{ [userId]: { lessons: [{ text, hits, createdAt }] } }
 *
 * 关键设计：**lesson 必须"被验证有效"才加权**
 *   流程：用户点「重做」并写意见 ⇒ 记 pending ⇒ 下次生成时注入
 *         ⇒ 用户这次**导出/满意** ⇒ 该条 hits+1（有效）
 *         ⇒ 用户又重做 ⇒ hits-1（无效，且不再注入）
 */

import fs from 'node:fs'
import path from 'node:path'

export type Lesson = {
  text: string
  /** 有效次数 − 无效次数 */
  hits: number
  createdAt: string
  /** pending = 待验证 · active = 已验证 · dead = 已失效 */
  state: 'pending' | 'active' | 'dead'
}

type Store = Record<string, Lesson[]>

const FILE = path.join(process.cwd(), 'storage', 'lab2-memory.json')

function load(): Store {
  try {
    if (!fs.existsSync(FILE)) return {}
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as Store
  } catch {
    return {}
  }
}

function save(s: Store) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(s, null, 2), 'utf8')
  } catch { /* 静默失败，不影响生成 */ }
}

/**
 * 取该用户的教训（最多 20 条）
 *
 * ★★★ 2026-11-04 用户：「实验2 要自己有记忆，不是这份做完下次连干什么都忘记。」
 *
 * 上一版门槛：只注入 `state === 'active' && hits > 0`
 *   ⇒ 转 active 只能靠用户点「👍 满意」
 *   ⇒ 实测那按钮从来没人点 ⇒ 所有意见永远停在 pending
 *   ⇒ prompt 里永远是"（无历史教训）"—— 记忆等于不存在
 *
 * 现在：**pending 也注入**（用户写过的话就是他想要的），只排除 dead（连续无效）。
 *   · active（验证过）排前面，hits 高的更前
 *   · pending（还没验证）排后面，新的更前
 *   · dead（反复无效）不注入
 */
export function getMemories(userId: string, limit = 20): string[] {
  const all = load()[userId] || []
  return all
    .filter((l) => l.state !== 'dead')
    .sort((a, b) => {
      const A = a.state === 'active' ? 1 : 0
      const B = b.state === 'active' ? 1 : 0
      if (A !== B) return B - A          /* active 优先 */
      if (A === 1) return b.hits - a.hits /* active 内按命中次数 */
      return a.createdAt < b.createdAt ? 1 : -1  /* pending 内新的优先 */
    })
    .slice(0, limit)
    .map((l) => l.text)
}

/** 用户点「重做」并写了意见 ⇒ 记为 pending（待验证） */
export function addPending(userId: string, text: string) {
  const s = load()
  const list = s[userId] || (s[userId] = [])
  const t = String(text || '').trim()
  if (!t) return
  /* 已有相同就 +1 pending，不重复 */
  const hit = list.find((l) => l.text === t)
  if (hit) {
    if (hit.state === 'dead') hit.state = 'pending'
    save(s)
    return
  }
  list.push({ text: t, hits: 0, createdAt: new Date().toISOString(), state: 'pending' })
  /* 最多留 60 条，超出删最旧的 pending */
  if (list.length > 60) {
    const idx = list.findIndex((l) => l.state === 'pending')
    if (idx >= 0) list.splice(idx, 1)
  }
  save(s)
}

/** 用户这一单"满意"（导出 / 没再重做）⇒ 所有 pending 转 active，hits+1 */
export function confirmPending(userId: string) {
  const s = load()
  const list = s[userId] || []
  let n = 0
  list.forEach((l) => {
    if (l.state === 'pending') { l.state = 'active'; l.hits += 1; n++ }
  })
  if (n) save(s)
  return n
}

/** 用户又重做了一次 ⇒ 上次的 pending 判"无效"（hits-1，连续无效就 dead） */
export function rejectPending(userId: string) {
  const s = load()
  const list = s[userId] || []
  let n = 0
  list.forEach((l) => {
    if (l.state === 'pending') {
      l.hits -= 1
      if (l.hits <= -1) l.state = 'dead'
      n++
    }
  })
  if (n) save(s)
  return n
}

/** 调试：看某用户的全部记忆 */
export function dumpMemories(userId: string): Lesson[] {
  return load()[userId] || []
}
