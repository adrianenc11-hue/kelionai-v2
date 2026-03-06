(function () {
    'use strict';

    function renderPlans(plans, status) {
        var container = document.getElementById('pricing-plans');
        if (!container) return;

        var currentPlan = status ? status.plan : null;
        var subscription = status ? status.subscription : null;

        if (!plans || plans.length === 0) {
            container.innerHTML = '<div class="plan-loading">Plans are not available at this time.</div>';
            return;
        }

        container.innerHTML = '';

        plans.forEach(function (p) {
            var isCurrent = p.id === currentPlan;
            var card = document.createElement('div');
            card.className = 'plan-card' +
                (p.id === 'pro' ? ' featured' : '') +
                (isCurrent ? ' current' : '');

            var badgeHtml = p.id === 'pro' ? '<div class="plan-badge">Recommended</div>' :
                p.id === 'enterprise' ? '<div class="plan-badge">Business</div>' : '';

            var priceHtml = p.price === 0
                ? '<div class="plan-price">Free</div>'
                : '<div class="plan-price"><span class="currency">€</span>' + KShared.esc(p.price) + '<small>/month</small></div>';

            var features = p.features || [
                p.limits.chat === -1 ? 'Unlimited chat' : p.limits.chat + ' chats/day',
                p.limits.search === -1 ? 'Unlimited searches' : p.limits.search + ' searches/day',
                p.limits.image === -1 ? 'Unlimited images' : p.limits.image + ' images/day'
            ];

            var featuresHtml = features.map(function (f) {
                return '<li>' + KShared.esc(f) + '</li>';
            }).join('');

            var btnHtml;
            if (isCurrent) {
                btnHtml = '<button class="plan-btn current-plan" disabled>Current plan</button>';
                if (subscription && subscription.current_period_end) {
                    var renewDate = new Date(subscription.current_period_end).toLocaleDateString('en-US');
                    btnHtml += '<button class="plan-btn manage" id="btn-manage-' + KShared.esc(p.id) + '">Manage subscription</button>';
                    btnHtml += '<p style="font-size:0.75rem;color:#8888aa;text-align:center;margin-top:6px">Renews on ' + KShared.esc(renewDate) + '</p>';
                }
            } else if (p.price === 0) {
                btnHtml = '<button class="plan-btn free-plan" disabled>Included</button>';
            } else {
                btnHtml = '<button class="plan-btn upgrade" data-plan="' + KShared.esc(p.id) + '">Upgrade to ' + KShared.esc(p.name) + '</button>';
            }

            card.innerHTML = badgeHtml +
                '<div class="plan-name">' + KShared.esc(p.name) + '</div>' +
                priceHtml +
                '<ul class="plan-features">' + featuresHtml + '</ul>' +
                '<div class="plan-action">' + btnHtml + '</div>';

            container.appendChild(card);

            var upgradeBtn = card.querySelector('.plan-btn.upgrade');
            if (upgradeBtn) {
                upgradeBtn.addEventListener('click', function () {
                    KShared.checkout(this.getAttribute('data-plan'));
                });
            }

            var manageBtn = card.querySelector('.plan-btn.manage');
            if (manageBtn) {
                manageBtn.addEventListener('click', KShared.openPortal);
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
                ? ' · Renewal: ' + KShared.esc(new Date(status.subscription.current_period_end).toLocaleDateString('en-US'))
                : '';
            msg = '✅ Current plan: <strong>' + KShared.esc(plan.toUpperCase()) + '</strong>' + renewDate;
        } else if (plan === 'free') {
            msg = 'You are on the <strong>Free</strong> plan. Upgrade for extended access.';
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
                el.innerHTML = '✅ Payment processed successfully! Your plan has been activated.';
                el.classList.remove('hidden');
                el.style.background = 'rgba(0, 255, 136, 0.08)';
                el.style.borderColor = 'rgba(0, 255, 136, 0.3)';
                el.style.color = '#00ff88';
            }
            window.history.replaceState({}, '', window.location.pathname);
        } else if (payment === 'cancel') {
            var el2 = document.getElementById('pricing-status');
            if (el2) {
                el2.innerHTML = 'Payment was cancelled. You can try again anytime.';
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

        var plans = await KShared.loadPlans();
        var status = await KShared.loadStatus();

        showStatus(status);
        renderPlans(plans, status);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
