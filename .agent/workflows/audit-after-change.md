---
description: Audit obligatoriu după fiecare modificare de funcționalitate
---
# Audit-First Workflow — OBLIGATORIU

## Regulă: După ORICE modificare de cod care afectează o funcție sau funcționalitate:

// turbo-all

### 1. VERIFICARE COD
- Citește funcția modificată complet
- Verifică: nu există date false, synthetic, inventate, hardcodate
- Verifică: error handling real (nu `catch(e){}` gol)
- Verifică: toate exporturile există și sunt corecte
- Verifică: importurile noi sunt adăugate

### 2. PUSH + DEPLOY
- `git add` DOAR fișierele modificate
- `git commit` cu mesaj clar ce s-a schimbat
- `git push origin master`
- Așteaptă 60s pentru deploy Railway

### 3. AUDIT LIVE
- Apelează API-ul afectat cu fetch() din browser
- Verifică răspunsul e format corect
- Verifică nu sunt erori 500/404
- Verifică datele returnate sunt REALE (nu inventate)

### 4. RAPORT ONEST
- Ce funcționează: dovezi (output real)
- Ce NU funcționează: erori exacte
- Ce e falsificat: NIMIC (dacă e, raportează)
- NICIODATĂ: "Normal", "Se rezolvă cu timpul", "Minor"

### 5. ZERO TOLERANȚĂ
- Date sintetice = INTERZIS
- Volume=0 hardcodat = INTERZIS
- Random walk = INTERZIS
- Mesaje de succes fără dovadă = INTERZIS
- "Silent catch" fără logging = INTERZIS
