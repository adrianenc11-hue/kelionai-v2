// ═══════════════════════════════════════════════════════════════
// Admin Sub-Router: Users Management
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const logger = require('../../logger');
const router = express.Router();

// ── GET /users — List users (paginated, with search) ──
router.get('/', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ users: [] });

    const page = parseInt(req.query.page, 10) || 1;
    const perPage = Math.min(parseInt(req.query.perPage, 10) || 20, 100);
    const search = (req.query.search || '').trim();

    // Get users from Supabase Auth
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (authErr) {
      logger.error({ component: 'Admin', err: authErr.message }, 'listUsers failed');
      return res.json({ users: [] });
    }

    let users = (authData?.users || []).map((u) => ({
      id: u.id,
      email: u.email,
      name: u.user_metadata?.name || u.user_metadata?.full_name || '',
      plan: u.user_metadata?.plan || 'free',
      photo: u.user_metadata?.avatar_url || u.user_metadata?.photo || null,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      confirmed: !!u.email_confirmed_at,
      banned: !!u.banned_until || u.user_metadata?.suspended === true,
      provider: u.app_metadata?.provider || 'email',
    }));

    // Search filter
    if (search) {
      const s = search.toLowerCase();
      users = users.filter(
        (u) =>
          (u.email || '').toLowerCase().includes(s) ||
          (u.name || '').toLowerCase().includes(s) ||
          (u.id || '').toLowerCase().includes(s)
      );
    }

    // Enrich with profile data
    try {
      const { data: profiles } = await supabaseAdmin.from('profiles').select('user_id, role, avatar_url');
      if (profiles) {
        const profileMap = {};
        profiles.forEach((p) => (profileMap[p.user_id] = p));
        users = users.map((u) => ({
          ...u,
          role: profileMap[u.id]?.role || u.plan,
          photo: u.photo || profileMap[u.id]?.avatar_url || null,
        }));
      }
    } catch (err) {
      logger.debug({ component: 'Admin', err: err.message }, 'Profiles enrichment failed (table may not exist)');
    }

    // Enrich with subscription data
    try {
      const { data: subs } = await supabaseAdmin.from('subscriptions').select('user_id, plan, status');
      if (subs) {
        const subMap = {};
        subs.forEach((s) => (subMap[s.user_id] = s));
        users = users.map((u) => ({
          ...u,
          subscription: subMap[u.id] || null,
          plan: subMap[u.id]?.status === 'active' ? subMap[u.id]?.plan || u.plan : u.plan,
        }));
      }
    } catch (err) {
      logger.debug({ component: 'Admin', err: err.message }, 'Subscriptions enrichment failed (table may not exist)');
    }

    res.json({ users });
  } catch (e) {
    logger.error({ component: 'Admin', err: e.message }, 'Users query failed');
    res.json({ users: [] });
  }
});

