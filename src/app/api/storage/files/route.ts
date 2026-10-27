import { NextRequest, NextResponse } from 'next/server'
import { getAuthFromHeaders } from '@/lib/api-auth'
// ★VF_OSS_MAXKEYS_V1：列表改**分页全量**（单次最多 1000 条 ⇒ 超过会"少显示"）
import { listAllObjects, putObject } from '@/lib/oss'
import { saveToPersonalRepo, ensureThumb } from '@/lib/personal-storage'
// ★VF_REPOSPLIT_V1：分类（`gen_` 前缀 = 生成物）只认 lib/repo-naming 一处口径
import { repoKind } from '@/lib/repo-naming'
// ★VF_REPOSPLIT_V1b（2026-10-12 用户实测「成片和素材还是放在一起」）：**老成片**没有 `gen_` 前缀
//   （改名之前生成的），必须用现成的**强判据**认出来：出片记录（video-factory 任务文件里的 repoName）
//   + 统一入库命名 `YYYYMMDD_NNN.mp4` **两条同时成立** ⇒ 判为生成素材（不误伤用户自己导入的视频）。
import { readOutcomeNames } from '@/lib/agent/video-material'
import { materialStateOf } from '@/lib/agent/vf/material-pool'

// ★VF_QUOTA_V2（2026-10-11 用户定案「到 450 就不给传」）：配额常量与判定**只认 lib/storage-quota**（一处真源）
import { QUOTA_TOTAL, QUOTA_REJECT, quotaUsed, quotaCheck, quotaGenUsed } from '@/lib/storage-quota'

// ★2026-09-22：缩略图补齐的**并发闸门**（同时最多 2 个，其余排队）。
//   为什么：ensureThumb 每个任务都要"整段下载视频 → ffmpeg 抽帧 → 上传"，无限制并发会把
//   带宽/CPU 打满，导致用户"打开列表后下载/播放都变慢"（用户实测反馈）。
//   注意：这是**进程内**闸门（单实例部署足够；多实例只会各自限流，不会更差）。
const THUMB_MAX_CONCURRENT = 2
let thumbRunning = 0
const thumbQueue: Array<() => void> = []
function scheduleThumb(userId: number, name: string): void {
  const run = () => {
    thumbRunning++
    Promise.resolve()
      .then(() => ensureThumb(userId, name))
      .catch(() => { /* 单张失败不影响列表 */ })
      .finally(() => {
        thumbRunning = Math.max(0, thumbRunning - 1)
        const next = thumbQueue.shift()
        if (next) next()
      })
  }
  if (thumbRunning < THUMB_MAX_CONCURRENT) run()
  else thumbQueue.push(run)
}

// ★VF_QUOTA_V2：原来这里有一套 usedQuota（失败返回 0 ⇒ 配额形同虚设），已统一到 lib/storage-quota 的 quotaUsed
//   （排除 .thumbs/ 与 _gen/，失败返回 -1 ⇒ 调用方明确报错，不静默放行）。

