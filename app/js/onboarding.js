let currentStep = 1;
let selectedLang = 'ro';
let selectedPlan = 'free';

function updateDots(step) {
    for (var i = 1; i <= 3; i++) {
        var dot = document.getElementById('dot-' + i);
        if (dot) {
            dot.className = 'progress-dot' + (i === step ? ' active' : '');
        }
    }
}

function nextStep() {
    if (currentStep < 3) {
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

function selectLang(el) {
    document.querySelectorAll('.lang-option').forEach(function(o) { o.classList.remove('selected'); });
    el.classList.add('selected');
    selectedLang = el.getAttribute('data-lang');
    try { localStorage.setItem('kelion_lang', selectedLang); } catch(e) {}
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
        if (selectedLang) localStorage.setItem('kelion_lang', selectedLang);
        if (selectedPlan) localStorage.setItem('kelion_selected_plan', selectedPlan);
    } catch(e) {}
    window.location.replace('/');
}

// Pre-select Romanian by default
(function() {
    var roOption = document.querySelector('[data-lang="ro"]');
    if (roOption) { roOption.classList.add('selected'); }
})();
