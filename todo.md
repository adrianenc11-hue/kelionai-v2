# TODO — KelionAI v2

## 🔴 Broken (trebuie fixat)
- [ ] Email — RESEND_API_KEY lipsește pe Railway (codul e gata)
- [ ] WhatsApp — token posibil expirat, de verificat din Meta Developers
- [ ] Guardian News — API key nesetat

## 🟡 De implementat
- [ ] UI Memory Panel — pagină frontend vizualizare memorii

## 🔵 Configurare
- [ ] Domain verification kelionai.app — DNS TXT record

## ✅ Fixat azi (09.03.2026)
- [x] Action Confirmation — blochează efectiv acțiuni riscante
- [x] Calendar OAuth2 — JWT Service Account + domain-wide delegation
- [x] Calendar sharing — ACL writer access confirmat
- [x] Multi-agent system — 6 agenți: General, Code, Creative, Research, Trading, Tutor
- [x] Tutor Agent — mod pedagogic cu 8 reguli (pas cu pas, analogii, verificare)
- [x] UI Agent Activity Badge — badge violet cu icon+nume agent+model
- [x] Agent prompt injection — systemPrompt injectat în buildEnrichedContext
- [x] Code Execution — vm.createContext sandbox (deja era OK)
- [x] Web Scrape — deja implementat complet
- [x] RAG Search — deja funcțional (semantic + keyword fallback)
- [x] Scheduled Tasks — deja implementat (5min interval)