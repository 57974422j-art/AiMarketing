/**
 * 个人仓库统一入库层
 *
 * 所有「导入到个人仓库 storage/{userId}/」的入口都必须走这里，
 * 保证：① 文件名统一 YYYYMMDD_NNN.ext（天然按日期正确排列）；
 *       ② 视频自动生成 .thumbs/{name}.jpg 缩略图；③ 配额一致。
 *
 * 覆盖来源：电脑本地导入 / 一键成片存仓库 / 数字人存仓库。
 */
import fs from 'fs'
import path from 'path'
import { tmpdir } from 'os'
import { putObject, listObjects, getObject, objectExists } from '@/lib/oss'
import { runFFmpeg } from '@/lib/ffmpeg'
// ★VF_QUOTA_V2（2026-10-11 用户定案「到 450 就不给传」）：配额唯一真源（排除 .thumbs/ 与 _gen/）
import { quotaUsed, quotaCheck as quotaMsg } from '@/lib/storage-quota'
// ★VF_REPOSPLIT_V1（2026-10-11 用户定案「在个人仓库内分 原始素材 / 生成素材，时间编码也分开」）：
//   命名与序号的**唯一真源**（纯函数，可单测）。素材 `20261011_001.jpg` ｜ 生成物 `gen_20261011_001.mp4`
import { datePrefixOf, buildRepoName, nextSeq, listPrefix } from '@/lib/repo-naming'

const VIDEO_RE = /\.(mp4|mov|avi|mkv|webm)$/i

/** 用 FFmpeg 从视频 buffer 截第一帧作为缩略图 */
async function generateThumbnail(videoBuffer: Buffer): Promise<Buffer | null> {
  try {
    const tmpIn = path.join(tmpdir(), `thumb_${Date.now()}_in.mp4`)
    const tmpOut = path.join(tmpdir(), `thumb_${Date.now()}_out.jpg`)
    fs.writeFileSync(tmpIn, videoBuffer)
    await runFFmpeg(`-y -i "${tmpIn}" -ss 00:00:00.5 -vframes 1 -q:v 2 "${tmpOut}"`, {
      timeout: 15000,
      skipNice: true,
      priority: 'high',
    })
    const thumb = fs.readFileSync(tmpOut)
    fs.unlinkSync(tmpIn)
    fs.unlinkSync(tmpOut)
    return thumb
  } catch (e) {
    console.error('[thumbnail] FFmpeg生成失败:', e instanceof Error ? e.message : e)
    return null
  }
}

export interface SaveToRepoOptions {
  userId: string | number
  buffer: Buffer
  ext: string
  mime: string
  /** 是否做 500MB 配额检查，默认 true */
  quotaCheck?: boolean
  /** ★VF_REPOSPLIT_V1（2026-10-11 用户定案「在个人仓库内分 原始素材 和 生成素材，时间编码也分开」）：
   *  `true` = 这是**系统生成物**（成片/审片图/预览/数字人…）⇒ 文件名 `gen_日期_序号.ext`，
   *  **与原始素材各自计数**（两个序号空间，互不占号），前端按前缀分组显示。
   *  为什么用文件名前缀而不是子目录 `_gen/`：见 `src/lib/repo-naming.ts` 文件头（读/删/镜像三处都禁 `/`）。 */
  gen?: boolean
}

/**
 * 统一写入个人仓库：日期序命名 + 自动缩略图
 * 返回最终文件名（如 20260723_001.mp4）
 */
