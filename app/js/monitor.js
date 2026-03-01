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
        } else {
            showMarkdown(String(content));
        }
    }

    function clear() {
        showPanel('monitor-default');
        if (window.KAvatar) KAvatar.setPresenting(false);
    }

    function downloadContent() {
        var imgEl = document.getElementById('monitor-image');
        var mapEl = document.getElementById('monitor-map');
        var textEl = document.getElementById('monitor-text');
        var img = imgEl && imgEl.style.display !== 'none' ? imgEl.querySelector('img') : null;
        var iframe = mapEl && mapEl.style.display !== 'none' ? mapEl.querySelector('iframe') : null;
        var text = textEl && textEl.style.display !== 'none' ? textEl : null;

        if (img && img.src) {
            fetch(img.src).then(function(r) { return r.blob(); }).then(function(blob) {
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url; a.download = 'monitor-image.png'; a.click();
                setTimeout(function() { URL.revokeObjectURL(url); }, 100);
            }).catch(function() {
                var a = document.createElement('a');
                a.href = img.src; a.download = 'monitor-image.png'; a.target = '_blank'; a.click();
            });
        } else if (iframe && iframe.src) {
            var a = document.createElement('a');
            var blob = new Blob([iframe.src], { type: 'text/plain' });
            var iframeUrl = URL.createObjectURL(blob);
            a.href = iframeUrl; a.download = 'monitor-url.txt'; a.click();
            setTimeout(function() { URL.revokeObjectURL(iframeUrl); }, 100);
        } else if (text) {
            var blob2 = new Blob([text.innerHTML], { type: 'text/html' });
            var textUrl = URL.createObjectURL(blob2);
            var a2 = document.createElement('a');
            a2.href = textUrl; a2.download = 'monitor-content.html'; a2.click();
            setTimeout(function() { URL.revokeObjectURL(textUrl); }, 100);
        }
    }

    // Requires JSZip library to be loaded before monitor.js for ZIP export to work.
    // Falls back to downloadContent() if JSZip is unavailable.
    function downloadAsZip() {
        if (window.JSZip) {
            var zip = new JSZip();
            var imgEl = document.getElementById('monitor-image');
            var textEl = document.getElementById('monitor-text');
            var img = imgEl && imgEl.style.display !== 'none' ? imgEl.querySelector('img') : null;
            var text = textEl && textEl.style.display !== 'none' ? textEl : null;
            var tasks = [];
            if (img && img.src) {
                tasks.push(fetch(img.src).then(function(r) { return r.blob(); }).then(function(b) { zip.file('image.png', b); }).catch(function() {}));
            }
            if (text) { zip.file('content.html', text.innerHTML); }
            Promise.all(tasks).then(function() {
                zip.generateAsync({ type: 'blob' }).then(function(blob) {
                    var zipUrl = URL.createObjectURL(blob);
                    var a = document.createElement('a');
                    a.href = zipUrl; a.download = 'monitor-export.zip'; a.click();
                    setTimeout(function() { URL.revokeObjectURL(zipUrl); }, 100);
                });
            });
        } else {
            downloadContent();
        }
    }

    document.addEventListener('DOMContentLoaded', function() {
        var dlBtn = document.getElementById('btn-monitor-download');
        var zipBtn = document.getElementById('btn-monitor-zip');
        if (dlBtn) dlBtn.addEventListener('click', downloadContent);
        if (zipBtn) zipBtn.addEventListener('click', downloadAsZip);
    });

    return {
        showImage: showImage,
        showMap: showMap,
        showWebContent: showWebContent,
        showMarkdown: showMarkdown,
        showSearchResults: showSearchResults,
        showWeather: showWeather,
        show: show,
        clear: clear,
        downloadContent: downloadContent,
        downloadAsZip: downloadAsZip
    };
})();
