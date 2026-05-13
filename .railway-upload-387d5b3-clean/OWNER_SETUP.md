# OWNER SETUP — pasi manuali pe care doar tu (owner-ul) ii poti face

Sistemul de reguli este creat pe disc. Pentru a deveni cu adevarat greu de
ocolit, trebuie sa executi urmatorii pasi. Eu (agentul) NU pot face niciunul
dintre ei in locul tau, pentru ca toti necesita autoritatea ta de owner pe
GitHub si pe sistemul tau.

---

## Pas 1 — Review-uieste continutul inainte sa commit-ezi

Deschide si citeste:
- `RULES.md` — cele 55 de reguli.
- `.augment/rules.md` — bootstrap-ul agentului.
- `DELIVERY_CONTRACT.md` — definitia de "livrat".
- `CODEOWNERS` — cine aproba ce.

Daca e ceva ce nu vrei, spune-mi ce sa schimb INAINTE de commit. Odata ce
RULES.md e commit-at si hash-ul e generat, orice modificare cere din nou
aprobarea ta explicita.

## Pas 2 — Commit si push

```
git add RULES.md RULES.sha256 .augment/ CODEOWNERS DELIVERY_CONTRACT.md OWNER_SETUP.md scripts/verify-rules-integrity.cjs scripts/verify-agent-report.cjs scripts/lock-rules.ps1 scripts/unlock-rules.ps1 scripts/lock-rules.sh scripts/unlock-rules.sh .github/workflows/rules-integrity.yml .github/workflows/acceptance.yml e2e/acceptance/
git commit -m "Add enforceable rules infrastructure (RULES.md + CI + CODEOWNERS)"
git push
```

## Pas 3 — Activeaza branch protection pe GitHub (CRITIC)

Fara acest pas, CODEOWNERS si workflow-urile sunt doar sugestii. Cu el,
devin obligatorii.

1. Mergi la https://github.com/adrianenc11-hue/kelionai-v2/settings/branches
2. Click "Add branch protection rule" (sau editeaza regula existenta pentru `master`).
3. Branch name pattern: `master`
4. Bifeaza:
   - **Require a pull request before merging**
     - Require approvals: **1**
     - **Require review from Code Owners** (ASTA e linia care face CODEOWNERS real)
     - Dismiss stale pull request approvals when new commits are pushed
   - **Require status checks to pass before merging**
     - Require branches to be up to date before merging
     - Status checks required:
       - `verify-rules` (din workflow-ul `rules-integrity`)
       - `acceptance (payments)`, `acceptance (language-mirror)`, `acceptance (language-switch)`, `acceptance (trial-timer)` — pentru capabilitatile care trebuie sa functioneze; cele "NOT IMPLEMENTED" nu le bifa acum.
   - **Require conversation resolution before merging**
   - **Do not allow bypassing the above settings** — bifeaza si pentru admini. ASTA te protejeaza si de tine cand obosesti.
5. Salveaza.

Dupa pasul asta, nimeni — nici macar eu ca agent cu access token — nu poate fuziona o modificare la RULES.md fara aprobarea ta explicita in GitHub UI.

## Pas 4 — Activeaza signed commits (optional, dar recomandat)

Pe aceeasi pagina de branch protection:
- **Require signed commits**

Asta inseamna ca orice commit pe master trebuie semnat cu o cheie GPG sau SSH. Cum eu (agentul) lucrez prin tool-ul de push si nu am cheia ta, nu pot pushui direct pe master. Toate modificarile trec prin PR-uri pe care tu le semnezi.

## Pas 5 — Ruleaza lock-rules local

Dupa commit si push, fa read-only fisierele pe masina ta:

```
powershell -ExecutionPolicy Bypass -File scripts\lock-rules.ps1
```

De la acest punct, daca orice tool (inclusiv eu) incearca sa scrie in RULES.md, primeste access-denied.

## Pas 6 — Verifica ca functioneaza

```
node scripts/verify-rules-integrity.cjs
```
Trebuie sa afiseze: `RULES integrity OK (sha256=...)` si exit 0.

Incearca sa modifici RULES.md (adauga un spatiu la sfarsit). Ar trebui sa primesti eroare "access denied" de la Windows. Daca reusesti sa modifici, scriptul de integritate va raporta mismatch la urmatoarea rulare si CI-ul va bloca push-ul.

---

## Ce NU pot face eu, agentul, din acest punct

- Nu pot edita RULES.md, RULES.sha256, CODEOWNERS, DELIVERY_CONTRACT.md, .augment/rules.md, workflow-urile, sau scripturile de verificare fara sa cer tie deblocarea.
- Nu pot regenera RULES.sha256 (scriptul `--write` nu va mai porni fara unlock manual).
- Nu pot fuziona un PR care atinge fisierele protejate — GitHub refuza fara aprobarea ta (CODEOWNERS + branch protection).
- Nu pot marca o capabilitate ca "livrata" in DELIVERY_CONTRACT.md — CODEOWNERS cere aprobarea ta si PR-ul pica in CI daca scriptul acceptance nu returneaza 0 pe productie.

## Ce POT inca face (limite reale, onest)

- Pot sa mint in text, in chat cu tine. Niciun fisier nu ma poate opri sa scriu minciuni ca output. Dar minciunile mele nu pot ajunge in produs — CI-ul si acceptance-ul le resping.
- Pot sa-ti sugerez sa deblochezi lucruri. Decizia ta e ultima linie de aparare.
- Pot sa scriu cod care nu respecta regulile — dar CI-ul va pica si PR-ul nu va fuziona.

Asta e protectia reala. Nu e absoluta — e cea mai buna care exista tehnic.
