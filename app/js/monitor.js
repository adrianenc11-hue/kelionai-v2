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
        el.innerHTML = '<div class="monitor-browser">' +
            '<div class="browser-bar">' +
            '<input type="text" id="browser-url" value="' + safeUrl + '" placeholder="Enter URL..." style="flex:1;background:#1a1a2e;color:#e0e0ff;border:1px solid #333;border-radius:6px;padding:5px 10px;font-size:0.75rem;">' +
            '<button id="browser-go" style="background:#6366F1;color:#fff;border:none;border-radius:6px;padding:5px 12px;cursor:pointer;margin-left:4px;font-size:0.75rem;">Go</button>' +
            '<button id="browser-close" style="background:#333;color:#aaa;border:none;border-radius:6px;padding:5px 8px;cursor:pointer;margin-left:4px;font-size:0.75rem;">✕</button>' +
            '</div>' +
            '<div class="browser-quick" style="display:flex;gap:6px;margin:4px 0;flex-wrap:wrap;">' +
            '<button class="qlink" data-url="https://www.youtube.com/embed/jfKfPfyJRdk" style="font-size:0.65rem;">▶ YouTube Live</button>' +
            '<button class="qlink" data-url="https://www.radiozu.ro" style="font-size:0.65rem;">📻 RadioZU</button>' +
            '<button class="qlink" data-url="https://www.kissfm.ro" style="font-size:0.65rem;">📻 KissFM</button>' +
            '<button class="qlink" data-url="https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M" style="font-size:0.65rem;">🎵 Spotify</button>' +
            '<button class="qlink-new" data-url="https://www.netflix.com" style="font-size:0.65rem;">🎬 Netflix ↗</button>' +
            '<button class="qlink-new" data-url="https://www.twitch.tv" style="font-size:0.65rem;">🎮 Twitch ↗</button>' +
            '</div>' +
            '<iframe src="' + safeUrl + '" title="Web browser" style="width:100%;flex:1;border:none;border-radius:8px;background:#000;"></iframe>' +
            '</div>';
        showPanel('monitor-map');
        if (window.KAvatar) KAvatar.setPresenting(true);
        // Wire up browser controls
        setTimeout(function () {
            var goBtn = document.getElementById('browser-go');
            var urlInput = document.getElementById('browser-url');
            var closeBtn = document.getElementById('browser-close');
            if (goBtn && urlInput) {
                goBtn.addEventListener('click', function () {
                    var u = urlInput.value.trim();
                    if (u && !u.startsWith('http')) u = 'https://' + u;
                    if (u) showWebContent(u);
                });
                urlInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') goBtn.click(); });
            }
            if (closeBtn) closeBtn.addEventListener('click', clear);
            document.querySelectorAll('.qlink').forEach(function (b) {
                b.addEventListener('click', function () { showWebContent(b.dataset.url); });
            });
            document.querySelectorAll('.qlink-new').forEach(function (b) {
                b.addEventListener('click', function () { window.open(b.dataset.url, '_blank'); });
            });
        }, 50);
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
            // Render trusted server HTML directly (weather, etc.)
            var el = document.getElementById('monitor-text');
            if (!el) return;
            el.innerHTML = content;
            showPanel('monitor-text');
            if (window.KAvatar) KAvatar.setPresenting(true);
        } else if (type === 'weather' && typeof content === 'object') {
            showWeather(content);
        } else if (type === 'web') {
            showWebContent(content);
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
            fetch(img.src).then(function (r) { return r.blob(); }).then(function (blob) {
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url; a.download = 'monitor-image.png'; a.click();
                setTimeout(function () { URL.revokeObjectURL(url); }, 100);
            }).catch(function () {
                var a = document.createElement('a');
                a.href = img.src; a.download = 'monitor-image.png'; a.target = '_blank'; a.click();
            });
        } else if (iframe && iframe.src) {
            var a = document.createElement('a');
            var blob = new Blob([iframe.src], { type: 'text/plain' });
            var iframeUrl = URL.createObjectURL(blob);
            a.href = iframeUrl; a.download = 'monitor-url.txt'; a.click();
            setTimeout(function () { URL.revokeObjectURL(iframeUrl); }, 100);
        } else if (text) {
            var blob2 = new Blob([text.innerHTML], { type: 'text/html' });
            var textUrl = URL.createObjectURL(blob2);
            var a2 = document.createElement('a');
            a2.href = textUrl; a2.download = 'monitor-content.html'; a2.click();
            setTimeout(function () { URL.revokeObjectURL(textUrl); }, 100);
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
                tasks.push(fetch(img.src).then(function (r) { return r.blob(); }).then(function (b) { zip.file('image.png', b); }).catch(function () { }));
            }
            if (text) { zip.file('content.html', text.innerHTML); }
            Promise.all(tasks).then(function () {
                zip.generateAsync({ type: 'blob' }).then(function (blob) {
                    var zipUrl = URL.createObjectURL(blob);
                    var a = document.createElement('a');
                    a.href = zipUrl; a.download = 'monitor-export.zip'; a.click();
                    setTimeout(function () { URL.revokeObjectURL(zipUrl); }, 100);
                });
            });
        } else {
            downloadContent();
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        var dlBtn = document.getElementById('btn-monitor-download');
        var zipBtn = document.getElementById('btn-monitor-zip');
        var webBtn = document.getElementById('btn-monitor-web');
        if (dlBtn) dlBtn.addEventListener('click', downloadContent);
        if (zipBtn) zipBtn.addEventListener('click', downloadAsZip);
        if (webBtn) webBtn.addEventListener('click', function () { showWebContent('about:blank'); });
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
