// KelionAI — Error page script
(function () {
    'use strict';
    var retryBtn = document.getElementById('btn-retry');
    if (retryBtn) {
        retryBtn.addEventListener('click', function () { window.location.reload(); });
    }
    var reportBtn = document.getElementById('btn-report');
    if (reportBtn) {
        reportBtn.addEventListener('click', function () {
            if (window.Sentry) {
                Sentry.captureMessage('User reported error from error page', { level: 'error' });
                reportBtn.textContent = '✅ Reported!';
                reportBtn.disabled = true;
            }
        });
    }
}());
