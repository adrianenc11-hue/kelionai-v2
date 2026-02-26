/* ═══════════════════════════════════════════
   KelionAI Navbar — interactive behaviors
   ═══════════════════════════════════════════ */
(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', function () {
        var hamburger = document.getElementById('navbar-hamburger');
        var mobileMenu = document.getElementById('navbar-mobile-menu');
        var getStartedBtn = document.getElementById('navbar-get-started');
        var langOptions = document.querySelectorAll('.lang-option');
        var langLabel = document.getElementById('navbar-lang-label');

        // Hamburger toggle
        if (hamburger && mobileMenu) {
            hamburger.addEventListener('click', function () {
                mobileMenu.classList.toggle('open');
            });
            // Close on outside click
            document.addEventListener('click', function (e) {
                if (!hamburger.contains(e.target) && !mobileMenu.contains(e.target)) {
                    mobileMenu.classList.remove('open');
                }
            });
        }

        // Get Started button — shows auth screen
        if (getStartedBtn) {
            getStartedBtn.addEventListener('click', function () {
                var authScreen = document.getElementById('auth-screen');
                var appLayout = document.getElementById('app-layout');
                if (authScreen && appLayout) {
                    authScreen.classList.remove('hidden');
                    appLayout.classList.add('hidden');
                }
            });
        }

        // Language switcher — update label, close dropdown on selection
        langOptions.forEach(function (btn) {
            btn.addEventListener('click', function () {
                var lang = btn.getAttribute('data-lang');
                if (langLabel && lang) {
                    langLabel.textContent = lang.toUpperCase();
                }
                var dropdown = btn.closest('.lang-switcher');
                if (dropdown) dropdown.classList.remove('open');
            });
        });
    });
}());
