'use strict';

// ─────────────────────────────────────────────────────────────────────
// Tool Router — Intelligent tool selection based on message intent.
//
// Instead of sending all 82 tools with every API request (~3000 tokens),
// this module analyzes the user's message and returns only the relevant
// tool subset. A "salut" greeting needs 0 tools. A weather question
// needs 3-4. A code task needs ~10. This cuts token cost by 60-90%
// on average and improves model response quality (less choice paralysis).
//
// The router uses keyword matching + category mapping. Each tool belongs
// to one or more categories. Each category has trigger keywords/patterns.
// The CORE category (always included) contains tools the model may call
// unprompted (memory, emotion, monitor).
// ─────────────────────────────────────────────────────────────────────

// Tool categories — each tool belongs to one or more
const TOOL_CATEGORIES = {
  // Always included — silent/system tools the model may need anytime
  CORE: [
    'observe_user_emotion',
    'learn_from_observation',
    'remember_fact',
    'get_action_history',
    'ui_notify',
    'show_on_monitor',
    'query_database',
    'conversation_summary',
    'read_past_conversation',
    'thinking_mode',
    'memory_sources',
    'run_command',
  ],

  // Greetings and simple conversation — no tools needed beyond CORE
  // (matched by absence of any other category)

  // Weather, location, geo
  GEO_WEATHER: [
    'get_weather',
    'get_forecast',
    'get_air_quality',
    'get_my_location',
    'get_sun_times',
    'get_moon_phase',
    'geocode',
    'reverse_geocode',
    'get_timezone',
    'get_elevation',
  ],

  // Navigation and places
  NAVIGATION: [
    'get_my_location',
    'get_route',
    'nearby_places',
    'open_gps_app',
    'geocode',
    'reverse_geocode',
  ],

  // Web search, news, information
  SEARCH_INFO: [
    'web_search',
    'get_news',
    'wikipedia_search',
    'fetch_url',
    'rss_read',
    'dictionary',
    'search_academic',
    'fetch_documentation',
    'browse_web',
    'computer_use',
    'deep_search',
  ],

  // Finance — crypto, stocks, forex
  FINANCE: [
    'get_crypto_price',
    'get_stock_price',
    'get_forex',
    'currency_convert',
  ],

  // Math and calculations
  MATH: [
    'calculate',
    'unit_convert',
    'run_regex',
    'data_visualize',
  ],

  // Code, files, terminal — development tools
  CODE_DEV: [
    'run_command',
    'run_terminal_command',
    'write_to_file',
    'replace_file_content',
    'multi_replace_file_content',
    'read_local_file',
    'list_local_files',
    'edit_local_file',
    'search_codebase',
    'replace_in_file',
    'run_code',
    'ask_expert_coder',
    'execute_plan',
    'check_updates',
    'self_verify',
  ],

  // GitHub
  GITHUB: [
    'commit_and_push_to_github',
    'create_github_pr',
    'manage_github_prs',
    'github_repo_info',
    'list_github_repo_files',
    'read_github_file',
    'search_github',
  ],

  // Package managers
  PACKAGES: [
    'npm_package_info',
    'pypi_package_info',
    'search_stackoverflow',
    'check_updates',
  ],

  // Camera and vision
  CAMERA: [
    'camera_on',
    'camera_off',
    'switch_camera',
    'zoom_camera',
    'set_narration_mode',
  ],

  // Voice and UI
  UI_VOICE: [
    'switch_voice',
    'ui_navigate',
    'play_radio',
  ],

  // Email and calendar
  PRODUCTIVITY: [
    'read_calendar',
    'read_email',
    'search_files',
    'compose_email_draft',
    'send_email',
    'create_calendar_ics',
    'zapier_trigger',
  ],

  // User account
  ACCOUNT: [
    'get_my_credits',
    'get_my_usage',
    'get_my_profile',
    'query_database',
    'conversation_summary',
  ],

  // Documents and OCR
  DOCUMENTS: [
    'read_pdf',
    'read_docx',
    'ocr_image',
    'ocr_passport',
  ],

  // Image generation
  IMAGE_GEN: [
    'generate_image',
  ],

  // Natural disasters / science
  SCIENCE: [
    'get_earthquakes',
  ],
};

