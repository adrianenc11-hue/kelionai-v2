import { useRef, useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'

// ───── Camera: responsive framing + slight parallax on pointer ─────
// Adrian: "trebuie sa aplici in funtie de tipul monitorului afisat ,
// telefon tableta ,zoom corect sa incadreze pagina corect pe verticala
// si daca il pui orizontal pe orizontala". The stage was authored for a
// wide desktop (aspect ≈ 1.6+) with a 36° fov; on a phone in portrait
// (aspect ≈ 0.45) the avatar at x=1.6 falls off the right edge and the
// monitor clips on the left. We now derive camera fov, z-distance, and
// horizontal offset from the live viewport aspect so the same scene
// stays framed — "pe verticala" in portrait, "pe orizontala" in
// landscape — without the user having to scroll or pinch-zoom.
//
// The parallax-on-pointermove stays on pointer devices only; on touch
// devices (phones / tablets) pointermove never fires so the effect is
// a no-op by design.
function computeFrame(aspect) {
  // Bands chosen empirically against the avatar at [1.6,0,0] and the
  // wall monitor at ~[-1.4,0.8,-1]. Higher fov + farther z + smaller
  // lookAt-x = more of both sides visible on narrow viewports.
  if (aspect >= 1.45) {
    // Desktop / landscape tablet — original tuning.
    return { fov: 36, z: 4.2, x: 0.3, lookAtX: 0.3, lookAtY: 0.4 }
  }
  if (aspect >= 1.05) {
    // Square-ish / small landscape laptop.
    return { fov: 42, z: 4.8, x: 0.5, lookAtX: 0.5, lookAtY: 0.5 }
  }
  if (aspect >= 0.75) {
    // Tablet portrait / large phone landscape.
    return { fov: 50, z: 5.6, x: 0.9, lookAtX: 0.9, lookAtY: 0.55 }
  }
  // Phone portrait (< 0.75) — center on the avatar, pull way back.
  return { fov: 58, z: 6.8, x: 1.3, lookAtX: 1.3, lookAtY: 0.6 }
}

export default function CameraRig() {
  const { camera, size } = useThree()
  const target = useRef({ x: 0, y: 0 })
  useEffect(() => {
    const onMove = (e) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1
      const ny = (e.clientY / window.innerHeight) * 2 - 1
      target.current = { x: nx * 0.15, y: -ny * 0.08 }
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])
  // Recompute frame constants when the viewport resizes (orientation
  // change, window resize, dev-tools toggle). `size` is already reactive
  // in react-three-fiber; no manual listener needed.
  const frame = useMemo(() => computeFrame(size.width / Math.max(1, size.height)), [size.width, size.height])
  // Apply fov once per frame-config change. Must update the projection
  // matrix or the fov change has no visible effect.
  useEffect(() => {
    if (camera.isPerspectiveCamera) {
      camera.fov = frame.fov
      camera.updateProjectionMatrix()
    }
  }, [camera, frame.fov])
  useFrame(() => {
    camera.position.x += (frame.x + target.current.x - camera.position.x) * 0.03
    camera.position.y += (0.2 + target.current.y - camera.position.y) * 0.03
    camera.position.z += (frame.z - camera.position.z) * 0.03
    camera.lookAt(frame.lookAtX, frame.lookAtY, 0)
  })
  return null
}
