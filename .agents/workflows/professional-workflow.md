---
description: Workflow profesional obligatoriu — reguli stricte pentru orice modificare pe KelionAI v2
---

// turbo-all

# Professional Workflow — KelionAI v2 (Regim Special)

## ⚠️ REGULILE DE AUR (OBLIGATORIU)

### Regula 1: ZERO modificări la instrumente de verificare

Fișierele protejate (SHA-256 locked):

- `scripts/gate.js`
- `scripts/pre-start-audit.js`
- `scripts/smoke.js`
- `scripts/verify-tools-integrity.js`
- `scripts/diagnose.js`
- `eslint.config.js`
- `.prettierrc.json`

### Regula 2: ZERO valori hardcodate

Totul vine din `process.env.*`. Niciodată URL-uri, chei, domenii direct în cod.

### Regula 3: Dacă o verificare pică → repari CODUL, NU unealta

### Regula 4: STOP la eroare → Diagnozează → Fix → Verifică → Continuă

Când apare o eroare:

1. **STOP** — nu încerci să continui
2. **DIAGNOZEAZĂ** cu instrumentul dedicat: `npm run diagnose`
3. **IDENTIFICĂ** exact ce a picat din raportul diagnostic
4. **REPARĂ** codul (nu unealta!)
5. **VERIFICĂ** reparația: `npm run diagnose` din nou
6. **CONTINUĂ** doar dacă totul e verde

---

## Instrumentele Dedicate (Obligatoriu Instalate)

| Instrument           | Comandă                                  | Ce detectează                      |
| -------------------- | ---------------------------------------- | ---------------------------------- |
| **Diagnostic Tool**  | `npm run diagnose`                       | Toate verificările simultan        |
| **Diagnostic + Fix** | `npm run diagnose:fix`                   | Detectează + auto-fix unde posibil |
| **Pre-Start Audit**  | `node scripts/pre-start-audit.js`        | Valori hardcodate                  |
| **Tool Integrity**   | `node scripts/verify-tools-integrity.js` | Fișiere tool modificate            |
| **ESLint**           | `npx eslint server/`                     | Erori de cod                       |
| **Prettier**         | `npx prettier --check server/`           | Format cod                         |
| **Syntax Check**     | `node --check <fișier>`                  | Erori de sintaxă JS                |
| **Unit Tests**       | `npx jest --forceExit`                   | Teste unitare                      |
| **Full Gate**        | `npm run gate`                           | Toate porțile (deploy)             |

---

## Flux de Lucru Obligatoriu

### Pas 1: Fă modificarea

Editează codul aplicației (server/, app/, etc.)

### Pas 2: Diagnostic complet

```bash
npm run diagnose
```

Dacă ORICE verificare pică → **STOP** → citești raportul → repari.

### Pas 3: Auto-fix (opțional)

```bash
npm run diagnose:fix
```

Repară automat ce se poate (Prettier format, ESLint --fix).

### Pas 4: Re-diagnostic

```bash
npm run diagnose
```

Rulează din nou. Continuă DOAR dacă totul e ✅.

### Pas 5: Commit

```bash
git add -A
git commit -m "<mesaj descriptiv>"
```

Pre-commit hook-ul va rula automat toate verificările la commit.

### Pas 6: Dacă commit pică

**STOP** → `npm run diagnose` → fix → `npm run diagnose` → retry commit.

---

## Ce fac dacă o verificare pică

| Verificare      | Acțiune corectă                | Acțiune INTERZISĂ              |
| --------------- | ------------------------------ | ------------------------------ |
| ESLint          | `npx eslint server/ --fix`     | ❌ Modific reguli ESLint       |
| Prettier        | `npx prettier --write server/` | ❌ Schimb `.prettierrc.json`   |
| Hardcoded audit | Folosesc `process.env.*`       | ❌ Adaug excepție în whitelist |
| Tool integrity  | `--update` doar cu aprobare    | ❌ Șterg `.tool-hashes.json`   |
| Syntax Check    | Fix eroarea de sintaxă JS      | ❌ Comment out codul           |
| Jest tests      | Fix codul/testul               | ❌ Skip/șterg test             |
| Gate            | Fix toate erorile              | ❌ Comment out gates           |
