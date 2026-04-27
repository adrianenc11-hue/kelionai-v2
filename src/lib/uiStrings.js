// UI string localization — auto-detects browser language.
// Usage: import { t } from '../lib/uiStrings'
// Then:  t('cameraOn')  →  "Opriți camera" (if browser is Romanian)
//
// Default fallback: English. Supported: en, ro, fr, de, es.

const STRINGS = {
  // ─── Menu: Tools ──────────────────────────────────────
  tools:              { en: 'Tools',                 ro: 'Instrumente',           fr: 'Outils',              de: 'Werkzeuge',            es: 'Herramientas' },
  cameraOn:           { en: '📹 Turn camera on',     ro: '📹 Opriți camera',      fr: '📹 Activer la caméra', de: '📹 Kamera einschalten', es: '📹 Encender cámara' },
  cameraOff:          { en: '📹 Turn camera off',    ro: '📹 Opriți camera',      fr: '📹 Désactiver caméra', de: '📹 Kamera ausschalten', es: '📹 Apagar cámara' },
  shareScreen:        { en: '🖥️ Share screen',       ro: '🖥️ Partajează ecranul', fr: '🖥️ Partager l\'écran',  de: '🖥️ Bildschirm teilen', es: '🖥️ Compartir pantalla' },
  stopScreen:         { en: '🖥️ Stop sharing screen',ro: '🖥️ Oprește partajarea', fr: '🖥️ Arrêter le partage',de: '🖥️ Teilen beenden',    es: '🖥️ Dejar de compartir' },
  showTranscript:     { en: '📝 Show transcript',    ro: '📝 Afișează transcrierea',fr: '📝 Afficher transcription',de: '📝 Transkript anzeigen',es: '📝 Mostrar transcripción' },
  hideTranscript:     { en: '📝 Hide transcript',    ro: '📝 Ascunde transcrierea',fr: '📝 Masquer transcription',de: '📝 Transkript ausblenden',es: '📝 Ocultar transcripción' },
  contactUs:          { en: '✉️ Contact us',         ro: '✉️ Contactați-ne',      fr: '✉️ Contactez-nous',    de: '✉️ Kontaktieren Sie uns',es: '✉️ Contáctenos' },

  // ─── Menu: Voice Style ────────────────────────────────
  voiceStyle:         { en: 'Voice Style',           ro: 'Stilul vocal',          fr: 'Style vocal',         de: 'Stimmstil',            es: 'Estilo de voz' },
  warm:               { en: 'Warm',                  ro: 'Cald',                  fr: 'Chaleureux',          de: 'Warm',                 es: 'Cálido' },
  playful:            { en: 'Playful',               ro: 'Jucăuș',                fr: 'Enjoué',              de: 'Verspielt',            es: 'Juguetón' },
  calm:               { en: 'Calm',                  ro: 'Calm',                  fr: 'Calme',               de: 'Ruhig',                es: 'Tranquilo' },
  focused:            { en: 'Focused',               ro: 'Concentrat',            fr: 'Concentré',           de: 'Fokussiert',           es: 'Enfocado' },

  // ─── Menu: Conversations ──────────────────────────────
  conversationHistory:{ en: 'Conversation history',  ro: 'Istoricul conversațiilor',fr: 'Historique des conversations',de: 'Gesprächsverlauf',es: 'Historial de conversaciones' },
  newChat:            { en: 'New chat',              ro: 'Chat nou',              fr: 'Nouvelle discussion',  de: 'Neuer Chat',          es: 'Nuevo chat' },
  whatDoYouKnow:      { en: 'What do you know about me?',ro: 'Ce știi despre mine?',fr: 'Que savez-vous de moi ?',de: 'Was weißt du über mich?',es: '¿Qué sabes de mí?' },

  // ─── Menu: Voice Clone ────────────────────────────────
  cloneMyVoice:       { en: 'Clone my voice',        ro: 'Clonează-mi vocea',     fr: 'Cloner ma voix',      de: 'Meine Stimme klonen', es: 'Clonar mi voz' },

  // ─── Menu: Push / Pings ───────────────────────────────
  enablePings:        { en: 'Enable pings',          ro: 'Activează ping-urile',  fr: 'Activer les pings',   de: 'Pings aktivieren',    es: 'Activar pings' },
  enablingPings:      { en: 'Enabling pings…',       ro: 'Se activează…',         fr: 'Activation…',         de: 'Aktivierung…',        es: 'Activando…' },
  disablePings:       { en: 'Disable pings',         ro: 'Dezactivează ping-urile',fr: 'Désactiver les pings',de: 'Pings deaktivieren', es: 'Desactivar pings' },
  disablingPings:     { en: 'Disabling pings…',      ro: 'Se dezactivează…',      fr: 'Désactivation…',      de: 'Deaktivierung…',      es: 'Desactivando…' },
  sendTestPing:       { en: 'Send a test ping',      ro: 'Trimite un ping de test',fr: 'Envoyer un ping test',de: 'Test-Ping senden',   es: 'Enviar ping de prueba' },

  // ─── Menu: Admin ──────────────────────────────────────
  adminDashboard:     { en: 'Admin dashboard',       ro: 'Panou admin',           fr: 'Tableau de bord admin',de: 'Admin-Dashboard',    es: 'Panel de administración' },

  // ─── Top bar ──────────────────────────────────────────
  signIn:             { en: 'Sign in',               ro: 'Conectare',             fr: 'Se connecter',        de: 'Anmelden',            es: 'Iniciar sesión' },
  signOut:            { en: 'Sign out',              ro: 'Deconectare',           fr: 'Se déconnecter',      de: 'Abmelden',            es: 'Cerrar sesión' },
  credits:            { en: 'Credits',               ro: 'Credite',               fr: 'Crédits',             de: 'Guthaben',            es: 'Créditos' },
  buyCredits:         { en: 'Buy credits',           ro: 'Cumpără credite',       fr: 'Acheter des crédits', de: 'Guthaben kaufen',     es: 'Comprar créditos' },

  // ─── Chat ─────────────────────────────────────────────
  typeToKelion:       { en: 'Type to Kelion…',       ro: 'Tastați către Kelion…', fr: 'Écrivez à Kelion…',   de: 'Schreiben an Kelion…',es: 'Escribe a Kelion…' },

  // ─── Trial ────────────────────────────────────────────
  trialFree:          { en: 'Free trial',            ro: 'Perioadă de încercare gratuită',fr: 'Essai gratuit',de: 'Kostenlose Testversion',es: 'Prueba gratuita' },
  remaining:          { en: 'remaining',             ro: 'rămasă',                fr: 'restant',             de: 'verbleibend',         es: 'restante' },

  // ─── Status ───────────────────────────────────────────
  stopped:            { en: 'STOPPED',               ro: 'OPRIT',                 fr: 'ARRÊTÉ',              de: 'GESTOPPT',            es: 'DETENIDO' },
  listening:          { en: 'LISTENING',              ro: 'ASCULTĂ',               fr: 'ÉCOUTE',              de: 'HÖRT ZU',             es: 'ESCUCHANDO' },
  thinking:           { en: 'THINKING',              ro: 'GÂNDEȘTE',              fr: 'RÉFLÉCHIT',           de: 'DENKT',               es: 'PENSANDO' },
  speaking:           { en: 'SPEAKING',              ro: 'VORBEȘTE',              fr: 'PARLE',               de: 'SPRICHT',             es: 'SPRICHT' },

  // ─── PWA Install ──────────────────────────────────────
  installApp:         { en: 'Install app',           ro: 'Instalează aplicația',  fr: 'Installer l\'app',    de: 'App installieren',    es: 'Instalar app' },
}

// Detect browser language, cache result.
let _lang = null
function detectLang() {
  if (_lang) return _lang
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en'
  const code = nav.split('-')[0].toLowerCase()
  _lang = ['ro', 'fr', 'de', 'es'].includes(code) ? code : 'en'
  return _lang
}

/**
 * Translate a UI string key.
 * @param {string} key — one of the keys in STRINGS above
 * @returns {string} — localized text, or the key itself if missing
 */
export function t(key) {
  const entry = STRINGS[key]
  if (!entry) return key
  const lang = detectLang()
  return entry[lang] || entry.en || key
}

/** Force a specific language (useful after login when user has preference). */
export function setLang(code) {
  _lang = ['ro', 'fr', 'de', 'es', 'en'].includes(code) ? code : 'en'
}

/** Get current detected language code. */
export function getLang() {
  return detectLang()
}
