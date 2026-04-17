import { Link } from 'react-router-dom'

// Static legal copy. Each entry is rendered as plain HTML paragraphs below
// the title. Keep the content intentionally simple — if a change ever needs
// to ship (GDPR amendment, new refund window, etc.) edit the object here
// and redeploy. No dynamic data here by design.
const LEGAL = {
  terms: {
    title: 'Termeni și Condiții',
    updated: '2026-04-17',
    body: [
      ['Obiect', 'KelionAI este un serviciu de asistent AI vocal oferit prin intermediul site-ului kelionai.app. Prin crearea unui cont și utilizarea serviciului, ești de acord cu acești termeni.'],
      ['Cont utilizator', 'Ești responsabil pentru păstrarea confidențialității parolei tale și pentru toate activitățile desfășurate din contul tău. Ne poți anunța imediat dacă suspectezi o utilizare neautorizată.'],
      ['Abonamente și plăți', 'Plățile sunt procesate prin Stripe. Abonamentele se reînnoiesc automat la sfârșitul perioadei curente, cu excepția cazului în care le anulezi din secțiunea „Planuri & Abonamente". Anularea intră în vigoare la sfârșitul perioadei plătite, fără rambursare pentru perioada deja parcursă.'],
      ['Utilizare acceptabilă', 'Nu ai voie să folosești serviciul pentru activități ilegale, spam, generare de conținut abuziv sau inginerie inversă a serviciului. Ne rezervăm dreptul de a suspenda conturi care încalcă acești termeni.'],
      ['Limitarea răspunderii', 'Serviciul este oferit „ca atare". Nu garantăm disponibilitate neîntreruptă și nu răspundem pentru decizii luate pe baza răspunsurilor generate de AI.'],
      ['Modificări', 'Putem actualiza acești termeni. Versiunea în vigoare este cea afișată pe această pagină. Data ultimei actualizări este vizibilă în antet.'],
      ['Contact', 'Pentru orice întrebare privind acești termeni, scrie-ne la support@kelionai.app.'],
    ],
  },

  privacy: {
    title: 'Politica de confidențialitate',
    updated: '2026-04-17',
    body: [
      ['Date colectate', 'Colectăm: email, nume, parolă (hash), istoric de utilizare (număr de interacțiuni/zi), identificatorul Stripe al clientului și al abonamentului. Nu stocăm numere de card — acestea rămân la Stripe.'],
      ['Scop', 'Folosim aceste date pentru a opera contul, a procesa plățile, a aplica limitele de utilizare și a oferi suport. Nu vindem datele către terți.'],
      ['Procesatori', 'Terți care procesează date în numele nostru: Stripe (plăți), OpenAI / Google Gemini (generare răspunsuri AI), ElevenLabs (sinteză voce). Transmitem doar ceea ce este necesar pentru funcționalitate.'],
      ['Păstrare', 'Păstrăm datele contului cât timp este activ. La ștergerea contului, datele sunt eliminate în maxim 30 de zile, cu excepția celor pe care legea ne obligă să le păstrăm (facturi).'],
      ['Drepturile tale (GDPR)', 'Ai dreptul la acces, rectificare, ștergere, portabilitate și opoziție. Trimite cererea la privacy@kelionai.app și răspundem în maxim 30 de zile.'],
      ['Securitate', 'Parolele sunt stocate hash-uite (scrypt). Comunicația este criptată cu TLS. Accesul la datele personale este restricționat la personalul autorizat.'],
      ['Cookies', 'Folosim un cookie de sesiune (`kelion.token`) pentru autentificare. Detalii complete pe pagina de Cookies.'],
    ],
  },

  refund: {
    title: 'Politica de rambursare',
    updated: '2026-04-17',
    body: [
      ['Principiu general', 'Plățile sunt nerambursabile după primele 14 zile de la data primei facturări a unui plan plătit, conform legislației UE privind consumatorii.'],
      ['Fereastra de 14 zile', 'Dacă ești consumator final din UE și ai cumpărat un abonament plătit, poți solicita rambursare completă în primele 14 zile de la achiziție, trimițând un email la billing@kelionai.app. Rambursarea se face prin Stripe, pe aceeași metodă de plată, în maxim 10 zile lucrătoare.'],
      ['Anulare fără rambursare', 'După fereastra de 14 zile, poți anula oricând din contul tău („Planuri & Abonamente" → „Anulează"). Păstrezi accesul până la sfârșitul perioadei plătite și nu vei mai fi taxat.'],
      ['Excepții', 'Nu oferim rambursare pentru utilizare care încalcă Termenii sau pentru taxe suportate de către noi (ex. taxe bancare la chargeback nejustificat).'],
      ['Contact', 'Pentru orice cerere de rambursare: billing@kelionai.app.'],
    ],
  },

  cookies: {
    title: 'Politica de cookies',
    updated: '2026-04-17',
    body: [
      ['Ce sunt cookies', 'Cookies sunt fișiere mici stocate de browser. Le folosim strict pentru funcționalitate — nu pentru publicitate sau profilare.'],
      ['Cookies esențiale', '`kelion.token` — cookie HttpOnly cu token-ul de sesiune JWT. Expiră în 7 zile. Fără acest cookie nu te putem autentifica.'],
      ['Cookies Stripe', 'Stripe plasează propriile cookies pe paginile de Checkout și Billing Portal. Detalii: https://stripe.com/cookies-policy/legal.'],
      ['Dezactivare', 'Poți dezactiva cookies din setările browser-ului, dar nu vei putea folosi contul fără cookie-ul de sesiune.'],
    ],
  },
}

