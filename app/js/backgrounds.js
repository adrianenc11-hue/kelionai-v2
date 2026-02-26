(function () {
    'use strict';

    var _currentTheme = 'bg-default';

    var CONTEXT_MAP = {
        'bg-classroom': ['learn', 'teach', 'study', 'course', 'lesson', 'school', 'nva', 'curs'],
        'bg-lab':       ['chemistry', 'science', 'experiment', 'chimie', 'laborator'],
        'bg-office':    ['code', 'coding', 'work', 'office', 'business', 'email', 'cod'],
        'bg-kitchen':   ['cook', 'recipe', 'food', 'gatesc', 'reteta', 'mancare'],
        'bg-gym':       ['workout', 'exercise', 'gym', 'fitness', 'antrenament'],
        'bg-zen':       ['meditat', 'relax', 'calm', 'breath', 'mindful', 'liniste'],
        'bg-night':     ['tired', 'sleep', 'noapte', 'obosit', 'somn'],
        'bg-happy':     ['happy', 'great', 'amazing', 'fericit', 'super', 'excellent']
    };

    var ALL_THEMES = ['bg-default', 'bg-classroom', 'bg-lab', 'bg-office', 'bg-kitchen', 'bg-gym', 'bg-zen', 'bg-night', 'bg-emergency', 'bg-happy'];

    function setTheme(theme) {
        if (_currentTheme === theme) return;
        var body = document.body;
        ALL_THEMES.forEach(function (t) { body.classList.remove(t); });
        if (theme && theme !== 'bg-default') body.classList.add(theme);
        _currentTheme = theme;
    }

    function detectFromMessage(message) {
        if (!message) return;
        var lower = message.toLowerCase();
        var bestTheme = null;
        var bestCount = 0;
        var MIN_MATCHES = 2; // require at least 2 matching keywords

        Object.keys(CONTEXT_MAP).forEach(function (theme) {
            var keywords = CONTEXT_MAP[theme];
            var count = 0;
            keywords.forEach(function (kw) { if (lower.includes(kw)) count++; });
            if (count >= MIN_MATCHES && count > bestCount) {
                bestCount = count;
                bestTheme = theme;
            }
        });

        if (bestTheme) setTheme(bestTheme);
    }

    function getCurrentTheme() {
        return _currentTheme;
    }

    window.KBackground = { setTheme: setTheme, detectFromMessage: detectFromMessage, getCurrentTheme: getCurrentTheme };
}());
