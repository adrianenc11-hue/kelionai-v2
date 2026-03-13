// Temporary script — creates contact@kelionai.app via Supabase Admin API
require("dotenv").config();
const { supabaseAdmin } = require("./server/supabase");

(async () => {
    if (!supabaseAdmin) {
        console.log("ERROR: supabaseAdmin not initialised (check SUPABASE_SERVICE_KEY)");
        process.exit(1);
    }

    // 1. Check if user already exists
    const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
    if (listErr) { console.log("LIST ERROR:", listErr.message); process.exit(1); }
    const existing = list.users.find(u => u.email === "contact@kelionai.app");
    if (existing) {
        console.log("USER EXISTS:", existing.id, existing.email, "confirmed:", !!existing.email_confirmed_at);
        // Reset password for existing user
        const { data: upd, error: updErr } = await supabaseAdmin.auth.admin.updateUser(existing.id, {
            password: "KelionAI!2026",
            email_confirm: true,
        });
        if (updErr) console.log("UPDATE ERROR:", updErr.message);
        else console.log("PASSWORD RESET OK for", upd.user.email);
        process.exit(0);
    }

    // 2. Create new user
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: "contact@kelionai.app",
        password: "KelionAI!2026",
        email_confirm: true,
        user_metadata: { full_name: "KelionAI Admin" },
    });
    if (error) { console.log("CREATE ERROR:", error.message); process.exit(1); }
    console.log("USER CREATED:", data.user.id, data.user.email);
})();
