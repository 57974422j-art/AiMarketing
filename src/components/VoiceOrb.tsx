'use client'

import { useRef, useEffect } from 'react'

// 声纹点云球（移植自 BaiLongma voice-core.js 的 Fibonacci 球面采样 + 正弦噪声算法）
// 状态：idle(灰) listening(白) recognizing(蓝) speaking(紫) thinking(紫)
type OrbState = 'idle' | 'listening' | 'recognizing' | 'speaking' | 'thinking'

const STATE_CFG: Record<OrbState, { amp: number; spd: number; r: [number,number,number]; g: [number,number,number]; b: [number,number,number] }> = {
  idle:        { amp: 0.003, spd: 0.10, r: [70,90,105],   g: [78,98,112],   b: [90,110,125]  },
  listening:   { amp: 0.055, spd: 0.75, r: [185,215,245], g: [185,215,245], b: [195,225,255] },
  recognizing: { amp: 0.55,  spd: 4.50, r: [25,75,165],   g: [95,155,230],  b: [195,230,255] },
  speaking:    { amp: 0.09,  spd: 1.00, r: [130,95,185],  g: [105,80,170],  b: [225,200,255] },
  thinking:    { amp: 0.15,  spd: 1.10, r: [100,60,200],  g: [80,60,180],   b: [220,190,255] },
}

function fibSphere(n: number, radius: number) {
  const pts: { x: number; y: number; z: number }[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i
    pts.push({ x: Math.cos(theta) * r * radius, y: y * radius, z: Math.sin(theta) * r * radius })
  }
  return pts
}

const OUTER = fibSphere(1600, 1.0)
const INNER = fibSphere(700, 0.86)

function sn(x: number, y: number, z: number, t: number) {
  return (
    Math.sin(x * 2.3 + t * 1.1) * Math.cos(y * 1.9 + t * 0.8) * 0.38 +
    Math.sin(y * 3.1 + t * 1.4) * Math.cos(z * 2.7 + t * 0.6) * 0.30 +
    Math.sin(z * 1.7 + t * 0.9) * Math.cos(x * 3.3 + t * 1.2) * 0.30 +
    Math.sin(x * 5.1 + y * 4.3 + t * 2.1) * 0.14
  )
}

interface Props {
  state: OrbState
  size?: number       // canvas CSS 尺寸（px）
  volume?: number     // 0~1 外部音量（录音时驱动跳动）
  className?: string
}

export default function VoiceOrb({ state, size = 200, volume = 0, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef(state)
  const volRef = useRef(volume)
  stateRef.current = state
  volRef.current = volume

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)

    let raf = 0
    let t = 0
    const cx = size / 2
    const cy = size / 2
    const R = size * 0.36

    const lerp = (a: number, b: number, k: number) => a + (b - a) * k

    const render = () => {
      const cfg = STATE_CFG[stateRef.current]
      const extVol = volRef.current
      t += 0.016 * cfg.spd
      ctx.clearRect(0, 0, size, size)

      // 外发光
      const glow = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.5)
      glow.addColorStop(0, `rgba(${cfg.r[1]},${cfg.g[1]},${cfg.b[1]},0.10)`)
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, size, size)

      const drawLayer = (pts: typeof OUTER, baseAlpha: number, radScale: number) => {
        const proj = pts.map(p => {
          const noise = sn(p.x, p.y, p.z, t) * cfg.amp
          const rr = radScale * (1 + noise + extVol * 0.5)
          // 简单旋转
          const rx = p.x * Math.cos(t * 0.2) - p.z * Math.sin(t * 0.2)
          const rz = p.x * Math.sin(t * 0.2) + p.z * Math.cos(t * 0.2)
          const sx = cx + rx * R * rr
          const sy = cy + p.y * R * rr
          const depth = (rz + 1) / 2 // 0~1
          return { sx, sy, depth }
        }).sort((a, b) => a.depth - b.depth)

        for (const pt of proj) {
          const alpha = baseAlpha * (0.35 + pt.depth * 0.65)
          const px = 1.1 + pt.depth * 1.6
          const cr = Math.round(lerp(cfg.r[0], cfg.r[1], pt.depth))
          const cg = Math.round(lerp(cfg.g[0], cfg.g[1], pt.depth))
          const cb = Math.round(lerp(cfg.b[0], cfg.b[1], pt.depth))
          ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`
          ctx.beginPath()
          ctx.arc(pt.sx, pt.sy, px, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      drawLayer(INNER, 0.55, 0.86)
      drawLayer(OUTER, 0.8, 1.0)
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => cancelAnimationFrame(raf)
  }, [size])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size }}
    />
  )
}
