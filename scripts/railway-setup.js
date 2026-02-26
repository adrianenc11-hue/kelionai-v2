#!/usr/bin/env node
'use strict';

/**
 * KelionAI — Railway Environment Setup
 * Setează automat variabilele de environment în Railway.
 *
 * Utilizare: npm run railway:setup
 */

const { execSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ─── Constante ────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..');
const ENV_EXAMPLE = path.join(ROOT, '.env.example');
const ENV_LOCAL_FILE = path.join(ROOT, '.env');
const ENV_GENERATED = path.join(ROOT, '.env.local');

// Variabile generate automat (nu se întreabă utilizatorul)
const AUTO_GENERATE = ['ADMIN_TOKEN'];

// Variabile obligatorii (nu pot fi sărite)
const REQUIRED_KEYS = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY'];

// ─── Utilitare ────────────────────────────────────────────────────────────────

function print(msg) {
    process.stdout.write(msg + '\n');
}

function mask(value) {
    if (!value || value.length <= 6) return '***';
    return value.slice(0, 4) + '***' + value.slice(-2);
}

/** Parsează un fișier .env și returnează un Map cheie→valoare. */
function parseEnvFile(filePath) {
    const result = new Map();
    if (!fs.existsSync(filePath)) return result;

    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        // Ignoră valorile placeholder din .env.example
        if (key && value && !value.endsWith('-xxx') && !value.endsWith('xxx') &&
            value !== 'xxx' && !value.includes('xxxxxxxxxxxxxxxxxxxx')) {
            result.set(key, value);
        }
    }
    return result;
}

/** Extrage doar cheile (fără valori) din .env.example. */
function parseEnvExampleKeys(filePath) {
    const keys = [];
    if (!fs.existsSync(filePath)) return keys;

    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        if (key) keys.push(key);
    }
    return keys;
}

/** Rulează o comandă și returnează stdout sau null la eroare. */
function run(cmd, args = [], silent = true) {
    const result = spawnSync(cmd, args, {
        encoding: 'utf8',
        stdio: silent ? 'pipe' : 'inherit',
    });
    if (result.status !== 0) return null;
    return (result.stdout || '').trim();
}

/** Întreabă utilizatorul o întrebare și returnează răspunsul. */
function prompt(rl, question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim()));
    });
}

// ─── Verificări preliminare ───────────────────────────────────────────────────

async function ensureRailwayCLI() {
    const which = run('railway', ['--version']);
    if (which !== null) {
        print('✅ Railway CLI detectat');
        return true;
    }

    print('⚠️  Railway CLI nu este instalat. Instalez...');
    const install = spawnSync('npm', ['i', '-g', '@railway/cli'], {
        stdio: 'inherit',
        encoding: 'utf8',
    });

    if (install.status !== 0) {
        print('❌ Nu am putut instala Railway CLI. Rulează manual: npm i -g @railway/cli');
        process.exit(1);
    }
    print('✅ Railway CLI instalat cu succes');
    return true;
}

function checkRailwayAuth() {
    const whoami = run('railway', ['whoami']);
    if (whoami) {
        print(`✅ Autentificat ca: ${whoami}`);
        return true;
    }
    print('❌ Nu ești autentificat în Railway. Rulează: railway login');
    process.exit(1);
}

function checkRailwayLink() {
    const status = run('railway', ['status']);
    if (status) {
        // Extrage numele proiectului din output
        const match = status.match(/Project:\s*(.+)/i);
        const projectName = match ? match[1].trim() : 'unknown';
        print(`✅ Proiect linked: ${projectName}`);
        return true;
    }
    print('❌ Niciun proiect Railway linked. Rulează: railway link');
    process.exit(1);
}

// ─── Setare variabile ─────────────────────────────────────────────────────────

async function setRailwayVar(key, value) {
    const result = spawnSync('railway', ['variables', 'set', `${key}=${value}`], {
        encoding: 'utf8',
        stdio: 'pipe',
    });
    return result.status === 0;
}

// ─── Flux principal ───────────────────────────────────────────────────────────

