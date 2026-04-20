import { useControls, folder, Leva } from 'leva'
import { TUNING, updateTuning, isTuningEnabled } from '../lib/tuning'

// Debug-only avatar / lip-sync tuning panel.
//
// Gated on `?debug=1` (or `?tune=1`) so it never ships to end users. Every
// slider writes its value straight into the mutable `TUNING` singleton that
// `KelionStage` and `lipSync` read on every animation frame, so changes are
// applied live without a re-render.
//
// When Adrian is happy with a combination he can copy the values out of the
// panel's collapsed JSON and paste them as the new defaults in
// `src/lib/tuning.js`.

/**
 * Internal component — always assumes the debug flag is on. Rules of hooks
 * mean `useControls` must run unconditionally, so the parent `TuningPanel`
 * gates the mount of this component on `isTuningEnabled()`.
 */
function TuningPanelInner() {
  useControls(
    {
      'Avatar body': folder({
        avatarBaseYaw: {
          value: TUNING.avatarBaseYaw,
          min: -0.35, max: 0.35, step: 0.005,
          label: 'Idle yaw (rad)',
          onChange: (v) => updateTuning({ avatarBaseYaw: v }),
        },
        avatarPresentingYaw: {
          value: TUNING.avatarPresentingYaw,
          min: -0.35, max: 0.35, step: 0.005,
          label: 'Presenting yaw Δ (rad)',
          onChange: (v) => updateTuning({ avatarPresentingYaw: v }),
        },
      }),
      'Lip-sync amplitude': folder({
        jawAmplitude: {
          value: TUNING.jawAmplitude,
          min: 0, max: 0.45, step: 0.01,
          label: 'Jaw bone amp',
          onChange: (v) => updateTuning({ jawAmplitude: v }),
        },
        morphAmplitude: {
          value: TUNING.morphAmplitude,
          min: 0, max: 1.0, step: 0.01,
          label: 'Viseme morph amp',
          onChange: (v) => updateTuning({ morphAmplitude: v }),
        },
      }),
      'Lip-sync envelope': folder({
        lipAttack: {
          value: TUNING.lipAttack,
          min: 0.1, max: 0.9, step: 0.01,
          label: 'Attack',
          onChange: (v) => updateTuning({ lipAttack: v }),
        },
        lipRelease: {
          value: TUNING.lipRelease,
          min: 0.01, max: 0.35, step: 0.005,
          label: 'Release',
          onChange: (v) => updateTuning({ lipRelease: v }),
        },
        lipFormantWeight: {
          value: TUNING.lipFormantWeight,
          min: 1.0, max: 3.0, step: 0.05,
          label: 'Formant weight',
          onChange: (v) => updateTuning({ lipFormantWeight: v }),
        },
        lipPeakDecay: {
          value: TUNING.lipPeakDecay,
          min: 0.995, max: 0.9999, step: 0.0001,
          label: 'Peak decay',
          onChange: (v) => updateTuning({ lipPeakDecay: v }),
        },
      }),
      'Eye look': folder({
        eyeLookX: {
          value: TUNING.eyeLookX,
          min: -0.4, max: 0.4, step: 0.01,
          label: 'Gaze X',
          onChange: (v) => updateTuning({ eyeLookX: v }),
        },
        eyeLookY: {
          value: TUNING.eyeLookY,
          min: -0.4, max: 0.4, step: 0.01,
          label: 'Gaze Y',
          onChange: (v) => updateTuning({ eyeLookY: v }),
        },
      }),
      'Expression': folder({
        expressionSmile: {
          value: TUNING.expressionSmile,
          min: 0, max: 1, step: 0.01,
          label: 'Smile',
          onChange: (v) => updateTuning({ expressionSmile: v }),
        },
        expressionBrowInnerUp: {
          value: TUNING.expressionBrowInnerUp,
          min: 0, max: 1, step: 0.01,
          label: 'Brow inner up',
          onChange: (v) => updateTuning({ expressionBrowInnerUp: v }),
        },
      }),
    },
    { collapsed: false },
  )

  // <Leva /> mounts the drawer in the top-right. `fill` would stretch it
  // to the container; the default floating panel is what we want.
  return (
    <Leva
      collapsed={false}
      titleBar={{ title: 'Kelion tuning (debug)', drag: true }}
      theme={{ sizes: { rootWidth: '300px' } }}
    />
  )
}

/**
 * Public wrapper. Returns null (and therefore never invokes any hooks or
 * mounts the Leva drawer) when the URL does not carry `?debug=1` or
 * `?tune=1`. Zero cost on production pageviews.
 */
export function TuningPanel() {
  if (!isTuningEnabled()) return null
  return <TuningPanelInner />
}

export default TuningPanel
