// ═══════════════════════════════════════════════════════════════
// KelionAI — Dynamic Backgrounds
// Auto-detect context from conversation and change background
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var BACKGROUNDS = {
        default:    { gradient: 'linear-gradient(135deg, #0a0e1a 0%, #1a1e2e 100%)', emoji: '' },
        cooking:    { gradient: 'linear-gradient(135deg, #1a0e00 0%, #2e1800 100%)', emoji: '🍳' },
        coding:     { gradient: 'linear-gradient(135deg, #001a0e 0%, #002e1a 100%)', emoji: '💻' },
        meditation: { gradient: 'linear-gradient(135deg, #0a0a1a 0%, #1a0a2e 100%)', emoji: '🧘' },
        workout:    { gradient: 'linear-gradient(135deg, #1a0000 0%, #2e0a00 100%)', emoji: '💪' },
        learning:   { gradient: 'linear-gradient(135deg, #000a1a 0%, #001a2e 100%)', emoji: '📚' },
        music:      { gradient: 'linear-gradient(135deg, #0a001a 0%, #1a002e 100%)', emoji: '🎵' },
        travel:     { gradient: 'linear-gradient(135deg, #001a1a 0%, #002e2e 100%)', emoji: '✈️' },
        business:   { gradient: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%)', emoji: '💼' },
        emergency:  { gradient: 'linear-gradient(135deg, #1a0000 0%, #3a0000 100%)', emoji: '🆘' }
    };

    var CONTEXT_KEYWORDS = {
        cooking:    ['cook', 'recipe', 'food', 'kitchen', 'bake', 'gătit', 'rețetă', 'mâncare'],
        coding:     ['code', 'programming', 'debug', 'function', 'cod', 'programare'],
        meditation: ['meditat', 'calm', 'breath', 'relax', 'zen', 'mindful', 'respirație'],
        workout:    ['workout', 'exercise', 'gym', 'fitness', 'antrenament', 'sport'],
        learning:   ['learn', 'study', 'course', 'lesson', 'teach', 'înv', 'curs', 'lecție'],
        music:      ['music', 'song', 'playlist', 'muzică', 'cântec'],
        travel:     ['travel', 'trip', 'flight', 'hotel', 'călăto', 'vacanță'],
        business:   ['business', 'meeting', 'invoice', 'afaceri', 'ședință']
    };

    function detectContext(text) {
        if (!text) return 'default';
        var lower = text.toLowerCase();
        var contexts = Object.keys(CONTEXT_KEYWORDS);
        for (var i = 0; i < contexts.length; i++) {
            var keywords = CONTEXT_KEYWORDS[contexts[i]];
            for (var j = 0; j < keywords.length; j++) {
                if (lower.indexOf(keywords[j]) !== -1) return contexts[i];
            }
        }
        return 'default';
    }

    function setBackground(context) {
        var bg = BACKGROUNDS[context] || BACKGROUNDS.default;
        document.body.style.transition = 'background 1s ease';
        document.body.style.background = bg.gradient;
    }

    function reset() {
        setBackground('default');
    }

    window.KBackgrounds = { set: setBackground, detect: detectContext, reset: reset };
}());
