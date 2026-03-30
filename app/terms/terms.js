(async function () {
  try {
    var res = await fetch('/api/legal/terms');
    var data = await res.json();
    var container = document.getElementById('legal-content');
    if (data.sections && data.sections.length) {
      container.innerHTML = data.sections
        .map(function (s) {
          return '<div class="legal-section"><h2>' + s.title + '</h2><p>' + s.content + '</p></div>';
        })
        .join('');
    } else {
      container.innerHTML = '<p>Content unavailable. Please try again later.</p>';
    }
  } catch (e) {
    document.getElementById('legal-content').innerHTML =
      '<p>Failed to load terms of service. Please try again later.</p>';
  }
})();
