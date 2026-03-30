let currentStep = 1;
let selectedPlan = 'free';

function updateDots(step) {
  for (let i = 1; i <= 2; i++) {
    const dot = document.getElementById('dot-' + i);
    if (dot) {
      dot.className = 'progress-dot' + (i === step ? ' active' : '');
    }
  }
}

function nextStep() {
  if (currentStep < 2) {
    document.querySelector('[data-step="' + currentStep + '"]').classList.remove('active');
    currentStep++;
    document.querySelector('[data-step="' + currentStep + '"]').classList.add('active');
    updateDots(currentStep);
  }
}

function prevStep() {
  if (currentStep > 1) {
    document.querySelector('[data-step="' + currentStep + '"]').classList.remove('active');
    currentStep--;
    document.querySelector('[data-step="' + currentStep + '"]').classList.add('active');
    updateDots(currentStep);
  }
}

function selectPlan(el) {
  document.querySelectorAll('.plan-card').forEach(function (c) {
    c.classList.remove('selected');
  });
  el.classList.add('selected');
  selectedPlan = el.getAttribute('data-plan');
  try {
    localStorage.setItem('kelion_selected_plan', selectedPlan);
  } catch (_e) {
    /* ignored */
  }
}

function finishOnboarding() {
  try {
    localStorage.setItem('kelion_onboarded', 'true');
    // Persist language default (English) if not already set
    if (!localStorage.getItem('kelion_lang')) localStorage.setItem('kelion_lang', 'en');
    if (selectedPlan) localStorage.setItem('kelion_selected_plan', selectedPlan);
  } catch (_e) {
    /* ignored */
  }
  window.location.replace('/');
}

// Wire up event listeners (replaces inline onclick — required by CSP).
// Script is loaded at end of <body>, so DOM is already available.
(function () {
  const btnStart = document.getElementById('btn-start');
  if (btnStart) {
    btnStart.addEventListener('click', nextStep);
  }

  const btnFinish = document.getElementById('btn-finish');
  if (btnFinish) {
    btnFinish.addEventListener('click', finishOnboarding);
  }

  const btnPlanBack = document.getElementById('btn-plan-back');
  if (btnPlanBack) {
    btnPlanBack.addEventListener('click', prevStep);
  }

  document.querySelectorAll('.plan-card').forEach(function (el) {
    el.addEventListener('click', function () {
      selectPlan(this);
    });
  });

  // Fetch real prices from backend and update plan cards
  (function fetchPrices() {
    const API = window.location.origin;
    fetch(API + '/api/payments/plans')
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        const plans = data.plans || [];
        const priceMap = {};
        for (let i = 0; i < plans.length; i++) {
          priceMap[plans[i].id] = plans[i];
        }
        document.querySelectorAll('.plan-card').forEach(function (card) {
          const planId = card.getAttribute('data-plan');
          const priceEl = card.querySelector('.plan-price');
          if (!priceEl || !priceMap[planId]) return;
          const plan = priceMap[planId];
          if (plan.price === 0) return; // Free plan — keep i18n text
          const sym = window.KShared ? KShared.currencySymbol(plan.currency) : '£';
          let period = typeof i18n !== 'undefined' ? i18n.t('onboarding.plan.perMonth') : '/month';
          if (plan.billing === 'annual') {
            period = typeof i18n !== 'undefined' ? i18n.t('onboarding.plan.perYear') : '/year';
          }
          priceEl.textContent = sym + plan.price + period;
          priceEl.removeAttribute('data-i18n');
        });
      })
      .catch(function () {
        /* keep fallback text */
      });
  })();
})();
