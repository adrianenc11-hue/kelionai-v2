import { useEffect, useRef, useState, useCallback } from 'react'

export function useLipSync(audioRef) {
  const [mouthOpen, setMouthOpen] = useState(0)
  const ctxRef = useRef(null)
  const analyzerRef = useRef(null)
  const sourceRef = useRef(null)
  const animationRef = useRef(null)

  const startAnalyzing = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return

    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    const ctx = ctxRef.current
    if (ctx.state === 'suspended') ctx.resume()

    if (!sourceRef.current) {
      const source = ctx.createMediaElementSource(audio)
      const analyzer = ctx.createAnalyser()
      analyzer.fftSize = 256
      source.connect(analyzer)
      analyzer.connect(ctx.destination)
      sourceRef.current = source
      analyzerRef.current = analyzer
    }

    const dataArray = new Uint8Array(analyzerRef.current.frequencyBinCount)

    const update = () => {
      if (!analyzerRef.current) return
      analyzerRef.current.getByteFrequencyData(dataArray)
      let sum = 0
      for (let i = 0; i < 20; i++) sum += dataArray[i]
      const average = sum / 20
      let value = (average - 30) / 120
      value = Math.max(0, Math.min(1, value))
      setMouthOpen(value)
      animationRef.current = requestAnimationFrame(update)
    }
    update()
  }, [audioRef])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onPlay = () => startAnalyzing()
    const onEnded = () => {
      cancelAnimationFrame(animationRef.current)
      setMouthOpen(0)
    }

    audio.addEventListener('play', onPlay)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('pause', onEnded)

    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('pause', onEnded)
      cancelAnimationFrame(animationRef.current)
    }
  }, [audioRef, startAnalyzing])

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animationRef.current)
      if (ctxRef.current && ctxRef.current.state !== 'closed') {
        ctxRef.current.close()
      }
    }
  }, [])

  return mouthOpen
}
