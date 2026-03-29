// App — i18n (Internationalisation) Module

// ── Dynamic app name helper ──
function _appName() {
  return (window.APP_CONFIG && window.APP_CONFIG.appName) || _appName();
}
// Lightweight translation system. Reads/writes `kelion_lang` in localStorage.
// Usage:
//   i18n.setLanguage('en')         — switch UI language
//   i18n.getLanguage()             — returns current language code
//   i18n.t('key')                  — translate a single key
//   i18n.detectLanguage(text)      — detect language from text, returns lang code
(function () {
  ('use strict');

  // Initial supported set — extended dynamically from /api/languages
  let SUPPORTED = [
    'en',
    'ro',
    'fr',
    'de',
    'es',
    'it',
    'pt',
    'nl',
    'pl',
    'cs',
    'sk',
    'hr',
    'sr',
    'sl',
    'bs',
    'bg',
    'mk',
    'sq',
    'hu',
    'fi',
    'et',
    'lv',
    'lt',
    'sv',
    'no',
    'da',
    'is',
    'ga',
    'cy',
    'eu',
    'ca',
    'gl',
    'tr',
    'az',
    'uz',
    'kk',
    'ms',
    'id',
    'tl',
    'vi',
    'sw',
    'ha',
    'yo',
    'zu',
    'af',
    'mt',
    'eo',
    'la',
    'ar',
    'fa',
    'ur',
    'he',
    'yi',
    'hi',
    'mr',
    'ne',
    'bn',
    'pa',
    'gu',
    'ta',
    'te',
    'kn',
    'ml',
    'si',
    'th',
    'lo',
    'my',
    'km',
    'ka',
    'hy',
    'am',
    'ja',
    'zh',
    'ko',
    'bo',
    'mn',
    'ru',
    'uk',
  ];
  // Detect default language dynamically from browser — zero hardcode
  const DEFAULT_LANG = (function () {
    try {
      const bl = (navigator.language || navigator.userLanguage || '').split('-')[0].toLowerCase();
      return bl || 'en';
    } catch (_e) {
      return 'en';
    }
  })();

  // Fetch full language list from server (non-blocking)
  (function fetchSupportedLanguages() {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/languages', true);
      xhr.timeout = 5000;
      xhr.onload = function () {
        if (xhr.status === 200) {
          try {
            const langs = JSON.parse(xhr.responseText);
            if (Array.isArray(langs) && langs.length > 0) {
              SUPPORTED = langs.map(function (l) {
                return l.code;
              });
            }
          } catch (_e) {
            /* keep defaults */
          }
        }
      };
      xhr.send();
    } catch (_e) {
      /* keep defaults */
    }
  })();

  const translations = {
    en: {
      // ─── Onboarding ───────────────────────────────────────────
      'onboarding.title': 'Welcome to',
      'onboarding.subtitle': 'Your personal AI assistant — smart, fast, multilingual.',
      'onboarding.start': 'Get Started →',
      'onboarding.plan.title': '💎 Choose your plan',
      'onboarding.plan.free.name': 'Free',
      'onboarding.plan.free.desc': '20 messages/day · Basic features',
      'onboarding.plan.free.price': 'Free',
      'onboarding.plan.pro.name': 'Pro',
      'onboarding.plan.pro.desc': '200 messages/day · All features',
      'onboarding.plan.pro.price': '{price}',
      'onboarding.plan.premium.name': 'Premium',
      'onboarding.plan.premium.desc': 'Unlimited · Maximum priority',
      'onboarding.plan.premium.price': '{price}',
      'onboarding.plan.perMonth': '/month',
      'onboarding.plan.perYear': '/year',
      'onboarding.finish': 'Finish →',
      'onboarding.back': '← Back',
      // ─── Auth ─────────────────────────────────────────────────
      'auth.subtitle': 'Your smart AI assistant',
      'auth.title': 'Sign In',
      'auth.name.placeholder': 'Your name',
      'auth.email.placeholder': 'Email',
      'auth.password.placeholder': 'Password',
      'auth.submit': 'Sign In',
      'auth.toggle': 'No account → Create',
      'auth.guest': 'Continue without account',
      // ─── Navigation ───────────────────────────────────────────
      'nav.home': 'Home',
      'nav.features': 'Features',
      'nav.pricing': 'Pricing',
      'nav.developer': 'Developer',
      'nav.docs': 'Docs',
      'nav.get_started': 'Get Started',
      'nav.lang_aria': 'Change language',
      // ─── History sidebar ──────────────────────────────────────
      'history.title': 'Conversations',
      // ─── Chat ─────────────────────────────────────────────────
      'thinking.text': 'Thinking...',
      'input.placeholder': 'Type or speak...',
      // ─── Monitor ─────────────────────────────────────────────
      'monitor.default.text': 'The monitor will display content when the AI assistant shares information.',
      'monitor.default.hint': 'Say "what\'s ahead" or "show me a map"',
      'monitor.title': 'Monitor',
      // ─── Drop zone ────────────────────────────────────────────
      'drop.text': 'Drop file here',
      // ─── Pricing modal ────────────────────────────────────────
      'pricing.modal.title': 'Choose your plan',
      // ─── PWA ─────────────────────────────────────────────────
      'pwa.title': 'Install ' + _appName(),
      'pwa.subtitle': 'Quick access from your screen',
      'pwa.install': 'Install',
      'pwa.dismiss': 'Not now',
      // ─── Error page ───────────────────────────────────────────
      'error.title': 'Oops! Something went wrong',
      'error.description': 'The server encountered a problem. The team has been notified.',
      'error.retry': 'Try Again',
      'error.report': 'Report Issue',
      // ─── Pricing page ─────────────────────────────────────────
      'pricing.hero.title': 'Choose the right plan for you',
      'pricing.hero.subtitle': 'Access the most advanced AI assistant with 3D avatar',
      'pricing.loading': 'Loading plans...',
      'pricing.nav.home': 'Home',
      'pricing.nav.account': 'My account',
      'pricing.faq.title': 'Frequently Asked Questions',
      'pricing.faq.cancel.q': 'Can I cancel anytime?',
      'pricing.faq.cancel.a':
        'Yes, you can cancel your subscription at any time from the billing page. There are no penalties.',
      'pricing.faq.payment.q': 'What payment methods do you accept?',
      'pricing.faq.payment.a': 'We accept all credit/debit cards (Visa, Mastercard, Amex) through Stripe.',
      'pricing.faq.trial.q': 'Is there a trial period?',
      'pricing.faq.trial.a':
        'The Free plan is permanently available. Paid plans can be cancelled within 30 days for a full refund.',
      'pricing.faq.enterprise.q': 'What is the Enterprise plan?',
      'pricing.faq.enterprise.a':
        'Unlimited access to all features, priority support and guaranteed SLA for teams and companies.',
      'pricing.footer': '© ' + new Date().getFullYear() + ' ' + _appName() + '.',
      'pricing.terms': 'Terms',
      'pricing.privacy': 'Privacy',
      // ─── Settings page ────────────────────────────────────────
      'settings.title': '⚙️ Settings',
      'settings.subtitle': 'Customize your ' + _appName() + ' experience',
      'settings.lang.section': '🌍 Language & Region',
      'settings.lang.label': 'Interface language',
      'settings.lang.desc': 'The language in which you receive AI responses',
      'settings.theme.section': '🎨 Theme',
      'settings.theme.label': 'Visual theme',
      'settings.theme.desc': _appName() + ' is optimised for dark mode',
      'settings.theme.unavailable': 'Unavailable at this time',
      'settings.notif.section': '🔔 Notifications',
      'settings.notif.browser.label': 'Browser notifications',
      'settings.notif.browser.desc': 'Receive an alert when the AI finishes responding',
      'settings.notif.sounds.label': 'UI sounds',
      'settings.notif.sounds.desc': 'Sounds when sending and receiving messages',

      'settings.api.section': '🔑 API & Integrations',
      'settings.api.label': 'API Keys',
      'settings.api.desc': 'Manage API keys for external integrations',
      'settings.api.portal': 'Developer Portal →',
      'settings.sub.section': '💳 Subscription',
      'settings.nav.home': 'Home',
      'settings.nav.pricing': 'Pricing',
      'settings.nav.developer': 'Developer',
      // ─── Chat / App runtime ───────────────────────────────────
      'app.connectionError': 'Connection error.',
      'app.genericError': 'Error.',
      'app.tooManyMessages': '\u23f3 Too many messages. Please wait a moment.',
      'app.trialExpiredTitle': 'Free trial expired',
      'app.trialExpiredMessage':
        'Your 7-day free trial has ended. Create an account or subscribe to keep using ' + _appName() + '.',
      'app.dailyLimitTitle': 'Daily limit reached',
      'app.dailyLimitMessage': 'You have used all free messages for today. Create an account or upgrade for more.',
      'app.messagesCount': '{remaining}/{limit} messages',
      'app.remaining': '{remaining}/{limit} remaining',
      // ─── Payments UI ──────────────────────────────────────────
      'payments.loading': 'Loading...',
      'payments.unavailable': 'Plans are not available at the moment.',
      'payments.currentPlan': 'Current plan',
      'payments.included': 'Included',
      'payments.upgradeTo': 'Upgrade to {name}',
      'payments.manageSubscription': 'Manage subscription',
      'payments.success': '\u2705 Payment processed successfully! Your plan has been activated.',
      'payments.cancelled': 'Payment was cancelled. You can try again anytime.',
      // ─── Shared auth ──────────────────────────────────────────
      'shared.signInRequired': 'You need to be signed in to upgrade.',
      // ─── UI common ────────────────────────────────────────────
      'ui.close': 'Close',
      // ─── Voice ─────────────────────────────────────────────────
      'voice.realtimeUnavailable': '\u26a0\ufe0f Realtime unavailable',
      // ─── Mobile / Navigation ──────────────────────────────────
      'mobile.navigateTo': 'Navigate to',
      'mobile.from': 'From:',
      'mobile.openGoogleMaps': 'Open Google Maps',
      'mobile.locationUnavailable': 'Location unavailable',
      'mobile.sendCoordinates': 'Send coordinates to contacts',
      'mobile.locationOnMap': 'Location on map',
      'mobile.call112': 'Call 112',
      'mobile.ambulance': 'Ambulance',
      'mobile.police': 'Police',
      'mobile.sos.confirm':
        'WARNING: You are about to trigger an SOS emergency alert!\n\nThis will:\n- Show your GPS coordinates\n- Offer links to 112, SMS\n- Save location in database\n\nConfirm you have a real emergency?',
      'mobile.sos.shareText': 'SOS EMERGENCY! I need help!',
    },
    ro: {
      'onboarding.title': 'Bun venit la',
      'onboarding.subtitle': 'Asistentul tău AI personal — inteligent, rapid, multilingv.',
      'onboarding.start': 'Începe →',
      'onboarding.plan.title': '💎 Alege planul tău',
      'onboarding.plan.free.name': 'Free',
      'onboarding.plan.free.desc': '20 mesaje/zi · Funcții de bază',
      'onboarding.plan.free.price': 'Gratuit',
      'onboarding.plan.pro.name': 'Pro',
      'onboarding.plan.pro.desc': '200 mesaje/zi · Toate funcțiile',
      'onboarding.plan.pro.price': '{price}',
      'onboarding.plan.premium.name': 'Premium',
      'onboarding.plan.premium.desc': 'Nelimitat · Prioritate maximă',
      'onboarding.plan.premium.price': '{price}',
      'onboarding.plan.perMonth': '/lună',
      'onboarding.plan.perYear': '/an',
      'onboarding.finish': 'Finalizează →',
      'onboarding.back': '← Înapoi',
      'auth.subtitle': 'Asistentul tău AI inteligent',
      'auth.title': 'Autentificare',
      'auth.name.placeholder': 'Numele tău',
      'auth.email.placeholder': 'Email',
      'auth.password.placeholder': 'Parolă',
      'auth.submit': 'Intră',
      'auth.toggle': 'Nu am cont → Creează',
      'auth.guest': 'Continuă fără cont',
      'nav.home': 'Acasă',
      'nav.features': 'Funcții',
      'nav.pricing': 'Prețuri',
      'nav.developer': 'Developer',
      'nav.docs': 'Docs',
      'nav.get_started': 'Începe',
      'nav.lang_aria': 'Schimbă limba',
      'history.title': 'Conversații',
      'thinking.text': 'Se gândește...',
      'input.placeholder': 'Scrie sau vorbește...',
      'monitor.default.text': 'Monitorul va afișa conținut când asistentul AI partajează informații.',
      'monitor.default.hint': 'Spune "ce e în față" sau "arată-mi o hartă"',
      'monitor.title': 'Monitor',
      'drop.text': 'Trage fișierul aici',
      'pricing.modal.title': 'Alege planul tău',
      'pwa.title': 'Instalează ' + _appName(),
      'pwa.subtitle': 'Acces rapid de pe ecranul tău',
      'pwa.install': 'Instalează',
      'pwa.dismiss': 'Nu acum',
      'error.title': 'Oops! Ceva a mers prost',
      'error.description': 'Serverul a întâmpinat o problemă. Echipa a fost notificată.',
      'error.retry': 'Reîncearcă',
      'error.report': 'Raportează problema',
      'pricing.hero.title': 'Alege planul potrivit pentru tine',
      'pricing.hero.subtitle': 'Acces la cel mai avansat asistent AI cu avatar 3D',
      'pricing.loading': 'Se încarcă planurile...',
      'pricing.nav.home': 'Acasă',
      'pricing.nav.account': 'Contul meu',
      'pricing.faq.title': 'Întrebări frecvente',
      'pricing.faq.cancel.q': 'Pot anula oricând?',
      'pricing.faq.cancel.a': 'Da, poți anula abonamentul oricând din pagina de billing. Nu există penalizări.',
      'pricing.faq.payment.q': 'Ce metode de plată acceptați?',
      'pricing.faq.payment.a': 'Acceptăm toate cardurile de credit/debit (Visa, Mastercard, Amex) prin Stripe.',
      'pricing.faq.trial.q': 'Există perioadă de probă?',
      'pricing.faq.trial.a':
        'Planul Free este disponibil permanent. Planurile plătite pot fi anulate în 30 de zile pentru rambursare completă.',
      'pricing.faq.enterprise.q': 'Ce este planul Enterprise?',
      'pricing.faq.enterprise.a':
        'Acces nelimitat la toate funcționalitățile, suport prioritar și SLA garantat pentru echipe și companii.',
      'pricing.footer': '© ' + new Date().getFullYear() + ' ' + _appName() + '.',
      'pricing.terms': 'Termeni',
      'pricing.privacy': 'Confidențialitate',
      'settings.title': '⚙️ Setări',
      'settings.subtitle': 'Personalizează experiența ' + _appName(),
      'settings.lang.section': '🌍 Limbă & Regiune',
      'settings.lang.label': 'Limbă interfață',
      'settings.lang.desc': 'Limba în care primești răspunsurile AI',
      'settings.theme.section': '🎨 Temă',
      'settings.theme.label': 'Temă vizuală',
      'settings.theme.desc': _appName() + ' este optimizat pentru dark mode',
      'settings.theme.unavailable': 'Indisponibil momentan',
      'settings.notif.section': '🔔 Notificări',
      'settings.notif.browser.label': 'Notificări browser',
      'settings.notif.browser.desc': 'Primește alertă când AI termină de răspuns',
      'settings.notif.sounds.label': 'Sunete UI',
      'settings.notif.sounds.desc': 'Sunete la trimiterea și primirea mesajelor',

      'settings.api.section': '🔑 API & Integrări',
      'settings.api.label': 'API Keys',
      'settings.api.desc': 'Gestionează cheile API pentru integrări externe',
      'settings.api.portal': 'Developer Portal →',
      'settings.sub.section': '💳 Abonament',
      'settings.nav.home': 'Acasă',
      'settings.nav.pricing': 'Prețuri',
      'settings.nav.developer': 'Developer', // ─── Chat / App runtime ───────────────────────────────────
      'app.connectionError': 'Eroare de conexiune.',
      'app.genericError': 'Eroare.',
      'app.tooManyMessages': '\u23f3 Prea multe mesaje. Te rog a\u0219teapt\u0103 pu\u021bin.',
      'app.trialExpiredTitle': 'Perioada de prob\u0103 a expirat',
      'app.trialExpiredMessage':
        'Perioada ta gratuit\u0103 de 7 zile s-a \u00eencheiat. Creeaz\u0103 un cont sau aboneaz\u0103-te pentru a continua.',
      'app.dailyLimitTitle': 'Limit\u0103 zilnic\u0103 atins\u0103',
      'app.dailyLimitMessage':
        'Ai folosit toate mesajele gratuite pentru azi. Creeaz\u0103 un cont sau f\u0103 upgrade.',
      'app.messagesCount': '{remaining}/{limit} mesaje',
      'app.remaining': '{remaining}/{limit} r\u0103mase',
      // ─── Payments UI ──────────────────────────────────────────
      'payments.loading': 'Se \u00eencarc\u0103...',
      'payments.unavailable': 'Planurile nu sunt disponibile momentan.',
      'payments.currentPlan': 'Planul curent',
      'payments.included': 'Inclus',
      'payments.upgradeTo': 'Upgrade la {name}',
      'payments.manageSubscription': 'Gestioneaz\u0103 abonamentul',
      'payments.success': '\u2705 Plata a fost procesat\u0103 cu succes! Planul t\u0103u a fost activat.',
      'payments.cancelled': 'Plata a fost anulat\u0103. Po\u021bi \u00eencerca din nou oric\u00e2nd.',
      // ─── Shared auth ──────────────────────────────────────────
      'shared.signInRequired': 'Trebuie s\u0103 fii autentificat pentru a face upgrade.',
      // ─── UI common ────────────────────────────────────────────
      'ui.close': '\u00cenchide',
      // ─── Voice ─────────────────────────────────────────────────
      'voice.realtimeUnavailable': '\u26a0\ufe0f Realtime indisponibil',
      // ─── Mobile / Navigation ──────────────────────────────────
      'mobile.navigateTo': 'Navigare spre',
      'mobile.from': 'De la:',
      'mobile.openGoogleMaps': 'Deschide Google Maps',
      'mobile.locationUnavailable': 'Locatie indisponibila',
      'mobile.sendCoordinates': 'Trimite coordonatele la contacte',
      'mobile.locationOnMap': 'Locatie pe harta',
      'mobile.call112': 'Suna 112',
      'mobile.ambulance': 'Ambulanta',
      'mobile.police': 'Politie',
      'mobile.sos.confirm':
        'ATENTIE: Vei declansa o alerta SOS de urgenta!\n\nAceasta va:\n- Afisa coordonatele tale GPS\n- Oferi link-uri catre 112, SMS\n- Salva locatia in baza de date\n\nConfirmi ca ai o urgenta reala?',
      'mobile.sos.shareText': 'SOS URGENTA! Am nevoie de ajutor!',
    },
    fr: {
      'onboarding.title': 'Bienvenue sur',
      'onboarding.subtitle': 'Votre assistant IA personnel — intelligent, rapide, multilingue.',
      'onboarding.start': 'Commencer →',
      'onboarding.plan.title': '💎 Choisissez votre plan',
      'onboarding.plan.free.name': 'Gratuit',
      'onboarding.plan.free.desc': '20 messages/jour · Fonctionnalités de base',
      'onboarding.plan.free.price': 'Gratuit',
      'onboarding.plan.pro.name': 'Pro',
      'onboarding.plan.pro.desc': '200 messages/jour · Toutes les fonctionnalités',
      'onboarding.plan.pro.price': '{price}',
      'onboarding.plan.premium.name': 'Premium',
      'onboarding.plan.premium.desc': 'Illimité · Priorité maximale',
      'onboarding.plan.premium.price': '{price}',
      'onboarding.plan.perMonth': '/mois',
      'onboarding.plan.perYear': '/an',
      'onboarding.finish': 'Terminer →',
      'onboarding.back': '← Retour',
      'auth.subtitle': 'Votre assistant IA intelligent',
      'auth.title': 'Connexion',
      'auth.name.placeholder': 'Votre nom',
      'auth.email.placeholder': 'Email',
      'auth.password.placeholder': 'Mot de passe',
      'auth.submit': 'Se connecter',
      'auth.toggle': 'Pas de compte → Créer',
      'auth.guest': 'Continuer sans compte',
      'nav.home': 'Accueil',
      'nav.features': 'Fonctionnalités',
      'nav.pricing': 'Tarifs',
      'nav.developer': 'Développeur',
      'nav.docs': 'Docs',
      'nav.get_started': 'Commencer',
      'nav.lang_aria': 'Changer de langue',
      'history.title': 'Conversations',
      'thinking.text': 'Réflexion...',
      'input.placeholder': 'Écrivez ou parlez...',
      'monitor.default.text': "Le moniteur affichera du contenu lorsque l'assistant IA partagera des informations.",
      'monitor.default.hint': 'Dites "qu\'est-ce qu\'il y a devant" ou "montrez-moi une carte"',
      'monitor.title': 'Moniteur',
      'drop.text': 'Déposez le fichier ici',
      'pricing.modal.title': 'Choisissez votre plan',
      'pwa.title': 'Installer ' + _appName(),
      'pwa.subtitle': 'Accès rapide depuis votre écran',
      'pwa.install': 'Installer',
      'pwa.dismiss': 'Pas maintenant',
      'error.title': "Oops ! Quelque chose s'est mal passé",
      'error.description': "Le serveur a rencontré un problème. L'équipe a été notifiée.",
      'error.retry': 'Réessayer',
      'error.report': 'Signaler le problème',
      'pricing.hero.title': 'Choisissez le plan qui vous convient',
      'pricing.hero.subtitle': "Accédez à l'assistant IA le plus avancé avec avatar 3D",
      'pricing.loading': 'Chargement des plans...',
      'pricing.nav.home': 'Accueil',
      'pricing.nav.account': 'Mon compte',
      'pricing.faq.title': 'Questions fréquentes',
      'pricing.faq.cancel.q': 'Puis-je annuler à tout moment ?',
      'pricing.faq.cancel.a':
        "Oui, vous pouvez annuler votre abonnement à tout moment depuis la page de facturation. Il n'y a pas de pénalités.",
      'pricing.faq.payment.q': 'Quels moyens de paiement acceptez-vous ?',
      'pricing.faq.payment.a': 'Nous acceptons toutes les cartes de crédit/débit (Visa, Mastercard, Amex) via Stripe.',
      'pricing.faq.trial.q': "Y a-t-il une période d'essai ?",
      'pricing.faq.trial.a':
        'Le plan Gratuit est disponible en permanence. Les plans payants peuvent être annulés dans les 30 jours pour un remboursement complet.',
      'pricing.faq.enterprise.q': "Qu'est-ce que le plan Entreprise ?",
      'pricing.faq.enterprise.a':
        'Accès illimité à toutes les fonctionnalités, support prioritaire et SLA garanti pour les équipes et entreprises.',
      'pricing.footer': '© ' + new Date().getFullYear() + ' ' + _appName() + '.',
      'pricing.terms': 'Conditions',
      'pricing.privacy': 'Confidentialité',
      'settings.title': '⚙️ Paramètres',
      'settings.subtitle': 'Personnalisez votre expérience ' + _appName(),
      'settings.lang.section': '🌍 Langue & Région',
      'settings.lang.label': "Langue de l'interface",
      'settings.lang.desc': 'La langue dans laquelle vous recevez les réponses IA',
      'settings.theme.section': '🎨 Thème',
      'settings.theme.label': 'Thème visuel',
      'settings.theme.desc': _appName() + ' est optimisé pour le mode sombre',
      'settings.theme.unavailable': 'Indisponible pour le moment',
      'settings.notif.section': '🔔 Notifications',
      'settings.notif.browser.label': 'Notifications navigateur',
      'settings.notif.browser.desc': "Recevez une alerte quand l'IA a terminé de répondre",
      'settings.notif.sounds.label': 'Sons UI',
      'settings.notif.sounds.desc': "Sons lors de l'envoi et de la réception des messages",

      'settings.api.section': '🔑 API & Intégrations',
      'settings.api.label': 'Clés API',
      'settings.api.desc': 'Gérez les clés API pour les intégrations externes',
      'settings.api.portal': 'Portail Développeur →',
      'settings.sub.section': '💳 Abonnement',
      'settings.nav.home': 'Accueil',
      'settings.nav.pricing': 'Tarifs',
      'settings.nav.developer': 'Développeur',
      'app.connectionError': 'Erreur de connexion.',
      'app.genericError': 'Erreur.',
      'app.tooManyMessages': '\u23f3 Trop de messages. Veuillez patienter.',
      'app.trialExpiredTitle': 'Essai gratuit expir\u00e9',
      'app.trialExpiredMessage':
        'Votre essai gratuit de 7 jours est termin\u00e9. Cr\u00e9ez un compte pour continuer.',
      'app.dailyLimitTitle': 'Limite journali\u00e8re atteinte',
      'app.dailyLimitMessage':
        'Vous avez utilis\u00e9 tous les messages gratuits. Cr\u00e9ez un compte ou passez \u00e0 un plan sup\u00e9rieur.',
      'payments.loading': 'Chargement...',
      'payments.unavailable': 'Les plans ne sont pas disponibles pour le moment.',
      'payments.currentPlan': 'Plan actuel',
      'payments.included': 'Inclus',
      'payments.upgradeTo': 'Passer \u00e0 {name}',
      'payments.manageSubscription': "G\u00e9rer l'abonnement",
      'payments.success': '\u2705 Paiement trait\u00e9 avec succ\u00e8s ! Votre plan a \u00e9t\u00e9 activ\u00e9.',
      'payments.cancelled': 'Paiement annul\u00e9. Vous pouvez r\u00e9essayer \u00e0 tout moment.',
      'shared.signInRequired': 'Vous devez \u00eatre connect\u00e9 pour passer \u00e0 un plan sup\u00e9rieur.',
    },
    de: {
      'onboarding.title': 'Willkommen bei',
      'onboarding.subtitle': 'Ihr persönlicher KI-Assistent — intelligent, schnell, mehrsprachig.',
      'onboarding.start': 'Loslegen →',
      'onboarding.plan.title': '💎 Wählen Sie Ihren Plan',
      'onboarding.plan.free.name': 'Kostenlos',
      'onboarding.plan.free.desc': '20 Nachrichten/Tag · Grundfunktionen',
      'onboarding.plan.free.price': 'Kostenlos',
      'onboarding.plan.pro.name': 'Pro',
      'onboarding.plan.pro.desc': '200 Nachrichten/Tag · Alle Funktionen',
      'onboarding.plan.pro.price': '{price}',
      'onboarding.plan.premium.name': 'Premium',
      'onboarding.plan.premium.desc': 'Unbegrenzt · Höchste Priorität',
      'onboarding.plan.premium.price': '{price}',
      'onboarding.plan.perMonth': '/Monat',
      'onboarding.plan.perYear': '/Jahr',
      'onboarding.finish': 'Fertigstellen →',
      'onboarding.back': '← Zurück',
      'auth.subtitle': 'Ihr intelligenter KI-Assistent',
      'auth.title': 'Anmelden',
      'auth.name.placeholder': 'Ihr Name',
      'auth.email.placeholder': 'E-Mail',
      'auth.password.placeholder': 'Passwort',
      'auth.submit': 'Anmelden',
      'auth.toggle': 'Kein Konto → Erstellen',
      'auth.guest': 'Ohne Konto fortfahren',
      'nav.home': 'Startseite',
      'nav.features': 'Funktionen',
      'nav.pricing': 'Preise',
      'nav.developer': 'Entwickler',
      'nav.docs': 'Docs',
      'nav.get_started': 'Loslegen',
      'nav.lang_aria': 'Sprache ändern',
      'history.title': 'Gespräche',
      'thinking.text': 'Denkt nach...',
      'input.placeholder': 'Tippen oder sprechen...',
      'monitor.default.text': 'Der Monitor zeigt Inhalte an, wenn der KI-Assistent Informationen teilt.',
      'monitor.default.hint': 'Sagen Sie "was ist vorne" oder "zeig mir eine Karte"',
      'monitor.title': 'Monitor',
      'drop.text': 'Datei hier ablegen',
      'pricing.modal.title': 'Wählen Sie Ihren Plan',
      'pwa.title': _appName() + ' installieren',
      'pwa.subtitle': 'Schneller Zugriff von Ihrem Bildschirm',
      'pwa.install': 'Installieren',
      'pwa.dismiss': 'Nicht jetzt',
      'error.title': 'Oops! Etwas ist schiefgelaufen',
      'error.description': 'Der Server ist auf ein Problem gestoßen. Das Team wurde benachrichtigt.',
      'error.retry': 'Erneut versuchen',
      'error.report': 'Problem melden',
      'pricing.hero.title': 'Wählen Sie den richtigen Plan für Sie',
      'pricing.hero.subtitle': 'Zugang zum fortschrittlichsten KI-Assistenten mit 3D-Avatar',
      'pricing.loading': 'Pläne werden geladen...',
      'pricing.nav.home': 'Startseite',
      'pricing.nav.account': 'Mein Konto',
      'pricing.faq.title': 'Häufig gestellte Fragen',
      'pricing.faq.cancel.q': 'Kann ich jederzeit kündigen?',
      'pricing.faq.cancel.a':
        'Ja, Sie können Ihr Abonnement jederzeit über die Abrechnungsseite kündigen. Es gibt keine Strafen.',
      'pricing.faq.payment.q': 'Welche Zahlungsmethoden akzeptieren Sie?',
      'pricing.faq.payment.a': 'Wir akzeptieren alle Kredit-/Debitkarten (Visa, Mastercard, Amex) über Stripe.',
      'pricing.faq.trial.q': 'Gibt es eine Testphase?',
      'pricing.faq.trial.a':
        'Der kostenlose Plan ist dauerhaft verfügbar. Bezahlte Pläne können innerhalb von 30 Tagen für eine vollständige Rückerstattung storniert werden.',
      'pricing.faq.enterprise.q': 'Was ist der Enterprise-Plan?',
      'pricing.faq.enterprise.a':
        'Unbegrenzter Zugang zu allen Funktionen, priorisierter Support und garantiertes SLA für Teams und Unternehmen.',
      'pricing.footer': '© ' + new Date().getFullYear() + ' ' + _appName() + '.',
      'pricing.terms': 'Bedingungen',
      'pricing.privacy': 'Datenschutz',
      'settings.title': '⚙️ Einstellungen',
      'settings.subtitle': 'Passen Sie Ihre ' + _appName() + '-Erfahrung an',
      'settings.lang.section': '🌍 Sprache & Region',
      'settings.lang.label': 'Oberflächensprache',
      'settings.lang.desc': 'Die Sprache, in der Sie KI-Antworten erhalten',
      'settings.theme.section': '🎨 Thema',
      'settings.theme.label': 'Visuelles Thema',
      'settings.theme.desc': _appName() + ' ist für den Dunkelmodus optimiert',
      'settings.theme.unavailable': 'Derzeit nicht verfügbar',
      'settings.notif.section': '🔔 Benachrichtigungen',
      'settings.notif.browser.label': 'Browser-Benachrichtigungen',
      'settings.notif.browser.desc': 'Erhalten Sie eine Benachrichtigung, wenn die KI fertig ist',
      'settings.notif.sounds.label': 'UI-Töne',
      'settings.notif.sounds.desc': 'Töne beim Senden und Empfangen von Nachrichten',

      'settings.api.section': '🔑 API & Integrationen',
      'settings.api.label': 'API-Schlüssel',
      'settings.api.desc': 'API-Schlüssel für externe Integrationen verwalten',
      'settings.api.portal': 'Entwicklerportal →',
      'settings.sub.section': '💳 Abonnement',
      'settings.nav.home': 'Startseite',
      'settings.nav.pricing': 'Preise',
      'settings.nav.developer': 'Entwickler',
      'app.connectionError': 'Verbindungsfehler.',
      'app.genericError': 'Fehler.',
      'app.tooManyMessages': '\u23f3 Zu viele Nachrichten. Bitte warten.',
      'payments.loading': 'Wird geladen...',
      'payments.unavailable': 'Pl\u00e4ne sind derzeit nicht verf\u00fcgbar.',
      'payments.currentPlan': 'Aktueller Plan',
      'payments.included': 'Enthalten',
      'payments.upgradeTo': 'Upgrade auf {name}',
      'payments.manageSubscription': 'Abonnement verwalten',
      'shared.signInRequired': 'Sie m\u00fcssen angemeldet sein, um ein Upgrade durchzuf\u00fchren.',
    },
    es: {
      'onboarding.title': 'Bienvenido a',
      'onboarding.subtitle': 'Tu asistente IA personal — inteligente, rápido, multilingüe.',
      'onboarding.start': 'Empezar →',
      'onboarding.plan.title': '💎 Elige tu plan',
      'onboarding.plan.free.name': 'Gratuito',
      'onboarding.plan.free.desc': '20 mensajes/día · Funciones básicas',
      'onboarding.plan.free.price': 'Gratis',
      'onboarding.plan.pro.name': 'Pro',
      'onboarding.plan.pro.desc': '200 mensajes/día · Todas las funciones',
      'onboarding.plan.pro.price': '{price}',
      'onboarding.plan.premium.name': 'Premium',
      'onboarding.plan.premium.desc': 'Ilimitado · Máxima prioridad',
      'onboarding.plan.premium.price': '{price}',
      'onboarding.plan.perMonth': '/mes',
      'onboarding.plan.perYear': '/año',
      'onboarding.finish': 'Finalizar →',
      'onboarding.back': '← Atrás',
      'auth.subtitle': 'Tu asistente IA inteligente',
      'auth.title': 'Iniciar sesión',
      'auth.name.placeholder': 'Tu nombre',
      'auth.email.placeholder': 'Email',
      'auth.password.placeholder': 'Contraseña',
      'auth.submit': 'Entrar',
      'auth.toggle': 'No tengo cuenta → Crear',
      'auth.guest': 'Continuar sin cuenta',
      'nav.home': 'Inicio',
      'nav.features': 'Funciones',
      'nav.pricing': 'Precios',
      'nav.developer': 'Desarrollador',
      'nav.docs': 'Docs',
      'nav.get_started': 'Empezar',
      'nav.lang_aria': 'Cambiar idioma',
      'history.title': 'Conversaciones',
      'thinking.text': 'Pensando...',
      'input.placeholder': 'Escribe o habla...',
      'monitor.default.text': 'El monitor mostrará contenido cuando el asistente IA comparta información.',
      'monitor.default.hint': 'Di "qué hay delante" o "muéstrame un mapa"',
      'monitor.title': 'Monitor',
      'drop.text': 'Arrastra el archivo aquí',
      'pricing.modal.title': 'Elige tu plan',
      'pwa.title': 'Instalar ' + _appName(),
      'pwa.subtitle': 'Acceso rápido desde tu pantalla',
      'pwa.install': 'Instalar',
      'pwa.dismiss': 'Ahora no',
      'error.title': '¡Vaya! Algo salió mal',
      'error.description': 'El servidor encontró un problema. El equipo ha sido notificado.',
      'error.retry': 'Reintentar',
      'error.report': 'Reportar problema',
      'pricing.hero.title': 'Elige el plan adecuado para ti',
      'pricing.hero.subtitle': 'Accede al asistente IA más avanzado con avatar 3D',
      'pricing.loading': 'Cargando planes...',
      'pricing.nav.home': 'Inicio',
      'pricing.nav.account': 'Mi cuenta',
      'pricing.faq.title': 'Preguntas frecuentes',
      'pricing.faq.cancel.q': '¿Puedo cancelar en cualquier momento?',
      'pricing.faq.cancel.a':
        'Sí, puedes cancelar tu suscripción en cualquier momento desde la página de facturación. No hay penalizaciones.',
      'pricing.faq.payment.q': '¿Qué métodos de pago aceptan?',
      'pricing.faq.payment.a':
        'Aceptamos todas las tarjetas de crédito/débito (Visa, Mastercard, Amex) a través de Stripe.',
      'pricing.faq.trial.q': '¿Hay un período de prueba?',
      'pricing.faq.trial.a':
        'El plan Gratuito está disponible permanentemente. Los planes de pago se pueden cancelar dentro de los 30 días para un reembolso completo.',
      'pricing.faq.enterprise.q': '¿Qué es el plan Empresa?',
      'pricing.faq.enterprise.a':
        'Acceso ilimitado a todas las funcionalidades, soporte prioritario y SLA garantizado para equipos y empresas.',
      'pricing.footer': '© ' + new Date().getFullYear() + ' ' + _appName() + '.',
      'pricing.terms': 'Términos',
      'pricing.privacy': 'Privacidad',
      'settings.title': '⚙️ Configuración',
      'settings.subtitle': 'Personaliza tu experiencia ' + _appName(),
      'settings.lang.section': '🌍 Idioma & Región',
      'settings.lang.label': 'Idioma de la interfaz',
      'settings.lang.desc': 'El idioma en el que recibes las respuestas de IA',
      'settings.theme.section': '🎨 Tema',
      'settings.theme.label': 'Tema visual',
      'settings.theme.desc': _appName() + ' está optimizado para el modo oscuro',
      'settings.theme.unavailable': 'No disponible en este momento',
      'settings.notif.section': '🔔 Notificaciones',
      'settings.notif.browser.label': 'Notificaciones del navegador',
      'settings.notif.browser.desc': 'Recibe una alerta cuando la IA termine de responder',
      'settings.notif.sounds.label': 'Sonidos UI',
      'settings.notif.sounds.desc': 'Sonidos al enviar y recibir mensajes',

      'settings.api.section': '🔑 API & Integraciones',
      'settings.api.label': 'Claves API',
      'settings.api.desc': 'Gestiona las claves API para integraciones externas',
      'settings.api.portal': 'Portal del Desarrollador →',
      'settings.sub.section': '💳 Suscripción',
      'settings.nav.home': 'Inicio',
      'settings.nav.pricing': 'Precios',
      'settings.nav.developer': 'Desarrollador',
      'app.connectionError': 'Error de conexi\u00f3n.',
      'app.genericError': 'Error.',
      'app.tooManyMessages': '\u23f3 Demasiados mensajes. Espera un momento.',
      'payments.loading': 'Cargando...',
      'payments.unavailable': 'Los planes no est\u00e1n disponibles en este momento.',
      'payments.currentPlan': 'Plan actual',
      'payments.included': 'Incluido',
      'payments.upgradeTo': 'Actualizar a {name}',
      'payments.manageSubscription': 'Gestionar suscripci\u00f3n',
      'shared.signInRequired': 'Debes iniciar sesi\u00f3n para actualizar.',
    },
    it: {
      'onboarding.title': 'Benvenuto su',
      'onboarding.subtitle': 'Il tuo assistente IA personale — intelligente, veloce, multilingue.',
      'onboarding.start': 'Inizia →',
      'onboarding.plan.title': '💎 Scegli il tuo piano',
      'onboarding.plan.free.name': 'Gratuito',
      'onboarding.plan.free.desc': '20 messaggi/giorno · Funzionalità di base',
      'onboarding.plan.free.price': 'Gratis',
      'onboarding.plan.pro.name': 'Pro',
      'onboarding.plan.pro.desc': '200 messaggi/giorno · Tutte le funzionalità',
      'onboarding.plan.pro.price': '{price}',
      'onboarding.plan.premium.name': 'Premium',
      'onboarding.plan.premium.desc': 'Illimitato · Priorità massima',
      'onboarding.plan.premium.price': '{price}',
      'onboarding.plan.perMonth': '/mese',
      'onboarding.plan.perYear': '/anno',
      'onboarding.finish': 'Concludi →',
      'onboarding.back': '← Indietro',
      'auth.subtitle': 'Il tuo assistente IA intelligente',
      'auth.title': 'Accedi',
      'auth.name.placeholder': 'Il tuo nome',
      'auth.email.placeholder': 'Email',
      'auth.password.placeholder': 'Password',
      'auth.submit': 'Accedi',
      'auth.toggle': 'Non ho un account → Crea',
      'auth.guest': 'Continua senza account',
      'nav.home': 'Home',
      'nav.features': 'Funzionalità',
      'nav.pricing': 'Prezzi',
      'nav.developer': 'Sviluppatore',
      'nav.docs': 'Docs',
      'nav.get_started': 'Inizia',
      'nav.lang_aria': 'Cambia lingua',
      'history.title': 'Conversazioni',
      'thinking.text': 'Sta pensando...',
      'input.placeholder': 'Scrivi o parla...',
      'monitor.default.text': "Il monitor mostrerà contenuto quando l'assistente IA condividerà informazioni.",
      'monitor.default.hint': 'Di\' "cosa c\'è davanti" o "mostrami una mappa"',
      'monitor.title': 'Monitor',
      'drop.text': 'Trascina il file qui',
      'pricing.modal.title': 'Scegli il tuo piano',
      'pwa.title': 'Installa ' + _appName(),
      'pwa.subtitle': 'Accesso rapido dal tuo schermo',
      'pwa.install': 'Installa',
      'pwa.dismiss': 'Non ora',
      'error.title': 'Oops! Qualcosa è andato storto',
      'error.description': 'Il server ha riscontrato un problema. Il team è stato notificato.',
      'error.retry': 'Riprova',
      'error.report': 'Segnala il problema',
      'pricing.hero.title': 'Scegli il piano giusto per te',
      'pricing.hero.subtitle': "Accedi all'assistente IA più avanzato con avatar 3D",
      'pricing.loading': 'Caricamento piani...',
      'pricing.nav.home': 'Home',
      'pricing.nav.account': 'Il mio account',
      'pricing.faq.title': 'Domande frequenti',
      'pricing.faq.cancel.q': 'Posso cancellare in qualsiasi momento?',
      'pricing.faq.cancel.a':
        'Sì, puoi cancellare il tuo abbonamento in qualsiasi momento dalla pagina di fatturazione. Non ci sono penali.',
      'pricing.faq.payment.q': 'Quali metodi di pagamento accettate?',
      'pricing.faq.payment.a': 'Accettiamo tutte le carte di credito/debito (Visa, Mastercard, Amex) tramite Stripe.',
      'pricing.faq.trial.q': "C'è un periodo di prova?",
      'pricing.faq.trial.a':
        'Il piano Gratuito è disponibile in modo permanente. I piani a pagamento possono essere annullati entro 30 giorni per un rimborso completo.',
      'pricing.faq.enterprise.q': "Cos'è il piano Enterprise?",
      'pricing.faq.enterprise.a':
        'Accesso illimitato a tutte le funzionalità, supporto prioritario e SLA garantito per team e aziende.',
      'pricing.footer': '© ' + new Date().getFullYear() + ' ' + _appName() + '.',
      'pricing.terms': 'Termini',
      'pricing.privacy': 'Privacy',
      'settings.title': '⚙️ Impostazioni',
      'settings.subtitle': 'Personalizza la tua esperienza ' + _appName(),
      'settings.lang.section': '🌍 Lingua & Regione',
      'settings.lang.label': "Lingua dell'interfaccia",
      'settings.lang.desc': 'La lingua in cui ricevi le risposte IA',
      'settings.theme.section': '🎨 Tema',
      'settings.theme.label': 'Tema visivo',
      'settings.theme.desc': _appName() + ' è ottimizzato per la modalità scura',
      'settings.theme.unavailable': 'Non disponibile al momento',
      'settings.notif.section': '🔔 Notifiche',
      'settings.notif.browser.label': 'Notifiche browser',
      'settings.notif.browser.desc': "Ricevi un avviso quando l'IA finisce di rispondere",
      'settings.notif.sounds.label': 'Suoni UI',
      'settings.notif.sounds.desc': "Suoni all'invio e alla ricezione dei messaggi",

      'settings.api.section': '🔑 API & Integrazioni',
      'settings.api.label': 'Chiavi API',
      'settings.api.desc': 'Gestisci le chiavi API per le integrazioni esterne',
      'settings.api.portal': 'Portale Sviluppatori →',
      'settings.sub.section': '💳 Abbonamento',
      'settings.nav.home': 'Home',
      'settings.nav.pricing': 'Prezzi',
      'settings.nav.developer': 'Sviluppatore',
      'app.connectionError': 'Errore di connessione.',
      'app.genericError': 'Errore.',
      'app.tooManyMessages': '\u23f3 Troppi messaggi. Attendi un momento.',
      'payments.loading': 'Caricamento...',
      'payments.unavailable': 'I piani non sono disponibili al momento.',
      'payments.currentPlan': 'Piano attuale',
      'payments.included': 'Incluso',
      'payments.upgradeTo': 'Passa a {name}',
      'payments.manageSubscription': 'Gestisci abbonamento',
      'shared.signInRequired': "Devi effettuare l'accesso per eseguire l'upgrade.",
    },
  };

  // ─── Word/script patterns for language detection (70+ languages) ─────
  const LANG_PATTERNS = [
    // ── Latin-script languages (word-based) ──────────────────────────────
    {
      lang: 'ro',
      re: /\b(și|si|sau|este|sunt|pentru|care|cum|unde|vreau|poti|poți|buna|bună|salut|multumesc|mulțumesc|te|iti|îți|imi|îmi|mai|dar|ca|că|nu|da|eu|tu|el|ea|noi|voi|ei|ale|lui|sa|la|in|în|pe|cu|de|din|spre|pana|până|cand|când|daca|dacă|acum|deja|mereu|afara|afară|cite|cate|câte|câți|grade|ploua|plouă|vreme|meteo|soare|frig|cald|bine|rau|rău|stiu|știu|fac|pot|spune|arata|arată|vezi|uite|hai|asta|ziua|seara|dimineata|noaptea|trebuie|lucrez|merg|unde|ceva|nimic|acolo|aici|foarte|putina|puțin|mult|acasa|acasă|inainte|înainte|maine|mâine|ieri)\b/i,
    },
    {
      lang: 'fr',
      re: /\b(je|il|elle|nous|vous|ils|elles|avec|dans|sur|par|les|des|une|bonjour|merci|oui|non|comment|pourquoi|quoi|qui|où|quand|très|mais|donc|ni|car|cet|cette|mon|ton|son|ma|ta|aussi|encore|jamais|toujours|maintenant|ici|parce)\b/i,
    },
    {
      lang: 'de',
      re: /\b(ich|du|er|sie|wir|ihr|ist|sind|mit|für|auf|bei|aus|nach|von|über|unter|an|zu|ein|eine|der|die|das|und|oder|aber|nicht|ja|nein|hallo|danke|bitte|wie|was|wer|wo|wann|warum|auch|noch|schon|können|müssen|haben|werden)\b/i,
    },
    {
      lang: 'es',
      re: /\b(yo|tú|él|ella|nosotros|vosotros|ellos|con|para|por|del|hola|gracias|sí|cómo|qué|quién|dónde|cuándo|muy|pero|también|ya|más|menos|bueno|malo|grande|pequeño|tengo|puedo|quiero|estoy|hacer|decir)\b/i,
    },
    {
      lang: 'it',
      re: /\b(io|lui|lei|noi|voi|loro|è|sono|con|per|su|da|di|una|ciao|grazie|sì|come|perché|cosa|chi|dove|quando|molto|anche|già|più|meno|buono|cattivo|grande|piccolo|fare|dire|avere|potere|volere)\b/i,
    },
    {
      lang: 'pt',
      re: /\b(eu|ele|ela|nós|vós|eles|elas|é|são|com|para|em|por|do|da|uma|olá|obrigado|obrigada|sim|não|como|quê|quem|onde|quando|muito|mas|também|já|mais|menos|bom|mau|fazer|dizer|poder|ter)\b/i,
    },
    {
      lang: 'nl',
      re: /\b(ik|jij|hij|zij|wij|jullie|zijn|met|voor|op|bij|uit|aan|van|het|een|hallo|dank|ja|nee|hoe|waarom|wat|wie|waar|wanneer|ook|meer|minder|goed|slecht|hebben|kunnen|moeten|willen|worden)\b/i,
    },
    {
      lang: 'pl',
      re: /\b(ja|ty|on|ona|my|wy|oni|jest|są|dla|na|po|od|do|ten|ta|to|cześć|dziękuję|tak|nie|jak|dlaczego|co|kto|gdzie|kiedy|bardzo|ale|też|już|więcej|mniej|dobry|zły|mogę|chcę|muszę|robić)\b/i,
    },
    {
      lang: 'cs',
      re: /\b(já|ty|on|ona|my|vy|oni|je|jsou|pro|na|po|od|do|ahoj|děkuji|ano|ne|jak|proč|co|kdo|kde|kdy|velmi|ale|také|už|více|méně|dobrý|špatný|mít|moci|chtít|dělat)\b/i,
    },
    {
      lang: 'sk',
      re: /\b(ja|ty|on|ona|my|vy|oni|je|sú|pre|na|po|od|do|ahoj|ďakujem|áno|nie|ako|prečo|čo|kto|kde|kedy|veľmi|ale|tiež|už|viac|menej|dobrý|zlý|mať|môcť|chcieť|robiť)\b/i,
    },
    {
      lang: 'hr',
      re: /\b(ja|ti|on|ona|mi|vi|oni|je|su|za|na|po|od|do|bok|hvala|da|ne|kako|zašto|što|tko|gdje|kada|vrlo|ali|također|već|više|manje|dobar|loš|imati|moći|htjeti|raditi)\b/i,
    },
    {
      lang: 'sr',
      re: /\b(ја|ти|он|она|ми|ви|они|је|су|за|на|по|од|до|здраво|хвала|да|не|како|зашто|шта|ко|где|када|веома|али|такође|већ|више|мање|добар|лош)\b/i,
    },
    {
      lang: 'sl',
      re: /\b(jaz|ti|on|ona|mi|vi|oni|je|so|za|na|po|od|do|živjo|hvala|da|ne|kako|zakaj|kaj|kdo|kje|kdaj|zelo|ampak|tudi|že|več|manj|dober|slab)\b/i,
    },
    {
      lang: 'bs',
      re: /\b(ja|ti|on|ona|mi|vi|oni|je|su|za|na|po|od|do|zdravo|hvala|da|ne|kako|zašto|šta|ko|gdje|kada|veoma|ali|također|već|više|manje|dobar|loš)\b/i,
    },
    {
      lang: 'bg',
      re: /\b(аз|ти|той|тя|ние|вие|те|е|са|за|на|по|от|до|здравей|благодаря|да|не|как|защо|какво|кой|къде|кога|много|но|също|вече|повече|по-малко|добър|лош)\b/i,
    },
    {
      lang: 'mk',
      re: /\b(јас|ти|тој|таа|ние|вие|тие|е|се|за|на|по|од|до|здраво|благодарам|да|не|како|зошто|што|кој|каде|кога|многу|но|исто|веќе|повеќе|помалку|добар|лош)\b/i,
    },
    {
      lang: 'sq',
      re: /\b(unë|ti|ai|ajo|ne|ju|ata|është|janë|për|në|nga|me|pa|përshëndetje|faleminderit|po|jo|si|pse|çfarë|kush|ku|kur|shumë|por|gjithashtu|tashmë|më|mirë|keq)\b/i,
    },
    {
      lang: 'hu',
      re: /\b(én|te|ő|mi|ti|ők|van|vannak|vagyok|vagy|hogy|nem|igen|szia|köszönöm|igen|nem|hogyan|miért|mit|ki|hol|mikor|nagyon|de|is|már|több|kevesebb|jó|rossz|kell|lehet|akar|csinál)\b/i,
    },
    {
      lang: 'fi',
      re: /\b(minä|sinä|hän|me|te|he|on|ovat|olen|olet|kanssa|varten|että|mutta|ei|kyllä|moi|kiitos|miten|miksi|mitä|kuka|missä|milloin|hyvin|myös|jo|enemmän|vähemmän|hyvä|huono|voida|haluta|tehdä)\b/i,
    },
    {
      lang: 'et',
      re: /\b(mina|sina|tema|meie|teie|nemad|on|olen|oled|koos|jaoks|et|aga|ei|jah|tere|tänan|kuidas|miks|mida|kes|kus|millal|väga|ka|juba|rohkem|vähem|hea|halb|saama|tahtma|tegema)\b/i,
    },
    {
      lang: 'lv',
      re: /\b(es|tu|viņš|viņa|mēs|jūs|viņi|ir|esmu|esi|ar|priekš|ka|bet|nē|jā|sveiki|paldies|kā|kāpēc|ko|kas|kur|kad|ļoti|arī|jau|vairāk|mazāk|labs|slikts|varēt|gribēt|darīt)\b/i,
    },
    {
      lang: 'lt',
      re: /\b(aš|tu|jis|ji|mes|jūs|jie|yra|esu|esi|su|dėl|kad|bet|ne|taip|labas|ačiū|kaip|kodėl|ką|kas|kur|kada|labai|taip|jau|daugiau|mažiau|geras|blogas|galėti|norėti|daryti)\b/i,
    },
    {
      lang: 'sv',
      re: /\b(jag|du|han|hon|vi|ni|de|är|var|med|för|att|men|inte|ja|nej|hej|tack|hur|varför|vad|vem|var|när|mycket|också|redan|mer|mindre|bra|dålig|kunna|vilja|göra|ha|bli)\b/i,
    },
    {
      lang: 'no',
      re: /\b(jeg|du|han|hun|vi|dere|de|er|var|med|for|at|men|ikke|ja|nei|hei|takk|hvordan|hvorfor|hva|hvem|hvor|når|veldig|også|allerede|mer|mindre|god|dårlig|kunne|ville|gjøre|ha|bli)\b/i,
    },
    {
      lang: 'da',
      re: /\b(jeg|du|han|hun|vi|i|de|er|var|med|for|at|men|ikke|ja|nej|hej|tak|hvordan|hvorfor|hvad|hvem|hvor|hvornår|meget|også|allerede|mere|mindre|god|dårlig|kunne|ville|gøre|have|blive)\b/i,
    },
    {
      lang: 'is',
      re: /\b(ég|þú|hann|hún|við|þið|þeir|er|var|með|fyrir|að|en|ekki|já|nei|halló|takk|hvernig|af hverju|hvað|hver|hvar|hvenær|mjög|líka|þegar|meira|minna|góður|slæmur)\b/i,
    },
    {
      lang: 'ga',
      re: /\b(mé|tú|sé|sí|muid|sibh|siad|tá|bhí|le|do|agus|ach|ní|sea|dia duit|go raibh maith agat|conas|cén fáth|cad|cé|cá|cathain|an-mhór|freisin|cheana|níos mó|níos lú|maith|olc)\b/i,
    },
    {
      lang: 'cy',
      re: /\b(fi|ti|fe|hi|ni|chi|nhw|mae|oedd|gyda|ar|ac|ond|dim|ie|na|helo|diolch|sut|pam|beth|pwy|ble|pryd|iawn|hefyd|eisoes|mwy|llai|da|drwg)\b/i,
    },
    {
      lang: 'eu',
      re: /\b(ni|zu|hura|gu|zuek|haiek|da|dira|naiz|zara|eta|baina|ez|bai|kaixo|eskerrik|nola|zergatik|zer|nor|non|noiz|oso|ere|dagoeneko|gehiago|gutxiago|on|txar)\b/i,
    },
    {
      lang: 'ca',
      re: /\b(jo|tu|ell|ella|nosaltres|vosaltres|ells|és|són|amb|per|en|hola|gràcies|sí|no|com|per què|què|qui|on|quan|molt|però|també|ja|més|menys|bo|dolent|fer|dir|poder|tenir)\b/i,
    },
    {
      lang: 'gl',
      re: /\b(eu|ti|el|ela|nós|vós|eles|elas|é|son|con|para|en|por|do|da|ola|grazas|si|non|como|por que|que|quen|onde|cando|moito|pero|tamén|xa|máis|menos|bo|malo)\b/i,
    },
    {
      lang: 'tr',
      re: /\b(ben|sen|biz|siz|onlar|bu|bir|için|ile|ve|ama|çok|ne|kim|nerede|nasıl|merhaba|teşekkür|evet|hayır|var|yok|iyi|kötü|büyük|küçük|yapmak|demek|gelmek|gitmek|olmak)\b/i,
    },
    {
      lang: 'az',
      re: /\b(mən|sən|biz|siz|onlar|bu|bir|üçün|ilə|və|amma|çox|nə|kim|harada|necə|salam|təşəkkür|bəli|xeyr|var|yox|yaxşı|pis|böyük|kiçik)\b/i,
    },
    {
      lang: 'uz',
      re: /\b(men|sen|biz|siz|ular|bu|bir|uchun|bilan|va|lekin|juda|nima|kim|qayerda|qanday|salom|rahmat|ha|yoq|bor|yaxshi|yomon|katta|kichik)\b/i,
    },
    {
      lang: 'kk',
      re: /\b(мен|сен|біз|сіз|олар|бұл|бір|үшін|және|бірақ|өте|не|кім|қайда|қалай|сәлем|рахмет|иә|жоқ|бар|жақсы|жаман|үлкен|кішкентай)\b/i,
    },
    {
      lang: 'ms',
      re: /\b(saya|anda|dia|kami|mereka|ini|itu|untuk|dengan|dan|tetapi|sangat|apa|siapa|mana|bagaimana|halo|terima kasih|ya|tidak|ada|baik|buruk|besar|kecil|boleh|mahu|buat)\b/i,
    },
    {
      lang: 'id',
      re: /\b(saya|aku|kamu|dia|kami|kita|mereka|ini|itu|untuk|dengan|dan|tetapi|sangat|apa|siapa|mana|bagaimana|halo|terima|ya|tidak|ada|baik|buruk|besar|kecil|bisa|mau|buat|sudah|belum)\b/i,
    },
    {
      lang: 'tl',
      re: /\b(ako|ikaw|siya|kami|tayo|sila|ito|iyon|para|sa|at|ngunit|masyado|ano|sino|saan|paano|kumusta|salamat|oo|hindi|meron|wala|mabuti|masama|malaki|maliit|gumawa|sabihin)\b/i,
    },
    {
      lang: 'vi',
      re: /\b(tôi|bạn|anh|chị|chúng tôi|họ|này|đó|cho|với|và|nhưng|rất|gì|ai|đâu|thế nào|xin chào|cảm ơn|vâng|không|có|tốt|xấu|lớn|nhỏ|làm|nói|được)\b/i,
    },
    {
      lang: 'sw',
      re: /\b(mimi|wewe|yeye|sisi|wao|hii|hiyo|kwa|na|lakini|sana|nini|nani|wapi|vipi|habari|asante|ndiyo|hapana|kuna|nzuri|mbaya|kubwa|ndogo|kufanya|kusema|kwenda)\b/i,
    },
    {
      lang: 'ha',
      re: /\b(ni|kai|shi|ita|mu|su|wannan|wancan|don|da|amma|sosai|mene|wanene|ina|yaya|sannu|nagode|eh|a'a|akwai|babu|nagari|mugu|babba|karami)\b/i,
    },
    {
      lang: 'yo',
      re: /\b(emi|iwọ|oun|awa|nwon|eyi|yen|fun|ati|sugbon|pupo|kini|tani|nibo|bawo|pele|ese|beeni|rara|wa|dara|buru|nla|kere)\b/i,
    },
    {
      lang: 'zu',
      re: /\b(mina|wena|yena|thina|bona|lokhu|lokho|nga|futhi|kodwa|kakhulu|ini|ubani|kuphi|kanjani|sawubona|ngiyabonga|yebo|cha|kukhona|kuhle|kubi|okukhulu|okuncane)\b/i,
    },
    {
      lang: 'af',
      re: /\b(ek|jy|hy|sy|ons|julle|hulle|is|was|met|vir|en|maar|nie|ja|nee|hallo|dankie|hoe|hoekom|wat|wie|waar|wanneer|baie|ook|al|meer|minder|goed|sleg|kan|wil|maak|hê)\b/i,
    },
    {
      lang: 'mt',
      re: /\b(jien|int|hu|hi|aħna|intom|huma|huwa|kienet|ma|għal|u|iżda|ħafna|xiex|min|fejn|kif|bonġu|grazzi|iva|le|hemm|tajjeb|ħażin|kbir|żgħir)\b/i,
    },
    {
      lang: 'eo',
      re: /\b(mi|vi|li|ŝi|ni|ili|estas|estis|kun|por|kaj|sed|ne|jes|saluton|dankon|kiel|kial|kio|kiu|kie|kiam|tre|ankaŭ|jam|pli|malpli|bona|malbona|granda|malgranda)\b/i,
    },
    {
      lang: 'la',
      re: /\b(ego|tu|nos|vos|est|sunt|cum|pro|et|sed|non|ita|salve|gratias|quomodo|cur|quid|quis|ubi|quando|valde|etiam|iam|plus|minus|bonus|malus|magnus|parvus)\b/i,
    },
    // ── Script-based languages (Unicode ranges) ──────────────────────────
    { lang: 'ar', re: /[\u0600-\u06FF]/ },
    { lang: 'fa', re: /[\u0600-\u06FF][\u0600-\u06FF].*[\u06CC\u06A9\u0698\u06AF\u067E\u0686]/ },
    { lang: 'ur', re: /[\u0600-\u06FF][\u0600-\u06FF].*[\u0679\u0688\u0691\u06BA\u06BE\u06C1\u06D2]/ },
    { lang: 'he', re: /[\u0590-\u05FF]/ },
    { lang: 'yi', re: /[\u0590-\u05FF].*[\u05D0\u05D5\u05D9\u05E2\u05E7]/ },
    { lang: 'hi', re: /[\u0900-\u097F]/ },
    { lang: 'mr', re: /[\u0900-\u097F]/ },
    { lang: 'ne', re: /[\u0900-\u097F]/ },
    { lang: 'bn', re: /[\u0980-\u09FF]/ },
    { lang: 'pa', re: /[\u0A00-\u0A7F]/ },
    { lang: 'gu', re: /[\u0A80-\u0AFF]/ },
    { lang: 'ta', re: /[\u0B80-\u0BFF]/ },
    { lang: 'te', re: /[\u0C00-\u0C7F]/ },
    { lang: 'kn', re: /[\u0C80-\u0CFF]/ },
    { lang: 'ml', re: /[\u0D00-\u0D7F]/ },
    { lang: 'si', re: /[\u0D80-\u0DFF]/ },
    { lang: 'th', re: /[\u0E00-\u0E7F]/ },
    { lang: 'lo', re: /[\u0E80-\u0EFF]/ },
    { lang: 'my', re: /[\u1000-\u109F]/ },
    { lang: 'km', re: /[\u1780-\u17FF]/ },
    { lang: 'ka', re: /[\u10A0-\u10FF]/ },
    { lang: 'hy', re: /[\u0530-\u058F]/ },
    { lang: 'am', re: /[\u1200-\u137F]/ },
    { lang: 'ja', re: /[\u3040-\u309F\u30A0-\u30FF]/ },
    { lang: 'zh', re: /[\u4E00-\u9FFF]/ },
    { lang: 'ko', re: /[\uAC00-\uD7AF]/ },
    { lang: 'bo', re: /[\u0F00-\u0FFF]/ },
    { lang: 'mn', re: /[\u1800-\u18AF]/ },
    // ── English — LAST (fallback) ────────────────────────────────────────
    {
      lang: 'en',
      re: /\b(the|is|are|was|were|with|for|and|or|but|in|on|at|to|of|a|an|hello|hi|thanks|thank|yes|no|how|why|what|who|where|when|very|also|already|more|less|good|bad|big|small|can|will|would|should|have|been|being|this|that|these|those)\b/i,
    },
  ];

  let currentLang = DEFAULT_LANG;

  // ─── Language: ALWAYS default English ─────────────────────────────────
  // Language only changes when detected from chat input.
  // For subscribers: after login, their saved preference is loaded from Supabase.
  // On page exit: resets to English.
  // No browser auto-detection — always start EN.
  try {
    // Only restore saved lang if user was explicitly logged in (has token)
    const hasToken = localStorage.getItem('kelion_token');
    const saved = hasToken ? localStorage.getItem('kelion_lang') : null;
    if (saved && SUPPORTED.indexOf(saved) !== -1) {
      currentLang = saved;
    }
    // else: stays 'en' (DEFAULT_LANG)
  } catch (_e) {
    /* ignored */
  }

  // ─── Translate a single key (with optional {param} replacements) ────────
  function t(key, params) {
    const dict = translations[currentLang] || translations[DEFAULT_LANG];
    let msg = dict[key] || translations[DEFAULT_LANG][key] || key;
    if (params) {
      const keys = Object.keys(params);
      for (let i = 0; i < keys.length; i++) {
        msg = msg.split('{' + keys[i] + '}').join(String(params[keys[i]]));
      }
    }
    return msg;
  }

  // ─── Apply translations to DOM ─────────────────────────────────────────
  function applyTranslations() {
    // Text content
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
    // Placeholder attribute
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    // aria-label attribute
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
    });
    // Update <html lang="...">
    document.documentElement.lang = currentLang;
  }

  // ─── setLanguage ────────────────────────────────────────────────────────
  function setLanguage(lang) {
    if (!lang) return;
    currentLang = lang;
    try {
      localStorage.setItem('kelion_lang', lang);
    } catch (_e) {
      /* ignored */
    }
    applyTranslations();
    // Update KVoice detected language if available
    if (window.KVoice && typeof KVoice.setLanguage === 'function') KVoice.setLanguage(lang);
    // Dispatch event so other modules can react
    window.dispatchEvent(new CustomEvent('kelion-lang-changed', { detail: { lang: lang } }));
  }

  // ─── getLanguage ────────────────────────────────────────────────────────
  function getLanguage() {
    return currentLang;
  }

  // ─── detectLanguage from text ───────────────────────────────────────────
  function detectLanguage(text) {
    if (!text || text.trim().length < 3) return null;
    for (let i = 0; i < LANG_PATTERNS.length; i++) {
      if (LANG_PATTERNS[i].re.test(text)) return LANG_PATTERNS[i].lang;
    }
    return null;
  }

  // ─── Apply on load ──────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyTranslations);
  } else {
    applyTranslations();
  }

  window.i18n = {
    t: t,
    setLanguage: setLanguage,
    getLanguage: getLanguage,
    detectLanguage: detectLanguage,
    apply: applyTranslations,
  };
})();
