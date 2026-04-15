import { useEffect, useRef, useState, useCallback } from 'react'

export function useLipSync(audioRef) {
  const [mouthOpen, setMouthOpen] = useState(0)
  const ctxRef = useRef(null)
  const analyzerRef = useRef(null)
  const sourceRef = useRef(null)
  const animationRef = useRef(null)
  const lastStreamRef = useRef(null)

  const startAnalyzing = useCallback((stream) => {
    if (!stream) return

    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    const ctx = ctxRef.current
    if (ctx.state === 'suspended') ctx.resume()

    if (sourceRef.current) {
      sourceRef.current.disconnect()
      sourceRef.current = null
    }

    const analyzer = ctx.createAnalyser()
    analyzer.fftSize = 256
    analyzerRef.current = analyzer

    const source = ctx.createMediaStreamSource(stream)
    source.connect(analyzer)
    sourceRef.current = source
    lastStreamRef.current = stream

    const dataArray = new Uint8Array(analyzer.frequencyBinCount)

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
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onPlay = () => {
      const stream = audio.srcObject
      if (stream && stream !== lastStreamRef.current) {
        startAnalyzing(stream)
      } else if (stream) {
        const ctx = ctxRef.current
        if (ctx && ctx.state === 'suspended') ctx.resume()
        if (analyzerRef.current && !animationRef.current) {
          const dataArray = new Uint8Array(analyzerRef.current.frequencyBinCount)
          const update = () => {
            if (!analyzerRef.current) return
            analyzerRef.current.getByteFrequencyData(dataArray)
            let sum = 0
            for (let i = 0; i < 20; i++) sum += dataArray[i]
            const avg = sum / 20
            let v = (avg - 30) / 120
            setMouthOpen(Math.max(0, Math.min(1, v)))
            animationRef.current = requestAnimationFrame(update)
          }
          update()
        }
      }
    }

    const onEnded = () => {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
      setMouthOpen(0)
    }

    audio.addEventListener('play', onPlay)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('pause', onEnded)

    const interval = setInterval(() => {
      const stream = audio.srcObject
      if (stream && stream !== lastStreamRef.current) {
        startAnalyzing(stream)
      }
    }, 500)

    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('pause', onEnded)
      clearInterval(interval)
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
  }, [audioRef, startAnalyzing])

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animationRef.current)
      if (sourceRef.current) sourceRef.current.disconnect()
      if (ctxRef.current && ctxRef.current.state !== 'closed') {
        ctxRef.current.close()
      }
    }
  }, [])

  return mouthOpen
}
