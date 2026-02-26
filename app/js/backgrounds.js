// ═══════════════════════════════════════════════════════════════
// KelionAI — Dynamic Backgrounds
// window.KBG = { init, detect, setBackground, getCurrentBg, setManual }
// Auto-switches background based on conversation context keywords.
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const THEMES = {
        default:   { keywords: [], gradient: 'linear-gradient(135deg, #0a0e1a 0%, #1a1e2e 100%)', accent: '#00D4FF', name: 'default' },
        classroom: { keywords: ['teach', 'learn', 'school', 'lesson', 'course'], gradient: 'linear-gradient(135deg, #1a1200 0%, #2d2000 50%, #1a1500 100%)', accent: '#FFB300', name: 'classroom' },
        lab:       { keywords: ['chemistry', 'science', 'lab', 'experiment'], gradient: 'linear-gradient(135deg, #001a0d 0%, #002d1a 50%, #001a10 100%)', accent: '#00FF88', name: 'lab' },
        office:    { keywords: ['code', 'programming', 'function', 'debug'], gradient: 'linear-gradient(135deg, #001020 0%, #001830 50%, #000d1a 100%)', accent: '#00D4FF', name: 'office' },
        kitchen:   { keywords: ['cook', 'recipe', 'food', 'kitchen'], gradient: 'linear-gradient(135deg, #1a0800 0%, #2d1200 50%, #1a0a00 100%)', accent: '#FF6B35', name: 'kitchen' },
        gym:       { keywords: ['workout', 'exercise', 'gym', 'hiit', 'yoga'], gradient: 'linear-gradient(135deg, #1a0000 0%, #2d0000 50%, #1a0005 100%)', accent: '#FF2244', name: 'gym' },
        zen:       { keywords: ['meditat', 'breathe', 'calm', 'zen', 'relax'], gradient: 'linear-gradient(135deg, #0d0020 0%, #1a0035 50%, #0d0025 100%)', accent: '#9B59B6', name: 'zen' },
        corporate: { keywords: ['business', 'meeting', 'professional', 'corporate'], gradient: 'linear-gradient(135deg, #000d1a 0%, #001530 50%, #000d20 100%)', accent: '#2980B9', name: 'corporate' },
        music:     { keywords: ['music', 'song', 'playlist', 'concert'], gradient: 'linear-gradient(135deg, #1a0015 0%, #2d0025 50%, #1a0018 100%)', accent: '#FF6EB4', name: 'music' },
        travel:    { keywords: ['travel', 'map', 'location', 'city', 'country'], gradient: 'linear-gradient(135deg, #001a1a 0%, #002d2d 50%, #001a1a 100%)', accent: '#1ABC9C', name: 'travel' },
        night:     { keywords: ['night', 'dream', 'sleep', 'story'], gradient: 'linear-gradient(135deg, #050010 0%, #0d0020 50%, #050015 100%)', accent: '#6C3483', name: 'night' },
    };

    var currentBg = 'default';
    var manualOverride = false;
    var manualTimer = null;

    function detect(message) {
        if (manualOverride) return;
        var lower = message.toLowerCase();
        var themeNames = Object.keys(THEMES);
        for (var i = 0; i < themeNames.length; i++) {
            var name = themeNames[i];
            if (name === 'default') continue;
            var keywords = THEMES[name].keywords;
            for (var j = 0; j < keywords.length; j++) {
                if (new RegExp('\\b' + keywords[j]).test(lower)) {
                    setBackground(name);
                    return;
                }
            }
        }
    }

    function setBackground(themeName) {
        var theme = THEMES[themeName] || THEMES.default;
        var root = document.documentElement;
        root.style.setProperty('--bg-gradient', theme.gradient);
        // Kira always uses pink accent; Kelion follows the background accent
        var isKira = window.KAvatar && KAvatar.getCurrentAvatar() === 'kira';
        root.style.setProperty('--accent-color', isKira ? '#FF6EB4' : theme.accent);
        currentBg = themeName;
        try { sessionStorage.setItem('kelion_bg', themeName); } catch (e) { /* ignore */ }
    }

    function setManual(themeName) {
        if (!THEMES[themeName]) return;
        if (manualTimer) clearTimeout(manualTimer);
        manualOverride = true;
        setBackground(themeName);
        // Reset manual override after 5 minutes
        manualTimer = setTimeout(function () { manualOverride = false; }, 300000);
    }

    function getCurrentBg() { return currentBg; }

    function init() {
        var saved = null;
        try { saved = sessionStorage.getItem('kelion_bg'); } catch (e) { /* ignore */ }
        if (saved && THEMES[saved]) setBackground(saved);
    }

    window.KBG = { init: init, detect: detect, setBackground: setBackground, getCurrentBg: getCurrentBg, setManual: setManual };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
