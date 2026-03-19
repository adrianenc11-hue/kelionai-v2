// ═══════════════════════════════════════════════════════════════
// KelionAI — Monitor Manager
// Controls the right-side display panel content
// ═══════════════════════════════════════════════════════════════
const _MonitorManager = (function () {
    'use strict';

    const PANELS = ['monitor-image', 'monitor-map', 'monitor-text', 'monitor-search', 'monitor-weather', 'monitor-iframe', 'monitor-audio', 'monitor-video', 'monitor-default'];
    let _lastContentHash = ''; // Dedup: prevent same content showing twice

    // Display type per panel — match what CSS expects
    const PANEL_DISPLAY = {
        'monitor-image': 'flex',
        'monitor-map': 'flex',
        'monitor-text': 'flex',
        'monitor-default': 'flex',
    };

    function showPanel(id) {
        console.log('[MonitorManager] showPanel called for:', id);
        PANELS.forEach(function (pid) {
            const el = document.getElementById(pid);
            if (el) el.style.setProperty('display', 'none', 'important');
        });
        // Pe mobile, display-panel e ascuns cu transform:translateY(100%) — il aratam
        const displayPanel = document.getElementById('display-panel');
        if (displayPanel) {
            if (id !== 'monitor-default') {
                displayPanel.classList.add('mobile-visible');
            } else {
                displayPanel.classList.remove('mobile-visible');
            }
        }
        // Avatarul rămâne vizibil — e în left-panel, monitorul e în display-panel
        const el = document.getElementById(id);
        if (el) {
            const displayVal = PANEL_DISPLAY[id] || 'block';
            el.style.setProperty('display', displayVal, 'important');
            console.log('[MonitorManager] Set', id, 'display to:', displayVal, 'actual:', el.style.display);
        }
    }

    function showImage(url, caption) {
        console.log('[MonitorManager] showImage called with:', url?.substring(0, 80));
        const el = document.getElementById('monitor-image');
        if (!el) { console.warn('[MonitorManager] #monitor-image not found!'); return; }
        const safeUrl = String(url).replace(/"/g, '&quot;');
        const safeCaption = caption ? String(caption).replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
        el.innerHTML = '<img src="' + safeUrl + '" alt="' + safeCaption + '">' +
            (safeCaption ? '<p class="monitor-caption">' + safeCaption + '</p>' : '');
        // Nuclear fix: do ALL visibility directly, don't rely only on showPanel
        showPanel('monitor-image');
        // Force display:flex explicitly (CSS has display:none rule that may override)
        el.style.setProperty('display', 'flex', 'important');
        console.log('[MonitorManager] monitor-image display set to:', el.style.display);
        if (window.KAvatar) KAvatar.setPresenting(true);
    }

    function showMap(lat, lng, label) {
        const el = document.getElementById('monitor-map');
        if (!el) return;
        const safeLabel = label ? String(label).replace(/"/g, '&quot;') : 'Map';
        const bbox = (lng - 0.05) + '%2C' + (lat - 0.05) + '%2C' + (lng + 0.05) + '%2C' + (lat + 0.05);
        const url = 'https://www.openstreetmap.org/export/embed.html?bbox=' + bbox +
            '&layer=mapnik&marker=' + lat + '%2C' + lng;
        el.innerHTML = '<iframe src="' + url + '" title="' + safeLabel + '"></iframe>' +
            (label ? '<p class="monitor-caption">📍 ' + String(label).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>' : '');
        showPanel('monitor-map');
        if (window.KAvatar) KAvatar.setPresenting(true);
    }

    function showWebContent(url) {
        const el = document.getElementById('monitor-map');
        if (!el) return;
        const safeUrl = String(url).replace(/"/g, '&quot;');
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
            const goBtn = document.getElementById('browser-go');
            const urlInput = document.getElementById('browser-url');
            const closeBtn = document.getElementById('browser-close');
            if (goBtn && urlInput) {
                goBtn.addEventListener('click', function () {
                    let u = urlInput.value.trim();
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
        const el = document.getElementById('monitor-text');
        if (!el) return;
        const html = String(text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')
            .replace(/^\d+\.\s(.+)$/gm, '<li>$1</li>')
            .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
            .replace(/\n/g, '<br>');
        el.innerHTML = html;
        showPanel('monitor-text');
        if (window.KAvatar) KAvatar.setPresenting(true);
    }

    function showSearchResults(results) {
        const el = document.getElementById('monitor-search');
        if (!el) return;
        if (!results || !results.length) { clear(); return; }
        let html = '<div class="monitor-search-list">';
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            const title = String(r.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const url = String(r.url || r.link || '#').replace(/"/g, '&quot;');
            const snippet = String(r.snippet || r.description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
        const el = document.getElementById('monitor-weather');
        if (!el) return;
        const icon = data.icon || '🌤️';
        const city = String(data.city || data.location || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const temp = data.temperature !== undefined ? data.temperature : (data.temp !== undefined ? data.temp : '');
        const desc = String(data.description || data.condition || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const html = '<div class="weather-card">' +
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
        console.log('[MonitorManager] show() called with type:', type, 'content length:', String(content).length, 'content start:', String(content).substring(0, 60));
        // Dedup: skip if same content already displayed
        const hash = String(content).substring(0, 200) + '|' + (type || '');
        if (hash === _lastContentHash) {
            console.log('[MonitorManager] DEDUP: skipping, same content already displayed');
            return;
        }
        _lastContentHash = hash;

        if (type === 'image') {
            showImage(content);
        } else if (type === 'map') {
            const el = document.getElementById('monitor-map');
            if (!el) return;
            const safeUrl = String(content).replace(/"/g, '&quot;');
            el.innerHTML = '<iframe src="' + safeUrl + '" title="Map"></iframe>';
            showPanel('monitor-map');
            if (window.KAvatar) KAvatar.setPresenting(true);
        } else if (type === 'html') {
            // HTML (harti, grafice) — afisam in display-panel (monitor)
            var dp = document.getElementById('display-content') || document.getElementById('display-panel');
            if (!dp) return;
            PANELS.forEach(function (pid) {
                var pel = document.getElementById(pid);
                if (pel) pel.style.setProperty('display', 'none', 'important');
            });
            var box = document.getElementById('_kelion_html_box');
            if (!box) {
                box = document.createElement('div');
                box.id = '_kelion_html_box';
                box.style.cssText = 'width:100%;height:100%;position:relative;';
                dp.appendChild(box);
            }
            box.style.display = 'block';
            var iframe = document.createElement('iframe');
            iframe.style.cssText = 'width:100%;height:100%;min-height:500px;border:none;border-radius:8px;display:block;background:#0a0a1e;';
            iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
            iframe.srcdoc = content;
            box.innerHTML = '';
            box.appendChild(iframe);
            if (window.KAvatar) KAvatar.setPresenting(true);
        } else if (type === 'weather' && typeof content === 'object') {
            showWeather(content);
        } else if (type === 'web') {
            showWebContent(content);
        } else if (type === 'iframe') {
            showIframe(content);
        } else if (type === 'audio') {
            showRadio(content);
        } else if (type === 'video') {
            showVideo(content);
        } else {
            showMarkdown(String(content));
        }
    }

    // ── IFRAME (URL/Web Navigation) ──
    function showIframe(url, title) {
        const iframe = document.getElementById('monitor-iframe-src');
        if (!iframe) return;
        iframe.src = String(url);
        const titleEl = document.getElementById('display-title');
        if (titleEl && title) titleEl.textContent = title;
        showPanel('monitor-iframe');
        if (window.KAvatar) KAvatar.setPresenting(true);
    }

    // ── RADIO LIVE ──
    function showRadio(streamUrl, stationName, logo) {
        const player = document.getElementById('radio-player');
        const nameEl = document.getElementById('radio-name');
        const logoEl = document.getElementById('radio-logo');
        if (!player) return;
        player.src = String(streamUrl);
        if (nameEl) nameEl.textContent = stationName || 'Radio';
        if (logoEl) logoEl.textContent = logo || '📻';
        player.play().catch(function () { });
        const titleEl = document.getElementById('display-title');
        if (titleEl) titleEl.textContent = '🎵 ' + (stationName || 'Radio');
        showPanel('monitor-audio');
        if (window.KAvatar) KAvatar.setPresenting(true);
    }

    // ── VIDEO (YouTube / Netflix / Embed) ──
    function showVideo(embedUrl, title) {
        const iframe = document.getElementById('monitor-video-src');
        if (!iframe) return;
        iframe.src = String(embedUrl);
        const titleEl = document.getElementById('display-title');
        if (titleEl) titleEl.textContent = '🎬 ' + (title || 'Video');
        showPanel('monitor-video');
        if (window.KAvatar) KAvatar.setPresenting(true);
    }

    function clear() {
        // Ascunde HTML box si reseteaza monitorul
        var box = document.getElementById('_kelion_html_box');
        if (box) box.style.display = 'none';
        PANELS.forEach(function (pid) {
            var el = document.getElementById(pid);
            if (el) el.style.display = 'none';
        });
        var def = document.getElementById('monitor-default');
        if (def) def.style.display = '';
        if (window.KAvatar) KAvatar.setPresenting(false);
    }

    function downloadContent() {
        const imgEl = document.getElementById('monitor-image');
        const mapEl = document.getElementById('monitor-map');
        const textEl = document.getElementById('monitor-text');
        const img = imgEl && imgEl.style.display !== 'none' ? imgEl.querySelector('img') : null;
        const iframe = mapEl && mapEl.style.display !== 'none' ? mapEl.querySelector('iframe') : null;
        const text = textEl && textEl.style.display !== 'none' ? textEl : null;

        if (img && img.src) {
            fetch(img.src).then(function (r) { return r.blob(); }).then(function (blob) {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = 'monitor-image.png'; a.click();
                setTimeout(function () { URL.revokeObjectURL(url); }, 100);
            }).catch(function () {
                const a = document.createElement('a');
                a.href = img.src; a.download = 'monitor-image.png'; a.target = '_blank'; a.click();
            });
        } else if (iframe && iframe.src) {
            const a = document.createElement('a');
            const blob = new Blob([iframe.src], { type: 'text/plain' });
            const iframeUrl = URL.createObjectURL(blob);
            a.href = iframeUrl; a.download = 'monitor-url.txt'; a.click();
            setTimeout(function () { URL.revokeObjectURL(iframeUrl); }, 100);
        } else if (text) {
            const blob2 = new Blob([text.innerHTML], { type: 'text/html' });
            const textUrl = URL.createObjectURL(blob2);
            const a2 = document.createElement('a');
            a2.href = textUrl; a2.download = 'monitor-content.html'; a2.click();
            setTimeout(function () { URL.revokeObjectURL(textUrl); }, 100);
        }
    }

    // Requires JSZip library to be loaded before monitor.js for ZIP export to work.
    // Falls back to downloadContent() if JSZip is unavailable.
    function downloadAsZip() {
        if (window.JSZip) {
            const zip = new JSZip();
            const imgEl = document.getElementById('monitor-image');
            const textEl = document.getElementById('monitor-text');
            const img = imgEl && imgEl.style.display !== 'none' ? imgEl.querySelector('img') : null;
            const text = textEl && textEl.style.display !== 'none' ? textEl : null;
            const tasks = [];
            if (img && img.src) {
                tasks.push(fetch(img.src).then(function (r) { return r.blob(); }).then(function (b) { zip.file('image.png', b); }).catch(function () { }));
            }
            if (text) { zip.file('content.html', text.innerHTML); }
            Promise.all(tasks).then(function () {
                zip.generateAsync({ type: 'blob' }).then(function (blob) {
                    const zipUrl = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = zipUrl; a.download = 'monitor-export.zip'; a.click();
                    setTimeout(function () { URL.revokeObjectURL(zipUrl); }, 100);
                });
            });
        } else {
            downloadContent();
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        const dlBtn = document.getElementById('btn-monitor-download');
        const zipBtn = document.getElementById('btn-monitor-zip');
        const webBtn = document.getElementById('btn-monitor-web');
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
        showIframe: showIframe,
        showRadio: showRadio,
        showVideo: showVideo,
        show: show,
        clear: clear,
        downloadContent: downloadContent,
        downloadAsZip: downloadAsZip
    };
})();

// ── Expune global pentru ca orice modul sa poata controla monitorul ──
window.MonitorManager = _MonitorManager;
window.showOnMonitor = function (content, type) {
    if (_MonitorManager) _MonitorManager.show(content, type);
};