// Trigger patterns for each category
// Each entry: { patterns: RegExp[], keywords: string[] }
const CATEGORY_TRIGGERS = {
  GEO_WEATHER: {
    patterns: [
      /vrem\w*/i, /temperatur/i, /ploua|ploi|ninge|vânt|soare/i,
      /weather/i, /forecast/i, /meteo/i, /calitate.*aer|air.*quality/i,
      /apune|răsare|sunrise|sunset/i, /lun[aă].*plin[aă]|moon/i,
      /altitudin|elevation/i, /timezone|fus.*orar|ceas.*acum.*în/i,
      /unde.*sunt|where.*am.*i|locati/i, /coordonate|gps/i,
    ],
    keywords: ['vreme', 'vremea', 'grad', 'celsius', 'weather', 'rain', 'snow',
      'wind', 'forecast', 'meteo', 'aer', 'pm2', 'poluare', 'smog',
      'apune', 'rasare', 'sunrise', 'sunset', 'luna', 'moon',
      'altitudine', 'elevation', 'timezone', 'fus orar', 'ora in',
      'time in', 'unde sunt', 'where am i', 'locatie', 'location'],
  },
  NAVIGATION: {
    patterns: [
      /navighe|navighea|naviga/i, /rut[aă]|route|drum/i,
      /distan[tț][aă]|distance/i, /waze|google.*maps/i,
      /apropia|nearby|farmaci|restaurant|atm|benzin/i,
      /cum.*ajung|how.*get.*to/i, /cât.*fac.*cu.*mașina/i,
    ],
    keywords: ['navighează', 'navigate', 'ruta', 'route', 'waze', 'maps',
      'distanță', 'distance', 'farmacie', 'restaurant', 'benzinărie',
      'nearby', 'aproape', 'spital', 'hospital', 'atm', 'cafenea'],
  },
  SEARCH_INFO: {
    patterns: [
      /caut[aă]|search|find/i, /știri|news|headline/i,
      /wikipedia|wiki/i, /ce.*s-a.*întâmplat|what.*happened/i,
      /cine.*e|who.*is|ce.*e|what.*is/i, /traduc|translate/i,
      /defini[tț]i|definit|definition|ce.*înseamn/i,
      /rss|feed|blog/i, /documentati|docs/i,
      /intră.*pe|deschide.*|open.*|browse|acceseaz[aă]?/i,
      /arată.*site|site.*ul/i, /articol|paper/i,
    ],
    keywords: ['caută', 'search', 'știri', 'news', 'wikipedia', 'wiki',
      'traduce', 'translate', 'definiție', 'definition', 'rss', 'feed',
      'documentație', 'docs', 'browse', 'site', 'pagină', 'page',
      'articol', 'paper', 'arxiv', 'academic'],
  },
  FINANCE: {
    patterns: [
      /bitcoin|btc|ethereum|eth|crypto|cripto/i,
      /acțiun[ei]|stock|share|bursă/i, /\btsla\b|\baapl\b|\bmsft\b|\bgoog\b/i,
      /\bcurs\b.*valut|exchange.*rate|\bforex\b/i, /convert.*valut|currency/i,
      /\beuro\b|\bdolar\b|\bleu\b|\blei\b|\bron\b|\busd\b|\beur\b/i,
      /preț.*acțiun|price.*stock/i,
    ],
    keywords: ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'cripto',
      'acțiune', 'stock', 'share', 'bursă', 'forex', 'curs', 'exchange',
      'valută', 'currency', 'euro', 'dolar', 'leu', 'ron'],
  },
  MATH: {
    patterns: [
      /calculea|comput|math/i, /radical|sqrt|logaritm/i,
      /câ[tț].*fac|how.*much.*is/i, /procent|percent/i,
      /convertește|convert.*unit/i, /kilom|mile|pound|kilo/i,
      /regex|regular.*express/i, /grafic|chart|plot|vizualiz/i,
      /\d+\s*[\+\-\*\/\^]\s*\d+/,  // Simple arithmetic detection
    ],
    keywords: ['calcul', 'calculate', 'math', 'radical', 'sqrt', 'logaritm',
      'procent', 'percent', 'convertește', 'convert', 'kilometri', 'mile',
      'kilograme', 'pounds', 'fahrenheit', 'celsius', 'regex',
      'grafic', 'chart', 'plot', 'vizualizare'],
  },
  CODE_DEV: {
    patterns: [
      /rulează|run|execut/i, /scri[eu].*(fișier|soft|program|cod|code|app|aplicați)/i,
      /creea.*(fișier|soft|program|cod|code|app|aplicați)/i,
      /înlocui|replace|edit.*fișier|edit.*file/i,
      /cod|code|script|python|javascript|node|npm|soft|program|app/i,
      /terminal|command|comand[aă]/i, /build|deploy|install/i,
      /bug|eroare|error|fix|repar/i, /funcți[ei]|function/i,
      /plan.*execut|execute.*plan/i, /expert.*cod/i,
      /verific[aă]?|verify|check|test/i,
    ],
    keywords: ['rulează', 'run', 'execută', 'execute', 'script', 'cod', 'code',
      'python', 'javascript', 'node', 'npm', 'terminal', 'command',
      'build', 'deploy', 'install', 'bug', 'eroare', 'error', 'fix',
      'repară', 'fișier', 'file', 'funcție', 'function', 'plan', 'expert',
      'verifică', 'verify', 'check', 'test', 'soft', 'program', 'aplicație', 'app', 'creează', 'dezvoltă'],
  },
  GITHUB: {
    patterns: [
      /\bgithub\b/i, /\bgit\b/i, /pull.*request|\bpr\b/i, /\bcommit\b|\bbranch\b|\bmerge\b/i,
      /\brepo(zitor)?\b/i, /\bstars\b|\bfork\b/i,
    ],
    keywords: ['github', 'git', 'pull request', 'pr', 'commit', 'branch',
      'merge', 'repository', 'repo', 'stars', 'fork'],
  },
  PACKAGES: {
    patterns: [
      /npm.*pachet|npm.*package|versiune.*express|version.*of/i,
      /pypi|pip.*install/i, /stackoverflow|stack.*overflow/i,
      /dependen[tț]e.*neactualizate|check.*updates/i,
    ],
    keywords: ['npm', 'package', 'pachet', 'pypi', 'pip', 'stackoverflow',
      'versiune', 'version', 'dependențe', 'neactualizate'],
  },
  CAMERA: {
    patterns: [
      /camer[aă]|camera/i, /porn.*camera|turn.*on.*camera/i,
      /opr.*camera|turn.*off.*camera|închide.*camera/i,
      /zoom|focali|rotește.*camera|flip.*camera|switch.*camera/i,
      /ce.*vez|what.*see|descri|nara|blind|nevăzător/i,
    ],
    keywords: ['cameră', 'camera', 'zoom', 'focalizează', 'rotește',
      'narare', 'narration', 'nevăzător', 'blind', 'descrie', 'describe'],
  },
  UI_VOICE: {
    patterns: [
      /voce|voice|clonat|switch.*voice|schimb.*voce/i,
      /radio|europa.*fm|kiss.*fm|bbc/i,
      /studio|contact|meniu.*principal|main.*page/i,
    ],
    keywords: ['voce', 'voice', 'clonată', 'radio', 'studio', 'contact',
      'meniu', 'menu', 'pagina', 'page'],
  },
  PRODUCTIVITY: {
    patterns: [
      /calendar|eveniment|event|ședinț[aă]|meeting/i,
      /mail|email|mesaj|message|inbox/i,
      /fișier.*drive|document.*drive|dropbox/i,
      /zapier|webhook|automat/i,
      /invitați[ei]|invite|ics/i,
    ],
    keywords: ['calendar', 'eveniment', 'event', 'ședință', 'meeting',
      'mail', 'email', 'mesaj', 'inbox', 'drive', 'dropbox',
      'zapier', 'webhook', 'invitație', 'invite'],
  },
  ACCOUNT: {
    patterns: [
      /credit|minut|minute|balanț|balance/i,
      /profil|profile|cont|account/i,
      /consum|usage|cheltui/i,
      /baz[aă].*date|database|conversați[ie]|memori[ie]|fact/i,
      /rezumat|summary|sumariz/i,
      /câte.*conversați|cât.*am.*vorbit/i,
    ],
    keywords: ['credit', 'minute', 'balanță', 'balance', 'profil',
      'profile', 'cont', 'account', 'consum', 'usage',
      'bază de date', 'database', 'conversații', 'rezumat', 'summary',
      'memorie', 'memory', 'fapte', 'facts'],
  },
  DOCUMENTS: {
    patterns: [
      /pdf|docx?|word|cv|factură|invoice/i,
      /ocr|citeș.*text|read.*text.*din.*poz/i,
      /pașaport|passport|mrz/i,
    ],
    keywords: ['pdf', 'docx', 'doc', 'word', 'cv', 'factură', 'invoice',
      'ocr', 'text', 'pașaport', 'passport'],
  },
  IMAGE_GEN: {
    patterns: [
      /generează.*imag|generate.*image|fă.*poz|draw|paint|pictea/i,
      /creează.*imagine|create.*picture/i,
    ],
    keywords: ['generează', 'generate', 'imagine', 'image', 'poză',
      'picture', 'desenează', 'draw', 'pictează', 'paint'],
  },
  SCIENCE: {
    patterns: [
      /cutremur|earthquake|seism|magnitudin/i,
    ],
    keywords: ['cutremur', 'earthquake', 'seism', 'magnitudine'],
  },
};

