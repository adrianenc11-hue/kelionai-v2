// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// KelionAI â€” Contact Form (Modal Overlay) + Clear Monitor
// Contact opens as modal overlay (like pricing modal).
// Also provides clearMonitor() for avatars.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€â”€ Clear Monitor Function (callable by avatars via [ACTION:monitor_clear]) â”€â”€â”€
window.clearMonitor = function () {
  const chatMessages = document.getElementById('chat-messages');
  const chatOverlay = document.getElementById('chat-overlay');
  if (chatMessages) chatMessages.innerHTML = '';
  if (chatOverlay) chatOverlay.innerHTML = '';
};

// â”€â”€â”€ Cinema Quill Writing Effect â”€â”€â”€
function quillWrite(element, text, speed = 35) {
  return new Promise((resolve) => {
    element.textContent = '';
    let i = 0;
    const cursor = document.createElement('span');
    cursor.className = 'quill-cursor';
    cursor.textContent = 'âœ’ï¸';
    element.appendChild(cursor);
    function type() {
      if (i < text.length) {
        element.insertBefore(document.createTextNode(text[i]), cursor);
        i++;
        setTimeout(type, speed + Math.random() * 20);
      } else {
        cursor.remove();
        resolve();
      }
    }
    type();
  });
}

// â”€â”€â”€ Create Contact Modal (once) â”€â”€â”€
function ensureContactModal() {
  if (document.getElementById('contact-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'contact-modal';
  modal.className = 'modal-overlay hidden';
  modal.innerHTML = `
<div class="modal-content" style="max-width:560px;padding:0;background:transparent;border:none;box-shadow:none;">
  <div class="contact-letter" id="contact-letter">
    <style>
      @import url('${window.KELION_URLS && KELION_URLS.GOOGLE_FONTS_CSS}/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap');
      .contact-letter {
        background: linear-gradient(135deg, #f5e6d0 0%, #f0dcc0 30%, #ede0c8 60%, #f5e6d0 100%);
        border: 2px solid #c4a66a;
        border-radius: 8px;
        padding: 32px 28px;
        box-shadow: 0 8px 40px rgba(0,0,0,0.5), inset 0 0 60px rgba(196,166,106,0.15);
        font-family: 'Playfair Display', Georgia, serif;
        color: #2c1810;
        position: relative;
        max-height: 80vh;
        overflow-y: auto;
        animation: letterAppear 0.6s ease-out;
      }
      @keyframes letterAppear {
        from { opacity: 0; transform: scale(0.92) translateY(20px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      .contact-letter::before {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        /* background injected via JS below to avoid hardcoded namespace URI */
        pointer-events: none;
        border-radius: 8px;
      }
      .letter-header { text-align: center; border-bottom: 1px solid #c4a66a; padding-bottom: 14px; margin-bottom: 16px; }
      .letter-header h2 { font-size: 1.2rem; font-weight: 700; color: #1a0f0a; margin: 0 0 4px 0; letter-spacing: 2px; }
      .letter-header p { font-size: 0.72rem; color: #8b6f47; font-style: italic; margin: 0; }
      .letter-intro { font-style: italic; color: #4a3728; font-size: 0.82rem; margin-bottom: 16px; min-height: 1.2em; }
      .quill-cursor { animation: quillBlink 0.6s infinite; margin-left: 2px; }
      @keyframes quillBlink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
      .letter-field { margin-bottom: 12px; }
      .letter-field label { display: block; font-size: 0.65rem; font-weight: 700; color: #8b6f47; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 4px; }
      .letter-field select, .letter-field input, .letter-field textarea {
        width: 100%; background: rgba(255,255,255,0.5); border: 1px solid #c4a66a; border-radius: 4px;
        padding: 8px 10px; font-family: 'Playfair Display', Georgia, serif; font-size: 0.85rem;
        color: #2c1810; outline: none; transition: border-color 0.3s; box-sizing: border-box;
      }
      .letter-field select:focus, .letter-field input:focus, .letter-field textarea:focus {
        border-color: #8b6f47; box-shadow: 0 0 8px rgba(139,111,71,0.2);
      }
      .letter-field textarea { min-height: 80px; resize: vertical; }
      .letter-actions { display: flex; gap: 10px; justify-content: center; margin-top: 18px; padding-top: 14px; border-top: 1px solid #c4a66a; }
      .letter-btn-send {
        background: linear-gradient(135deg, #8b6f47, #c4a66a); color: #fff; border: none;
        padding: 10px 30px; font-family: 'Playfair Display', Georgia, serif;
        font-size: 0.95rem; font-weight: 700; letter-spacing: 2px; border-radius: 4px;
        cursor: pointer; transition: all 0.3s; box-shadow: 0 2px 8px rgba(139,111,71,0.3);
      }
      .letter-btn-send:hover { background: linear-gradient(135deg, #6b5235, #a8894e); transform: translateY(-2px); }
      .letter-btn-cancel {
        background: transparent; color: #8b6f47; border: 1px solid #c4a66a;
        padding: 10px 20px; font-family: 'Playfair Display', Georgia, serif;
        font-size: 0.85rem; border-radius: 4px; cursor: pointer; transition: all 0.3s;
      }
      .letter-btn-cancel:hover { background: rgba(196,166,106,0.15); }
      .letter-seal { text-align: center; margin-top: 12px; font-size: 0.65rem; color: #a8894e; font-style: italic; }
      .letter-status { text-align: center; margin-top: 10px; padding: 8px; border-radius: 4px; font-size: 0.82rem; display: none; }
      .letter-status.success { display: block; background: rgba(34,139,34,0.15); color: #2d5a2d; border: 1px solid rgba(34,139,34,0.3); }
      .letter-status.error { display: block; background: rgba(178,34,34,0.15); color: #8b2222; border: 1px solid rgba(178,34,34,0.3); }
    </style>
    <div class="letter-header">
      <h2>âœ‰ KELIONAI</h2>
      <p>Official Correspondence</p>
    </div>
    <div class="letter-intro" id="letter-intro"></div>
    <div class="letter-field">
      <label>Department</label>
      <select id="contact-dept">
        <option value="">â€” Select â€”</option>
        <option value="Commercial">Commercial</option>
        <option value="Technical">Technical Support</option>
        <option value="Support">General Support</option>
        <option value="Other">Other</option>
      </select>
    </div>
    <div class="letter-field">
      <label>Subject</label>
      <input type="text" id="contact-subject" placeholder="Subject..." />
    </div>
    <div class="letter-field">
      <label>Your Email</label>
      <input type="email" id="contact-email" placeholder="your@email.com" />
    </div>
    <div class="letter-field">
      <label>Message</label>
      <textarea id="contact-message" placeholder="Write your message..."></textarea>
    </div>
    <div class="letter-field">
      <label>Signed by</label>
      <input type="text" id="contact-signature" placeholder="Your name" />
    </div>
    <div class="letter-actions">
      <button class="letter-btn-cancel" onclick="document.getElementById('contact-modal').classList.add('hidden')">â† Back</button>
      <button class="letter-btn-send" id="contact-send-btn" onclick="sendContactLetter()">âœ‰ Send Letter</button>
    </div>
    <div class="letter-status" id="contact-status"></div>
    <div class="letter-seal">â¦ Contact Support â¦</div>
  </div>
</div>`;
  document.body.appendChild(modal);
  // Close on backdrop click
  modal.addEventListener('click', function (e) {
    if (e.target === modal) modal.classList.add('hidden');
  });
}

// â”€â”€â”€ Open Contact Form as Modal â”€â”€â”€
window.openContactForm = function () {
  ensureContactModal();
  const modal = document.getElementById('contact-modal');
  modal.classList.remove('hidden');
  // Reset form
  const fields = ['contact-dept', 'contact-subject', 'contact-email', 'contact-message', 'contact-signature'];
  fields.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const status = document.getElementById('contact-status');
  if (status) {
    status.className = 'letter-status';
    status.textContent = '';
  }
  // Auto-fill email
  try {
    const session = JSON.parse(localStorage.getItem('kelion_session') || '{}');
    if (session.user?.email) {
      const emailField = document.getElementById('contact-email');
      if (emailField) emailField.value = session.user.email;
    }
  } catch (_e) {
    /* ignored */
  }
  // Quill intro
  const intro = document.getElementById('letter-intro');
  if (intro)
    quillWrite(
      intro,
      'Dear Valued Guest, we are honoured to receive your correspondence. Please complete the fields below and we shall attend to your matter with the utmost diligence.',
      20
    );
};

// â”€â”€â”€ Send Contact Letter â”€â”€â”€
window.sendContactLetter = async function () {
  const dept = document.getElementById('contact-dept')?.value;
  const subject = document.getElementById('contact-subject')?.value;
  const email = document.getElementById('contact-email')?.value;
  const message = document.getElementById('contact-message')?.value;
  const signature = document.getElementById('contact-signature')?.value;
  const statusEl = document.getElementById('contact-status');
  const sendBtn = document.getElementById('contact-send-btn');
  if (!dept || !email || !message) {
    statusEl.className = 'letter-status error';
    statusEl.textContent = 'âš  Please fill in Department, Email, and Message.';
    return;
  }
  sendBtn.textContent = 'â³ Sending...';
  sendBtn.disabled = true;
  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: signature || 'Anonymous',
        email,
        subject: '[' + dept + '] ' + (subject || 'No subject'),
        message,
      }),
    });
    const data = await res.json();
    if (data.success) {
      const autoReply = data.autoReply;
      const letter = document.getElementById('contact-letter');
      if (letter && autoReply) {
        letter.innerHTML =
          '<div class="letter-header"><h2>âœ‰ MESSAGE SENT</h2><p>Reference: ' +
          autoReply.refNumber +
          '</p></div>' +
          '<div class="letter-intro" id="reply-text"></div>' +
          '<div class="letter-actions"><button class="letter-btn-send" onclick="document.getElementById(\'contact-modal\').classList.add(\'hidden\')">âœ“ Close</button></div>' +
          '<div class="letter-seal">â¦ ' +
          autoReply.department +
          ' Department â¦</div>';
        const replyText = document.getElementById('reply-text');
        if (replyText) quillWrite(replyText, autoReply.body, 12);
      }
    } else {
      statusEl.className = 'letter-status error';
      statusEl.textContent = 'âš  ' + (data.error || 'Failed to send.');
    }
  } catch (_e) {
    statusEl.className = 'letter-status error';
    statusEl.textContent = 'âš  Network error.';
  }
  sendBtn.textContent = 'âœ‰ Send Letter';
  sendBtn.disabled = false;
};

// ── Inject SVG noise background from config (no hardcoded namespace) ──
(function () {
  const ns = (window.KELION_URLS && window.KELION_URLS.SVG_NAMESPACE) || '';
  const svg =
    "data:image/svg+xml,%3Csvg width='100' height='100' xmlns='" +
    encodeURIComponent(ns) +
    "'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.06'/%3E%3C/svg%3E";
  const style = document.createElement('style');
  style.textContent = '.contact-letter::before { background: url("' + svg + '") !important; }';
  document.head.appendChild(style);
})();
