import { useEffect, useRef, useState } from 'react'

/**
 * useLipSync hook
 * Analyzes an audio source and returns a value representing the current "openness" of the mouth.
 */
export function useLipSync(audioRef) {
  const [mouthOpen, setMouthOpen] = useState(0)
  const analyzerRef = useRef(null)
  const animationRef = useRef(null)

  useEffect(() => {
    if (!audioRef.current) return

    const audioContext = new (window.AudioContext || window.webkitAudioContext)()
    const analyzer = audioContext.createAnalyser()
    analyzer.fftSize = 256
    const source = audioContext.createMediaElementSource(audioRef.current)
    source.connect(analyzer)
    analyzer.connect(audioContext.destination)
    analyzerRef.current = analyzer

    const dataArray = new Uint8Array(analyzer.frequencyBinCount)

    const update = () => {
      if (!analyzerRef.current) return
      analyzerRef.current.getByteFrequencyData(dataArray)
      
      // Calculate average frequency in the typical voice range
      let sum = 0
      for (let i = 0; i < 20; i++) {
        sum += dataArray[i]
      }
      const average = sum / 20
      
      // Map average to 0-1 range for mouth openness
      // Threshold 30 to ignore background noise, max 150 for full open
      let value = (average - 30) / 120
      value = Math.max(0, Math.min(1, value))
      
      setMouthOpen(value)
      animationRef.current = requestAnimationFrame(update)
    }

    update()

    return () => {
      cancelAnimationFrame(animationRef.current)
      if (audioContext.state !== 'closed') {
        audioContext.close()
      }
    }
  }, [audioRef])

  return mouthOpen
}
