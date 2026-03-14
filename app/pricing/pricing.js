(function () {
  'use strict';

  var currentBilling = 'monthly';

  /**
   * renderPlans
   * @param {*} plans
   * @param {*} status
   * @returns {*}
   */
  function renderPlans(plans, status) {
    var container = document.getElementById('pricing-plans');
    if (!container) return;

    var currentPlan = status ? status.plan : null;
    var subscription = status ? status.subscription : null;

    if (!plans || plans.length === 0) {
      container.textContent = '<div class="plan-loading">Plans are not available at this time.</div>';
      return;
    }

    // Filter plans by current billing period
    var filtered = plans.filter(function (p) {
      if (p.price === 0) return true; // Always show Free
      return p.billing === currentBilling;
    });

    container.textContent = '';

    filtered.forEach(function (p) {
      var basePlanId = p.id.replace('_annual', '');
      var isCurrent = basePlanId === currentPlan;
      var card = document.createElement('div');
      card.className =
        'plan-card' +
        (basePlanId === 'pro' ? ' featured' : '') +
        (basePlanId === 'premium' ? ' premium-card' : '') +
        (isCurrent ? ' current' : '');

      var badgeHtml =
        basePlanId === 'pro'
          ? '<div class="plan-badge">Most Popular</div>'
          : basePlanId === 'premium'
            ? '<div class="plan-badge premium-badge">Best Value</div>'
            : '';

      // Savings badge for annual
      if (p.savings) {
        badgeHtml += '<div class="savings-badge">' + KShared.esc(p.savings) + '</div>';
      }

      var priceHtml;
      if (p.price === 0) {
        priceHtml = '<div class="plan-price">Free</div>' + '<div class="plan-price-sub">Forever</div>';
      } else if (p.billing === 'annual') {
        priceHtml =
          '<div class="plan-price"><span class="currency">€</span>' +
          KShared.esc(p.monthlyEquivalent) +
          '<small>/month</small></div>' +
          '<div class="plan-price-sub">Billed €' +
          KShared.esc(p.price) +
          '/year</div>';
      } else {
        priceHtml =
          '<div class="plan-price"><span class="currency">€</span>' +
          KShared.esc(p.price) +
          '<small>/month</small></div>';
      }

      var featuresHtml = (p.features || [])
        .map(function (f) {
          return '<li><span class="feature-check">✓</span> ' + KShared.esc(f) + '</li>';
        })
        .join('');

      var btnHtml;
      if (isCurrent) {
        btnHtml = '<button class="plan-btn current-plan" disabled>Current plan</button>';
        if (subscription && subscription.current_period_end) {
          var renewDate = new Date(subscription.current_period_end).toLocaleDateString('en-US');
          btnHtml +=
            '<button class="plan-btn manage" id="btn-manage-' + KShared.esc(p.id) + '">Manage subscription</button>';
          btnHtml +=
            '<p style="font-size:0.75rem;color:#8888aa;text-align:center;margin-top:6px">Renews on ' +
            KShared.esc(renewDate) +
            '</p>';
        }
      } else if (p.price === 0) {
        btnHtml = '<button class="plan-btn free-plan" disabled>Included</button>';
      } else {
        btnHtml =
          '<button class="plan-btn upgrade" data-plan="' +
          KShared.esc(p.id) +
          '">Get ' +
          KShared.esc(p.name) +
          '</button>';
      }

      card.textContent =
        badgeHtml +
        '<div class="plan-name">' +
        KShared.esc(p.name) +
        '</div>' +
        priceHtml +
        '<ul class="plan-features">' +
        featuresHtml +
        '</ul>' +
        '<div class="plan-action">' +
        btnHtml +
        '</div>';

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

  /**
   * renderToggle
   * @returns {*}
   */
  function renderToggle() {
    var hero = document.querySelector('.pricing-hero');
    if (!hero || document.getElementById('billing-toggle')) return;

    var toggle = document.createElement('div');
    toggle.id = 'billing-toggle';
    toggle.className = 'billing-toggle';
    toggle.textContent =
      '<button class="toggle-btn active" data-billing="monthly">Monthly</button>' +
      '<button class="toggle-btn" data-billing="annual">Annual <span class="toggle-save">Save 17%</span></button>';
    hero.appendChild(toggle);

    toggle.addEventListener('click', function (e) {
      var btn = e.target.closest('.toggle-btn');
      if (!btn) return;
      currentBilling = btn.getAttribute('data-billing');

      toggle.querySelectorAll('.toggle-btn').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });

      // Re-render with cached data
      if (window._cachedPlans && window._cachedStatus !== undefined) {
        renderPlans(window._cachedPlans, window._cachedStatus);
      }
    });
  }

  /**
   * showStatus
   * @param {*} status
   * @returns {*}
   */
  function showStatus(status) {
    var el = document.getElementById('pricing-status');
    if (!el || !status) return;

    var plan = status.plan || 'guest';
    var msg = '';
    if (plan !== 'guest' && plan !== 'free') {
      var renewDate =
        status.subscription && status.subscription.current_period_end
          ? ' · Renewal: ' + KShared.esc(new Date(status.subscription.current_period_end).toLocaleDateString('en-US'))
          : '';
      msg = '✅ Current plan: <strong>' + KShared.esc(plan.toUpperCase()) + '</strong>' + renewDate;
    } else if (plan === 'free') {
      msg = 'You are on the <strong>Free</strong> plan. Upgrade for extended access.';
    }

    if (msg) {
      el.textContent = msg;
      el.classList.remove('hidden');
    }
  }

  /**
   * checkPaymentResult
   * @returns {*}
   */
  function checkPaymentResult() {
    var params = new URLSearchParams(window.location.search);
    var payment = params.get('payment');
    if (payment === 'success') {
      var el = document.getElementById('pricing-status');
      if (el) {
        el.textContent = '✅ Payment processed successfully! Your plan has been activated.';
        el.classList.remove('hidden');
        el.style.background = 'rgba(0, 255, 136, 0.08)';
        el.style.borderColor = 'rgba(0, 255, 136, 0.3)';
        el.style.color = '#00ff88';
      }
      window.history.replaceState({}, '', window.location.pathname);
    } else if (payment === 'cancel') {
      var el2 = document.getElementById('pricing-status');
      if (el2) {
        el2.textContent = 'Payment was cancelled. You can try again anytime.';
        el2.classList.remove('hidden');
        el2.style.background = 'rgba(255, 100, 100, 0.08)';
        el2.style.borderColor = 'rgba(255, 100, 100, 0.2)';
        el2.style.color = '#ff8888';
      }
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  /**
   * init
   * @returns {*}
   */
  async function init() {
    checkPaymentResult();
    renderToggle();

    var plans = await KShared.loadPlans();
    var status = await KShared.loadStatus();

    window._cachedPlans = plans;
    window._cachedStatus = status;

    showStatus(status);
    renderPlans(plans, status);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