export async function saveToPersonalRepo(opts: SaveToRepoOptions): Promise<{ name: string }> {
  const { userId, buffer, ext, mime } = opts
  const uid = String(userId)
  const quotaCheck = opts.quotaCheck ?? true

  // ★VF_QUOTA_V2：配额判定统一到 lib/storage-quota
  //   （一处真源：总量 500MB / 拒传阈值 450MB / **排除 .thumbs 与 _gen**）
  //   与旧实现的差别：① 不再各处写死 500MB；② 缩略图不再占用户配额；
  //   ③ **列目录失败（-1）也拦** —— 旧实现是"失败就跳过配额检查"（用户实测"一会能传一会不能"的来源之一）。
  if (quotaCheck) {
    const used = await quotaUsed(uid)
    const msg = quotaMsg(used, buffer.length)
    if (msg) throw new Error(msg)
  }

  // 日期序命名：素材 `YYYYMMDD_NNN.ext` ｜ 生成物 `gen_YYYYMMDD_NNN.ext`
  //   ★VF_REPOSPLIT_V1（2026-10-11 用户定案）：命名拼装统一到 lib/repo-naming（纯函数 ⇒ 可单测）。
  const gen = !!opts.gen
  const now = new Date()
  const datePrefix = datePrefixOf(now)
  let todaySeq = 1
  // ★VF_NAMESEQ_V2（2026-10-10 用户服务器实测：仓库里有 0 字节半成品、当天还缺号）：
  //   老写法 `catch {}` 会把**列目录失败吞掉**，todaySeq 停在 1 ⇒ 算出"当天第一张"的名字 ⇒
  //   putObject **覆盖已有素材**（用户现象"传上去显示的和下载的不一样"里就有这条：
  //   显示命中 24h 旧缓存、下载拿到被覆盖后的新内容）。
  //   现口径：列目录失败 ⇒ **宁可这次保存失败并明确告知**，也不覆盖已有素材。
  let existing: Array<{ name: string }> = []
  try {
    // ★VF_REPOSPLIT_V1：列表前缀分两类 —— 素材 `storage/{uid}/{日期}` ｜ 生成物 `storage/{uid}/gen_{日期}`
    //   ⇒ 两类**天然不在同一前缀下**，序号各算各的（用户要的"时间编码也分开"就是这一行）
    existing = (await listObjects(listPrefix({ uid, datePrefix, gen }))).filter((o) => !o.name.includes('/.thumbs/'))
  } catch {
    throw new Error('无法确认当天序号（列目录失败）——为避免覆盖已有素材，这次没有保存，请重试')
  }
  // ★VF_NAMESEQ_V1（2026-10-05 用户实测「删了 001 后新片又占 001 → 客户端按文件名判重跳过同步，
  //   本地永远看不到新片」）：序号取【当天已有最大序号 + 1】，不复用被删掉的空号
  //   （原逻辑 existing.length+1：001、003 在、002 被删时会撞 003）。
  // ★VF_NAMESEQ_V1 的"取最大 +1、不复用空号"与"命名规范外兜底 count+1"，已**整体搬进** repo-naming.nextSeq
  //   ★VF_REPOSPLIT_V1：序号与命名统一走纯函数（同类计数、gen 独立序号空间）
  todaySeq = nextSeq(existing.map((o) => String(o.name || '')), { datePrefix, gen })
  // ★VF_NAMESEQ_V2：落盘**之前**再做一次存在性校验（并发两人同时上传、命名规范外的遗留都能兜住）
  let name = buildRepoName({ datePrefix, seq: todaySeq, ext, gen })
  for (let i = 0; i < 50 && (await objectExists(`storage/${uid}/${name}`)); i++) {
    todaySeq++
    name = buildRepoName({ datePrefix, seq: todaySeq, ext, gen })
  }
  let key = `storage/${uid}/${name}`

  // ★VF_PUTUNIQ_V1（2026-10-12 用户定案「个人仓库缩略图错乱」修复其二）：**条件写 + 撞名换号重试**
  //   旧写法是"HEAD 探测 → 再 put"，探测与写入之间有空档：并发两个请求可能**同时通过探测**，
  //   后写者把前者的素材**连同它的 `.thumbs/` 缩略图**一起覆盖
  //   （用户现象原话："我上传是对的，其它人上传缩略图就是乱的"）。
  //   现口径：`x-oss-forbid-overwrite` ⇒ 已存在由**服务端拒绝**（409），本端退到下一号重试 ——
  //   哪怕并发，也保证**一个名字只有一个写入者**。上面的 HEAD 循环保留：让绝大多数情况一次就中、少一次 409 往返。
  for (let guard = 0; ; guard++) {
    try {
      await putObject(key, buffer, mime, { forbidOverwrite: true })
      break
    } catch (e: any) {
      const sig = String(e?.code || e?.name || e?.message || '')
      const conflict = /FileAlreadyExists|ObjectAlreadyExists|409/i.test(sig)
      if (!conflict || guard >= 50) throw e
      todaySeq++
      name = buildRepoName({ datePrefix, seq: todaySeq, ext, gen })
      key = `storage/${uid}/${name}`
    }
  }

  // 视频文件：生成缩略图存到 .thumbs/ 目录
  if (VIDEO_RE.test(name)) {
    try {
      const thumbBuffer = await generateThumbnail(buffer)
      if (thumbBuffer) {
        const thumbName = name.replace(VIDEO_RE, '.jpg')
        const thumbKey = `storage/${uid}/.thumbs/${thumbName}`
        await putObject(thumbKey, thumbBuffer, 'image/jpeg')
      }
    } catch {}
  }

  return { name }
}

/**
 * 存量视频缺缩略图时后台懒补齐：
 * 从 OSS 取回视频 buffer → 现截一帧 → 存回 .thumbs/
 */
export async function ensureThumb(userId: string | number, videoName: string): Promise<void> {
  const uid = String(userId)
  const key = `storage/${uid}/${videoName}`
  const thumbName = videoName.replace(VIDEO_RE, '.jpg')
  const thumbKey = `storage/${uid}/.thumbs/${thumbName}`
  try {
    if (await objectExists(thumbKey)) return
    const videoBuf = await getObject(key)
    const thumbBuffer = await generateThumbnail(videoBuf)
    if (thumbBuffer) await putObject(thumbKey, thumbBuffer, 'image/jpeg')
  } catch (e) {
    console.error('[ensureThumb] 补齐失败:', e instanceof Error ? e.message : e)
  }
}
