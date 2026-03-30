(async function () {
  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  try {
    var res = await fetch('/api/legal/privacy');
    var data = await res.json();
    var container = document.getElementById('legal-content');
    if (data.sections && data.sections.length) {
      container.innerHTML = data.sections
        .map(function (s) {
          return '<div class="legal-section"><h2>' + _esc(s.title) + '</h2><p>' + _esc(s.content) + '</p></div>';
        })
        .join('');
    } else {
      container.innerHTML = '<p>Content unavailable. Please try again later.</p>';
    }
  } catch (e) {
    document.getElementById('legal-content').innerHTML =
      '<p>Failed to load privacy policy. Please try again later.</p>';
  }
})();
