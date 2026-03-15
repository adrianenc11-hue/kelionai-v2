let currentStep = 1;
let selectedPlan = 'free';

function updateDots(step) {
    for (var i = 1; i <= 2; i++) {
        var dot = document.getElementById('dot-' + i);
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
    document.querySelectorAll('.plan-card').forEach(function(c) { c.classList.remove('selected'); });
    el.classList.add('selected');
    selectedPlan = el.getAttribute('data-plan');
    try { localStorage.setItem('kelion_selected_plan', selectedPlan); } catch(e) {}
}

function finishOnboarding() {
    try {
        localStorage.setItem('kelion_onboarded', 'true');
        // Persist language default (English) if not already set
        if (!localStorage.getItem('kelion_lang')) localStorage.setItem('kelion_lang', 'en');
        if (selectedPlan) localStorage.setItem('kelion_selected_plan', selectedPlan);
    } catch(e) {}
    window.location.replace('/');
}

// Wire up event listeners (replaces inline onclick — required by CSP).
// Script is loaded at end of <body>, so DOM is already available.
(function() {
    var btnStart = document.getElementById('btn-start');
    if (btnStart) { btnStart.addEventListener('click', nextStep); }

    var btnFinish = document.getElementById('btn-finish');
    if (btnFinish) { btnFinish.addEventListener('click', finishOnboarding); }

    var btnPlanBack = document.getElementById('btn-plan-back');
    if (btnPlanBack) { btnPlanBack.addEventListener('click', prevStep); }

    document.querySelectorAll('.plan-card').forEach(function(el) {
        el.addEventListener('click', function() { selectPlan(this); });
    });
})();
