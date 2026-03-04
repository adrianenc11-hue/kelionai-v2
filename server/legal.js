// ═══════════════════════════════════════════════════════════════
// KelionAI v2.3 — LEGAL (GDPR, Terms, Privacy)
// ═══════════════════════════════════════════════════════════════
const logger = require('./logger');
const express = require('express');
const router = express.Router();

// ═══ TERMS OF SERVICE ═══
router.get('/terms', (req, res) => {
    res.json({
        title: 'Termeni și Condiții — KelionAI',
        version: '1.0',
        effectiveDate: '2026-03-01',
        sections: [
            {
                title: '1. Descrierea Serviciului',
                content: 'KelionAI este un asistent AI accesibil cu avatari 3D care oferă funcții de chat, căutare, generare de imagini, analiză vizuală și informații meteo. Serviciul este disponibil în planurile Free, Pro (€9.99/lună) și Premium (€19.99/lună).'
            },
            {
                title: '2. Conturi și Înregistrare',
                content: 'Pentru funcționalități complete, utilizatorii trebuie să creeze un cont. Sunteți responsabil pentru securitatea credențialelor. Conturile sunt personale și netransferabile.'
            },
            {
                title: '3. Utilizare Acceptabilă',
                content: 'Serviciul nu poate fi utilizat pentru: conținut ilegal, hărțuire, spam, manipulare AI în scopuri dăunătoare, sau încălcarea drepturilor altora.'
            },
            {
                title: '4. Plăți și Subscripții',
                content: 'Subscripțiile se facturează lunar prin Stripe. Anularea oricând din portalul de facturare. Rambursări conform politicii Stripe.'
            },
            {
                title: '5. Limitarea Răspunderii',
                content: 'KelionAI oferă informații generate de AI care pot conține erori. Nu garantăm acuratețea sau completitudinea. Serviciul e oferit "ca atare".'
            },
            {
                title: '6. Proprietate Intelectuală',
                content: 'Conținutul generat de AI poate fi utilizat conform planului. KelionAI își rezervă drepturile asupra platformei, codului și designului.'
            },
            {
                title: '7. Modificări',
                content: 'Ne rezervăm dreptul de a modifica termenii. Notificăm utilizatorii prin email cu 30 de zile înainte.'
            }
        ]
    });
});

// ═══ PRIVACY POLICY ═══
router.get('/privacy', (req, res) => {
    res.json({
        title: 'Politica de Confidențialitate — KelionAI',
        version: '1.0',
        effectiveDate: '2026-03-01',
        sections: [
            {
                title: '1. Date Colectate',
                content: 'Colectăm: email, nume (opțional), conversații AI, preferințe, date utilizare, date plată procesate de Stripe.'
            },
            {
                title: '2. Scopul Procesării',
                content: 'Furnizarea serviciului, personalizare (memorie AI), facturare, îmbunătățirea calității, comunicări serviciu.'
            },
            {
                title: '3. Baza Legală (GDPR Art. 6)',
                content: 'Consimțământ (memorie AI), executarea contractului (serviciu), interes legitim (îmbunătățire).'
            },
            {
                title: '4. Stocarea Datelor',
                content: 'Servere Supabase (EU) și Railway. Conversații criptate TLS + repaus. Plăți gestionate exclusiv de Stripe.'
            },
            {
                title: '5. Partajare Date',
                content: 'Anthropic/OpenAI (procesare AI), ElevenLabs (TTS), Stripe (plăți), Supabase (stocare). Nu vindem date personale.'
            },
            {
                title: '6. Drepturile Dvs. (GDPR)',
                content: 'Acces, rectificare, ștergere, portabilitate, restricționare, opoziție. Contact: privacy@kelionai.app.'
            },
            {
                title: '7. Retenția Datelor',
                content: 'Conversații: cât contul e activ + 30 zile. Plăți: 5 ani (fiscal). La ștergere cont: eliminare 30 zile.'
            },
            {
                title: '8. Cookie-uri',
                content: 'Doar cookie-uri esențiale pentru autentificare. Zero tracking sau publicitate.'
            }
        ]
    });
});

