/**
 * ★VF_UPLOAD_SHRINK_V1（2026-10-30 用户定案）
 * =============================================================================
 * 用户原话：「图片不管是 AGENT 哪个页面上传都压缩，**不裁剪、不影响分辨率**，是否可以？」
 *          「这个肯定有，这微信图片怎么大，确实不合理」
 *          「既然无伤，没必要图片那么大」
 *
 * ## 为什么要在**上传时**压，而不是用到时再压
 * 现在整条链上压了三次（送 AI 一次、闸门内嵌一次、成片一次），
 * 每处策略不同 ⇒ 反复出问题（`import('sharp')` 失败、1.2MB 门槛挡住兜底、
 * 页面 11.5MB 导致 check 超时…）。**一处压好，全链路受益**：
 *   · 仓库体积降（用户在意「个人仓库占比」）
 *   · 送 AI 的请求体稳定在 3~6MB（远低于实测的 45MB 上限）
 *   · 闸门内嵌页面从 11.5MB 降到 7MB 左右 ⇒ check 更快
 *   · 成片清晰度不变（因为**尺寸没改**）
 *
 * ## 唯一的原则：**只降质量，不动尺寸，不裁剪**
 *   · 宽高完全不变（1707×1280 还是 1707×1280）
 *   · 不裁边、不改比例、不旋转
 *   · 只把 jpg 的量化质量从 q95~98 降到 **q82**
 *   ⇒ 体积降 40~70%，肉眼几乎不可辨（成片本身还要再压一次）
 *
 * ## 实测依据（2026-10-30 本地）
 * ```
 * 请求体  6MB → 200 ✅   22MB → 200 ✅   32MB → 200 ✅   45MB → 200 ✅
 *         50MB → **413 Request Entity Too Large**（deepseek 前面的 openresty）
 * ```
 * ⇒ 上限约 45~50MB。17 张 × 1.1MB × 1.37 ≈ 26MB ⇒ 安全。
 *   而不压的话，微信 4MB/张 ⇒ 17 × 4 × 1.37 = 92MB ⇒ **必 413**（用户那次就是这样）。
 *
 * ## 为什么用 createRequire 加载 sharp
 * 之前代码写的是 `await import('sharp')`，在 Next standalone（ESM 产物）里**加载失败**，
 * 而被 `catch {}` 静默吞掉 ⇒ 「sharp 不可用」这个假象持续了很久。
 * 实际上 `require('sharp')` 是好的（服务器上实测能打出 libvips 版本）。
 * ⇒ 现在统一用 `createRequire(import.meta.url)` 去 require，绕开 ESM/CJS 互操作问题。
 */
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 只有超过这个体积才压（小图压了没意义，反而多一次解码）
 *  ★VF_UPLOAD_SHRINK_V1b（2026-10-30 用户定案「超过 1.2MB 压或者 1MB 压都可以」）：
 *    500KB → **1MB**。
 *    理由：用户的实际素材是 0.27MB/张（1707×1280），**根本不需要压**；
 *        真正要治的是**微信导出的 4MB 大图**。
 *    ⇒ 1MB 这个门槛：正常手机图（0.2~0.8MB）一律不动，只压真正的巨图。
 *    ⚠️ 副作用：0.6~1MB 的图不再压（以前会）⇒ 仓库体积略大一点点，但**画质零损失**。
 *    17 张 × 1.1MB（压后）× 1.37 ≈ 26MB ⇒ 仍在实测 45MB 上限的**安全区**内。 */
const SHRINK_THRESHOLD = 1024 * 1024          // 1MB
/** jpg 目标质量：82 是"肉眼无感"与"体积下降"的平衡点 */
const JPEG_QUALITY = 82

let _sharp: any = null
let _sharpTried = false
/** 用 require 加载 sharp（绕开 `import()` 在 standalone 里失败的问题） */
function getSharp(): any {
  if (_sharpTried) return _sharp
  _sharpTried = true
  try {
    const req = createRequire(import.meta.url)
    _sharp = req('sharp')
    try { console.log('[上传压缩] sharp 可用（' + String(_sharp?.versions?.vips || 'ok') + '）') } catch { /* ignore */ }
  } catch (e: any) {
    _sharp = null
    // ★这次**不静默** —— 上次就是因为静默，我们花了两天以为 sharp 坏了
    try { console.error('[上传压缩] sharp 加载失败，将用 ffmpeg 兜底：' + String(e?.message || e).slice(0, 160)) } catch { /* ignore */ }
  }
  return _sharp
}

/** 这些格式可以安全"只降质量"；gif 不能（会变静图），svg 不能（矢量） */
const SHRINKABLE = ['jpg', 'jpeg', 'png', 'webp']

/**
 * 压缩图片：**只降质量，尺寸不变，不裁剪**。
 * 失败时返回原 buffer（绝不让上传因为压缩失败而挂掉）。
 */
export async function shrinkImageOnUpload(
  buffer: Buffer,
  ext: string,
): Promise<{ buffer: Buffer; note: string }> {
  const e = String(ext || '').toLowerCase()
  const noop = { buffer, note: '' }
  if (!SHRINKABLE.includes(e)) return noop
  if (buffer.length <= SHRINK_THRESHOLD) return noop          // 小图不动

  const before = buffer.length

  /* ── 首选 sharp：质量最高、体积最小、行为最可控 ── */
  const sharp = getSharp()
  if (sharp) {
    try {
      const out = await sharp(buffer)
        // ⚠️ 不调 .resize() / .extract() / .rotate() —— 尺寸与构图必须原样保留
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .toBuffer()
      if (out && out.length && out.length < before * 0.92) {
        return {
          buffer: out,
          note: before + 'KB → ' + Math.round(out.length / 1024) + 'KB（sharp q' + JPEG_QUALITY + '，尺寸未变）',
        }
      }
      return { buffer, note: 'sharp 压缩收益不足，保留原图' }
    } catch (e1: any) {
      try { console.error('[上传压缩] sharp 处理失败，转 ffmpeg：' + String(e1?.message || e1).slice(0, 120)) } catch { /* ignore */ }
    }
  }

  /* ── 兜底 ffmpeg：只设质量，不加 -vf（不加就不会改尺寸） ── */
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ups-'))
    const inP = path.join(dir, 'in.' + (e === 'jpeg' ? 'jpg' : e))
    const outP = path.join(dir, 'out.jpg')
    try {
      fs.writeFileSync(inP, buffer)
      // -q:v 3 约等于 jpg q85；**刻意不加 -vf scale** ⇒ 尺寸原样
      const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-threads', '1', '-i', inP,
        '-threads', '1', '-q:v', '3', outP], { timeout: 30000 })
      if (r.status === 0 && fs.existsSync(outP)) {
        const out = fs.readFileSync(outP)
        if (out.length && out.length < before * 0.92) {
          return {
            buffer: out,
            note: before + 'KB → ' + Math.round(out.length / 1024) + 'KB（ffmpeg q3，尺寸未变）',
          }
        }
      }
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  } catch (e2: any) {
    try { console.error('[上传压缩] ffmpeg 兜底也失败，保留原图：' + String(e2?.message || e2).slice(0, 120)) } catch { /* ignore */ }
  }

  return { buffer, note: '压缩未生效，保留原图' }
}
