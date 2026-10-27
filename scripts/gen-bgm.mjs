#!/usr/bin/env node
/**
 * gen-bgm.mjs —— 本地合成背景音乐（纯 Node，零依赖，不调任何外部 API）
 *
 * ★VF_LOCAL_BGM_V1（2026-10-27 用户定案）：
 *   MiniMax 音乐 API 已对**新用户永久关闭**（实测 `api.minimax.cn` 返回
 *   `status_code 2153 · This Music API is no longer available to new users`），
 *   而「音乐库」是图片成片与日报线**共同的源头**（图片成片 `bgm='auto'` 挑库里最新一首公开曲目）
 *   ⇒ 库空 ⇒ 两条线都没配乐。
 *
 *   用户的定位（重要）：**原则上不主推音乐** —— 各平台（抖音/视频号）自带免费曲库、
 *   用户上传时自己挑更好，我们也没有版权负担。
 *   ⇒ 所以这里只做**"能出声的兜底"**：四四拍节奏铺底，不追求"一首好听的歌"。
 *   ⚠️ 能做出：底鼓 / 踩镲 / 贝斯线 / 和弦铺底。
 *   ⚠️ 做不出：旋律起伏、段落变化（那需要真人作曲或版权曲库）。
 *
 * 用法（在项目根目录、能读 .env.local 的机器上跑）：
 *   node scripts/gen-bgm.mjs --dry            # 只在本地生成 wav，不上传不入库（先试听）
 *   node scripts/gen-bgm.mjs                  # 生成 + 上传 OSS + 写入「公共音乐库」
 *   node scripts/gen-bgm.mjs --only=edm       # 只做一首（edm / chill / upbeat）
 *
 * 输出：每首约 40 秒、44.1kHz / 16bit / 单声道 wav（混音时会被再压到 -18dB）。
 */
import fs from 'node:fs'
import path from 'node:path'

const ARG = process.argv.slice(2)
const DRY = ARG.includes('--dry')
const ONLY = (ARG.find((a) => a.startsWith('--only=')) || '').split('=')[1] || ''

const SR = 44100          // 采样率
const DUR = 40            // 秒（配合 -stream_loop -1 够用）
const PEAK = 0.72         // 峰值留余量（后面还要混配音）

/* ── 基础波形 ─────────────────────────────────────────────── */
const TAU = Math.PI * 2
const sin = (f, t) => Math.sin(TAU * f * t)

/** 底鼓：60Hz 快速下滑到 40Hz + 指数衰减（最像"咚"的写法） */
function kick(t, amp = 1) {
  const body = Math.exp(-t * 28)
  const f = 42 + 60 * Math.exp(-t * 42)
  return sin(f, t) * body * amp
}

/** 军鼓：白噪声 + 180Hz 体音，短衰减 */
function snare(t, rnd, amp = 1) {
  const n = rnd() * 2 - 1
  const body = Math.exp(-t * 34)
  return (n * 0.7 + sin(185, t) * 0.3) * body * amp
}

/** 踩镲：高通噪声 + 极短衰减 */
function hat(t, rnd, amp = 1) {
  const n = rnd() * 2 - 1
  return n * Math.exp(-t * 95) * amp
}

/** 贝斯：正弦 + 二次谐波（低通感），带起音与释放 */
function bass(t, f, len, amp = 1) {
  if (t < 0 || t > len) return 0
  const atk = Math.min(1, t / 0.006)
  const rel = Math.min(1, (len - t) / 0.03)
  return (sin(f, t) * 0.8 + sin(f * 2, t) * 0.2) * atk * rel * amp
}

/** 和弦铺底：三个音叠加 + 缓慢起伏（避免死板） */
function pad(t, freqs, amp = 1) {
  let v = 0
  for (const f of freqs) v += sin(f, t) * 0.33
  const swell = 0.75 + 0.25 * Math.sin(TAU * (t / 8))
  return v * swell * amp
}

/* ── 音名 → 频率 ────────────────────────────────────────── */
const NOTE = { A2: 110, C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196, A3: 220, B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440 }