// Pre-compiled keyword regexes for better performance
const COMPILED_KW_REGEX = {};
for (const [cat, triggers] of Object.entries(CATEGORY_TRIGGERS)) {
  COMPILED_KW_REGEX[cat] = triggers.keywords.map(kw => 
    new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')
  );
}

/**
 * Analyze a user message and return the set of relevant tool categories.
 * @param {string} message - The user's message text
 * @returns {Set<string>} - Set of category names that match
 */
function detectCategories(message) {
  if (!message || typeof message !== 'string') return new Set();

  const lower = message.toLowerCase().trim();
  const matched = new Set();

  for (const [category, triggers] of Object.entries(CATEGORY_TRIGGERS)) {
    // Check patterns (regex)
    const hasPatternMatch = triggers.patterns.some(p => p.test(lower));
    if (hasPatternMatch) {
      matched.add(category);
      continue;
    }

    // Check keywords (pre-compiled)
    const hasKwMatch = COMPILED_KW_REGEX[category].some(re => re.test(lower));
    if (hasKwMatch) {
      matched.add(category);
    }
  }

  return matched;
}

/**
 * Given a user message and the full tool catalog, return only the relevant
 * tools. CORE tools are always included. If no categories match (simple
 * greeting/chat), only CORE tools are returned.
 *
 * @param {string} message - The user's message
 * @param {Array} allTools - Full KELION_TOOLS array from realtime.js
 * @returns {{ tools: Array, categories: string[], allToolsCount: number, selectedCount: number }}
 */
