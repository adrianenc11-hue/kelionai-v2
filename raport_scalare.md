# Raport Scalare PostgreSQL pentru 1 Milion de Utilizatori

## 1. Connection Pooling
Pentru un număr masiv de conexiuni concurente, conexiunile directe la Postgres sunt prea costisitoare (câte un proces pe conexiune). 
- **Soluție:** Folosește `PgBouncer` în modul "transaction". Astfel vei putea multiplexa zeci de mii de cereri venite de pe serverele Node.js pe un număr fix de 100-200 de conexiuni Postgres reale.

## 2. Indexare și Optimizare Queries
- Creează indecși B-Tree pe coloanele frecvent căutate (ex. `email`, `user_id`).
- Folosește `EXPLAIN ANALYZE` pentru a găsi query-urile încete.
- Implementează "Partial Indexes" pentru tabele care au stări logice (ex: `WHERE status = 'active'`).

## 3. Caching cu Redis
Nu apela baza de date pentru date care nu se schimbă des.
- Pune datele "hot" (profil, sold credite, stări sesiuni) în Redis.
- Baza de date PostgreSQL va fi folosită exclusiv ca sursă de adevăr (Source of Truth) la scriere, în timp ce citirile masive se vor face din memoria RAM (Redis).

## 4. Partiționarea Datelor (Table Partitioning)
Dacă tabela `transactions` (Ledger-ul de credite) atinge 50-100GB, fă partiționare pe lună (`created_at`). Asta accelerează enorm operațiunile de filtrare pe date recente și ușurează ștergerile vechi.

## 5. Read Replicas (Scalare Orizontală)
Când procesorul (CPU) bazei de date principale (Master) trece de 70%:
- Adaugă o replică de tip Read-Only.
- Toate request-urile de tip `SELECT` (graficele admin, logurile) le trimiți către Replica. Toate request-urile de `INSERT/UPDATE` merg spre Master.

*Raport generat prin Deep Reasoning (Testul 2 - Autonomie).*
