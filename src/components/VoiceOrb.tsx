'use client'

import { useRef, useEffect } from 'react'

// 声纹球 v4（2026-08-06）：托卡马克聚变核心——铜片捆绑带 + 等离子体粒子 + 磁约束环 + 多圈光圈 + 呼吸光晕 + 中心能量核心
// 状态：idle(蓝白) listening(亮白) recognizing(电蓝) speaking(紫) thinking(紫)；麦克风音量驱动粒子/光效
type OrbState = 'idle' | 'listening' | 'recognizing' | 'speaking' | 'thinking'

const STATE_CFG: Record<OrbState, { amp: number; spd: number; r: [number, number, number]; g: [number, number, number]; b: [number, number, number] }> = {
  idle:        { amp: 0.01, spd: 0.5,  r: [90, 150, 210], g: [120, 190, 235], b: [200, 240, 255] },
  listening:   { amp: 0.08, spd: 1.0,  r: [200, 230, 255], g: [210, 240, 255], b: [235, 250, 255] },
  recognizing: { amp: 0.5,  spd: 3.0,  r: [20, 90, 200],   g: [80, 180, 250],  b: [190, 240, 255] },
  speaking:    { amp: 0.15, spd: 1.4,  r: [150, 110, 220], g: [120, 90, 200],  b: [240, 210, 255] },
  thinking:    { amp: 0.2,  spd: 1.6,  r: [110, 70, 220],  g: [90, 60, 200],   b: [230, 200, 255] },
}

interface Props {
  state: OrbState
  size?: number
  volume?: number     // 0~1 外部音量
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
    const TAU = Math.PI * 2

    // 托卡马克参数（按尺寸缩放，2026-08-06：加大比例让球体视觉填满 canvas）
    const R = size * 0.42    // 大半径（2026-08-07 放大，球体更饱满）
    const rTube = size * 0.19 // 小半径
    const PARTICLE_COUNT = size >= 100 ? 700 : (size >= 60 ? 200 : 60)
    const COIL_COUNT = 12
    const BAND_COUNT = 6