export async function GET(request: NextRequest) {
  // 2026-08-12 #5: 删除 query 回退（原 query 可伪造他人 userId 枚举私有素材），强制 header/cookie 鉴权
  const auth = getAuthFromHeaders(request)
  if (!auth?.userId) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  try {
    const prefix = `storage/${auth.userId}/`
    const objects = await listAllObjects(prefix, 20000)
    // ★VF_REPOSPLIT_V1b：老成片判据（出片记录 + 统一入库命名，两条同时成立才算）——读的是
    //   video-factory 任务文件的 repoName，零网络、零 prisma，判不出来就一个都不认（不误伤原片）。
    let outcomes: Set<string> = new Set()
    try { outcomes = readOutcomeNames(auth.userId) } catch { /* 读不到记录 ⇒ 只按前缀分 */ }
    // 已存在的缩略图集合，用于判断存量视频是否需要补图
    const thumbSet = new Set(
      objects.filter(o => o.name.includes('/.thumbs/')).map(o => o.name.split('/.thumbs/')[1])
    )
    // ★VF_CACHEBUST_V1（2026-10-12 用户定案「缩略图和素材不一样」修复其一）：缩略图**版本指纹**
    //   病灶：缩略图 URL 由文件名确定性拼出，而后端返回 `Cache-Control: public, max-age=86400`
    //   ⇒ 底层文件被覆盖/重生成后 **URL 不变 ⇒ 浏览器继续显示 24 小时前的旧图**（观感就是"和素材不符"）。
    //   现口径：URL 后面挂 `&v=<size-mtime>`；内容一变 URL 就变，24h 缓存从此安全。
    const thumbVer = new Map<string, string>()
    for (const o of objects) {
      if (!o.name.includes('/.thumbs/')) continue
      thumbVer.set(o.name.split('/.thumbs/')[1], `${o.size}-${o.lastModified.getTime()}`)
    }

    // 过滤掉 .thumbs 子目录的文件，只返回用户上传的文件
    // ★VF_REPOSPLIT_V1：顺手排除历史/规划中的 `_gen/` 目录项（那类 key 读/删/镜像三处都进不去，
    //   列出来只会让人点了没反应）——现在生成物走**平铺前缀** `gen_日期_序号.ext`，见 lib/repo-naming。
    /* ★VF_LIST_FLATONLY_V1（2026-10-23 用户截图实锤「素材库里冒出一堆 frames/gen_xxx/seg-N.png，
       没有缩略图、还删不掉」）：
       病灶：这里只排除了 `.thumbs/` 和 `_gen/` 两个**具体**子目录
            ⇒ 任何**别的**子目录（我加的 `frames/`、以后的任何缓存目录）都会被当成用户素材列出来。
       现口径：**只显示平铺文件**（相对路径里不含 `/`）—— 一切子目录都是内部数据，不进素材库。
       这样即使以后再加新的缓存前缀，也**不可能再污染列表**（不用每次记得加排除）。 */
    const files = objects
      .filter((o) => {
        const rel = o.name.slice(prefix.length)
        return rel.length > 0 && !rel.includes('/')
      })
      .map(o => {
        const name = o.name.slice(prefix.length)
        const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(name)
        // 缩略图路径（OSS 上 .thumbs/{name}.jpg）
        const thumbName = name.replace(/\.(mp4|mov|avi|mkv|webm)$/i, '.jpg')
        const thumbExists = thumbSet.has(thumbName)
        // 存量视频缺缩略图时后台异步补齐
        // ★2026-09-22（用户实测「打开个人仓库后，下载/播放都变慢」）：
        //   原来对**每个**缺图的视频**无限制并发** ensureThumb —— 每个任务 = 从 OSS 整段下载视频
        //   + 起一个 ffmpeg 抽帧 + 再上传，几十个视频同时跑就把带宽/CPU 打满，
        //   于是"列表之后的下载/播放"全被拖慢。这里限制**同时最多 2 个**，其余排队。
        if (isVideo && !thumbExists) scheduleThumb(auth!.userId, name)
        // ★VF_REPOSPLIT_V1b：两类判据并起来 —— ① 新命名 `gen_日期_序号.ext`（repoKind）；
        //   ② **老成片**（改名之前生成的，如 `20261011_022.mp4`）靠"出片记录 + 统一入库命名"
        //      两条同时成立认出来（materialStateOf === 'outcome'）⇒ 不误伤用户自己导入的视频。
        const isGen = repoKind(name) === 'gen' || materialStateOf(name, { outcomeNames: outcomes }) === 'outcome'
        return {
          name,
          // `gen` = 生成素材（前端"生成素材"这组）｜`asset` = 用户原始素材（"原始素材"这组）
          kind: isGen ? 'gen' as const : 'asset' as const,
          size: o.size,
          mtime: o.lastModified.toISOString(),
          isVideo,
          /* ★VF_THUMB_ONLY_IMAGE_V1（2026-10-27 用户实测「个人仓库里 html 显示成破图」）：
             病灶：原来"非视频就一律把**文件自己**当缩略图" ⇒ `.html`（10.6MB）也被塞进 `<img src>`
                  ⇒ 浏览器当图片解码失败 ⇒ **破图**（前端本来给 html 留了 📄 图标分支，被这个假 url 骗过去了）。
             现口径：**只有图片**才用文件本身作预览；html / mp4(无缩略图) / 其它 ⇒ `null`
                  ⇒ 前端显示 📄 图标（点文件名照样能打开预览）。
             ⚠️ 不改前端：前端已经有 `thumbUrl ? <img> : 📄` 的分支。 */
          thumbUrl: isVideo
            ? (thumbExists ? `/api/storage/file?userId=${auth!.userId}&name=.thumbs/${thumbName}&v=${thumbVer.get(thumbName) || 0}` : null)
            : (/\.(jpg|jpeg|png|gif|webp)$/i.test(name)
              ? `/api/storage/file?userId=${auth!.userId}&name=${encodeURIComponent(name)}&v=${o.size}-${o.lastModified.getTime()}`
              : null),
        }
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime))

    const used = await quotaUsed(auth.userId)
    /* ★VF_QUOTA_V3：**额外**返回"生成素材占用"（`gen_` 前缀 + 它的缩略图）——
       只用于**展示**，**不参与拒传判定**（否则一生成就撞 450MB，连原始素材都传不上来）。
       用户实测：面板显示 `0.0MB / 450MB (0%)`，因为 `gen_` 被 `NOT_USAGE` 排除 ⇒ 完全看不到生成物占了多少。 */
    const genUsed = await quotaGenUsed(auth.userId)
    // ★VF_QUOTA_V2：给前端的口径与拒传阈值**一致**（total = 拒传阈值 450MB；totalReal = 总空间 500MB）
    return NextResponse.json({
      success: true,
      data: {
        files, used: used < 0 ? 0 : used,
        genUsed: genUsed < 0 ? null : genUsed,     // null = 统计失败（前端显示 "—" 而不是 0）
        total: QUOTA_REJECT, totalReal: QUOTA_TOTAL, quotaUnknown: used < 0,
        userId: auth.userId,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message || '读取失败' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = getAuthFromHeaders(request)
  if (!auth) return NextResponse.json({ success: false, message: '请先登录' }, { status: 401 })

  const form = await request.formData()
  const file = form.get('file') as File
  if (!file) return NextResponse.json({ success: false, message: '缺少文件' }, { status: 400 })

  const used = await quotaUsed(auth.userId)
  // ★VF_QUOTA_V2：统一判定（已用 + 本次 > 450MB ⇒ 拒；统计失败也拒 ⇒ 不静默放行）
  const quotaMsg = quotaCheck(used, file.size)
  if (quotaMsg) return NextResponse.json({ success: false, message: quotaMsg }, { status: 413 })

  // ★VF_UPLOADGUARD_V1（2026-10-10 用户服务器实测：仓库里躺着 `20261009_021.mp4` = **0 字节**，
  //   而且它没有缩略图 ⇒ 这是**上传中途断**留下的半成品：列表里看得见、点开是坏的）。
  //   病灶：这里对扩展名与内容长度**没有任何校验** ⇒ 空内容、怪扩展名也照进仓库（"逻辑混乱"的来源之一）。
  // ★VF_BGM_PICK_V1（2026-10-22 用户定案「没有音乐」+ 乐库为空 ⇒ 走"用户自己传"）：
  //   放行**音频**（配乐用）。只放常见格式：mp3/m4a/wav/aac（ogg/flac 阿里能读但 ffmpeg 混音链没验过，先不放）。
  const ALLOWED_EXT = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'jpg', 'jpeg', 'png', 'gif', 'webp',
    'mp3', 'm4a', 'wav', 'aac']
  const ext = String(file.name.split('.').pop() || '').toLowerCase()
  if (!ALLOWED_EXT.includes(ext)) {
    return NextResponse.json({ success: false, message: '不支持的文件类型：' + (ext || '(无扩展名)') }, { status: 400 })
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  if (!buffer.length) {
    return NextResponse.json({
      success: false,
      message: '上传内容为空（0 字节）——上传可能中断了，请重试；服务端没有保存任何东西',
    }, { status: 400 })
  }

  // 根据扩展名设置 MIME 类型
  const mimeMap: Record<string, string> = {
    mp4: 'video/mp4', mov: 'video/quicktime', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp',
    // ★VF_BGM_PICK_V1：音频（配乐）—— mime 必须给对，否则浏览器试听 / ffmpeg 探测都会犯迷糊
    mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac',
  }
  const mime = mimeMap[ext.toLowerCase()] || 'application/octet-stream'

  try {
    const res = await saveToPersonalRepo({ userId: auth.userId, buffer, ext, mime })
    // 2026-08-26: 不再自动抽帧（用户要求：上传视频不切图；发视频时按需抽帧在 extract_video_frames 工具内）
    // ★2026-10-12 更正（这句注释曾把排查带偏）：`saveToPersonalRepo` **确实会**为视频抽一帧，
    //   但那一帧只作**列表缩略图**存到 `.thumbs/`（personal-storage.ts 视频分支），不返回给调用方当"分镜帧"。
    return NextResponse.json({ success: true, data: { name: res.name, size: file.size, frames: [] } })
  } catch (e) {
    const message = e instanceof Error ? e.message : '保存失败'
    return NextResponse.json({ success: false, message }, { status: 413 })
  }
}

// 强制动态渲染：API 路由依赖 request.headers / 鉴权，禁止 Next 在构建期静态预渲染
export const dynamic = 'force-dynamic'