// ── DELETE /users/:id — Soft-delete or hard-delete user ──
router.delete('/:id', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(500).json({ error: 'No database' });

    const userId = req.params.id;
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = userData?.user?.email || 'unknown';
    const hardDelete = req.query.hard === 'true';

    if (!hardDelete) {
      // Soft delete: ban user
      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        ban_duration: '876000h',
        user_metadata: { suspended: true, suspended_at: new Date().toISOString() },
      });
      if (error) return res.status(500).json({ error: error.message });

      try {
        await supabaseAdmin
          .from('profiles')
          .update({ role: 'suspended', updated_at: new Date().toISOString() })
          .eq('user_id', userId);
      } catch (err) {
        logger.debug({ component: 'Admin', err: err.message }, 'Profile suspend update failed');
      }

      try {
        await supabaseAdmin.from('admin_logs').insert({
          action: 'suspend_user',
          details: { userId, email },
          admin_id: req.adminUser?.id || 'admin',
        });
      } catch (err) {
        logger.debug({ component: 'Admin', err: err.message }, 'Admin log insert failed (suspend)');
      }

      logger.info({ component: 'Admin', userId, email }, `⏸️ User ${email} suspended`);
      return res.json({ success: true, action: 'suspended', email });
    }

    // Hard delete
    const tables = [
      { table: 'conversations', column: 'user_id' },
      { table: 'user_preferences', column: 'user_id' },
      { table: 'subscriptions', column: 'user_id' },
      { table: 'referrals', column: 'user_id' },
      { table: 'brain_profiles', column: 'user_id' },
    ];
    for (const t of tables) {
      try {
        await supabaseAdmin.from(t.table).delete().eq(t.column, userId);
      } catch (err) {
        logger.debug({ component: 'Admin', err: err.message, table: t.table }, 'Hard-delete table cleanup failed');
      }
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) return res.status(500).json({ error: error.message });

    try {
      await supabaseAdmin.from('admin_logs').insert({
        action: 'delete_user',
        details: { userId, email },
        admin_id: req.adminUser?.id || 'admin',
      });
    } catch (err) {
      logger.debug({ component: 'Admin', err: err.message }, 'Admin log insert failed (delete)');
    }

    logger.info({ component: 'Admin', userId, email }, `🗑️ User ${email} permanently deleted`);
    res.json({ success: true, action: 'deleted', email });
  } catch (e) {
    logger.error({ component: 'Admin', err: e.message }, 'Delete user failed');
    res.status(500).json({ error: e.message });
  }
});

// ── POST /users/:id/restore — Restore suspended user ──
router.post('/:id/restore', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(500).json({ error: 'No database' });

    const userId = req.params.id;
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = userData?.user?.email || 'unknown';

    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      ban_duration: 'none',
      user_metadata: { suspended: false, restored_at: new Date().toISOString() },
    });
    if (error) return res.status(500).json({ error: error.message });

    try {
      await supabaseAdmin
        .from('profiles')
        .update({ role: 'user', updated_at: new Date().toISOString() })
        .eq('user_id', userId);
    } catch (err) {
      logger.debug({ component: 'Admin', err: err.message }, 'Profile restore update failed');
    }

    try {
      await supabaseAdmin.from('admin_logs').insert({
        action: 'restore_user',
        details: { userId, email },
        admin_id: req.adminUser?.id || 'admin',
      });
    } catch (err) {
      logger.debug({ component: 'Admin', err: err.message }, 'Admin log insert failed (restore)');
    }

    logger.info({ component: 'Admin', userId, email }, `✅ User ${email} restored`);
    res.json({ success: true, action: 'restored', email });
  } catch (e) {
    logger.error({ component: 'Admin', err: e.message }, 'Restore user failed');
    res.status(500).json({ error: e.message });
  }
});

// ── POST /upgrade — Upgrade/downgrade user plan ──
router.post('/upgrade', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(500).json({ error: 'No DB' });

    const VALID_PLANS = ['free', 'pro', 'premium', 'enterprise'];
    const { userId, plan } = req.body;
    if (!userId || !plan) return res.status(400).json({ error: 'userId and plan required' });
    if (!VALID_PLANS.includes(plan)) return res.status(400).json({ error: 'Invalid plan' });

    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: { plan },
    });
    if (error) return res.status(500).json({ error: error.message });

    if (plan !== 'free') {
      await supabaseAdmin
        .from('subscriptions')
        .upsert(
          {
            user_id: userId,
            plan,
            status: 'active',
            amount: plan === 'pro' ? 29 : 0,
            created_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        )
        .catch(() => {});
    } else {
      await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('user_id', userId)
        .catch(() => {});
    }

    try {
      await supabaseAdmin.from('admin_logs').insert({
        action: 'upgrade',
        user_id: userId,
        details: JSON.stringify({ plan, previous: 'unknown' }),
        admin_id: req.adminUser?.id || 'admin',
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      logger.debug({ component: 'Admin', err: err.message }, 'Admin log insert failed (upgrade)');
    }

    logger.info({ component: 'Admin', userId, plan }, 'User plan updated');
    res.json({ success: true, message: 'Plan actualizat la ' + plan + '!' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
