import { useMemo } from 'react'
import * as THREE from 'three'

// ───── Luxury studio decor — NYC skyline through panoramic windows ─────
// Adrian asked to swap the old animated color panels for a night-time New
// York skyline seen through floor-to-ceiling windows. We also killed the
// breathing-light animation because it was tiring.
function useNYCSkylineTexture() {
  return useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 2048
    canvas.height = 1024
    const ctx = canvas.getContext('2d')
    // Deep-night sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, 1024)
    sky.addColorStop(0, '#04060e')
    sky.addColorStop(0.45, '#0b1029')
    sky.addColorStop(0.72, '#1a1236')
    sky.addColorStop(1, '#2a1640')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, 2048, 1024)
    // Stars
    for (let i = 0; i < 140; i++) {
      const s = 0.3 + Math.random() * 0.6
      ctx.fillStyle = `rgba(255,255,255,${s})`
      ctx.fillRect(Math.random() * 2048, Math.random() * 350, 1, 1)
    }
    // Distant back layer of buildings
    let x = 0
    while (x < 2048) {
      const w = 50 + Math.random() * 70
      const h = 150 + Math.random() * 180
      const y = 1024 - h
      ctx.fillStyle = `rgb(${8 + Math.random() * 6}, ${10 + Math.random() * 8}, ${22 + Math.random() * 12})`
      ctx.fillRect(x, y, w, h)
      x += w
    }
    // Front layer — taller skyscrapers with bright windows
    x = 0
    while (x < 2048) {
      const w = 60 + Math.random() * 140
      const h = 280 + Math.random() * 460
      const y = 1024 - h
      ctx.fillStyle = `rgb(${14 + Math.random() * 8}, ${16 + Math.random() * 10}, ${28 + Math.random() * 14})`
      ctx.fillRect(x, y, w, h)
      // Antenna / spire on some taller ones
      if (h > 550 && Math.random() < 0.4) {
        ctx.fillStyle = '#1a1e32'
        ctx.fillRect(x + w / 2 - 1, y - 40 - Math.random() * 60, 2, 50)
      }
      // Windows grid
      const cellW = 10
      const cellH = 14
      for (let wx = x + 6; wx < x + w - 6; wx += cellW) {
        for (let wy = y + 10; wy < 1018; wy += cellH) {
          if (Math.random() < 0.52) {
            const warm = Math.random() < 0.65
            const flicker = 0.55 + Math.random() * 0.45
            ctx.fillStyle = warm
              ? `rgba(250, 215, 140, ${flicker})`
              : `rgba(170, 200, 255, ${flicker})`
            ctx.fillRect(wx, wy, 4, 6)
          }
        }
      }
      x += w
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    return tex
  }, [])
}

export default function StudioDecor() {
  const skylineTex = useNYCSkylineTexture()
  // Four windows divided by vertical mullions.
  const windowCount = 4
  const wallWidth = 12
  const wallHeight = 5.4
  const mullionW = 0.08
  const windowW = (wallWidth - mullionW * (windowCount + 1)) / windowCount

  return (
    <group>
      {/* Full back wall with the NYC skyline showing through */}
      <mesh position={[0, 0.4, -4.6]}>
        <planeGeometry args={[wallWidth, wallHeight]} />
        <meshBasicMaterial map={skylineTex} toneMapped={false} />
      </mesh>

      {/* Vertical mullions (window frames) over the wall */}
      {Array.from({ length: windowCount + 1 }).map((_, i) => {
        const x = -wallWidth / 2 + i * (windowW + mullionW) + mullionW / 2
        return (
          <mesh key={`mul-${i}`} position={[x, 0.4, -4.55]}>
            <planeGeometry args={[mullionW, wallHeight]} />
            <meshStandardMaterial color={'#0a0b12'} roughness={0.6} metalness={0.35} />
          </mesh>
        )
      })}

      {/* Horizontal top and bottom frames */}
      <mesh position={[0, 0.4 + wallHeight / 2 - 0.05, -4.55]}>
        <planeGeometry args={[wallWidth, 0.14]} />
        <meshStandardMaterial color={'#0a0b12'} roughness={0.6} metalness={0.35} />
      </mesh>
      <mesh position={[0, 0.4 - wallHeight / 2 + 0.05, -4.55]}>
        <planeGeometry args={[wallWidth, 0.14]} />
        <meshStandardMaterial color={'#0a0b12'} roughness={0.6} metalness={0.35} />
      </mesh>

      {/* Ceiling strip removed — Adrian flagged the warm #ffb27a line as
          a distracting "brown bar" at the top of the stage. */}

      {/* Cool floor LED strip */}
      <mesh position={[0, -1.9, -4.5]}>
        <planeGeometry args={[10.5, 0.04]} />
        <meshBasicMaterial color={'#60a5fa'} toneMapped={false} />
      </mesh>

      {/* The in-scene 3D presentation monitor was removed so that the stage
          stays clean when no content is loaded. All monitor payloads now
          render exclusively in the half-page <MonitorOverlay/> (left 50vw
          on desktop, bottom 55vh on mobile). An empty dark bezel sitting
          next to the avatar at all times was confusing — users expected it
          to be the promised half-page screen. */}

      {/* Reflective floor */}
      <mesh position={[0, -1.65, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial
          color={'#05060a'}
          metalness={0.92}
          roughness={0.18}
        />
      </mesh>

      {/* Subtle ground glow under avatar — follows avatar's new offset. */}
      <mesh position={[1.6, -1.64, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.8, 64]} />
        <meshBasicMaterial color={'#7c3aed'} transparent opacity={0.18} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      {/* Key spotlights on avatar */}
      <spotLight
        position={[4, 5, 4]}
        angle={0.35}
        penumbra={0.6}
        intensity={1.8}
        color={'#fef3c7'}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <spotLight
        position={[-4, 4, 3]}
        angle={0.4}
        penumbra={0.7}
        intensity={1.2}
        color={'#a78bfa'}
      />
      <spotLight
        position={[1.6, 4, -3]}
        angle={0.6}
        penumbra={0.8}
        intensity={0.9}
        color={'#60a5fa'}
        target-position={[1.6, 0, 0]}
      />
      {/* Rim light from behind */}
      <pointLight position={[0, 1.5, -3]} intensity={0.6} color={'#c084fc'} />

      {/* Ambient fill */}
      <ambientLight intensity={0.22} color={'#3b2a6b'} />
    </group>
  )
}
