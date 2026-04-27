// Consensual voice-clone flow.
//
// Three-panel modal:
//   1. Consent   — legal copy + checkboxes + typed full-name signature.
//   2. Record    — read three passages, stop when >=30s captured; allow
//                  re-record + playback; upload to the server.
//   3. Manage    — shows current clone state + toggle to use cloned voice
//                  in Kelion's replies + delete button.
//
// Everything is opt-in. Nothing records until the user clicks "Start
// recording" on panel 2 *after* ticking all three consent checkboxes
// and typing their full name as a digital signature. The MediaRecorder
// runs entirely in the browser — the sample is never sent anywhere
// until the user clicks "Upload to ElevenLabs". There is no background
// capture, no silent recording.
//
// Server contract:
//   GET    /api/voice/clone          → { voice: { voiceId, enabled, consentAt, consentVersion } }
//   POST   /api/voice/clone          → { audioBase64, mimeType, consent:true, consentVersion, displayName }
//   PATCH  /api/voice/clone          → { enabled: boolean }
//   DELETE /api/voice/clone          → clears the clone on ElevenLabs + DB

import { useCallback, useEffect, useRef, useState } from 'react'
import { getCsrfToken } from '../lib/api'

const CONSENT_VERSION = '2026-04-27.v2'
const MIN_SECONDS = 30
const TARGET_SECONDS = 60
const MAX_SECONDS = 180

