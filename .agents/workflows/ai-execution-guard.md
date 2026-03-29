---
description: Guard obligatoriu pentru orice AI care lucrează pe acest repo — previne promisiuni false de scriere și confuzii de task
---

# AI Execution Guard — KelionAI v2

## REGULA 1: Verifică acces de scriere ÎNAINTE de orice promisiune

Înainte de a spune "voi repara" sau "am reparat":

1. Încearcă **efectiv** să scrii un fișier de test: `echo "test" > /tmp/_write_check`
2. Dacă nu poți → spune CLAR: "Nu am acces de scriere. Îți dau patch-urile, dar tu le aplici."
3. **NU** promite niciodată reparare fără a fi verificat mai întâi

## REGULA 2: Nu confunda analiza cu execuția

- "Am identificat problema" ≠ "Am reparat problema"
- "Trebuie schimbat X" ≠ "Am schimbat X"
- Dacă nu ai aplicat fizic un patch, **NU** pretinde că l-ai aplicat
- Verifică cu `wc -l <fisier>` sau `git diff` înainte de a raporta succes

## REGULA 3: Citește cererea exact

Înainte de a începe munca:

1. Citește cererea userului cuvânt cu cuvânt
2. Scrie în primele 2 propoziții ce a cerut userul
3. Dacă cererea e "scriere în DB" → NU face audit de securitate
4. Dacă cererea e "fix camera" → NU rescrie auth-ul
5. Dacă nu ești sigur ce s-a cerut → ÎNTREABĂ, nu presupune

## REGULA 4: Raportare onestă

La fiecare pas, raportează:

- ✅ Ce ai făcut REAL (cu dovadă: diff, output, git log)
- ❌ Ce NU ai putut face (cu motiv)
- ⏳ Ce rămâne de făcut

## REGULA 5: Nu inventa stări

- NU raporta "am stricat fișierul X" fără a verifica cu `wc -l` sau `cat`
- NU raporta "am salvat modificarea" fără a verifica cu `git diff`
- Orice afirmație despre starea codului TREBUIE verificată cu o comandă reală
