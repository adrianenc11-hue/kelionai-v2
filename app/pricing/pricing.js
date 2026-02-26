(function () {
    'use strict';
    var API = window.location.origin;

    function esc(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getToken() {
        try { return localStorage.getItem('kelion_token'); } catch (e) { return null; }
    }

    function authHeaders() {
        var h = { 'Content-Type': 'application/json' };
        var t = getToken();
        if (t) h['Authorization'] = 'Bearer ' + t;
        return h;
    }

    async function loadPlans() {
        try {
            var r = await fetch(API + '/api/payments/plans');
            if (!r.ok) return [];
            return (await r.json()).plans || [];
        } catch (e) { return []; }
    }

    async function loadStatus() {
        try {
            var r = await fetch(API + '/api/payments/status', { headers: authHeaders() });
            if (!r.ok) return null;
            return await r.json();
        } catch (e) { return null; }
    }

    async function checkout(plan) {
        if (!getToken()) {
            alert('Trebuie să fii autentificat pentru a upgrade. Mergi la aplicație și autentifică-te.');
            window.location.href = '/';
            return;
        }
        try {
            var r = await fetch(API + '/api/payments/checkout', {
                method: 'POST', headers: authHeaders(),
                body: JSON.stringify({ plan: plan })
            });
            var d = await r.json();
            if (d.url) window.location.href = d.url;
            else alert(d.error || 'Eroare la procesarea plății.');
        } catch (e) { alert('Eroare la procesarea plății.'); }
    }

    async function openPortal() {
        try {
            var r = await fetch(API + '/api/payments/portal', {
                method: 'POST', headers: authHeaders()
            });
            var d = await r.json();
            if (d.url) window.location.href = d.url;
            else alert(d.error || 'Eroare portal billing.');
        } catch (e) { alert('Eroare la deschiderea portalului de billing.'); }
    }

    function renderPlans(plans, status) {
        var container = document.getElementById('pricing-plans');
        if (!container) return;

        var currentPlan = status ? status.plan : null;
        var subscription = status ? status.subscription : null;

        if (!plans || plans.length === 0) {
            container.innerHTML = '<div class="plan-loading">Planurile nu sunt disponibile momentan.</div>';
            return;
        }

        container.innerHTML = '';

        plans.forEach(function (p) {
            var isCurrent = p.id === currentPlan;
            var card = document.createElement('div');
            card.className = 'plan-card' +
                (p.id === 'pro' ? ' featured' : '') +
                (isCurrent ? ' current' : '');

            var badgeHtml = p.id === 'pro' ? '<div class="plan-badge">Recomandat</div>' :
                            p.id === 'enterprise' ? '<div class="plan-badge">Business</div>' : '';

            var priceHtml = p.price === 0
                ? '<div class="plan-price">Gratuit</div>'
                : '<div class="plan-price"><span class="currency">€</span>' + esc(p.price) + '<small>/lună</small></div>';

            var features = p.features || [
                p.limits.chat === -1 ? 'Chat nelimitat' : p.limits.chat + ' chat/zi',
                p.limits.search === -1 ? 'Căutări nelimitate' : p.limits.search + ' căutări/zi',
                p.limits.image === -1 ? 'Imagini nelimitate' : p.limits.image + ' imagini/zi'
            ];

            var featuresHtml = features.map(function (f) {
                return '<li>' + esc(f) + '</li>';
            }).join('');

            var btnHtml;
            if (isCurrent) {
                btnHtml = '<button class="plan-btn current-plan" disabled>Plan curent</button>';
                if (subscription && subscription.current_period_end) {
                    var renewDate = new Date(subscription.current_period_end).toLocaleDateString('ro-RO');
                    btnHtml += '<button class="plan-btn manage" id="btn-manage-' + esc(p.id) + '">Gestionează abonamentul</button>';
                    btnHtml += '<p style="font-size:0.75rem;color:#8888aa;text-align:center;margin-top:6px">Se reînnoiește pe ' + esc(renewDate) + '</p>';
                }
            } else if (p.price === 0) {
                btnHtml = '<button class="plan-btn free-plan" disabled>Inclus</button>';
            } else {
                btnHtml = '<button class="plan-btn upgrade" data-plan="' + esc(p.id) + '">Upgrade la ' + esc(p.name) + '</button>';
            }

            card.innerHTML = badgeHtml +
                '<div class="plan-name">' + esc(p.name) + '</div>' +
                priceHtml +
                '<ul class="plan-features">' + featuresHtml + '</ul>' +
                '<div class="plan-action">' + btnHtml + '</div>';

            container.appendChild(card);

            var upgradeBtn = card.querySelector('.plan-btn.upgrade');
            if (upgradeBtn) {
                upgradeBtn.addEventListener('click', function () {
                    checkout(this.getAttribute('data-plan'));
                });
            }

            var manageBtn = card.querySelector('.plan-btn.manage');
            if (manageBtn) {
                manageBtn.addEventListener('click', openPortal);
            }
        });
    }

    function showStatus(status) {
        var el = document.getElementById('pricing-status');
        if (!el || !status) return;

        var plan = status.plan || 'guest';
        var msg = '';
        if (plan !== 'guest' && plan !== 'free') {
            var renewDate = status.subscription && status.subscription.current_period_end
                ? ' · Reînnoire: ' + esc(new Date(status.subscription.current_period_end).toLocaleDateString('ro-RO'))
                : '';
            msg = '✅ Plan curent: <strong>' + esc(plan.toUpperCase()) + '</strong>' + renewDate;
        } else if (plan === 'free') {
            msg = 'Ești pe planul <strong>Free</strong>. Upgrade pentru acces extins.';
        }

        if (msg) {
            el.innerHTML = msg;
            el.classList.remove('hidden');
        }
    }

    function checkPaymentResult() {
        var params = new URLSearchParams(window.location.search);
        var payment = params.get('payment');
        if (payment === 'success') {
            var el = document.getElementById('pricing-status');
            if (el) {
                el.innerHTML = '✅ Plata procesată cu succes! Planul tău a fost activat.';
                el.classList.remove('hidden');
                el.style.background = 'rgba(0, 255, 136, 0.08)';
                el.style.borderColor = 'rgba(0, 255, 136, 0.3)';
                el.style.color = '#00ff88';
            }
            window.history.replaceState({}, '', window.location.pathname);
        } else if (payment === 'cancel') {
            var el2 = document.getElementById('pricing-status');
            if (el2) {
                el2.innerHTML = 'Plata a fost anulată. Poți încerca din nou oricând.';
                el2.classList.remove('hidden');
                el2.style.background = 'rgba(255, 100, 100, 0.08)';
                el2.style.borderColor = 'rgba(255, 100, 100, 0.2)';
                el2.style.color = '#ff8888';
            }
            window.history.replaceState({}, '', window.location.pathname);
        }
    }

    async function init() {
        checkPaymentResult();

        var plans = await loadPlans();
        var status = await loadStatus();

        showStatus(status);
        renderPlans(plans, status);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
