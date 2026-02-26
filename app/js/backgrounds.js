// ═══════════════════════════════════════════════════════════════
// KelionAI — Dynamic Backgrounds
// Auto-switches background based on conversation topic
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const CONTEXT_BACKGROUNDS = {
        study:     { gradient: 'linear-gradient(135deg, #0d1b2a 0%, #1a3a5c 100%)', accent: '#4fc3f7', icon: '📚' },
        cooking:   { gradient: 'linear-gradient(135deg, #1a0a00 0%, #3d1a00 100%)', accent: '#ff8a65', icon: '🍳' },
        fitness:   { gradient: 'linear-gradient(135deg, #0a1a0a 0%, #1a3a1a 100%)', accent: '#69f0ae', icon: '💪' },
        music:     { gradient: 'linear-gradient(135deg, #1a0a2e 0%, #2d1b4e 100%)', accent: '#ce93d8', icon: '🎵' },
        travel:    { gradient: 'linear-gradient(135deg, #0a1628 0%, #0d2137 100%)', accent: '#80deea', icon: '✈️' },
        business:  { gradient: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%)', accent: '#90caf9', icon: '💼' },
        meditation:{ gradient: 'linear-gradient(135deg, #0a1a1a 0%, #0d2626 100%)', accent: '#80cbc4', icon: '🧘' },
        gaming:    { gradient: 'linear-gradient(135deg, #0a0014 0%, #1a0028 100%)', accent: '#ea80fc', icon: '🎮' },
        science:   { gradient: 'linear-gradient(135deg, #001a0a 0%, #002a14 100%)', accent: '#a5d6a7', icon: '🔬' },
        default:   { gradient: 'linear-gradient(135deg, #0a0e1a 0%, #1a1e2e 100%)', accent: '#00D4FF', icon: '' },
    };

    const KEYWORDS = {
        study:     ['learn', 'study', 'course', 'lesson', 'homework', 'school', 'university', 'invatam', 'curs', 'lectie', 'examen', 'exam', 'tema'],
        cooking:   ['cook', 'recipe', 'food', 'eat', 'kitchen', 'gatesc', 'reteta', 'mancare', 'bucatarie', 'ingredient', 'fel de mancare'],
        fitness:   ['workout', 'exercise', 'gym', 'run', 'sport', 'antrenament', 'sala', 'alerg', 'fitness', 'muschi', 'cardio'],
        music:     ['music', 'song', 'play', 'listen', 'muzica', 'cantec', 'asculta', 'chitara', 'pian', 'melodie', 'playlist'],
        travel:    ['travel', 'trip', 'visit', 'flight', 'hotel', 'calatorie', 'zbor', 'vacanta', 'drum', 'destinatie', 'turism'],
        business:  ['work', 'business', 'meeting', 'office', 'email', 'munca', 'afacere', 'intalnire', 'birou', 'proiect', 'client'],
        meditation:['relax', 'meditate', 'calm', 'breathe', 'stress', 'relaxare', 'meditatie', 'liniste', 'respiratie', 'anxietate'],
        gaming:    ['game', 'play', 'gaming', 'joc', 'joaca', 'level', 'score', 'jucator', 'fps', 'rpg'],
        science:   ['science', 'chemistry', 'physics', 'biology', 'lab', 'stiinta', 'chimie', 'fizica', 'biologie', 'experiment'],
    };

    var currentBg = 'default';
    var transitionTimeout = null;

    function detectContext(text) {
        var t = text.toLowerCase();
        for (var ctx in KEYWORDS) {
            if (KEYWORDS.hasOwnProperty(ctx)) {
                var words = KEYWORDS[ctx];
                for (var i = 0; i < words.length; i++) {
                    if (t.indexOf(words[i]) !== -1) return ctx;
                }
            }
        }
        return null;
    }

    function applyBackground(ctx, animate) {
        if (animate === undefined) animate = true;
        if (ctx === currentBg) return;
        var bg = CONTEXT_BACKGROUNDS[ctx] || CONTEXT_BACKGROUNDS.default;
        var body = document.body;
        if (animate) body.style.transition = 'background 1.5s ease';
        body.style.background = bg.gradient;
        currentBg = ctx;
        // Update accent color CSS variable
        var isKira = document.querySelector('[data-avatar="kira"].active');
        document.documentElement.style.setProperty('--kelion-accent', isKira ? '#FF6EB4' : bg.accent);
    }

    function onMessage(text) {
        var ctx = detectContext(text);
        if (ctx) {
            if (transitionTimeout) clearTimeout(transitionTimeout);
            // Delay 2s after message to avoid flicker
            transitionTimeout = setTimeout(function () { applyBackground(ctx); }, 2000);
        }
    }

    function reset() {
        if (transitionTimeout) clearTimeout(transitionTimeout);
        applyBackground('default');
    }

    window.KBackgrounds = { onMessage: onMessage, reset: reset, applyBackground: applyBackground, detectContext: detectContext };
})();
