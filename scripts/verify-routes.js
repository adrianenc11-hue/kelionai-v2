#!/usr/bin/env node
'use strict';

const BASE = 'http://localhost:3847';

const routes = [
  { path: '/', expect: 200, desc: 'Homepage' },
  { path: '/privacy/', expect: 200, desc: 'Privacy Policy' },
  { path: '/terms/', expect: 200, desc: 'Terms of Service' },
  { path: '/gdpr/', expect: 200, desc: 'GDPR' },
  { path: '/pricing/', expect: 200, desc: 'Pricing' },
  { path: '/premium', expect: 301, desc: 'Premium redirect' },
  { path: '/landing', expect: 404, desc: 'Landing (not mapped)' },
  { path: '/api/legal/terms', expect: 200, desc: 'API Terms JSON' },
  { path: '/api/legal/privacy', expect: 200, desc: 'API Privacy JSON' },
];

const RO_PATTERNS =
  /Gratuit|Recomandat|\/lună|Upgrade la|chat\/zi|căutări\/zi|imagini\/zi|Inclus|Plan curent|Gestionează|încarcă|Abonamente|Invită|prieten|Generează|Trimite|Copiază|Închide|Exportă|Recomandări|Plata procesată|Plata a fost|reînnoiește|Felicit|Deschide KelionAI|Expiră pe|funcțional|Termeni și Condiții|Politica de Confidențialitate|Descrierea Serviciului|Conturi și Înregistrare|Utilizare Acceptabilă|Plăți și Abonamente|Datele Colectate|Scopul Prelucrării|Baza Legală|Stocarea Datelor|Partajarea Datelor|Drepturile Tale|Ștergerea Datelor|Portabilitate|Modificări/;

(async () => {
  let passed = 0,
    failed = 0;

  for (const r of routes) {
    try {
      const res = await fetch(BASE + r.path, { redirect: 'manual' });
      const status = res.status;
      const loc = res.headers.get('location') || '';
      const ok = status === r.expect;
      if (ok) passed++;
      else failed++;
      const mark = ok ? '✅ PASS' : '❌ FAIL';
      const extra = loc ? ` → ${loc}` : ` (${(await res.text()).length} bytes)`;
    } catch (e) {
      failed++;
    }
  }

  const runtimeChecks = [
    { path: '/api/legal/terms', desc: 'API Terms JSON' },
    { path: '/api/legal/privacy', desc: 'API Privacy JSON' },
    { path: '/pricing/', desc: 'Pricing HTML' },
    { path: '/privacy/', desc: 'Privacy HTML' },
    { path: '/terms/', desc: 'Terms HTML' },
    { path: '/gdpr/', desc: 'GDPR HTML' },
    { path: '/', desc: 'Homepage HTML' },
  ];

  let roFound = 0;
  for (const c of runtimeChecks) {
    try {
      const res = await fetch(BASE + c.path);
      const text = await res.text();
      const hasRo = RO_PATTERNS.test(text);
      if (hasRo) roFound++;
    } catch (e) {
      console.error(e);
    }
  }

  console.log(
    `\n  Result: ${roFound === 0 ? '✅ ZERO Romanian strings in runtime' : `❌ ${roFound} pages with Romanian`}\n`
  );

  const directRoutes = ['/', '/privacy/', '/terms/', '/gdpr/', '/pricing/'];
  for (const p of directRoutes) {
    // Simulate browser refresh = two fetches
    const r1 = await fetch(BASE + p);
    const r2 = await fetch(BASE + p);
    const ok = r1.status === 200 && r2.status === 200;
  }
})();
