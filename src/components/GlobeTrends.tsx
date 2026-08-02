'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

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

// 程序生成地球海洋/陆地纹理（NASA 在线贴图加载失败时的本地兜底）
function makeEarthTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 1024; c.height = 512
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 512)
  g.addColorStop(0, '#0a2a4a'); g.addColorStop(0.5, '#0d3b66'); g.addColorStop(1, '#0a2a4a')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 1024, 512)
  const blobs = [
    [180, 180, 90, '#1f6f4a'], [260, 300, 70, '#2a7d54'], [520, 200, 110, '#237a4f'],
    [560, 330, 80, '#2f8a5a'], [760, 240, 95, '#1f6f4a'], [820, 360, 60, '#2a7d54'],
    [400, 120, 50, '#3a8a60'], [680, 400, 70, '#237a4f'],
  ]
  blobs.forEach(([x, y, r, col]) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill() })
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// 加载 NASA Blue Marble 真实贴图（three-globe 官方示例 CDN），失败回退本地纹理
function loadEarthTexture(fallback: THREE.Texture): THREE.Texture {
  const loader = new THREE.TextureLoader()
  loader.setCrossOrigin('anonymous')
  const tex = loader.load(
    'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg',
    (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4 },
    undefined,
    () => { /* 加载失败：保留 fallback 本地纹理 */ }
  )
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export default function GlobeTrends({ sources }: { sources: HotSource[] }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<HotSource | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const globeRef = useRef<THREE.Group | null>(null)
  const cloudRef = useRef<THREE.Mesh | null>(null)
  const controlsRef = useRef<any>(null)
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

    // 光照（降低环境光以凸显 NASA 贴图细节，方向光打出立体感）
    const ambient = new THREE.AmbientLight(0xffffff, 0.55)
    scene.add(ambient)
    const dir = new THREE.DirectionalLight(0xffffff, 0.9)
    dir.position.set(2.5, 1.5, 2)
    scene.add(dir)

    const globe = new THREE.Group()
    globeRef.current = globe
    // 初始朝向：亚洲（中国）居中面对相机，确保国内平台光点默认可见
    globe.rotation.y = -Math.PI / 2
    scene.add(globe)

    const R = 1
    // 实体地球（NASA Blue Marble 真实贴图，失败回退本地纹理）
    const earthMat = new THREE.MeshPhongMaterial({
      map: loadEarthTexture(makeEarthTexture()),
      shininess: 6,
      specular: new THREE.Color(0x112233),
    })
    const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 48), earthMat)
    globe.add(earth)

    // 经纬线框（BaiLongma 网格观感）
    const wire = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.002, 36, 24),
      new THREE.MeshBasicMaterial({ color: 0x1e3a5f, wireframe: true, transparent: true, opacity: 0.12 })
    )
    globe.add(wire)

    // 云层（半透明，独立缓慢自转）
    const cloudTex = (() => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 256
      const cx = c.getContext('2d')!
      cx.fillStyle = 'rgba(255,255,255,0)'; cx.fillRect(0, 0, 512, 256)
      for (let i = 0; i < 40; i++) {
        const x = Math.random() * 512, y = Math.random() * 256, r = 12 + Math.random() * 36
        const rg = cx.createRadialGradient(x, y, 0, x, y, r)
        rg.addColorStop(0, 'rgba(255,255,255,0.5)'); rg.addColorStop(1, 'rgba(255,255,255,0)')
        cx.fillStyle = rg; cx.beginPath(); cx.arc(x, y, r, 0, Math.PI * 2); cx.fill()
      }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
    })()
    const cloud = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.015, 48, 36),
      new THREE.MeshPhongMaterial({ map: cloudTex, transparent: true, opacity: 0.35, depthWrite: false })
    )
    cloudRef.current = cloud
    globe.add(cloud)

    // 高光大气圈
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.08, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0x2b6cb0, transparent: true, opacity: 0.08, side: THREE.BackSide })
    )
    globe.add(glow)

    // 热点标记
    markersRef.current = []
    sources.forEach((src) => {
      const geo = SOURCE_GEO[src.source]
      if (!geo) return
      const isCN = src.region === 'cn'
      const color = isCN ? 0xff9f1c : 0x38bdf8
      const vec = latLngToVec3(geo.lat, geo.lng, R * 1.02)
      const markerGeo = new THREE.SphereGeometry(0.035 + Math.min(src.items.length, 12) * 0.002, 12, 12)
      const markerMat = new THREE.MeshBasicMaterial({ color })
      const mesh = new THREE.Mesh(markerGeo, markerMat)
      mesh.position.copy(vec)
      globe.add(mesh)
      markersRef.current.push({ mesh, source: src, base: vec.length() })
    })

    // OrbitControls：拖拽旋转 + 滚轮缩放
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.rotateSpeed = 0.5
    controls.minDistance = 1.6
    controls.maxDistance = 6
    controls.enablePan = false
    controlsRef.current = controls

    // 射线拾取（点光点看榜单）
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
      globe.rotation.y += 0.0008
      if (cloudRef.current) cloudRef.current.rotation.y += 0.0004
      markersRef.current.forEach((m, i) => {
        const s = 1 + Math.sin(t * 3 + i) * 0.12
        m.mesh.scale.setScalar(s)
        const mat = m.mesh.material as THREE.MeshBasicMaterial
        mat.color.set(m.source.region === 'cn' ? 0xff9f1c : 0x38bdf8)
      })
      controls.update()
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
      controls.dispose()
      renderer.dispose()
      earth.geometry.dispose(); earthMat.map?.dispose(); earthMat.dispose()
      wire.geometry.dispose(); (wire.material as THREE.Material).dispose()
      cloud.geometry.dispose(); (cloud.material as THREE.Material).dispose(); cloudTex.dispose()
      glow.geometry.dispose(); (glow.material as THREE.Material).dispose()
      markersRef.current.forEach((m) => {
        m.mesh.geometry.dispose()
        ;(m.mesh.material as THREE.Material).dispose()
      })
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
  }, [sources])

  return (
    <div className="relative w-full h-full">
      <div
        ref={mountRef}
        className="w-full h-full rounded-2xl border border-white/10 bg-[#070710] overflow-hidden cursor-grab active:cursor-grabbing"
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