/* ── 三首曲子的配方（都是四四拍，循环友好）─────────────── */
const SONGS = {
  edm: {
    title: '轻快电子（本地合成）',
    prompt: 'light four-on-the-floor electronic bed, no vocals, local synthesis',
    bpm: 120,
    // 每小节：和弦根音 + pad 三和弦
    bars: [
      { root: NOTE.A2, pad: [NOTE.A3, NOTE.C4, NOTE.E4] },
      { root: NOTE.F3, pad: [NOTE.F3, NOTE.A3, NOTE.C4] },
      { root: NOTE.C3, pad: [NOTE.C4, NOTE.E4, NOTE.G4] },
      { root: NOTE.G3, pad: [NOTE.G3, NOTE.B3, NOTE.D4] },
    ],
    layers: { kick: true, hat: true, snare: false, bass: true, pad: 0.28 },
  },
  chill: {
    title: '舒缓铺底（本地合成）',
    prompt: 'mellow ambient pad with soft percussion, no vocals, local synthesis',
    bpm: 88,
    bars: [
      { root: NOTE.C3, pad: [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.B3] },
      { root: NOTE.A2, pad: [NOTE.A3, NOTE.C4, NOTE.E4, NOTE.G4] },
      { root: NOTE.F3, pad: [NOTE.F3, NOTE.A3, NOTE.C4, NOTE.E4] },
      { root: NOTE.G3, pad: [NOTE.G3, NOTE.B3, NOTE.D4, NOTE.F4] },
    ],
    layers: { kick: false, hat: true, snare: false, bass: 0.55, pad: 0.5 },
  },
  upbeat: {
    title: '明快律动（本地合成）',
    prompt: 'upbeat rhythmic bed with kick snare and bass, no vocals, local synthesis',
    bpm: 128,
    bars: [
      { root: NOTE.E3, pad: [NOTE.E4, NOTE.G4, NOTE.B3] },
      { root: NOTE.C3, pad: [NOTE.C4, NOTE.E4, NOTE.G4] },
      { root: NOTE.G3, pad: [NOTE.G3, NOTE.B3, NOTE.D4] },
      { root: NOTE.D3, pad: [NOTE.D4, NOTE.F4, NOTE.A3] },
    ],
    layers: { kick: true, hat: true, snare: true, bass: true, pad: 0.22 },
  },
}

/* ── 合成一首 ───────────────────────────────────────────── */
function render(song) {
  const n = Math.floor(SR * DUR)
  const out = new Float32Array(n)
  const beat = 60 / song.bpm       // 一拍秒数
  const barLen = beat * 4
  const totalBars = Math.ceil(DUR / barLen) + 1

  // 固定种子（同一首每次生成结果一致，便于复现）
  let seed = 20261027
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }

  for (let b = 0; b < totalBars; b++) {
    const bar = song.bars[b % song.bars.length]
    const barStart = b * barLen

    // ① 底鼓：每拍一下
    if (song.layers.kick) {
      for (let k = 0; k < 4; k++) {
        const s0 = barStart + k * beat
        for (let i = 0; i < SR * 0.22; i++) {
          const idx = Math.floor(s0 * SR) + i
          if (idx >= n) break
          out[idx] += kick(i / SR, 0.9)
        }
      }
    }

    // ② 军鼓：2、4 拍
    if (song.layers.snare) {
      for (const k of [1, 3]) {
        const s0 = barStart + k * beat
        for (let i = 0; i < SR * 0.14; i++) {
          const idx = Math.floor(s0 * SR) + i
          if (idx >= n) break
          out[idx] += snare(i / SR, rnd, 0.45)
        }
      }
    }

    // ③ 踩镲：八分音符，反拍稍轻
    if (song.layers.hat) {
      for (let k = 0; k < 8; k++) {
        const s0 = barStart + (k * beat) / 2
        const amp = k % 2 === 0 ? 0.16 : 0.1
        for (let i = 0; i < SR * 0.06; i++) {
          const idx = Math.floor(s0 * SR) + i
          if (idx >= n) break
          out[idx] += hat(i / SR, rnd, amp)
        }
      }
    }

    // ④ 贝斯：根音，八分音符（chill 用全音符更松）
    const bassAmp = typeof song.layers.bass === 'number' ? song.layers.bass : (song.layers.bass ? 0.6 : 0)
    if (bassAmp > 0) {
      const steps = song.layers.bass === 0.55 ? 2 : 8
      const len = song.layers.bass === 0.55 ? barLen / 2 : beat / 2
      for (let k = 0; k < steps; k++) {
        const s0 = barStart + (k * barLen) / steps
        const f = k % 4 === 3 ? bar.root * 1.5 : bar.root   // 每小节末尾跳个五度，不死板
        for (let i = 0; i < Math.floor(SR * (len - 0.01)); i++) {
          const idx = Math.floor(s0 * SR) + i
          if (idx >= n) break
          out[idx] += bass(i / SR, f, len, bassAmp)
        }
      }
    }

    // ⑤ 和弦铺底：整小节
    const padAmp = song.layers.pad || 0
    if (padAmp > 0) {
      const s0 = barStart
      for (let i = 0; i < Math.floor(SR * barLen); i++) {
        const idx = Math.floor(s0 * SR) + i
        if (idx >= n) break
        out[idx] += pad(i / SR, bar.pad, padAmp)
      }
    }
  }

  // 结尾淡出 1.2 秒（循环播放时不会有"咔"的一声）
  const fadeN = Math.floor(SR * 1.2)
  for (let i = 0; i < fadeN; i++) {
    const idx = n - fadeN + i
    if (idx >= 0) out[idx] *= 1 - i / fadeN
  }

  // 归一化到 PEAK
  let max = 0
  for (let i = 0; i < n; i++) { const a = Math.abs(out[i]); if (a > max) max = a }
  const g = max > 0 ? PEAK / max : 1
  for (let i = 0; i < n; i++) out[i] *= g
  return out
}

