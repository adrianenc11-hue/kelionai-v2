export function installGlobalTracers() {
  if (window.__TRACERS_INSTALLED) return;
  window.__TRACERS_INSTALLED = true;

  const getStackTrace = () => {
    try {
      const err = new Error();
      const stack = err.stack || '';
      const lines = stack.split('\n').filter(l => !l.includes('globalTracer.js') && !l.includes('Error'));
      return lines.slice(0, 3).join(' | ').trim();
    } catch {
      return 'Unknown Stack';
    }
  };

  // 1. WebSocket Tracer
  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    console.warn(`[TRACER-NET] 🌐 NEW WebSocket connection opened to: ${url}\nStack: ${getStackTrace()}`);
    const ws = new OriginalWebSocket(url, protocols);
    
    // Intercept send to see if any unknown data is pushed
    const origSend = ws.send;
    ws.send = function(data) {
      // Don't spam binary audio chunks unless we really want to, keep it lightweight
      if (typeof data === 'string') {
        const preview = data.length > 200 ? data.slice(0, 200) + '...' : data;
        console.info(`[TRACER-NET] ⬆️ WS Send to ${url}: ${preview}`);
      }
      return origSend.call(this, data);
    };
    return ws;
  };
  Object.assign(window.WebSocket, OriginalWebSocket);
  window.WebSocket.prototype = OriginalWebSocket.prototype;

  // 2. fetch Tracer
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    // Log AI/LLM/Audio URLs to see if anything else is communicating
    if (url && (url.includes('/api/voice/clone') || url.includes('/api/realtime') || url.includes('elevenlabs') || url.includes('google') || url.includes('openai'))) {
      console.warn(`[TRACER-NET] 📡 FETCH called to AI endpoint: ${url}\nStack: ${getStackTrace()}`);
    }
    return origFetch.apply(this, args);
  };

  // 3. AudioContext Tracer
  const OrigAudioContext = window.AudioContext || window.webkitAudioContext;
  if (OrigAudioContext) {
    function TracedAudioContext(...args) {
      console.warn(`[TRACER-AUDIO] 🎛️ NEW AudioContext created!\nStack: ${getStackTrace()}`);
      const ctx = new OrigAudioContext(...args);
      
      const origCreateBufferSource = ctx.createBufferSource;
      ctx.createBufferSource = function() {
        const src = origCreateBufferSource.call(this);
        const origStart = src.start;
        src.start = function(when, offset, duration) {
          console.warn(`[TRACER-AUDIO] 🔊 AudioContext buffer started playing! scheduled at: ${when || 'now'} (ctx time: ${ctx.currentTime})\nStack: ${getStackTrace()}`);
          return origStart.call(this, when, offset, duration);
        };
        return src;
      };
      return ctx;
    }
    TracedAudioContext.prototype = OrigAudioContext.prototype;
    window.AudioContext = TracedAudioContext;
    if (window.webkitAudioContext) window.webkitAudioContext = TracedAudioContext;
  }

  // 4. window.Audio Tracer
  const OrigAudio = window.Audio;
  window.Audio = function(...args) {
    console.warn(`[TRACER-AUDIO] 🎵 NEW HTMLAudioElement created via new Audio(): ${args[0]}\nStack: ${getStackTrace()}`);
    const audio = new OrigAudio(...args);
    const origPlay = audio.play;
    audio.play = function() {
      console.warn(`[TRACER-AUDIO] ▶️ HTMLAudioElement started playing: ${this.src}\nStack: ${getStackTrace()}`);
      return origPlay.call(this);
    };
    return audio;
  };
  window.Audio.prototype = OrigAudio.prototype;

  // 5. Existing HTMLAudioElement.play Tracker
  const origHtmlAudioPlay = HTMLAudioElement.prototype.play;
  HTMLAudioElement.prototype.play = function() {
    console.warn(`[TRACER-AUDIO] ▶️ DOM HTMLAudioElement started playing: ${this.src || 'Blob/Stream'}\nStack: ${getStackTrace()}`);
    return origHtmlAudioPlay.call(this);
  };

  console.log('%c[TRACER] 🛡️ Global Audio & Network Tracers installed. Monitoring for hidden sources...', 'color: #ef4444; font-weight: bold; font-size: 14px');
}
