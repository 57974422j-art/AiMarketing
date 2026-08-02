'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

type HotItem = { title: string; hot?: string; url?: string }
type HotSource = { source: string; region: 'cn' | 'global'; items: HotItem[] }

// 各热榜源的近似经纬度（用于地球表面投影打点）
const SOURCE_GEO: Record<string, { lat: number; lng: number }> = {
  微博: { lat: 39.9, lng: 116.4 },
  抖音: { lat: 39.9, lng: 116.4 },
  知乎: { lat: 31.2, lng: 121.5 },
  小红书: { lat: 31.2, lng: 121.5 },
  今日头条: { lat: 39.9, lng: 116.4 },
  百度热搜: { lat: 39.9, lng: 116.4 },
  HackerNews: { lat: 37.4, lng: -122.1 },
  Reddit: { lat: 37.8, lng: -122.4 },
}

function latLngToVec3(lat: number, lng: number, r: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lng + 180) * (Math.PI / 180)
  const x = -r * Math.sin(phi) * Math.cos(theta)
  const z = r * Math.sin(phi) * Math.sin(theta)
  const y = r * Math.cos(phi)
  return new THREE.Vector3(x, y, z)
}

export default function GlobeTrends({ sources }: { sources: HotSource[] }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<HotSource | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const globeRef = useRef<THREE.Group | null>(null)
  const markersRef = useRef<{ mesh: THREE.Mesh; source: HotSource; base: number }[]>([])
  const rafRef = useRef<number>(0)
  const activeRef = useRef<HotSource | null>(null)

  // 渲染主流程
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const width = mount.clientWidth
    const height = mount.clientHeight || 320

    const scene = new THREE.Scene()
    sceneRef.current = scene
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
    camera.position.set(0, 0, 3.2)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const globe = new THREE.Group()
    globeRef.current = globe
    scene.add(globe)

    // 点阵地球（免贴图）
    const R = 1
    const sphereGeo = new THREE.SphereGeometry(R, 48, 48)
    const pos = sphereGeo.attributes.position
    const dots: number[] = []
    const dotCount = pos.count
    for (let i = 0; i < dotCount; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i)
      // 只保留表层点
      dots.push(v.x, v.y, v.z)
    }
    const dotGeo = new THREE.BufferGeometry()
    dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(dots, 3))
    const dotMat = new THREE.PointsMaterial({ color: 0x3a5a8c, size: 0.018, transparent: true, opacity: 0.55 })
    globe.add(new THREE.Points(dotGeo, dotMat))

    // 经纬线框
    const wire = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.002, 24, 18),
      new THREE.MeshBasicMaterial({ color: 0x1e3a5f, wireframe: true, transparent: true, opacity: 0.18 })
    )
    globe.add(wire)

    // 高光大气圈
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.06, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0x2b6cb0, transparent: true, opacity: 0.06, side: THREE.BackSide })
    )
    globe.add(glow)

    // 热点标记
    markersRef.current = []
    sources.forEach((src) => {
      const geo = SOURCE_GEO[src.source]
      if (!geo) return
      const isCN = src.region === 'cn'
      const color = isCN ? 0xff9f1c : 0x38bdf8
      const vec = latLngToVec3(geo.lat, geo.lng, R * 1.01)
      const markerGeo = new THREE.SphereGeometry(0.035 + Math.min(src.items.length, 12) * 0.002, 12, 12)
      const markerMat = new THREE.MeshBasicMaterial({ color })
      const mesh = new THREE.Mesh(markerGeo, markerMat)
      mesh.position.copy(vec)
      globe.add(mesh)
      markersRef.current.push({ mesh, source: src, base: vec.length() })
    })

    // 射线拾取
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()
    const onClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObjects(markersRef.current.map((m) => m.mesh))
      if (hits.length) {
        const hit = markersRef.current.find((m) => m.mesh === hits[0].object)
        if (hit) {
          activeRef.current = hit.source
          setActive(hit.source)
        }
      }
    }
    renderer.domElement.addEventListener('click', onClick)

    // 动画循环
    let t = 0
    const animate = () => {
      t += 0.005
      globe.rotation.y += 0.0025
      // 标记脉冲
      markersRef.current.forEach((m, i) => {
        const s = 1 + Math.sin(t * 3 + i) * 0.12
        m.mesh.scale.setScalar(s)
        const mat = m.mesh.material as THREE.MeshBasicMaterial
        mat.color.set(m.source.region === 'cn' ? 0xff9f1c : 0x38bdf8)
      })
      renderer.render(scene, camera)
      rafRef.current = requestAnimationFrame(animate)
    }
    animate()

    const onResize = () => {
      const w = mount.clientWidth
      const h = mount.clientHeight || 320
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', onResize)
      renderer.domElement.removeEventListener('click', onClick)
      renderer.dispose()
      dotGeo.dispose()
      wire.geometry.dispose()
      glow.geometry.dispose()
      markersRef.current.forEach((m) => {
        m.mesh.geometry.dispose()
        ;(m.mesh.material as THREE.Material).dispose()
      })
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
  }, [sources])

  return (
    <div className="relative w-full">
      <div
        ref={mountRef}
        className="w-full h-[320px] rounded-2xl border border-white/10 bg-[#070710] overflow-hidden cursor-pointer"
        style={{ boxShadow: 'inset 0 0 60px rgba(43,108,176,0.15)' }}
      />
      <div className="absolute top-3 left-3 flex items-center gap-3 text-[10px]">
        <span className="flex items-center gap-1 text-gray-400">
          <span className="w-2 h-2 rounded-full bg-orange-400" /> 国内
        </span>
        <span className="flex items-center gap-1 text-gray-400">
          <span className="w-2 h-2 rounded-full bg-sky-400" /> 全球
        </span>
      </div>
      <p className="absolute bottom-2 right-3 text-[9px] text-gray-600">点击光点查看该平台热点</p>

      {active && (
        <div className="absolute inset-x-3 bottom-3 rounded-xl border border-white/10 bg-black/70 backdrop-blur-md p-3 animate-in fade-in">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${active.region === 'cn' ? 'bg-orange-400' : 'bg-sky-400'}`} />
              {active.source}
              <span className="text-[9px] text-gray-500">· {active.region === 'cn' ? '国内' : '全球'}</span>
            </span>
            <button onClick={() => { setActive(null); activeRef.current = null }} className="text-[10px] text-gray-500 hover:text-gray-300">
              ✕
            </button>
          </div>
          <ul className="space-y-1 max-h-28 overflow-y-auto">
            {active.items.slice(0, 8).map((it, i) => (
              <li key={i} className="text-[10px] text-gray-300 leading-snug truncate">· {it.title}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
