// ═══════════════════════════════════════════════════════════════
// KelionAI — Dynamic Backgrounds (backgrounds.js)
// Auto-switches background based on conversation context
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var currentTheme = 'default';

    var THEMES = {
        default:   { bg: 'linear-gradient(135deg, #0a0e1a 0%, #1a1e2e 100%)', accent: '#00D4FF', emoji: '🌆' },
        classroom: { bg: 'linear-gradient(135deg, #0d1b0d 0%, #1a2e1a 100%)', accent: '#44ff88', emoji: '🏫' },
        lab:       { bg: 'linear-gradient(135deg, #0a0e1a 0%, #0d1a2e 100%)', accent: '#00aaff', emoji: '🔬' },
        coding:    { bg: 'linear-gradient(135deg, #0a0a0a 0%, #0d1a0d 100%)', accent: '#00ff41', emoji: '💻' },
        kitchen:   { bg: 'linear-gradient(135deg, #1a0e05 0%, #2e1a0a 100%)', accent: '#ffaa00', emoji: '🍳' },
        gym:       { bg: 'linear-gradient(135deg, #1a0505 0%, #2e0d0d 100%)', accent: '#ff4444', emoji: '🏋️' },
        zen:       { bg: 'linear-gradient(135deg, #051a10 0%, #0a2e1a 100%)', accent: '#88ffcc', emoji: '🧘' },
        corporate: { bg: 'linear-gradient(135deg, #0a0a14 0%, #14141e 100%)', accent: '#8888ff', emoji: '🏢' },
        space:     { bg: 'linear-gradient(135deg, #000005 0%, #05050a 100%)', accent: '#aa88ff', emoji: '🌌' },
        beach:     { bg: 'linear-gradient(135deg, #051014 0%, #0a1e2e 100%)', accent: '#00ddff', emoji: '🏖️' },
        studio:    { bg: 'linear-gradient(135deg, #14050a 0%, #2e0a14 100%)', accent: '#ff88cc', emoji: '🎨' },
        dream:     { bg: 'linear-gradient(135deg, #05051a 0%, #0a0a28 100%)', accent: '#aa88ff', emoji: '🌙' },
    };

    var KEYWORDS = {
        classroom: ['teach', 'learn', 'study', 'lesson', 'course', 'school', 'university', 'math', 'history', 'învaț', 'lecție', 'curs'],
        lab:       ['chemistry', 'science', 'experiment', 'physics', 'biology', 'chimie', 'știință'],
        coding:    ['code', 'programming', 'function', 'javascript', 'python', 'debug', 'cod', 'programare'],
        kitchen:   ['cook', 'recipe', 'food', 'meal', 'ingredient', 'gătit', 'rețetă', 'mâncare'],
        gym:       ['workout', 'exercise', 'fitness', 'gym', 'running', 'sport', 'antrenament', 'exercițiu'],
        zen:       ['meditat', 'breathe', 'relax', 'calm', 'stress', 'anxiety', 'meditație', 'respirație'],
        corporate: ['business', 'meeting', 'presentation', 'strategy', 'afaceri', 'întâlnire', 'prezentare'],
        space:     ['space', 'stars', 'universe', 'planet', 'cosmos', 'spațiu', 'univers', 'stele'],
        beach:     ['travel', 'vacation', 'holiday', 'beach', 'sea', 'vacanță', 'călătorie', 'mare'],
        studio:    ['art', 'draw', 'paint', 'design', 'creative', 'artă', 'desen', 'pictură'],
        dream:     ['dream', 'sleep', 'night', 'vis', 'somn', 'noapte'],
    };

    var _indicatorEl = null;
    var _indicatorTimer = null;

    function showThemeIndicator(text) {
        if (!_indicatorEl) {
            _indicatorEl = document.createElement('div');
            _indicatorEl.id = 'theme-indicator';
            _indicatorEl.style.cssText = [
                'position:fixed',
                'top:12px',
                'right:12px',
                'z-index:500',
                'background:rgba(0,0,0,0.7)',
                'color:#fff',
                'padding:6px 14px',
                'border-radius:20px',
                'font-size:0.85rem',
                'pointer-events:none',
                'transition:opacity 0.4s ease',
                'opacity:0',
            ].join(';');
            document.body.appendChild(_indicatorEl);
        }
        _indicatorEl.textContent = text;
        _indicatorEl.style.opacity = '1';
        if (_indicatorTimer) clearTimeout(_indicatorTimer);
        _indicatorTimer = setTimeout(function () {
            _indicatorEl.style.opacity = '0';
        }, 2000);
    }

    function setTheme(name) {
        var theme = THEMES[name] || THEMES.default;
        var resolvedName = THEMES[name] ? name : 'default';
        document.body.style.transition = 'background 0.8s ease';
        document.body.style.background = theme.bg;
        document.documentElement.style.setProperty('--accent', theme.accent);
        var canvas = document.getElementById('avatar-canvas');
        if (canvas) canvas.style.filter = 'drop-shadow(0 0 20px ' + theme.accent + '40)';
        showThemeIndicator(theme.emoji + ' ' + resolvedName);
        currentTheme = resolvedName;
        try { localStorage.setItem('kelion_theme', resolvedName); } catch (e) { /* ignore */ }
    }

    function detectTheme(message) {
        var lower = message.toLowerCase();
        var themes = Object.keys(KEYWORDS);
        for (var i = 0; i < themes.length; i++) {
            var theme = themes[i];
            var words = KEYWORDS[theme];
            for (var j = 0; j < words.length; j++) {
                if (lower.indexOf(words[j]) !== -1) {
                    return theme;
                }
            }
        }
        return null;
    }

    function onMessage(text) {
        var theme = detectTheme(text);
        if (theme && theme !== currentTheme) setTheme(theme);
    }

    // Restore last theme on init
    (function restoreTheme() {
        try {
            var saved = localStorage.getItem('kelion_theme');
            if (saved && THEMES[saved]) setTheme(saved);
        } catch (e) { /* ignore */ }
    })();

    window.KBackgrounds = {
        setTheme: setTheme,
        onMessage: onMessage,
        getTheme: function () { return currentTheme; },
    };
})();