// ═══ GDPR: EXPORT ALL USER DATA ═══
router.get('/gdpr/export', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Not authenticated' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

        const [conversations, preferences, subscription, usage, referrals] = await Promise.all([
            supabaseAdmin.from('conversations').select('id, avatar, title, created_at').eq('user_id', user.id),
            supabaseAdmin.from('user_preferences').select('key, value, updated_at').eq('user_id', user.id),
            supabaseAdmin.from('subscriptions').select('plan, status, current_period_start, current_period_end').eq('user_id', user.id),
            supabaseAdmin.from('usage').select('type, count, date').eq('user_id', user.id),
            supabaseAdmin.from('referrals').select('code, created_at').eq('user_id', user.id)
        ]);

        // Get messages for each conversation
        let allMessages = [];
        if (conversations.data?.length) {
            const convIds = conversations.data.map(c => c.id);
            const { data: msgs } = await supabaseAdmin
                .from('messages')
                .select('conversation_id, role, content, language, created_at')
                .in('conversation_id', convIds)
                .order('created_at', { ascending: true });
            allMessages = msgs || [];
        }

        const exportData = {
            exportDate: new Date().toISOString(),
            format: 'GDPR Data Export — KelionAI',
            user: {
                id: user.id,
                email: user.email,
                name: user.user_metadata?.full_name || null,
                created: user.created_at
            },
            conversations: conversations.data || [],
            messages: allMessages,
            preferences: preferences.data || [],
            subscription: subscription.data || [],
            usage: usage.data || [],
            referrals: referrals.data || []
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="kelionai-export-${user.id}.json"`);
        res.json(exportData);
    } catch (e) {
        logger.error({ component: 'Legal', err: e.message }, 'GDPR Export');
        res.status(500).json({ error: 'Data export error' });
    }
});

// ═══ GDPR: DELETE ALL USER DATA ═══
router.delete('/gdpr/delete', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Not authenticated' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

        const { confirm } = req.body;
        if (confirm !== 'DELETE_MY_DATA') {
            return res.status(400).json({
                error: 'Send { "confirm": "DELETE_MY_DATA" } to confirm',
                warning: 'This action is IRREVERSIBLE. All conversations, preferences and data will be deleted.'
            });
        }

        // Cancel Stripe subscription if active
        try {
            const { data: sub } = await supabaseAdmin
                .from('subscriptions')
                .select('stripe_subscription_id')
                .eq('user_id', user.id)
                .eq('status', 'active')
                .single();

            if (sub?.stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
                const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
                await stripe.subscriptions.cancel(sub.stripe_subscription_id);
            }
        } catch (e) { logger.warn({ component: 'Legal', err: e.message }, 'subscription might not exist'); }

        // Delete all user data in order (respecting foreign keys)
        const convIds = [];
        const { data: convs } = await supabaseAdmin.from('conversations').select('id').eq('user_id', user.id);
        if (convs) convs.forEach(c => convIds.push(c.id));

        if (convIds.length) {
            await supabaseAdmin.from('messages').delete().in('conversation_id', convIds);
        }
        await supabaseAdmin.from('conversations').delete().eq('user_id', user.id);
        await supabaseAdmin.from('user_preferences').delete().eq('user_id', user.id);
        await supabaseAdmin.from('subscriptions').delete().eq('user_id', user.id);
        await supabaseAdmin.from('usage').delete().eq('user_id', user.id);
        await supabaseAdmin.from('referrals').delete().eq('user_id', user.id);

        logger.info({ component: 'Legal', userId: user.id }, `🗑️ All data deleted for user ${user.id}`);
        res.json({ success: true, message: 'All data deleted. Your account can be closed from settings.' });
    } catch (e) {
        logger.error({ component: 'Legal', err: e.message }, 'GDPR Delete');
        res.status(500).json({ error: 'Data deletion error' });
    }
});

// ═══ GDPR: CONSENT STATUS ═══
router.get('/gdpr/consent', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Not authenticated' });
        if (!supabaseAdmin) return res.json({ consents: {} });

        const { data } = await supabaseAdmin
            .from('user_preferences')
            .select('key, value')
            .eq('user_id', user.id)
            .like('key', 'consent_%');

        const consents = {};
        (data || []).forEach(d => { consents[d.key.replace('consent_', '')] = d.value; });

        res.json({ consents });
    } catch (e) {
        res.status(500).json({ error: 'Consent error' });
    }
});

// ═══ GDPR: UPDATE CONSENT ═══
router.post('/gdpr/consent', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Not authenticated' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

        const { type, granted } = req.body;
        const validTypes = ['memory', 'analytics', 'marketing'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ error: `Valid types: ${validTypes.join(', ')}` });
        }

        await supabaseAdmin.from('user_preferences').upsert({
            user_id: user.id,
            key: `consent_${type}`,
            value: { granted: !!granted, timestamp: new Date().toISOString() }
        }, { onConflict: 'user_id,key' });

        res.json({ success: true, type, granted: !!granted });
    } catch (e) {
        res.status(500).json({ error: 'Consent update error' });
    }
});

module.exports = router;
