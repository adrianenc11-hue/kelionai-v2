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
  micOn:              { en: 'ON',                    ro: 'PORNIT',                fr: 'ACTIVÉ',              de: 'EIN',                 es: 'ENCENDIDO' },
  micOff:             { en: 'OFF',                   ro: 'OPRIT',                 fr: 'DÉSACTIVÉ',           de: 'AUS',                 es: 'APAGADO' },

  // ─── PWA Install ──────────────────────────────────────
  installApp:         { en: 'Install app',           ro: 'Instalează aplicația',  fr: 'Installer l\'app',    de: 'App installieren',    es: 'Instalar app' },

  // ─── Studio ───────────────────────────────────────────
  studioTitle:        { en: 'Studio',                ro: 'Studio',                fr: 'Studio',              de: 'Studio',              es: 'Studio' },
  backToKelion:       { en: '‹ Kelion',              ro: '‹ Kelion',              fr: '‹ Kelion',            de: '‹ Kelion',            es: '‹ Kelion' },
  newProject:         { en: '+ New',                 ro: '+ Nou',                 fr: '+ Nouveau',           de: '+ Neu',               es: '+ Nuevo' },
  rename:             { en: 'Rename',                ro: 'Redenumește',           fr: 'Renommer',            de: 'Umbenennen',          es: 'Renombrar' },
  delete:             { en: 'Delete',                ro: 'Șterge',                fr: 'Supprimer',           de: 'Löschen',             es: 'Eliminar' },
  saved:              { en: 'Saved',                 ro: 'Salvat',                fr: 'Enregistré',          de: 'Gespeichert',         es: 'Guardado' },
  unsaved:            { en: 'Unsaved',               ro: 'Nesalvat',              fr: 'Non enregistré',      de: 'Nicht gespeichert',   es: 'Sin guardar' },
  savingDots:         { en: 'Saving…',               ro: 'Se salvează…',          fr: 'Enregistrement…',     de: 'Speichern…',          es: 'Guardando…' },
  files:              { en: 'Files',                 ro: 'Fișiere',               fr: 'Fichiers',            de: 'Dateien',             es: 'Archivos' },
  newFile:            { en: '+ New',                 ro: '+ Nou',                 fr: '+ Nouveau',           de: '+ Neu',               es: '+ Nuevo' },
  create:             { en: 'Create',                ro: 'Crează',                fr: 'Créer',               de: 'Erstellen',           es: 'Crear' },
  noFilesYet:         { en: 'No files yet — click "+ New" to add one.',
                        ro: 'Niciun fișier — apasă „+ Nou" pentru a adăuga.',
                        fr: 'Aucun fichier — cliquez « + Nouveau » pour en ajouter.',
                        de: 'Keine Dateien — klicken Sie „+ Neu" um eine hinzuzufügen.',
                        es: 'Sin archivos — haz clic en "+ Nuevo" para agregar.' },
  run:                { en: '▶ Run',                 ro: '▶ Rulează',             fr: '▶ Exécuter',          de: '▶ Ausführen',         es: '▶ Ejecutar' },
  running:            { en: '…running',              ro: '…rulează',              fr: '…exécution',          de: '…läuft',              es: '…ejecutando' },
  installDeps:        { en: 'install deps first (requirements.txt)',
                        ro: 'instalează dependențe întâi (requirements.txt)',
                        fr: 'installer les dépendances d\'abord (requirements.txt)',
                        de: 'Abhängigkeiten zuerst installieren (requirements.txt)',
                        es: 'instalar dependencias primero (requirements.txt)' },
  runPrompt:          { en: 'Click "Run" to execute this project in an ephemeral sandbox.',
                        ro: 'Apasă „Rulează" pentru a executa proiectul într-un sandbox efemer.',
                        fr: 'Cliquez « Exécuter » pour lancer ce projet dans un sandbox éphémère.',
                        de: 'Klicken Sie „Ausführen" um das Projekt in einer Sandbox auszuführen.',
                        es: 'Haz clic en "Ejecutar" para ejecutar el proyecto en un sandbox efímero.' },
  loadingStudio:      { en: 'Loading Studio…',       ro: 'Se încarcă Studio…',    fr: 'Chargement du Studio…',de: 'Studio wird geladen…',es: 'Cargando Studio…' },
  pickOrCreate:       { en: 'Pick or create a file on the left.',
                        ro: 'Alege sau creează un fișier din stânga.',
                        fr: 'Choisissez ou créez un fichier à gauche.',
                        de: 'Wählen oder erstellen Sie eine Datei links.',
                        es: 'Elige o crea un archivo a la izquierda.' },
  newProjectName:     { en: 'New project name:',     ro: 'Numele proiectului nou:',fr: 'Nom du nouveau projet :',de: 'Name des neuen Projekts:',es: 'Nombre del nuevo proyecto:' },
  renameProject:      { en: 'Rename project:',       ro: 'Redenumește proiectul:',fr: 'Renommer le projet :',de: 'Projekt umbenennen:', es: 'Renombrar proyecto:' },
  deleteConfirm:      { en: 'Delete project',        ro: 'Șterge proiectul',      fr: 'Supprimer le projet', de: 'Projekt löschen',     es: 'Eliminar proyecto' },
  cannotUndo:         { en: 'This cannot be undone.', ro: 'Această acțiune nu poate fi anulată.',fr: 'Cette action est irréversible.',de: 'Diese Aktion kann nicht rückgängig gemacht werden.',es: 'Esta acción no se puede deshacer.' },
  projectDeleted:     { en: 'Project deleted',       ro: 'Proiect șters',         fr: 'Projet supprimé',     de: 'Projekt gelöscht',    es: 'Proyecto eliminado' },
  timedOut:           { en: 'timed out',             ro: 'expirat',               fr: 'délai dépassé',       de: 'Zeitüberschreitung',  es: 'tiempo agotado' },
  rememberMe:         { en: 'Remember me',           ro: 'Ține-mă minte',         fr: 'Se souvenir de moi',  de: 'Angemeldet bleiben',  es: 'Recuérdame' },

  // ─── Contact Page ─────────────────────────────────────
  backToKelionFull:    { en: '← Back to Kelion',     ro: '← Înapoi la Kelion',   fr: '← Retour à Kelion',  de: '← Zurück zu Kelion', es: '← Volver a Kelion' },
  contactTitle:        { en: 'Contact us',            ro: 'Contactați-ne',         fr: 'Contactez-nous',     de: 'Kontakt',             es: 'Contáctenos' },
  contactSubtitle:     { en: 'Tell us what you need and we\'ll route it to the right team. We usually reply within one business day. For urgent account issues, email us directly at',
                          ro: 'Spuneți-ne ce aveți nevoie și vom direcționa mesajul către echipa potrivită. Răspundem de obicei într-o zi lucrătoare. Pentru probleme urgente, scrieți-ne direct la',
                          fr: 'Dites-nous ce dont vous avez besoin et nous transmettrons au bon service. Nous répondons généralement sous un jour ouvré. Pour les urgences, écrivez-nous à',
                          de: 'Teilen Sie uns mit, was Sie brauchen, und wir leiten es an das richtige Team weiter. Wir antworten in der Regel innerhalb eines Werktages. Für dringende Probleme schreiben Sie uns direkt an',
                          es: 'Cuéntenos qué necesita y lo dirigiremos al equipo adecuado. Generalmente respondemos en un día hábil. Para problemas urgentes, escríbanos directamente a' },
  yourName:            { en: 'Your name',             ro: 'Numele dvs.',           fr: 'Votre nom',          de: 'Ihr Name',            es: 'Su nombre' },
  emailLabel:          { en: 'Email',                 ro: 'Email',                 fr: 'E-mail',             de: 'E-Mail',              es: 'Correo' },
  department:          { en: 'Department',            ro: 'Departament',           fr: 'Département',        de: 'Abteilung',           es: 'Departamento' },
  subject:             { en: 'Subject',               ro: 'Subiect',               fr: 'Objet',              de: 'Betreff',             es: 'Asunto' },
  message:             { en: 'Message',               ro: 'Mesaj',                 fr: 'Message',            de: 'Nachricht',           es: 'Mensaje' },
  sendMessage:         { en: 'Send message',          ro: 'Trimite mesajul',       fr: 'Envoyer le message', de: 'Nachricht senden',    es: 'Enviar mensaje' },
  submitHint:          { en: 'Submitting will open your email app pre-filled with your message. If nothing happens, email us directly at',
                          ro: 'Trimiterea va deschide aplicația de email cu mesajul pre-completat. Dacă nu se întâmplă nimic, scrieți-ne direct la',
                          fr: 'L\'envoi ouvrira votre messagerie avec le message pré-rempli. Si rien ne se passe, écrivez-nous directement à',
                          de: 'Das Absenden öffnet Ihre E-Mail-App mit der vorausgefüllten Nachricht. Falls nichts passiert, schreiben Sie uns direkt an',
                          es: 'El envío abrirá su aplicación de correo con el mensaje pre-completado. Si no pasa nada, escríbanos directamente a' },
  subjectPlaceholder:  { en: 'Short summary (optional)', ro: 'Rezumat scurt (opțional)', fr: 'Résumé court (optionnel)', de: 'Kurze Zusammenfassung (optional)', es: 'Resumen corto (opcional)' },
  messagePlaceholder:  { en: 'How can we help?',      ro: 'Cum vă putem ajuta?',   fr: 'Comment pouvons-nous vous aider ?', de: 'Wie können wir helfen?', es: '¿Cómo podemos ayudarle?' },
  generalInquiry:      { en: 'General inquiry',       ro: 'Întrebare generală',    fr: 'Demande générale',   de: 'Allgemeine Anfrage',  es: 'Consulta general' },
  technicalSupport:    { en: 'Technical support',     ro: 'Suport tehnic',         fr: 'Support technique',  de: 'Technischer Support', es: 'Soporte técnico' },
  billingAndSubs:      { en: 'Billing & subscriptions',ro: 'Facturare și abonamente',fr: 'Facturation et abonnements',de: 'Abrechnung & Abonnements',es: 'Facturación y suscripciones' },
  salesAndDemos:       { en: 'Sales & demos',         ro: 'Vânzări și demo-uri',   fr: 'Ventes et démos',    de: 'Vertrieb & Demos',    es: 'Ventas y demos' },
  partnerships:        { en: 'Partnerships',          ro: 'Parteneriate',          fr: 'Partenariats',       de: 'Partnerschaften',     es: 'Asociaciones' },
  pressAndMedia:       { en: 'Press & media',         ro: 'Presă și media',        fr: 'Presse et médias',   de: 'Presse & Medien',     es: 'Prensa y medios' },
  careers:             { en: 'Careers',               ro: 'Cariere',               fr: 'Carrières',          de: 'Karriere',            es: 'Empleo' },
  privacyAndData:      { en: 'Privacy & data requests',ro: 'Confidențialitate și date',fr: 'Confidentialité et données',de: 'Datenschutz & Datenanfragen',es: 'Privacidad y datos' },
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