export default function LegalPage({ slug }) {
  const doc = LEGAL[slug]
  if (!doc) {
    return (
      <div style={{ color: '#fff', padding: '40px', background: '#0a0a0f', minHeight: '100vh' }}>
        <p>Document negăsit.</p>
        <Link to="/" style={{ color: '#a855f7' }}>← Înapoi</Link>
      </div>
    )
  }
  return (
    <div style={{
      background: '#0a0a0f', color: '#ddd', minHeight: '100vh',
      fontFamily: "'Inter', sans-serif", padding: '48px 20px',
    }}>
      <div style={{ maxWidth: '780px', margin: '0 auto' }}>
        <Link to="/" style={{ color: '#a855f7', fontSize: '13px', textDecoration: 'none' }}>← Înapoi la KelionAI</Link>
        <h1 style={{
          margin: '18px 0 6px', fontSize: '32px', fontWeight: '800',
          background: 'linear-gradient(135deg, #a855f7, #f472b6)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>{doc.title}</h1>
        <p style={{ color: '#666', fontSize: '12px', margin: '0 0 32px' }}>
          Ultima actualizare: {doc.updated}
        </p>

        {doc.body.map(([heading, text]) => (
          <section key={heading} style={{ marginBottom: '22px' }}>
            <h2 style={{ fontSize: '17px', fontWeight: '700', color: '#fff', margin: '0 0 8px' }}>
              {heading}
            </h2>
            <p style={{ color: '#aaa', lineHeight: 1.7, fontSize: '14px', margin: 0 }}>
              {text}
            </p>
          </section>
        ))}

        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.08)',
          marginTop: '40px', paddingTop: '20px', display: 'flex', gap: '16px', fontSize: '12px',
        }}>
          <Link to="/terms"   style={{ color: '#666', textDecoration: 'none' }}>Termeni</Link>
          <Link to="/privacy" style={{ color: '#666', textDecoration: 'none' }}>Confidențialitate</Link>
          <Link to="/refund"  style={{ color: '#666', textDecoration: 'none' }}>Rambursări</Link>
          <Link to="/cookies" style={{ color: '#666', textDecoration: 'none' }}>Cookies</Link>
        </div>
      </div>
    </div>
  )
}