async function main() {
    print('');
    print('🚂 KelionAI — Railway Environment Setup');
    print('════════════════════════════════════════');
    print('');

    // 1. Verifică Railway CLI
    await ensureRailwayCLI();
    checkRailwayAuth();
    checkRailwayLink();
    print('');

    // 2. Citește cheile din .env.example
    if (!fs.existsSync(ENV_EXAMPLE)) {
        print('❌ Fișierul .env.example nu a fost găsit!');
        process.exit(1);
    }
    const allKeys = parseEnvExampleKeys(ENV_EXAMPLE);
    print(`📋 Variabile de configurat: ${allKeys.length}`);
    print('');

    // 3. Citește valorile existente din .env local
    const localEnv = parseEnvFile(ENV_LOCAL_FILE);

    // 4. Interfață readline pentru input interactiv
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const setVars = [];
    const skippedVars = [];
    const generatedValues = new Map();

    for (const key of allKeys) {
        let value = localEnv.get(key) || '';

        // Auto-generare
        if (!value && AUTO_GENERATE.includes(key)) {
            value = crypto.randomBytes(64).toString('hex');
            generatedValues.set(key, value);
            print(`🔑 Generez ${key} automat...`);
            print(`   ✅ ${key}=${mask(value)} (salvat în .env.local)`);
            const ok = await setRailwayVar(key, value);
            if (ok) setVars.push(key);
            else print(`   ⚠️  Nu am putut seta ${key} în Railway`);
            continue;
        }

        // Valoare deja disponibilă din .env local
        if (value) {
            const ok = await setRailwayVar(key, value);
            if (ok) {
                setVars.push(key);
                print(`   ✅ ${key}=${mask(value)} (din .env local)`);
            } else {
                print(`   ⚠️  Nu am putut seta ${key} în Railway`);
            }
            continue;
        }

        // Prompt interactiv
        const isRequired = REQUIRED_KEYS.includes(key);
        const hint = isRequired ? ' (obligatoriu)' : ' — apasă Enter pentru a sări';
        print(`🗝️  ${key} lipsește${hint}:`);

        let answer = '';
        while (true) {
            answer = await prompt(rl, `   > `);
            if (answer) break;
            if (!isRequired) {
                print(`   ⏭️  ${key} sărit`);
                skippedVars.push(key);
                break;
            }
            print(`   ⚠️  ${key} este obligatoriu. Introdu o valoare (sau Ctrl+C pentru a ieși):`);
        }

        if (!answer) continue;

        const ok = await setRailwayVar(key, answer);
        if (ok) {
            setVars.push(key);
            print(`   ✅ ${key} setat`);
        } else {
            print(`   ⚠️  Nu am putut seta ${key} în Railway`);
            skippedVars.push(key);
        }
    }

    rl.close();

    // 5. Salvează valorile generate în .env.local
    if (generatedValues.size > 0) {
        const lines = [];
        if (fs.existsSync(ENV_GENERATED)) {
            const existing = fs.readFileSync(ENV_GENERATED, 'utf8').split('\n');
            for (const line of existing) {
                const eqIdx = line.indexOf('=');
                if (eqIdx !== -1) {
                    const k = line.slice(0, eqIdx).trim();
                    if (!generatedValues.has(k)) lines.push(line);
                } else if (line.trim()) {
                    lines.push(line);
                }
            }
        }
        for (const [k, v] of generatedValues) {
            lines.push(`${k}=${v}`);
        }
        fs.writeFileSync(ENV_GENERATED, lines.join('\n') + '\n', 'utf8');
        print('');
        print(`💾 Valorile generate au fost salvate în .env.local`);
    }

    // 6. Sumar final
    print('');
    print('════════════════════════════════════════');
    print(`✅ ${setVars.length}/${allKeys.length} variabile setate cu succes în Railway!`);
    if (skippedVars.length > 0) {
        print(`⏭️  Sărite (${skippedVars.length}): ${skippedVars.join(', ')}`);
    }
    print(`🚀 Rulează 'railway up' pentru a deploya!`);
    print('');
}

main().catch((err) => {
    console.error('❌ Eroare:', err.message);
    process.exit(1);
});
