// KelionAI v2 — Dynamic Backgrounds Module
(function () {
    'use strict';

    var CONTEXTS = {
        classroom: ['teach', 'learn', 'lesson', 'lecture', 'study', 'course', 'school', 'predai', 'invata', 'curs'],
        lab:       ['chemistry', 'experiment', 'formula', 'molecule', 'chimie', 'laborator'],
        office:    ['code', 'coding', 'program', 'develop', 'cod', 'programare', 'debug'],
        kitchen:   ['cook', 'recipe', 'food', 'meal', 'gatit', 'reteta', 'mancare', 'bucatarie'],
        gym:       ['workout', 'exercise', 'fitness', 'gym', 'antrenament', 'sport', 'exercitiu'],
        zen:       ['meditat', 'relax', 'breathe', 'calm', 'meditatie', 'respiratie', 'liniste'],
        corporate: ['business', 'meeting', 'presentation', 'prezentare', 'afacere', 'intalnire'],
        space:     ['space', 'universe', 'cosmos', 'spatiu', 'univers', 'stele']
    };

    var currentContext = 'default';
    var lastSwitch = 0;
    var CONTEXT_SWITCH_COOLDOWN_MS = 30000; // prevent rapid background flicker

    function detectContext(text) {
        var lower = text.toLowerCase();
        var keys = Object.keys(CONTEXTS);
        for (var i = 0; i < keys.length; i++) {
            var ctx = keys[i];
            var keywords = CONTEXTS[ctx];
            for (var j = 0; j < keywords.length; j++) {
                if (lower.indexOf(keywords[j]) !== -1) return ctx;
            }
        }
        return 'default';
    }

    function setContext(ctx) {
        var now = Date.now();
        if (ctx === currentContext) return;
        if (now - lastSwitch < CONTEXT_SWITCH_COOLDOWN_MS) return;
        lastSwitch = now;

        var body = document.body;
        // Remove all bg-* classes
        var classes = Array.prototype.slice.call(body.classList);
        for (var i = 0; i < classes.length; i++) {
            if (classes[i].indexOf('bg-') === 0) body.classList.remove(classes[i]);
        }
        if (ctx !== 'default') body.classList.add('bg-' + ctx);
        currentContext = ctx;
    }

    function getContext() { return currentContext; }

    function init() {
        window.addEventListener('kelion-context-change', function (e) {
            var text = (e.detail && e.detail.message) ? e.detail.message : '';
            var ctx = detectContext(text);
            setContext(ctx);
        });
    }

    window.KBG = { init: init, setContext: setContext, getContext: getContext };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
