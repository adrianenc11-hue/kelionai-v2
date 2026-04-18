// Kelion mic capture worklet.
// Runs off-main-thread, captures 128-sample mono frames from the mic,
// batches to ~20ms chunks (16kHz → 320 samples) and posts Float32 arrays
// back to the main thread for PCM16 encoding + WebSocket send.

class KelionCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(0)
    this.target = 320 // 20ms at 16kHz
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const channel = input[0]
    if (!channel) return true

    // Append to rolling buffer
    const next = new Float32Array(this.buffer.length + channel.length)
    next.set(this.buffer, 0)
    next.set(channel, this.buffer.length)
    this.buffer = next

    // Flush in 20ms chunks
    while (this.buffer.length >= this.target) {
      const chunk = this.buffer.slice(0, this.target)
      this.port.postMessage(chunk, [chunk.buffer])
      this.buffer = this.buffer.slice(this.target)
    }

    return true
  }
}

registerProcessor('kelion-capture', KelionCaptureProcessor)
