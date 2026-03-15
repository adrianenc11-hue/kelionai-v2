// KelionAI — Error page script
(function () {
    'use strict';
    var retryBtn = document.getElementById('btn-retry');
    if (retryBtn) {
        retryBtn.addEventListener('click', function () { window.location.reload(); });
    }
}());
