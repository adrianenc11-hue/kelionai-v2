// ═══════════════════════════════════════════════════════════════
// KelionAI — Monitor Manager
// Controls the right-side display panel content
// ═══════════════════════════════════════════════════════════════
var MonitorManager = (function () {
    'use strict';

    var PANELS = ['monitor-image', 'monitor-map', 'monitor-text', 'monitor-search', 'monitor-weather', 'monitor-default'];

    function showPanel(id) {
        PANELS.forEach(function (pid) {
            var el = document.getElementById(pid);
            if (el) el.style.display = 'none';
        });
        var el = document.getElementById(id);
        if (el) el.style.display = '';
    }

    function showImage(url, caption) {
        var el = document.getElementById('monitor-image');
        if (!el) return;
        var safeUrl = String(url).replace(/"/g, '&quot;');
        var safeCaption = caption ? String(caption).replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
        el.innerHTML = '<img src="' + safeUrl + '" alt="' + safeCaption + '">' +
            (safeCaption ? '<p class="monitor-caption">' + safeCaption + '</p>' : '');
        showPanel('monitor-image');
        if (window.KAvatar) KAvatar.setPresenting(true);
    }

    function showMap(lat, lng, label) {
        var el = document.getElementById('monitor-map');
        if (!el) return;
        var safeLabel = label ? String(label).replace(/"/g, '&quot;') : 'Map';
        var bbox = (lng - 0.05) + '%2C' + (lat - 0.05) + '%2C' + (lng + 0.05) + '%2C' + (lat + 0.05);
        var url = 'https://www.openstreetmap.org/export/embed.html?bbox=' + bbox +
            '&layer=mapnik&marker=' + lat + '%2C' + lng;
        el.innerHTML = '<iframe src="' + url + '" title="' + safeLabel + '"></iframe>' +
            (label ? '<p class="monitor-caption">📍 ' + String(label).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>' : '');
        showPanel('monitor-map');
        if (window.KAvatar) KAvatar.setPresenting(true);
    }

    function showWebContent(url) {
        var el = document.getElementById('monitor-map');
        if (!el) return;
        var safeUrl = String(url).replace(/"/g, '&quot;');
        el.innerHTML = '<iframe src="' + safeUrl + '" title="Web content"></iframe>';
        showPanel('monitor-map');
        if (window.KAvatar) KAvatar.setPresenting(true);
    }

    function showMarkdown(text) {
        var el = document.getElementById('monitor-text');
        if (!el) return;
        var html = String(text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
        el.innerHTML = html;
        showPanel('monitor-text');
        if (window.KAvatar) KAvatar.setPresenting(true);
    }

    function showSearchResults(results) {
        var el = document.getElementById('monitor-search');
        if (!el) return;
        if (!results || !results.length) { clear(); return; }
        var html = '<div class="monitor-search-list">';
        for (var i = 0; i < results.length; i++) {
            var r = results[i];
            var title = String(r.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            var url = String(r.url || r.link || '#').replace(/"/g, '&quot;');
            var snippet = String(r.snippet || r.description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            html += '<div class="monitor-search-item">' +
                '<a href="' + url + '" target="_blank" rel="noopener">' +
                '<div class="search-title">' + title + '</div>' +
                '<div class="search-url">' + url + '</div>' +
                '<div class="search-snippet">' + snippet + '</div>' +
                '</a></div>';
        }
        html += '</div>';
        el.innerHTML = html;
        showPanel('monitor-search');
        if (window.KAvatar) KAvatar.setPresenting(true);
    }

    function showWeather(data) {
        var el = document.getElementById('monitor-weather');
        if (!el) return;
        var icon = data.icon || '🌤️';
        var city = String(data.city || data.location || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        var temp = data.temperature !== undefined ? data.temperature : (data.temp !== undefined ? data.temp : '');
        var desc = String(data.description || data.condition || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        var html = '<div class="weather-card">' +
            '<div class="weather-city">' + city + '</div>' +
            '<div class="weather-main">' +
            '<span class="weather-icon">' + icon + '</span>' +
            '<span class="weather-temp">' + temp + '°C</span>' +
            '</div>' +
            '<div class="weather-desc">' + desc + '</div>' +
            '<div class="weather-details">' +
            (data.humidity ? '<span>💧 ' + data.humidity + '%</span>' : '') +
            (data.wind ? '<span>💨 ' + data.wind + ' km/h</span>' : '') +
            '</div>' +
            '</div>';
        el.innerHTML = html;
        showPanel('monitor-weather');
        if (window.KAvatar) KAvatar.setPresenting(true);
    }

    function show(content, type) {
        if (type === 'image') {
            showImage(content);
        } else if (type === 'map') {
            var el = document.getElementById('monitor-map');
            if (!el) return;
            var safeUrl = String(content).replace(/"/g, '&quot;');
            el.innerHTML = '<iframe src="' + safeUrl + '" title="Map"></iframe>';
            showPanel('monitor-map');
            if (window.KAvatar) KAvatar.setPresenting(true);
        } else if (type === 'html') {
            var el2 = document.getElementById('monitor-text');
            if (!el2) return;
            el2.innerHTML = content;
            showPanel('monitor-text');
            if (window.KAvatar) KAvatar.setPresenting(true);
        } else {
            showMarkdown(String(content));
        }
    }

    function clear() {
        showPanel('monitor-default');
        if (window.KAvatar) KAvatar.setPresenting(false);
    }

    return {
        showImage: showImage,
        showMap: showMap,
        showWebContent: showWebContent,
        showMarkdown: showMarkdown,
        showSearchResults: showSearchResults,
        showWeather: showWeather,
        show: show,
        clear: clear
    };
})();