function selectTools(message, allTools) {
  const categories = detectCategories(message);
  
  // Build the set of tool names to include
  const selectedNames = new Set();

  // Always include CORE
  for (const name of TOOL_CATEGORIES.CORE) {
    selectedNames.add(name);
  }

  // Add tools from matched categories
  for (const cat of categories) {
    const tools = TOOL_CATEGORIES[cat];
    if (tools) {
      for (const name of tools) {
        selectedNames.add(name);
      }
    }
  }

  // Filter the full tool array
  const selected = allTools.filter(t => selectedNames.has(t.name));

  return {
    tools: selected,
    categories: Array.from(categories),
    allToolsCount: allTools.length,
    selectedCount: selected.length,
  };
}

/**
 * Check if the message needs vision/camera capabilities.
 * Returns true only when the user explicitly asks about visual content.
 */
function needsVision(message) {
  if (!message || typeof message !== 'string') return false;
  const lower = message.toLowerCase();
  const visionPatterns = [
    /ce\s+vez/i,             // ce vezi
    /what.*see/i,            // what do you see
    /descri.*ce.*e/i,        // descrie ce e
    /arat[aă].*mi/i,         // arată-mi (when camera is on)
    /citeș.*text/i,          // citește textul
    /read.*text/i,
    /analizea.*imag/i,       // analizează imaginea
    /analyze.*image/i,
    /ce.*e.*în.*față/i,      // ce e in fata
    /nevăzăt/i,              // nevazator
    /nara/i,                 // narare/narration
    /blind/i,
  ];
  return visionPatterns.some(p => p.test(lower));
}

module.exports = {
  TOOL_CATEGORIES,
  CATEGORY_TRIGGERS,
  detectCategories,
  selectTools,
  needsVision,
};