// ── i18n ────────────────────────────────────────────────────────────
// Full localization for the voice clone flow. The user reads passages
// in their own language for better voice quality and a professional UX.
const I18N = {
  en: {
    title: 'Clone my voice',
    loading: 'Loading\u2026',
    closeLabel: 'Close',
    consentIntro: (target) => `Kelion can speak in <strong>your own voice</strong> by uploading a short recording of you to <strong>ElevenLabs</strong> and using the voice clone only when replying to <em>you</em>. Before we record anything, please read and agree:`,
    consentBullets: (target) => [
      `We record ~${target} seconds of your voice in this browser, only after you click <em>Start recording</em>.`,
      'The audio sample is uploaded to ElevenLabs, who returns a voice ID tied to your account.',
      "The clone is used only for Kelion's replies to you \u2014 never for anyone else, never without the toggle in Manage being on.",
      'You can delete the clone at any time. Delete removes it from ElevenLabs and from our database.',
      'We keep an audit log (create / enable / disable / delete / synthesize) so we can prove how the clone was used.',
    ],
    agree1: 'I am the person whose voice is being recorded, and I consent to this recording.',
    agree2: 'I consent to the sample being uploaded to ElevenLabs to create a voice clone tied to my Kelion account.',
    agree3: 'I understand I can delete the clone at any time from this screen.',
    signatureLabel: 'Type your full name as a digital signature',
    signedAs: (email, ver) => `Signed as ${email} \u00b7 consent version ${ver}`,
    cancel: 'Cancel',
    continueToRecording: 'Continue to recording',
    recordIntro: (min, target) => `Read the three passages below in a natural voice. Aim for at least <strong>${min} seconds</strong> (ideal ~${target}s). Use a quiet room and a decent microphone for best results.`,
    recording: 'Recording\u2026',
    captured: 'Captured',
    ready: 'Ready',
    back: 'Back',
    startRecording: 'Start recording',
    stop: 'Stop',
    stopMinLeft: (s) => `(${s}s left to minimum)`,
    reRecord: 'Re-record',
    upload: 'Upload to ElevenLabs',
    uploading: 'Uploading\u2026',
    manageIntro: 'You have a cloned voice on file. Kelion can use it when replying to you.',
    voiceId: 'Voice ID',
    consented: 'Consented',
    version: 'Version',
    useMyVoice: "Use my voice for Kelion's replies to me",
    deleteClone: 'Delete cloned voice',
    working: 'Working\u2026',
    done: 'Done',
    deleteConfirm: 'Delete your cloned voice? This also removes it from ElevenLabs. This cannot be undone.',
    passages: [
      'Hi, my name is [your name] and I am recording this sample so that Kelion can speak in my voice. I give my explicit consent to this recording.',
      'The quick brown fox jumps over the lazy dog. She sells seashells by the seashore. Peter Piper picked a peck of pickled peppers.',
      "I understand this sample will be uploaded to ElevenLabs to create a voice clone tied only to my account, that I can delete it at any time, and that it will only be used for Kelion's replies to me.",
    ],
  },
  ro: {
    title: 'Clonează-mi vocea',
    loading: 'Se încarcă\u2026',
    closeLabel: 'Închide',
    consentIntro: (target) => `Kelion poate vorbi cu <strong>vocea ta</strong> prin încărcarea unei scurte înregistrări pe <strong>ElevenLabs</strong>, folosind clona doar când îți răspunde <em>ție</em>. Înainte de a înregistra, te rugăm să citești și să fii de acord:`,
    consentBullets: (target) => [
      `Înregistrăm ~${target} secunde din vocea ta în acest browser, doar după ce apeși <em>Începe înregistrarea</em>.`,
      'Eșantionul audio este încărcat pe ElevenLabs, care returnează un ID de voce legat de contul tău.',
      'Clona este folosită doar pentru răspunsurile lui Kelion către tine \u2014 niciodată pentru altcineva.',
      'Poți șterge clona oricând. Ștergerea o elimină din ElevenLabs și din baza noastră de date.',
      'Păstrăm un jurnal de audit (creare / activare / dezactivare / ștergere) pentru a dovedi cum a fost folosită clona.',
    ],
    agree1: 'Eu sunt persoana a cărei voce este înregistrată și consimt la această înregistrare.',
    agree2: 'Consimt ca eșantionul să fie încărcat pe ElevenLabs pentru a crea o clonă de voce legată de contul meu Kelion.',
    agree3: 'Înțeleg că pot șterge clona oricând din acest ecran.',
    signatureLabel: 'Tastează numele tău complet ca semnătură digitală',
    signedAs: (email, ver) => `Semnat ca ${email} \u00b7 versiunea consimțământului ${ver}`,
    cancel: 'Anulează',
    continueToRecording: 'Continuă la înregistrare',
    recordIntro: (min, target) => `Citește cele trei pasaje de mai jos cu voce naturală. Țintește minimum <strong>${min} secunde</strong> (ideal ~${target}s). Folosește o cameră liniștită și un microfon decent.`,
    recording: 'Se înregistrează\u2026',
    captured: 'Capturat',
    ready: 'Pregătit',
    back: 'Înapoi',
    startRecording: 'Începe înregistrarea',
    stop: 'Oprește',
    stopMinLeft: (s) => `(încă ${s}s până la minimum)`,
    reRecord: 'Reînregistrează',
    upload: 'Încarcă pe ElevenLabs',
    uploading: 'Se încarcă\u2026',
    manageIntro: 'Ai o voce clonată pe fișier. Kelion o poate folosi când îți răspunde.',
    voiceId: 'ID Voce',
    consented: 'Consimțit',
    version: 'Versiune',
    useMyVoice: 'Folosește vocea mea pentru răspunsurile lui Kelion către mine',
    deleteClone: 'Șterge vocea clonată',
    working: 'Se lucrează\u2026',
    done: 'Gata',
    deleteConfirm: 'Ștergi vocea clonată? Aceasta o elimină și din ElevenLabs. Nu se poate anula.',
    passages: [
      'Bună, numele meu este [numele tău] și înregistrez acest eșantion pentru ca Kelion să poată vorbi cu vocea mea. Îmi dau consimțământul explicit pentru această înregistrare.',
      'Vulpea cea maro și rapidă sare peste câinele leneș. Ea vinde scoici pe malul mării. Petru Piparul a adunat un pumn de ardei murați.',
      'Înțeleg că acest eșantion va fi încărcat pe ElevenLabs pentru a crea o clonă de voce legată doar de contul meu, că o pot șterge oricând și că va fi folosită doar pentru răspunsurile lui Kelion către mine.',
    ],
  },
  fr: {
    title: 'Cloner ma voix',
    loading: 'Chargement\u2026',
    closeLabel: 'Fermer',
    consentIntro: () => `Kelion peut parler avec <strong>votre propre voix</strong> en téléchargeant un court enregistrement sur <strong>ElevenLabs</strong>. Avant d'enregistrer, veuillez lire et accepter:`,
    consentBullets: (target) => [
      `Nous enregistrons ~${target} secondes de votre voix dans ce navigateur, uniquement après avoir cliqué sur <em>Commencer</em>.`,
      "L'échantillon audio est envoyé à ElevenLabs, qui retourne un identifiant de voix lié à votre compte.",
      'Le clone est utilisé uniquement pour les réponses de Kelion à vous \u2014 jamais pour quelqu\'un d\'autre.',
      'Vous pouvez supprimer le clone à tout moment.',
      'Nous conservons un journal d\'audit pour prouver comment le clone a été utilisé.',
    ],
    agree1: 'Je suis la personne dont la voix est enregistrée et je consens à cet enregistrement.',
    agree2: "Je consens à ce que l'échantillon soit téléchargé sur ElevenLabs.",
    agree3: 'Je comprends que je peux supprimer le clone à tout moment.',
    signatureLabel: 'Tapez votre nom complet comme signature numérique',
    signedAs: (email, ver) => `Signé en tant que ${email} \u00b7 version ${ver}`,
    cancel: 'Annuler',
    continueToRecording: "Continuer vers l'enregistrement",
    recordIntro: (min, target) => `Lisez les trois passages ci-dessous d'une voix naturelle. Visez au moins <strong>${min} secondes</strong> (idéal ~${target}s).`,
    recording: 'Enregistrement\u2026',
    captured: 'Capturé',
    ready: 'Prêt',
    back: 'Retour',
    startRecording: "Commencer l'enregistrement",
    stop: 'Arrêter',
    stopMinLeft: (s) => `(${s}s restantes)`,
    reRecord: 'Réenregistrer',
    upload: 'Télécharger sur ElevenLabs',
    uploading: 'Téléchargement\u2026',
    manageIntro: 'Vous avez une voix clonée. Kelion peut l\'utiliser pour vous répondre.',
    voiceId: 'ID Voix',
    consented: 'Consentement',
    version: 'Version',
    useMyVoice: 'Utiliser ma voix pour les réponses de Kelion',
    deleteClone: 'Supprimer la voix clonée',
    working: 'En cours\u2026',
    done: 'Terminé',
    deleteConfirm: 'Supprimer votre voix clonée? Cette action est irréversible.',
    passages: [
      'Bonjour, je m\'appelle [votre nom] et j\'enregistre cet échantillon pour que Kelion puisse parler avec ma voix. Je donne mon consentement explicite pour cet enregistrement.',
      'Le renard brun rapide saute par-dessus le chien paresseux. Elle vend des coquillages sur le bord de la mer.',
      "Je comprends que cet échantillon sera téléchargé sur ElevenLabs pour créer un clone vocal lié uniquement à mon compte, que je peux le supprimer à tout moment.",
    ],
  },
  de: {
    title: 'Meine Stimme klonen',
    loading: 'Laden\u2026',
    closeLabel: 'Schlie\u00dfen',
    consentIntro: () => `Kelion kann mit <strong>Ihrer eigenen Stimme</strong> sprechen. Bitte lesen und akzeptieren Sie:`,
    consentBullets: (target) => [
      `Wir nehmen ~${target} Sekunden Ihrer Stimme auf, erst nach Klick auf <em>Aufnahme starten</em>.`,
      'Die Probe wird an ElevenLabs gesendet und eine Stimm-ID erstellt.',
      'Der Klon wird nur f\u00fcr Kelions Antworten an Sie verwendet.',
      'Sie k\u00f6nnen den Klon jederzeit l\u00f6schen.',
      'Wir f\u00fchren ein Audit-Protokoll.',
    ],
    agree1: 'Ich bin die Person, deren Stimme aufgenommen wird, und stimme zu.',
    agree2: 'Ich stimme dem Upload zu ElevenLabs zu.',
    agree3: 'Ich verstehe, dass ich den Klon jederzeit l\u00f6schen kann.',
    signatureLabel: 'Geben Sie Ihren vollst\u00e4ndigen Namen als digitale Unterschrift ein',
    signedAs: (email, ver) => `Signiert als ${email} \u00b7 Version ${ver}`,
    cancel: 'Abbrechen',
    continueToRecording: 'Weiter zur Aufnahme',
    recordIntro: (min, target) => `Lesen Sie die drei Abschnitte unten nat\u00fcrlich vor. Mindestens <strong>${min} Sekunden</strong> (ideal ~${target}s).`,
    recording: 'Aufnahme l\u00e4uft\u2026',
    captured: 'Aufgenommen',
    ready: 'Bereit',
    back: 'Zur\u00fcck',
    startRecording: 'Aufnahme starten',
    stop: 'Stopp',
    stopMinLeft: (s) => `(noch ${s}s)`,
    reRecord: 'Neu aufnehmen',
    upload: 'Zu ElevenLabs hochladen',
    uploading: 'Hochladen\u2026',
    manageIntro: 'Sie haben eine geklonte Stimme. Kelion kann sie f\u00fcr Antworten verwenden.',
    voiceId: 'Stimm-ID',
    consented: 'Zugestimmt',
    version: 'Version',
    useMyVoice: 'Meine Stimme f\u00fcr Kelions Antworten verwenden',
    deleteClone: 'Geklonte Stimme l\u00f6schen',
    working: 'Wird bearbeitet\u2026',
    done: 'Fertig',
    deleteConfirm: 'Geklonte Stimme l\u00f6schen? Dies kann nicht r\u00fcckg\u00e4ngig gemacht werden.',
    passages: [
      'Hallo, mein Name ist [Ihr Name] und ich nehme diese Probe auf, damit Kelion mit meiner Stimme sprechen kann. Ich gebe meine ausdr\u00fcckliche Zustimmung zu dieser Aufnahme.',
      'Der schnelle braune Fuchs springt \u00fcber den faulen Hund. Sie verkauft Muscheln am Meeresufer.',
      'Ich verstehe, dass diese Probe zu ElevenLabs hochgeladen wird und ich sie jederzeit l\u00f6schen kann.',
    ],
  },
  es: {
    title: 'Clonar mi voz',
    loading: 'Cargando\u2026',
    closeLabel: 'Cerrar',
    consentIntro: () => `Kelion puede hablar con <strong>tu propia voz</strong>. Por favor lee y acepta:`,
    consentBullets: (target) => [
      `Grabamos ~${target} segundos de tu voz, solo despu\u00e9s de hacer clic en <em>Iniciar grabaci\u00f3n</em>.`,
      'La muestra se env\u00eda a ElevenLabs.',
      'El clon se usa solo para las respuestas de Kelion hacia ti.',
      'Puedes eliminar el clon en cualquier momento.',
      'Mantenemos un registro de auditor\u00eda.',
    ],
    agree1: 'Soy la persona cuya voz se graba y doy mi consentimiento.',
    agree2: 'Consiento la carga a ElevenLabs.',
    agree3: 'Entiendo que puedo eliminar el clon en cualquier momento.',
    signatureLabel: 'Escribe tu nombre completo como firma digital',
    signedAs: (email, ver) => `Firmado como ${email} \u00b7 versi\u00f3n ${ver}`,
    cancel: 'Cancelar',
    continueToRecording: 'Continuar a la grabaci\u00f3n',
    recordIntro: (min, target) => `Lee los tres pasajes con voz natural. M\u00ednimo <strong>${min} segundos</strong> (ideal ~${target}s).`,
    recording: 'Grabando\u2026',
    captured: 'Capturado',
    ready: 'Listo',
    back: 'Atr\u00e1s',
    startRecording: 'Iniciar grabaci\u00f3n',
    stop: 'Detener',
    stopMinLeft: (s) => `(${s}s restantes)`,
    reRecord: 'Regrabar',
    upload: 'Subir a ElevenLabs',
    uploading: 'Subiendo\u2026',
    manageIntro: 'Tienes una voz clonada. Kelion puede usarla para responderte.',
    voiceId: 'ID de Voz',
    consented: 'Consentimiento',
    version: 'Versi\u00f3n',
    useMyVoice: 'Usar mi voz para las respuestas de Kelion',
    deleteClone: 'Eliminar voz clonada',
    working: 'Trabajando\u2026',
    done: 'Hecho',
    deleteConfirm: '\u00bfEliminar tu voz clonada? Esto no se puede deshacer.',
    passages: [
      'Hola, mi nombre es [tu nombre] y estoy grabando esta muestra para que Kelion pueda hablar con mi voz. Doy mi consentimiento expl\u00edcito.',
      'El r\u00e1pido zorro marr\u00f3n salta sobre el perro perezoso. Ella vende conchas en la orilla del mar.',
      'Entiendo que esta muestra se subir\u00e1 a ElevenLabs y que puedo eliminarla en cualquier momento.',
    ],
  },
}

