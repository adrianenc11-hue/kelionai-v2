// Updated the code to handle catch properly and remove fallback email

// Example of changed route in server/routes/admin.js

// ... existing imports

app.post('/auth-token', async (req, res) => {
    try {
        // ... other code
    } catch (e) {
        console.error(e);
        return res.status(500).send({ error: e.message });
    }

    // Getting the admin email from environment variables
    const email = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();

    // ... remaining authentication logic
});

// Other catch statements updated similarly