    // 等离子体粒子
    const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      theta: Math.random() * TAU,
      phi: Math.random() * TAU,
      speedTheta: (Math.random() - 0.5) * 0.02,
      speedPhi: (Math.random() - 0.5) * 0.025,
      size: Math.random() * 2 + 0.6,
      hue: Math.random() > 0.5 ? 195 : 275,
      sat: 80 + Math.random() * 20,
      light: 50 + Math.random() * 30,
      amp: Math.random() * 0.5 + 0.2,
      freq: Math.random() * 4 + 3,
      depth: 0, px: 0, py: 0, scale: 0,
    }))

    let rotY = 0, rotX = Math.PI / 2 // 2026-08-06：环面正面朝屏幕（正圆环，与光晕同心，无自转/无拖拽）
    let dragging = false, prevX = 0, prevY = 0
    let audioSmooth = 0


    // 3D 投影
    const project = (x: number, y: number, z: number) => {
      const cyR = Math.cos(rotY), syR = Math.sin(rotY)
      const x1 = x * cyR - z * syR
      const z1 = x * syR + z * cyR
      const cxR = Math.cos(rotX), sxR = Math.sin(rotX)
      const y1 = y * cxR - z1 * sxR
      const z2 = y * sxR + z1 * cxR
      const persp = 700
      const s = persp / (persp + z2 + 350)
      return { x: cx + x1 * s * (size / 400), y: cy - y1 * s * (size / 400), s, depth: z2 }
    }
    const torus = (theta: number, phi: number, rOff = 0) => ({
      x: (R + (rTube + rOff) * Math.cos(phi)) * Math.cos(theta),
      y: (rTube + rOff) * Math.sin(phi),
      z: (R + (rTube + rOff) * Math.cos(phi)) * Math.sin(theta),
    })

    const render = () => {
      const cfg = STATE_CFG[stateRef.current]
      const vol = Math.min(1, Math.max(0, volRef.current))
      t += 0.016 * cfg.spd
      audioSmooth = audioSmooth * 0.75 + vol * 0.25
      const aInt = audioSmooth

      ctx.clearRect(0, 0, size, size)

      // 呼吸脉动
      const breath = Math.sin(t * 2.2) * 0.1 + 1

      // ===== 多圈光圈（最外层） =====
      for (let i = 0; i < 4; i++) {
        ctx.beginPath()
        for (let th = 0; th <= TAU; th += 0.03) {
          const x = R * Math.cos(th)
          const z = R * Math.sin(th)
          const y = Math.sin(th * 6 + t * 2 + i) * 4
          const pp = project(x, y, z)
          if (th === 0) ctx.moveTo(pp.x, pp.y); else ctx.lineTo(pp.x, pp.y)
        }
        ctx.strokeStyle = `hsla(${200 + i * 12}, 80%, 60%, ${0.1 + aInt * 0.18})`
        ctx.lineWidth = 1.2 + i * 0.3
        ctx.shadowBlur = 12
        ctx.shadowColor = `hsla(${200 + i * 12}, 100%, 50%, 0.3)`
        ctx.stroke()
      }
      ctx.shadowBlur = 0

      // ===== 铜片捆绑带（6 组，每组 4 条细带 + 铆钉） =====
      for (let i = 0; i < BAND_COUNT; i++) {
        const thetaC = (i / BAND_COUNT) * TAU
        for (let s = 0; s < 4; s++) {
          const theta = thetaC + (s - 1.5) * 0.04
          const steps = 24
          ctx.beginPath()
          for (let j = 0; j <= steps; j++) {
            const th = theta + (j / steps - 0.5) * 0.3
            const p = torus(th, 0.5, rTube * 0.35)
            const pp = project(p.x, p.y, p.z)
            if (j === 0) ctx.moveTo(pp.x, pp.y); else ctx.lineTo(pp.x, pp.y)
          }
          const alpha = 0.4 + aInt * 0.25
          const hl = Math.sin(t * 3 + thetaC * 2) * 0.15 + 0.85
          ctx.strokeStyle = `rgba(220, 150, 50, ${alpha * hl})`
          ctx.lineWidth = 2.4 + s * 0.25
          ctx.shadowBlur = 6 + aInt * 8
          ctx.shadowColor = '#ff9944'
          ctx.stroke()
        }
        for (let side = -1; side <= 1; side += 2) {
          const p = torus(thetaC + side * 0.15, side * 0.5, rTube * 0.35)
          const pp = project(p.x, p.y, p.z)
          ctx.beginPath()
          ctx.arc(pp.x, pp.y, 2.5 + aInt * 1.5, 0, TAU)
          ctx.fillStyle = 'rgba(255, 210, 120, 0.9)'
          ctx.shadowBlur = 10
          ctx.shadowColor = '#ffaa44'
          ctx.fill()
        }
      }
      ctx.shadowBlur = 0

      // ===== 磁约束线圈 =====
      for (let i = 0; i < COIL_COUNT; i++) {
        const theta = (i / COIL_COUNT) * TAU
        const coilR = rTube + 4 + Math.sin(theta * 3 + t * 1.5) * 2
        ctx.beginPath()
        for (let phi = 0; phi <= TAU; phi += 0.1) {
          const sc = coilR / rTube
          const p = torus(theta, phi, rTube * (sc - 1))
          const pp = project(p.x, p.y, p.z)
          if (phi === 0) ctx.moveTo(pp.x, pp.y); else ctx.lineTo(pp.x, pp.y)
        }
        ctx.strokeStyle = `rgba(0, 210, 255, ${0.15 + aInt * 0.3})`
        ctx.lineWidth = 1.4
        ctx.shadowBlur = 6 + aInt * 10
        ctx.shadowColor = '#00d0ff'
        ctx.stroke()
      }
      ctx.shadowBlur = 0

      // ===== 内圈磁约束环 =====
      const innerR = R - rTube * 0.6
      ctx.beginPath()
      for (let th = 0; th <= TAU; th += 0.03) {
        const pp = project(innerR * Math.cos(th), 0, innerR * Math.sin(th))
        if (th === 0) ctx.moveTo(pp.x, pp.y); else ctx.lineTo(pp.x, pp.y)
      }
      ctx.strokeStyle = `rgba(170, 70, 255, ${0.3 + aInt * 0.45})`
      ctx.lineWidth = 2.5 + aInt * 4
      ctx.shadowBlur = 18 + aInt * 26
      ctx.shadowColor = '#a030ff'
      ctx.stroke()
      ctx.shadowBlur = 0

      // ===== 呼吸光晕（2026-08-07：收敛，紧贴球体不外溢）=====
      const glowR = R * 0.82 * breath
      const cp = project(0, 0, 0)
      const grad = ctx.createRadialGradient(cp.x, cp.y, R * 0.2, cp.x, cp.y, glowR)
      grad.addColorStop(0, `rgba(${cfg.r[1]},${cfg.g[1]},${cfg.b[1]},${(0.18 + aInt * 0.3) * breath * 0.42})`)
      grad.addColorStop(0.6, `rgba(200, 150, 60, ${0.08 * breath})`)
      grad.addColorStop(0.85, `rgba(120, 40, 255, ${0.1 * breath})`)
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grad
      ctx.beginPath(); ctx.arc(cp.x, cp.y, glowR, 0, TAU); ctx.fill()

      // ===== 等离子体粒子 =====
      for (const p of particles) {
        p.theta += p.speedTheta * (1 + aInt * 3)
        p.phi += p.speedPhi * (1 + aInt * 2)
        const pert = Math.sin(p.theta * p.freq + t * 3) * p.amp * (6 + aInt * 40)
        const tp = torus(p.theta, p.phi, pert)
        const pp = project(tp.x, tp.y, tp.z)
        p.px = pp.x; p.py = pp.y; p.depth = pp.depth; p.scale = pp.s
      }
      particles.sort((a, b) => b.depth - a.depth)
      for (const p of particles) {
        const alpha = Math.min(0.9, Math.max(0.15, p.scale - 0.1))
        const hue = (p.hue + aInt * 50) % 360
        const light = p.light + aInt * 35
        const ps = p.size * p.scale * (0.8 + aInt * 1.5)
        ctx.beginPath()
        ctx.arc(p.px, p.py, ps, 0, TAU)
        ctx.fillStyle = `hsla(${hue}, ${p.sat}%, ${light}%, ${alpha})`
        if (aInt > 0.35 || p.size > 1.6) {
          ctx.shadowBlur = 6 + aInt * 18
          ctx.shadowColor = `hsla(${hue}, 100%, 60%, 0.7)`
        } else {
          ctx.shadowBlur = 2
          ctx.shadowColor = `hsla(${hue}, 100%, 50%, 0.3)`
        }
        ctx.fill()
      }
      ctx.shadowBlur = 0
      // ===== 中心能量核心 =====
      const coreInt = 0.5 + aInt * 0.5 + breath * 0.4
      const coreR = size * 0.1 * breath
      const cg = ctx.createRadialGradient(cp.x, cp.y, 0, cp.x, cp.y, coreR)
      cg.addColorStop(0, `rgba(255,255,255,${Math.min(1, coreInt)})`)
      cg.addColorStop(0.35, `rgba(${cfg.r[1]},${cfg.g[1]},${cfg.b[1]},${coreInt * 0.85})`)
      cg.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = cg
      ctx.beginPath(); ctx.arc(cp.x, cp.y, coreR, 0, TAU); ctx.fill()

      // ===== 声纹波动环（2026-08-07：语音时由内向外扩散发光）=====
      if (aInt > 0.03) {
        const waves = 3
        for (let i = 0; i < waves; i++) {
          const phase = (t * 1.4 + i / waves) % 1
          const wr = coreR * 0.6 + phase * (R * 1.3)
          const alpha = (1 - phase) * (0.22 + aInt * 0.5)
          if (alpha < 0.02) continue
          ctx.beginPath()
          ctx.arc(cp.x, cp.y, wr, 0, TAU)
          ctx.strokeStyle = `hsla(${200 + i * 26}, 92%, 66%, ${alpha})`
          ctx.lineWidth = 1.2 + (1 - phase) * 2.4
          ctx.shadowBlur = 8 + aInt * 16
          ctx.shadowColor = '#00d0ff'
          ctx.stroke()
        }
        ctx.shadowBlur = 0
      }

      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [size])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size }}
    />
  )
}
