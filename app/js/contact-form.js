// ═══════════════════════════════════════════════════════════════
// KelionAI — Contact Form on Monitor (Cinematic Letter Style)
// Opens a parchment-style letter on the display panel with
// quill-pen writing animation, departments, and Send button.
// Also provides clearMonitor() function for avatars.
// ═══════════════════════════════════════════════════════════════

// ─── Clear Monitor Function (callable by avatars) ───
window.clearMonitor = function () {
  const chatMessages = document.getElementById('chat-messages');
  const chatOverlay = document.getElementById('chat-overlay');
  const displayContent = document.getElementById('display-content');
  if (chatMessages) chatMessages.innerHTML = '';
  if (chatOverlay) chatOverlay.innerHTML = '';
  if (displayContent) {
    displayContent.querySelectorAll('[id^="monitor-"]').forEach(el => {
      if (el.id === 'monitor-default') {
        el.innerHTML = 'Ready';
      } else {
        el.innerHTML = '';
        el.style.display = 'none';
      }
    });
  }
};

// ─── Cinema Quill Writing Effect ───
function quillWrite(element, text, speed = 35) {
  return new Promise(resolve => {
    element.textContent = '';
    let i = 0;
    const cursor = document.createElement('span');
    cursor.className = 'quill-cursor';
    cursor.textContent = '✒️';
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

// ─── Open Contact Form on Monitor ───
window.openContactForm = function () {
  const overlay = document.getElementById('chat-overlay');
  const displayPanel = document.getElementById('display-panel');
  if (!overlay) return;

  // Make sure display panel is visible
  if (displayPanel) displayPanel.style.display = '';
  
  // Clear and inject into visible overlay
  overlay.innerHTML = '';

  const letterHTML = `
    <div class="contact-letter" id="contact-letter">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap');
        
        .contact-letter {
          background: linear-gradient(135deg, #f5e6d0 0%, #f0dcc0 30%, #ede0c8 60%, #f5e6d0 100%);
          border: 2px solid #c4a66a;
          border-radius: 4px;
          padding: 40px 36px;
          margin: 12px;
          box-shadow: 
            0 4px 20px rgba(0,0,0,0.4),
            inset 0 0 60px rgba(196,166,106,0.15),
            0 0 0 1px rgba(196,166,106,0.3);
          font-family: 'Playfair Display', Georgia, serif;
          color: #2c1810;
          position: relative;
          max-height: calc(100vh - 200px);
          overflow-y: auto;
          animation: letterAppear 0.8s ease-out;
        }
        
        @keyframes letterAppear {
          from { opacity: 0; transform: scale(0.9) rotateX(10deg); }
          to { opacity: 1; transform: scale(1) rotateX(0); }
        }

        .contact-letter::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: url("data:image/svg+xml,%3Csvg width='100' height='100' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.06'/%3E%3C/svg%3E");
          pointer-events: none;
          border-radius: 4px;
        }

        .letter-header {
          text-align: center;
          border-bottom: 1px solid #c4a66a;
          padding-bottom: 16px;
          margin-bottom: 20px;
        }

        .letter-header h2 {
          font-size: 1.3rem;
          font-weight: 700;
          color: #1a0f0a;
          margin: 0 0 4px 0;
          letter-spacing: 2px;
        }

        .letter-header p {
          font-size: 0.75rem;
          color: #8b6f47;
          font-style: italic;
          margin: 0;
        }

        .letter-intro {
          font-style: italic;
          color: #4a3728;
          font-size: 0.85rem;
          margin-bottom: 20px;
          min-height: 1.2em;
        }

        .quill-cursor {
          animation: quillBlink 0.6s infinite;
          margin-left: 2px;
        }
        @keyframes quillBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        .letter-field {
          margin-bottom: 14px;
        }

        .letter-field label {
          display: block;
          font-size: 0.7rem;
          font-weight: 700;
          color: #8b6f47;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          margin-bottom: 6px;
        }

        .letter-field select,
        .letter-field input,
        .letter-field textarea {
          width: 100%;
          background: rgba(255,255,255,0.5);
          border: 1px solid #c4a66a;
          border-radius: 4px;
          padding: 10px 12px;
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 0.9rem;
          color: #2c1810;
          outline: none;
          transition: border-color 0.3s;
          box-sizing: border-box;
        }

        .letter-field select:focus,
        .letter-field input:focus,
        .letter-field textarea:focus {
          border-color: #8b6f47;
          box-shadow: 0 0 8px rgba(139,111,71,0.2);
        }

        .letter-field textarea {
          min-height: 100px;
          resize: vertical;
        }

        .letter-actions {
          display: flex;
          gap: 12px;
          justify-content: center;
          margin-top: 24px;
          padding-top: 16px;
          border-top: 1px solid #c4a66a;
        }

        .letter-btn-send {
          background: linear-gradient(135deg, #8b6f47, #c4a66a);
          color: #fff;
          border: none;
          padding: 12px 36px;
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 1rem;
          font-weight: 700;
          letter-spacing: 2px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.3s;
          box-shadow: 0 2px 8px rgba(139,111,71,0.3);
        }

        .letter-btn-send:hover {
          background: linear-gradient(135deg, #6b5235, #a8894e);
          transform: translateY(-2px);
          box-shadow: 0 4px 16px rgba(139,111,71,0.4);
        }

        .letter-btn-cancel {
          background: transparent;
          color: #8b6f47;
          border: 1px solid #c4a66a;
          padding: 12px 24px;
          font-family: 'Playfair Display', Georgia, serif;
          font-size: 0.9rem;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.3s;
        }

        .letter-btn-cancel:hover {
          background: rgba(196,166,106,0.15);
        }

        .letter-seal {
          text-align: center;
          margin-top: 16px;
          font-size: 0.7rem;
          color: #a8894e;
          font-style: italic;
        }

        .letter-status {
          text-align: center;
          margin-top: 12px;
          padding: 10px;
          border-radius: 4px;
          font-size: 0.85rem;
          display: none;
        }

        .letter-status.success {
          display: block;
          background: rgba(34,139,34,0.15);
          color: #2d5a2d;
          border: 1px solid rgba(34,139,34,0.3);
        }

        .letter-status.error {
          display: block;
          background: rgba(178,34,34,0.15);
          color: #8b2222;
          border: 1px solid rgba(178,34,34,0.3);
        }
      </style>

      <div class="letter-header">
        <h2>✉ KELIONAI</h2>
        <p>Official Correspondence</p>
      </div>

      <div class="letter-intro" id="letter-intro"></div>

      <div class="letter-field">
        <label>Department</label>
        <select id="contact-dept">
          <option value="">— Select Department —</option>
          <option value="Commercial">Commercial</option>
          <option value="Technical">Technical Support</option>
          <option value="Support">General Support</option>
          <option value="Other">Other</option>
        </select>
      </div>

      <div class="letter-field">
        <label>Subject</label>
        <input type="text" id="contact-subject" placeholder="Subject of your message..." />
      </div>

      <div class="letter-field">
        <label>Your Email</label>
        <input type="email" id="contact-email" placeholder="your@email.com" />
      </div>

      <div class="letter-field">
        <label>Message</label>
        <textarea id="contact-message" placeholder="Write your message here..."></textarea>
      </div>

      <div class="letter-field">
        <label>Signed by</label>
        <input type="text" id="contact-signature" placeholder="Your name" />
      </div>

      <div class="letter-actions">
        <button class="letter-btn-cancel" onclick="clearMonitor()">✕ Cancel</button>
        <button class="letter-btn-send" id="contact-send-btn" onclick="sendContactLetter()">✉ Send Letter</button>
      </div>

      <div class="letter-status" id="contact-status"></div>

      <div class="letter-seal">
        ❦ contact@kelionai.app ❦
      </div>
    </div>
  `;

  overlay.innerHTML = letterHTML;
  overlay.scrollTop = 0;

  // Cinematic quill writing for intro
  const intro = document.getElementById('letter-intro');
  if (intro) {
    quillWrite(intro, 'Dear Valued Guest, we are honoured to receive your correspondence. Please complete the fields below and we shall attend to your matter with the utmost diligence.', 25);
  }

  // Auto-fill email if logged in
  try {
    const session = JSON.parse(localStorage.getItem('kelion_session') || '{}');
    if (session.user?.email) {
      const emailField = document.getElementById('contact-email');
      if (emailField) emailField.value = session.user.email;
    }
  } catch (e) {}
};

// ─── Send Contact Letter ───
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
    statusEl.textContent = '⚠ Please fill in Department, Email, and Message.';
    return;
  }

  sendBtn.textContent = '⏳ Sending...';
  sendBtn.disabled = true;

  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: signature || 'Anonymous',
        email,
        subject: `[${dept}] ${subject || 'No subject'}`,
        message,
      }),
    });

    const data = await res.json();

    if (data.success) {
      statusEl.className = 'letter-status success';
      
      // Show auto-reply with quill effect
      const autoReply = data.autoReply;
      const letter = document.getElementById('contact-letter');
      if (letter && autoReply) {
        letter.innerHTML = `
          <div class="letter-header">
            <h2>✉ MESSAGE SENT</h2>
            <p>Reference: ${autoReply.refNumber}</p>
          </div>
          <div class="letter-intro" id="reply-text"></div>
          <div class="letter-actions">
            <button class="letter-btn-send" onclick="clearMonitor()">✓ Close</button>
          </div>
          <div class="letter-seal">❦ ${autoReply.department} Department ❦</div>
        `;
        const replyText = document.getElementById('reply-text');
        if (replyText) {
          quillWrite(replyText, autoReply.body, 15);
        }
      }
    } else {
      statusEl.className = 'letter-status error';
      statusEl.textContent = '⚠ ' + (data.error || 'Failed to send. Please try again.');
    }
  } catch (e) {
    statusEl.className = 'letter-status error';
    statusEl.textContent = '⚠ Network error. Please check your connection.';
  }

  sendBtn.textContent = '✉ Send Letter';
  sendBtn.disabled = false;
};
