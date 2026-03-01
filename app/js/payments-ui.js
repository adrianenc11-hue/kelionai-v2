(function () {
    'use strict';
    var API = window.location.origin;

    // ═══ Render pricing modal ═══
    async function renderPricing() {
        var grid = document.getElementById('pricing-grid');
        var info = document.getElementById('current-plan-info');
        if (!grid) return;

        grid.innerHTML = '<div class="pricing-loading">Loading...</div>';

        var plans = await KShared.loadPlans();
        var status = await KShared.loadStatus();
        var currentPlan = status ? status.plan : 'guest';
        var usage = (status && status.usage) ? status.usage : { chat: 0, search: 0, image: 0 };

        // Show current plan info
        if (info) {
            var limits = status && status.limits ? status.limits : { chat: 5, search: 3, image: 1 };
            info.innerHTML = '<div class="plan-status">' +
                '<span class="plan-badge plan-' + currentPlan + '">' + currentPlan.toUpperCase() + '</span>' +
                '<span class="plan-usage">Chat: ' + (usage.chat || 0) + '/' + (limits.chat === -1 ? '∞' : limits.chat) +
                ' · Search: ' + (usage.search || 0) + '/' + (limits.search === -1 ? '∞' : limits.search) +
                ' · Images: ' + (usage.image || 0) + '/' + (limits.image === -1 ? '∞' : limits.image) +
                '</span></div>';
        }

        if (plans.length === 0) {
            grid.innerHTML = '<div class="pricing-loading">Plans are not available at the moment.</div>';
            return;
        }

        grid.innerHTML = '';
        for (var i = 0; i < plans.length; i++) {
            var p = plans[i];
            var isCurrent = p.id === currentPlan;
            var card = document.createElement('div');
            card.className = 'pricing-card' + (p.id === 'pro' ? ' featured' : '') + (isCurrent ? ' current' : '');

            var featuresHtml = '';
            if (p.features) {
                for (var j = 0; j < p.features.length; j++) {
                    featuresHtml += '<li>✓ ' + p.features[j] + '</li>';
                }
            } else {
                featuresHtml = '<li>✓ ' + p.limits.chat + ' chat/day</li>' +
                    '<li>✓ ' + p.limits.search + ' searches/day</li>' +
                    '<li>✓ ' + p.limits.image + ' images/day</li>';
            }

            card.innerHTML = '<h3 class="pricing-plan-name">' + p.name + '</h3>' +
                '<div class="pricing-price">' + (p.price === 0 ? 'Free' : '€' + p.price + '<small>/month</small>') + '</div>' +
                '<ul class="pricing-features">' + featuresHtml + '</ul>' +
                '<div class="pricing-action" data-plan="' + p.id + '"></div>';

            grid.appendChild(card);

            var actionDiv = card.querySelector('.pricing-action');
            if (isCurrent) {
                actionDiv.innerHTML = '<button class="pricing-btn current" disabled>Current plan</button>';
            } else if (p.price === 0) {
                actionDiv.innerHTML = '<span class="pricing-btn free">Included</span>';
            } else {
                var btn = document.createElement('button');
                btn.className = 'pricing-btn upgrade';
                btn.textContent = 'Upgrade to ' + p.name;
                btn.setAttribute('data-plan', p.id);
                btn.addEventListener('click', function () { KShared.checkout(this.getAttribute('data-plan')); });
                actionDiv.appendChild(btn);
            }
        }

        // Manage subscription button for paid plans
        if (currentPlan === 'pro' || currentPlan === 'enterprise' || currentPlan === 'premium') {
            var manageBtn = document.createElement('div');
            manageBtn.className = 'pricing-manage';
            manageBtn.innerHTML = '<button class="pricing-btn manage" id="btn-manage-sub">Manage subscription</button>';
            grid.parentNode.appendChild(manageBtn);
            document.getElementById('btn-manage-sub').addEventListener('click', KShared.openPortal);
        }
    }

    // ═══ Handle payment URL params ═══
    function checkPaymentResult() {
        var params = new URLSearchParams(window.location.search);
        var payment = params.get('payment');
        if (payment === 'success') {
            setTimeout(function () {
                alert('✅ Payment processed successfully! Your plan has been activated.');
            }, 500);
            window.history.replaceState({}, '', window.location.pathname);
        } else if (payment === 'cancel') {
            setTimeout(function () {
                alert('Payment was cancelled. You can try again anytime.');
            }, 500);
            window.history.replaceState({}, '', window.location.pathname);
        }
    }

    // ═══ Show upgrade prompt when usage limit hit ═══
    function showUpgradePrompt() {
        var modal = document.getElementById('pricing-modal');
        if (modal) {
            modal.classList.remove('hidden');
            renderPricing();
        }
    }

    // ═══ Usage bar widget ═══ (disabled)
    function showUsageBar() {}

    // ═══ Init ═══
    function init() {
        var pricingBtn = document.getElementById('btn-pricing');
        var modal = document.getElementById('pricing-modal');
        var closeBtn = document.getElementById('pricing-close');

        if (pricingBtn && modal) {
            pricingBtn.addEventListener('click', function () {
                modal.classList.remove('hidden');
                renderPricing();
            });
        }

        if (closeBtn && modal) {
            closeBtn.addEventListener('click', function () {
                modal.classList.add('hidden');
            });
        }

        if (modal) {
            modal.addEventListener('click', function (e) {
                if (e.target === modal) modal.classList.add('hidden');
            });
        }

        checkPaymentResult();
    }

    window.KPayments = { init: init, showUpgradePrompt: showUpgradePrompt, renderPricing: renderPricing, showUsageBar: showUsageBar };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
