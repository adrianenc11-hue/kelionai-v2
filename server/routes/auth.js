// ═══════════════════════════════════════════════════════════════
// KelionAI — Auth Routes
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { validate, registerSchema, loginSchema, refreshSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema, changeEmailSchema } = require('../validation');

const router = express.Router();

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many attempts. Please wait 15 minutes.' }
});

// POST /api/auth/register
router.post('/register', authLimiter, validate(registerSchema), async (req, res) => {
    try {
        const { supabase } = req.app.locals;
        const { email, password, name } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
        if (!supabase) return res.status(503).json({ error: 'Auth service unavailable' });
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name || email.split('@')[0] } } });
        if (error) {
            // Don't expose whether email is already registered
            const safeMessage = error.message.includes('already registered')
                ? 'If this email is not already in use, a verification email has been sent.'
                : error.message;
            return res.status(400).json({ error: safeMessage });
        }
        res.json({ user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.full_name }, message: 'Please check your email to verify your account before signing in.' });
    } catch (e) { res.status(500).json({ error: 'Registration error' }); }
});

// POST /api/auth/login
router.post('/login', authLimiter, validate(loginSchema), async (req, res) => {
    try {
        const { supabase } = req.app.locals;
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
        if (!supabase) return res.status(503).json({ error: 'Auth service unavailable' });
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return res.status(401).json({ error: error.message });
        if (!data.user.email_confirmed_at) {
            return res.status(403).json({ error: 'Email not verified. Please check your inbox and verify your email before signing in.' });
        }
        res.json({ user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.full_name }, session: data.session });
    } catch (e) { res.status(500).json({ error: 'Login error' }); }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
    try { const { supabase } = req.app.locals; if (supabase) await supabase.auth.signOut(); } catch (e) { }
    res.json({ success: true });
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
    try {
        const { getUserFromToken } = req.app.locals;
        const u = await getUserFromToken(req);
        if (!u) return res.status(401).json({ error: 'Not authenticated' });
        res.json({ user: { id: u.id, email: u.email, name: u.user_metadata?.full_name } });
    } catch (e) { res.status(500).json({ error: 'Auth error' }); }
});

// POST /api/auth/refresh
router.post('/refresh', validate(refreshSchema), async (req, res) => {
    try {
        const { supabase } = req.app.locals;
        const { refresh_token } = req.body;
        if (!refresh_token || !supabase) return res.status(400).json({ error: 'Token missing' });
        const { data, error } = await supabase.auth.refreshSession({ refresh_token });
        if (error) return res.status(401).json({ error: error.message });
        res.json({ user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.full_name }, session: data.session });
    } catch (e) { res.status(500).json({ error: 'Refresh error' }); }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), async (req, res) => {
    try {
        const { supabase } = req.app.locals;
        const { email } = req.body;
        if (!supabase) return res.status(503).json({ error: 'Auth service unavailable' });
        const redirectTo = (process.env.APP_URL || 'https://kelionai.app') + '/reset-password.html';
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) return res.status(400).json({ error: error.message });
        res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
    } catch (e) { res.status(500).json({ error: 'Password reset error' }); }
});

// POST /api/auth/reset-password
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), async (req, res) => {
    try {
        const { supabase } = req.app.locals;
        const { access_token, password } = req.body;
        if (!supabase) return res.status(503).json({ error: 'Auth service unavailable' });
        const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token: access_token });
        if (sessionError) return res.status(401).json({ error: 'Invalid or expired reset token' });
        const { error } = await supabase.auth.updateUser({ password });
        if (error) return res.status(400).json({ error: error.message });
        res.json({ message: 'Password updated successfully.' });
    } catch (e) { res.status(500).json({ error: 'Password reset error' }); }
});

// POST /api/auth/change-password
router.post('/change-password', authLimiter, validate(changePasswordSchema), async (req, res) => {
    try {
        const { getUserFromToken, supabase } = req.app.locals;
        const u = await getUserFromToken(req);
        if (!u) return res.status(401).json({ error: 'Not authenticated' });
        if (!supabase) return res.status(503).json({ error: 'Auth service unavailable' });
        const { password } = req.body;
        const { error } = await supabase.auth.updateUser({ password });
        if (error) return res.status(400).json({ error: error.message });
        res.json({ message: 'Password updated successfully.' });
    } catch (e) { res.status(500).json({ error: 'Change password error' }); }
});

// POST /api/auth/change-email
router.post('/change-email', authLimiter, validate(changeEmailSchema), async (req, res) => {
    try {
        const { getUserFromToken, supabase } = req.app.locals;
        const u = await getUserFromToken(req);
        if (!u) return res.status(401).json({ error: 'Not authenticated' });
        if (!supabase) return res.status(503).json({ error: 'Auth service unavailable' });
        const { email } = req.body;
        const { error } = await supabase.auth.updateUser({ email });
        if (error) return res.status(400).json({ error: error.message });
        res.json({ message: 'A confirmation email has been sent to the new address.' });
    } catch (e) { res.status(500).json({ error: 'Change email error' }); }
});

module.exports = router;
