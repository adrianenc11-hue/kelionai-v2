#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// KelionAI v2.1 — SETUP AUTOMAT TOTAL
// Rulează: node setup.js
// Face: creează tabele Supabase, verifică chei, verifică health
// ═══════════════════════════════════════════════════════════════
require('dotenv').config();
const fetch = require('node-fetch');

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

async function main() {
    console.log('\n══════════════════════════════════════════');
    console.log('  KelionAI v2.1 — Setup Automat');
    console.log('══════════════════════════════════════════\n');

    // 1. Check env vars
    console.log('📋 Verificare chei API...');
    const keys = {
        'ANTHROPIC_API_KEY': process.env.ANTHROPIC_API_KEY,
        'ELEVENLABS_API_KEY': process.env.ELEVENLABS_API_KEY,
        'SUPABASE_URL': SUPA_URL,
        'SUPABASE_ANON_KEY': process.env.SUPABASE_ANON_KEY,
        'SUPABASE_SERVICE_KEY': SUPA_KEY,
    };
    const optional = {
        'DEEPSEEK_API_KEY': process.env.DEEPSEEK_API_KEY,
        'TOGETHER_API_KEY': process.env.TOGETHER_API_KEY,
        'GROQ_API_KEY': process.env.GROQ_API_KEY,
    };

    let allGood = true;
    for (const [name, val] of Object.entries(keys)) {
        if (val) console.log(`  ✅ ${name}`);
        else { console.log(`  ❌ ${name} — LIPSĂ!`); allGood = false; }
    }
    for (const [name, val] of Object.entries(optional)) {
        console.log(`  ${val ? '✅' : '⚠️'} ${name} ${val ? '' : '(opțional)'}`);
    }

    if (!allGood) {
        console.log('\n⚠️  Chei obligatorii lipsesc! Adaugă-le în .env sau Railway.');
        console.log('   Continuă oricum cu crearea tabelelor...\n');
    }

    // 2. Create Supabase tables
    if (SUPA_URL && SUPA_KEY) {
        console.log('\n🗄️  Creez tabele Supabase...');

        const queries = [
            // Conversations
            `CREATE TABLE IF NOT EXISTS conversations (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
                avatar TEXT NOT NULL DEFAULT 'kelion',
                title TEXT,
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            )`,
            // Messages
            `CREATE TABLE IF NOT EXISTS messages (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
                content TEXT NOT NULL,
                language TEXT DEFAULT 'ro',
                created_at TIMESTAMPTZ DEFAULT now()
            )`,
            // Preferences
            `CREATE TABLE IF NOT EXISTS user_preferences (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
                key TEXT NOT NULL,
                value JSONB NOT NULL DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now(),
                UNIQUE(user_id, key)
            )`,
            // Indexes
            `CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, updated_at DESC)`,
            `CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at ASC)`,
            `CREATE INDEX IF NOT EXISTS idx_prefs_user ON user_preferences(user_id)`,
            // Triggers
            `CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ language 'plpgsql'`,
            `DROP TRIGGER IF EXISTS conv_updated ON conversations`,
            `CREATE TRIGGER conv_updated BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at()`,
            `DROP TRIGGER IF EXISTS prefs_updated ON user_preferences`,
            `CREATE TRIGGER prefs_updated BEFORE UPDATE ON user_preferences FOR EACH ROW EXECUTE FUNCTION update_updated_at()`,
            // RLS
            `ALTER TABLE conversations ENABLE ROW LEVEL SECURITY`,
            `ALTER TABLE messages ENABLE ROW LEVEL SECURITY`,
            `ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY`,
            // Policies (with IF NOT EXISTS via DO block)
            `DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'own_conv') THEN
                    CREATE POLICY own_conv ON conversations FOR ALL USING (auth.uid() = user_id);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'own_msg') THEN
                    CREATE POLICY own_msg ON messages FOR ALL USING (conversation_id IN (SELECT id FROM conversations WHERE user_id = auth.uid()));
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'own_prefs') THEN
                    CREATE POLICY own_prefs ON user_preferences FOR ALL USING (auth.uid() = user_id);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'anon_conv') THEN
                    CREATE POLICY anon_conv ON conversations FOR ALL USING (user_id IS NULL) WITH CHECK (user_id IS NULL);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'anon_msg') THEN
                    CREATE POLICY anon_msg ON messages FOR ALL USING (conversation_id IN (SELECT id FROM conversations WHERE user_id IS NULL));
                END IF;
            END $$`
        ];

        let success = 0, fail = 0;
        for (const sql of queries) {
            try {
                const r = await fetch(`${SUPA_URL}/rest/v1/rpc/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': SUPA_KEY,
                        'Authorization': `Bearer ${SUPA_KEY}`,
                        'Prefer': 'return=minimal'
                    },
                    body: JSON.stringify({})  // dummy — we use the SQL endpoint instead
                });
            } catch(e) {}

            // Use the Supabase SQL endpoint (via pg REST)
            try {
                const r = await fetch(`${SUPA_URL}/rest/v1/rpc/exec_sql`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` },
                    body: JSON.stringify({ query: sql })
                });
                // If rpc doesn't exist, try direct query via management API
                if (r.status === 404) throw new Error('rpc not found');
                success++;
            } catch(e) {
                // Fallback: use Supabase Management API
                try {
                    const r = await fetch(`${SUPA_URL}/pg/query`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` },
                        body: JSON.stringify({ query: sql })
                    });
                    if (r.ok) success++;
                    else fail++;
                } catch(e2) { fail++; }
            }
        }

        if (fail > 0) {
            console.log(`\n  ⚠️  Unele queries nu au mers automat (${fail}/${queries.length}).`);
            console.log('  📋 Copiază și rulează manual fișierul server/schema.sql în:');
            console.log('     https://supabase.com/dashboard/project/nqlobybfwmtkmsqadqqr/sql\n');
        } else {
            console.log(`  ✅ Toate ${queries.length} queries executate!`);
        }

        // Test connection
        console.log('\n🔌 Test conexiune Supabase...');
        try {
            const r = await fetch(`${SUPA_URL}/rest/v1/conversations?limit=1`, {
                headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
            });
            if (r.ok) console.log('  ✅ Tabelul conversations accesibil');
            else console.log('  ⚠️  Tabelul conversations nu e accesibil — rulează schema.sql manual');
        } catch(e) {
            console.log('  ❌ Nu mă pot conecta la Supabase');
        }
    } else {
        console.log('\n⚠️  Supabase nu e configurat — skip crearea tabelelor');
    }

    // 3. Verify APIs work
    console.log('\n🧪 Test API-uri...');

    // Test Claude
    if (process.env.ANTHROPIC_API_KEY) {
        try {
            const r = await fetch('https://api.anthropic.com/v1/messages', { method:'POST',
                headers: { 'Content-Type':'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
                body: JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:10, messages:[{role:'user',content:'test'}] }) });
            console.log(`  ${r.ok ? '✅' : '❌'} Claude API — ${r.status}`);
        } catch(e) { console.log('  ❌ Claude API —', e.message); }
    }

    // Test ElevenLabs
    if (process.env.ELEVENLABS_API_KEY) {
        try {
            const r = await fetch('https://api.elevenlabs.io/v1/voices', {
                headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } });
            console.log(`  ${r.ok ? '✅' : '❌'} ElevenLabs — ${r.status}`);
        } catch(e) { console.log('  ❌ ElevenLabs —', e.message); }
    }

    console.log('\n══════════════════════════════════════════');
    console.log('  SETUP COMPLET!');
    console.log('  Acum: git add -A && git commit -m "v2.1" && git push');
    console.log('  Railway face auto-deploy.');
    console.log('══════════════════════════════════════════\n');
}

main().catch(e => { console.error('Setup error:', e); process.exit(1); });
