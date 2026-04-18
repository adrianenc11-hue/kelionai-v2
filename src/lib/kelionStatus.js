// Status color palette + pulse frequency per state
// Used by halo, status pill, transition indicators.

export const STATUS_COLORS = {
  idle:       '#a78bfa', // lavender
  requesting: '#f59e0b', // amber (asking mic)
  connecting: '#f59e0b', // amber
  listening:  '#34d399', // emerald green
  thinking:   '#fbbf24', // gold
  speaking:   '#60a5fa', // sky blue
  error:      '#ef4444', // red
}

// Pulse frequency in Hz (how fast halo/dot pulse)
export const STATUS_PULSE_HZ = {
  idle:       0.4,  // slow breath
  requesting: 1.2,
  connecting: 1.2,
  listening:  0.8,
  thinking:   1.5,
  speaking:   1.0,
  error:      2.0,
}
