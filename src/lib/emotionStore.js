// Stage 6 — M27: emotion mirroring store.
// observe_user_emotion tool calls from Gemini Live land here. The avatar
// subscribes via useEmotion() and nudges morph targets + halo tint.
//
// We keep the surface tiny on purpose: the LLM already has the hard part
// (reading the face from the multimodal stream). Our client only has to
// smooth the state and decay it back to neutral so the avatar doesn't
// freeze in one expression forever.

import { useEffect, useState } from 'react'

// Map emotion → suggested avatar blendshape weights (0..1) + halo hex.
// Keys match RPM/ARKit standard morph names where possible; we probe for
// alternatives in the avatar renderer, so not every mesh needs every key.
const EMOTION_PROFILES = {
  neutral:   { morphs: {},                                                          halo: '#a78bfa' },
  happy:     { morphs: { mouthSmile: 0.42, mouthSmileLeft: 0.42, mouthSmileRight: 0.42, cheekSquintLeft: 0.25, cheekSquintRight: 0.25 }, halo: '#fcd34d' },
  sad:       { morphs: { mouthFrownLeft: 0.30, mouthFrownRight: 0.30, browDownLeft: 0.20, browDownRight: 0.20 },                        halo: '#60a5fa' },
  surprised: { morphs: { eyeWideLeft: 0.55, eyeWideRight: 0.55, browInnerUp: 0.45, jawOpen: 0.18 },                                      halo: '#f0abfc' },
  angry:     { morphs: { browDownLeft: 0.45, browDownRight: 0.45, mouthFrownLeft: 0.20, mouthFrownRight: 0.20 },                        halo: '#f87171' },
  tired:     { morphs: { eyesClosed: 0.35, eyeBlinkLeft: 0.20, eyeBlinkRight: 0.20 },                                                   halo: '#9ca3af' },
  focused:   { morphs: { browDownLeft: 0.18, browDownRight: 0.18, mouthPressLeft: 0.18, mouthPressRight: 0.18 },                        halo: '#a78bfa' },
  confused:  { morphs: { browInnerUp: 0.30, browOuterUpLeft: 0.20, mouthLeft: 0.10 },                                                   halo: '#fbbf24' },
  anxious:   { morphs: { browInnerUp: 0.22, mouthPressLeft: 0.25, mouthPressRight: 0.25, eyeSquintLeft: 0.15, eyeSquintRight: 0.15 },   halo: '#fb923c' },
}

const DECAY_MS = 6000 // how long a detected emotion lasts before returning to neutral

let _state = { state: 'neutral', intensity: 0, cue: null, profile: EMOTION_PROFILES.neutral, at: 0 }
const _listeners = new Set()

function notify() { for (const l of _listeners) l(_state) }

export function setEmotion({ state, intensity, cue } = {}) {
  const profileKey = (state || 'neutral').toLowerCase()
  const profile = EMOTION_PROFILES[profileKey] || EMOTION_PROFILES.neutral
  const clampedIntensity = Math.max(0, Math.min(1, Number(intensity) || 0))
  _state = {
    state: profileKey,
    intensity: clampedIntensity,
    cue: cue || null,
    profile,
    at: Date.now(),
  }
  notify()
  return _state
}

export function getEmotion() { return _state }

export function subscribeEmotion(fn) {
  _listeners.add(fn)
  fn(_state)
  return () => _listeners.delete(fn)
}

export function useEmotion() {
  const [snap, setSnap] = useState(_state)
  useEffect(() => subscribeEmotion(setSnap), [])
  useEffect(() => {
    if (snap.state === 'neutral') return
    const elapsed = Date.now() - snap.at
    const remaining = DECAY_MS - elapsed
    if (remaining <= 0) { setEmotion({ state: 'neutral', intensity: 0 }); return }
    const t = setTimeout(() => setEmotion({ state: 'neutral', intensity: 0 }), remaining)
    return () => clearTimeout(t)
  }, [snap.at, snap.state])
  return snap
}

export { EMOTION_PROFILES, DECAY_MS }