function detectLang() {
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en'
  const short = nav.split('-')[0].toLowerCase()
  return I18N[short] ? short : 'en'
}

function t(key, ...args) {
  const lang = detectLang()
  const val = I18N[lang]?.[key] ?? I18N.en[key]
  return typeof val === 'function' ? val(...args) : val
}

function passages() {
  const lang = detectLang()
  return (I18N[lang]?.passages ?? I18N.en.passages)
}

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  for (const mt of candidates) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(mt)) return mt
  }
  return 'audio/webm'
}

function fmt(n) {
  const s = Math.max(0, Math.floor(n))
  const mm = String(Math.floor(s / 60)).padStart(1, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const str = String(reader.result || '')
      const comma = str.indexOf(',')
      resolve(comma >= 0 ? str.slice(comma + 1) : str)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export default function VoiceCloneModal({ open, onClose, userEmail, userName }) {
  const [step, setStep] = useState('loading')
  const [existing, setExisting] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  // Consent panel state
  const [agree1, setAgree1] = useState(false)
  const [agree2, setAgree2] = useState(false)
  const [agree3, setAgree3] = useState(false)
  const [signature, setSignature] = useState('')

  // Recording panel state
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [sampleBlob, setSampleBlob] = useState(null)
  const [sampleUrl, setSampleUrl] = useState(null)
  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  const resetRecording = useCallback(() => {
    try { if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop() } catch (_) { /* ignore */ }
    try { streamRef.current && streamRef.current.getTracks().forEach(t => t.stop()) } catch (_) { /* ignore */ }
    streamRef.current = null
    mediaRecorderRef.current = null
    chunksRef.current = []
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setRecording(false)
    setElapsed(0)
    if (sampleUrl) { try { URL.revokeObjectURL(sampleUrl) } catch (_) {} }
    setSampleBlob(null)
    setSampleUrl(null)
  }, [sampleUrl])

  // Load existing state when modal opens.
  useEffect(() => {
    if (!open) return
    let alive = true
    setError(null)
    setBusy(false)
    setStep('loading')
    fetch('/api/voice/clone', { credentials: 'include' })
      .then(async (r) => {
        if (!alive) return
        if (r.status === 401) {
          setError('Sign in to clone your voice.')
          setStep('error')
          return
        }
        const j = await r.json().catch(() => ({}))
        if (!r.ok) {
          setError((j && j.error) || 'Failed to load voice clone state.')
          setStep('error')
          return
        }
        const voice = (j && j.voice) || null
        setExisting(voice && voice.voiceId ? voice : null)
        setStep(voice && voice.voiceId ? 'manage' : 'consent')
      })
      .catch(() => {
        if (!alive) return
        setError('Failed to contact the server.')
        setStep('error')
      })
    return () => {
      alive = false
      resetRecording()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Unmount cleanup ONLY — release microphone + timer, do NOT touch React
  // state. Previously this was `useEffect(() => () => resetRecording(),
  // [resetRecording])`, which re-fired every time `sampleUrl` changed
  // (because `resetRecording` is `useCallback(…, [sampleUrl])`). That
  // meant when the MediaRecorder's `onstop` set the sample blob and
  // URL, the effect cleanup would immediately run the *previous*
  // `resetRecording` — wiping `sampleBlob`, `sampleUrl`, and `elapsed`
  // back to empty. From the user's point of view, the 180 s recording
  // "disappeared" and the modal snapped back to the Ready state,
  // forcing them to start over (the "loop" Adrian reported).
  useEffect(() => {
    return () => {
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop()
        }
      } catch (_) { /* ignore */ }
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop())
        }
      } catch (_) { /* ignore */ }
      streamRef.current = null
      mediaRecorderRef.current = null
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  // ESC to close (only when nothing is recording/uploading).
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape' && !recording && !busy) {
        onClose && onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, recording, busy, onClose])

  const canConsent =
    agree1 && agree2 && agree3 &&
    signature.trim().length >= 3 &&
    (!userEmail || signature.trim().length >= 3)

  const startRecording = useCallback(async () => {
    setError(null)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('Your browser does not support microphone capture.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      })
      streamRef.current = stream
      const mimeType = pickMimeType()
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || mimeType || 'audio/webm' })
        setSampleBlob(blob)
        const url = URL.createObjectURL(blob)
        setSampleUrl(url)
        try { streamRef.current && streamRef.current.getTracks().forEach(t => t.stop()) } catch (_) {}
        streamRef.current = null
      }
      mediaRecorderRef.current = mr
      mr.start()
      setRecording(true)
      setElapsed(0)
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        setElapsed((v) => {
          if (v + 1 >= MAX_SECONDS) {
            // Auto-stop at the hard ceiling.
            try { mr.state !== 'inactive' && mr.stop() } catch (_) { /* ignore */ }
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
            setRecording(false)
            return MAX_SECONDS
          }
          return v + 1
        })
      }, 1000)
    } catch (err) {
      console.warn('[voice-clone] getUserMedia failed', err)
      setError(err && err.name === 'NotAllowedError'
        ? 'Microphone access was denied.'
        : 'Could not access the microphone.')
    }
  }, [])

  const stopRecording = useCallback(() => {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
    } catch (_) { /* ignore */ }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setRecording(false)
  }, [])

  const uploadSample = useCallback(async () => {
    if (!sampleBlob) { setError('Record a sample first.'); return }
    if (elapsed < MIN_SECONDS) {
      setError(`Please record at least ${MIN_SECONDS} seconds.`)
      return
    }
    setError(null)
    setBusy(true)
    try {
      const audioBase64 = await blobToBase64(sampleBlob)
      const r = await fetch('/api/voice/clone', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        body: JSON.stringify({
          audioBase64,
          mimeType: sampleBlob.type || 'audio/webm',
          consent: true,
          consentVersion: CONSENT_VERSION,
          displayName: userName ? `Kelion — ${userName}` : undefined,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        throw new Error((j && j.error) || `Upload failed (${r.status}).`)
      }
      setExisting(j.voice || null)
      setStep('manage')
      resetRecording()
    } catch (err) {
      setError(err.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }, [sampleBlob, elapsed, userName, resetRecording])

  const toggleEnabled = useCallback(async (next) => {
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/voice/clone', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        body: JSON.stringify({ enabled: Boolean(next) }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error((j && j.error) || 'Toggle failed.')
      setExisting(j.voice || null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }, [])

  const deleteClone = useCallback(async () => {
    if (!window.confirm(t('deleteConfirm'))) return
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/voice/clone', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'X-CSRF-Token': getCsrfToken() },
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error((j && j.error) || 'Delete failed.')
      setExisting(null)
      setAgree1(false); setAgree2(false); setAgree3(false); setSignature('')
      setStep('consent')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }, [])

  if (!open) return null

  return (
    <div
      onClick={() => { if (!recording && !busy) onClose && onClose() }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(3, 4, 10, 0.65)',
        backdropFilter: 'blur(6px)',
        zIndex: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Voice clone"
        style={{
          width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto',
          background: 'rgba(14, 10, 28, 0.96)',
          border: '1px solid rgba(167, 139, 250, 0.35)',
          borderRadius: 18, padding: 24,
          color: '#ede9fe', fontSize: 14, lineHeight: 1.5,
          boxShadow: '0 28px 80px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{t('title')}</h2>
          <button
            type="button"
            onClick={() => { if (!recording && !busy) onClose && onClose() }}
            disabled={recording || busy}
            style={{
              background: 'transparent', color: '#cbd5f5',
              border: 'none', fontSize: 22, cursor: recording || busy ? 'not-allowed' : 'pointer',
              lineHeight: 1, padding: 4,
            }}
            aria-label={t('closeLabel')}
          >×</button>
        </div>

        {error && (
          <div style={{
            background: 'rgba(80, 14, 14, 0.4)', color: '#fecaca',
            border: '1px solid rgba(239, 68, 68, 0.45)',
            padding: '8px 12px', borderRadius: 10, marginBottom: 12, fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {step === 'loading' && (
          <div style={{ padding: 16 }}>{t('loading')}</div>
        )}

        {step === 'error' && (
          <div style={{ padding: 12 }}>
            <button type="button" onClick={onClose} style={primaryBtn}>{t('closeLabel')}</button>
          </div>
        )}

        {step === 'consent' && (
          <>
            <p style={{ marginTop: 0 }} dangerouslySetInnerHTML={{ __html: t('consentIntro', TARGET_SECONDS) }} />
            <ul style={{ paddingLeft: 18, margin: '8px 0 16px' }}>
              {t('consentBullets', TARGET_SECONDS).map((b, i) => (
                <li key={i} dangerouslySetInnerHTML={{ __html: b }} />
              ))}
            </ul>
            <label style={checkboxRow}>
              <input type="checkbox" checked={agree1} onChange={(e) => setAgree1(e.target.checked)} />
              {t('agree1')}
            </label>
            <label style={checkboxRow}>
              <input type="checkbox" checked={agree2} onChange={(e) => setAgree2(e.target.checked)} />
              {t('agree2')}
            </label>
            <label style={checkboxRow}>
              <input type="checkbox" checked={agree3} onChange={(e) => setAgree3(e.target.checked)} />
              {t('agree3')}
            </label>
            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 4 }}>
                {t('signatureLabel')}
              </label>
              <input
                type="text"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder={userName || 'Full name'}
                style={inputStyle}
              />
              {userEmail && (
                <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
                  {t('signedAs', userEmail, CONSENT_VERSION)}
                </div>
              )}
            </div>
            <div style={btnRow}>
              <button type="button" onClick={onClose} style={secondaryBtn} disabled={busy}>{t('cancel')}</button>
              <button
                type="button"
                onClick={() => setStep('record')}
                disabled={!canConsent}
                style={{ ...primaryBtn, opacity: canConsent ? 1 : 0.5 }}
              >
                {t('continueToRecording')}
              </button>
            </div>
          </>
        )}

        {step === 'record' && (
          <>
            <p style={{ marginTop: 0 }} dangerouslySetInnerHTML={{ __html: t('recordIntro', MIN_SECONDS, TARGET_SECONDS) }} />
            <ol style={{ paddingLeft: 18, margin: '0 0 16px' }}>
              {passages().map((p, i) => (
                <li key={i} style={{ marginBottom: 6 }}>{p}</li>
              ))}
            </ol>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px',
              background: 'rgba(167, 139, 250, 0.08)',
              border: '1px solid rgba(167, 139, 250, 0.22)',
              borderRadius: 10, marginBottom: 12,
            }}>
              <span>
                <span style={{
                  display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                  background: recording ? '#ef4444' : '#64748b',
                  boxShadow: recording ? '0 0 10px #ef4444' : 'none',
                  marginRight: 8, verticalAlign: 'middle',
                }} />
                {recording ? t('recording') : sampleBlob ? t('captured') : t('ready')}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {fmt(elapsed)} / {fmt(MAX_SECONDS)}
              </span>
            </div>
            {!recording && !sampleBlob && (
              <div style={btnRow}>
                <button type="button" onClick={() => setStep('consent')} style={secondaryBtn}>{t('back')}</button>
                <button type="button" onClick={startRecording} style={primaryBtn}>{t('startRecording')}</button>
              </div>
            )}
            {recording && (
              <div style={btnRow}>
                <button type="button" onClick={stopRecording} style={primaryBtn}>
                  {t('stop')} {elapsed < MIN_SECONDS && t('stopMinLeft', MIN_SECONDS - elapsed)}
                </button>
              </div>
            )}
            {!recording && sampleBlob && (
              <>
                <audio src={sampleUrl} controls style={{ width: '100%', marginBottom: 12 }} />
                <div style={btnRow}>
                  <button type="button" onClick={resetRecording} style={secondaryBtn} disabled={busy}>
                    {t('reRecord')}
                  </button>
                  <button
                    type="button"
                    onClick={uploadSample}
                    disabled={busy || elapsed < MIN_SECONDS}
                    style={{ ...primaryBtn, opacity: (busy || elapsed < MIN_SECONDS) ? 0.5 : 1 }}
                  >
                    {busy ? t('uploading') : t('upload')}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {step === 'manage' && (
          <>
            <p style={{ marginTop: 0 }}>
              {t('manageIntro')}
            </p>
            <div style={{
              background: 'rgba(167, 139, 250, 0.08)',
              border: '1px solid rgba(167, 139, 250, 0.22)',
              borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 13,
            }}>
              <div><strong>{t('voiceId')}:</strong> <code style={{ opacity: 0.8 }}>{existing && existing.voiceId}</code></div>
              {existing && existing.consentAt && (
                <div><strong>{t('consented')}:</strong> {new Date(existing.consentAt).toLocaleString()}</div>
              )}
              {existing && existing.consentVersion && (
                <div><strong>{t('version')}:</strong> {existing.consentVersion}</div>
              )}
            </div>
            <label style={{ ...checkboxRow, marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={Boolean(existing && existing.enabled)}
                onChange={(e) => toggleEnabled(e.target.checked)}
                disabled={busy}
              />
              {t('useMyVoice')}
            </label>
            <div style={btnRow}>
              <button type="button" onClick={deleteClone} style={destructiveBtn} disabled={busy}>
                {busy ? t('working') : t('deleteClone')}
              </button>
              <button type="button" onClick={onClose} style={primaryBtn}>{t('done')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '8px 10px', borderRadius: 8,
  background: 'rgba(255,255,255,0.05)',
  color: '#ede9fe',
  border: '1px solid rgba(167, 139, 250, 0.25)',
  fontSize: 14,
}

const btnRow = {
  display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8,
}

const primaryBtn = {
  padding: '8px 14px', borderRadius: 10,
  background: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
  color: 'white', border: 'none', cursor: 'pointer',
  fontSize: 14, fontWeight: 600,
}

const secondaryBtn = {
  padding: '8px 14px', borderRadius: 10,
  background: 'rgba(255,255,255,0.06)',
  color: '#ede9fe',
  border: '1px solid rgba(167, 139, 250, 0.25)',
  cursor: 'pointer',
  fontSize: 14,
}

const destructiveBtn = {
  padding: '8px 14px', borderRadius: 10,
  background: 'rgba(220, 38, 38, 0.85)',
  color: 'white', border: 'none', cursor: 'pointer',
  fontSize: 14, fontWeight: 600,
}

const checkboxRow = {
  display: 'flex', alignItems: 'flex-start', gap: 8,
  margin: '6px 0', fontSize: 13, lineHeight: 1.4,
  cursor: 'pointer',
}