/* ── Float32 → 16bit PCM WAV ────────────────────────────── */
function toWav(samples) {
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)          // fmt chunk size
  buf.writeUInt16LE(1, 20)           // PCM
  buf.writeUInt16LE(1, 22)           // mono
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2, 28)      // byte rate
  buf.writeUInt16LE(2, 32)           // block align
  buf.writeUInt16LE(16, 34)          // bits
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  return buf
}

/* ── 主流程 ─────────────────────────────────────────────── */
const outDir = path.join(process.cwd(), 'temp', 'bgm')
fs.mkdirSync(outDir, { recursive: true })

const picks = Object.keys(SONGS).filter((k) => !ONLY || k === ONLY)
if (!picks.length) { console.error('未知的 --only=' + ONLY + '，可选：' + Object.keys(SONGS).join(' / ')); process.exit(2) }

const made = []
for (const key of picks) {
  const song = SONGS[key]
  process.stdout.write('  ' + song.title.padEnd(20) + ' 合成中… ')
  const t0 = Date.now()
  const samples = render(song)
  const wav = toWav(samples)
  const f = path.join(outDir, `bgm-${key}.wav`)
  fs.writeFileSync(f, wav)
  const sec = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`${DUR}s · ${(wav.length / 1048576).toFixed(1)}MB · ${sec}s`)
  made.push({ key, song, file: f, wav })
}

console.log('')
console.log('  输出目录：' + path.relative(process.cwd(), outDir).replace(/\\/g, '/'))
made.forEach((m) => console.log('    ' + path.basename(m.file)))

if (DRY) {
  console.log('')
  console.log('  === --dry：只生成本地文件，没有上传、没有入库 ===')
  console.log('  先试听（双击 wav），觉得能用再跑：node scripts/gen-bgm.mjs')
  process.exit(0)
}

/* 上传 OSS + 写入「公共音乐库」（source='public' ⇒ 图片成片 bgm='auto' 能挑到）
   ⚠️ 这里**不用 src/lib/oss.ts** —— 那是 TypeScript，node 直接 import 会挂。
   用 ali-oss 直连（和 clean-storage.mjs 同一套写法），读 .env.local 拿凭据。 */
import OSS from 'ali-oss'
const env = fs.readFileSync('.env.local', 'utf8')
const g = (k) => { const m = new RegExp('^' + k + '=(.+)$', 'm').exec(env); return m ? m[1].trim().replace(/^["']|["']$/g, '') : '' }
const BUCKET = g('OSS_BUCKET')
const REGION = g('OSS_REGION') || 'oss-cn-hangzhou'
const client = new OSS({ region: REGION, accessKeyId: g('OSS_ACCESS_KEY_ID'), accessKeySecret: g('OSS_ACCESS_KEY_SECRET'), bucket: BUCKET })

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()
/* ★VF_LOCAL_BGM_V2（2026-10-27 用户「就这个很好，在音乐那里加个选择，选了就加，不选不加」）：
   两处都要放，因为两条线读的是**不同来源**：
     · 图片成片  ⇒ `mediaAsset`（source='public', category='music'），bgm='auto' 挑最新一首
     · 日报线下拉 ⇒ **个人仓库**里的音频（`listRepoAudio`：`AUD_RE` 认 wav，且名字不能以 `gen_` 开头）
   ⚠️ 所以 wav 各放一份：`music/public/` 给图片成片，`storage/{uid}/` 给日报线。
   用户明确要求**默认不加音乐** ⇒ 这里只是"让它们可选"，不改任何默认值。 */
const UID = (process.argv.find((a) => a.startsWith('--uid=')) || '--uid=1').split('=')[1]
console.log('')
for (const m of made) {
  const fileName = `bgm-local-${m.key}.wav`
  const ossKey = `music/public/${fileName}`
  const repoKey = `storage/${UID}/${fileName}`
  try {
    await client.put(ossKey, m.wav, { mime: 'audio/wav' })
    const ossUrl = `https://${BUCKET}.${REGION}.aliyuncs.com/${ossKey}`
    const exists = await prisma.mediaAsset.findFirst({ where: { title: fileName, source: 'public' } })
    if (exists) {
      await prisma.mediaAsset.update({ where: { id: exists.id }, data: { ossUrl, type: 'audio', category: 'music' } })
    } else {
      await prisma.mediaAsset.create({
        data: { title: fileName, ossUrl, type: 'audio', category: 'music', source: 'public', prompt: m.song.prompt },
      })
    }
    // 同一份放进个人仓库 ⇒ 日报线配音卡的下拉里能选到
    await client.put(repoKey, m.wav, { mime: 'audio/wav' })
    console.log('  ✓ ' + m.song.title + '  →  音乐库(public) + 个人仓库(' + UID + ')')
  } catch (e) {
    console.log('  ✗ 失败：' + m.song.title + ' —— ' + String((e && e.message) || e).slice(0, 120))
  }
}
await prisma.$disconnect()
console.log('')
console.log('  完成。')
console.log('  · 图片成片（bgm=auto）会挑到它们')
console.log('  · 日报线第 3 步「背景音乐」下拉里能选到（默认仍是「不加音乐」）')
console.log('  ⚠️ wav 每首 3.4MB，比 mp3 大，但免转码。')
