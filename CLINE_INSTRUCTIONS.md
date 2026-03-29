# Handoff Instructions for Cline

## Objective

The primary objective is to fix a critical application crash in the KelionAI backend. The application currently fails to start or run properly due to a broken module dependency.

## Current Error

When the application runs, it throws the following error:

```
Brain error: Cannot find module '../brain-v5'
Require stack:
- /app/server/routes/admin.js
- /app/server/index.js
```

## Context

1. **The Issue**: It appears that the file `brain-v5.js` was historically used for the AI core, but has likely been renamed or consolidated into `brain.js`. However, several files are still trying to `require('../brain-v5')` or `require('./brain-v5')`.
2. **Affected Files**:
   A recent search revealed the string `brain-v5` remains in:
   - `server/self-heal.js`
   - `server/routes/admin.js`
   - `server/brain.js`
   - potentially `server/index.js` (as per the require stack)

## Next Steps for You (Cline)

1. Search the `server` directory for all instances of `'brain-v5'` or `'../brain-v5'`.
2. Inspect the imports and verify if `brain.js` is the correct replacement for `brain-v5.js`.
3. Update the `require()` statements in `server/index.js`, `server/routes/admin.js`, `server/self-heal.js`, and any other relevant files to point to the correct file (e.g., `./brain` or `../brain.js`).
4. Start the server (e.g., via `npm start` or `node server/index.js`) to verify that the "Cannot find module" error is resolved and the application successfully boots.
5. If there are any other missing dependencies or subsequent errors after fixing `brain-v5`, address them sequentially until the application is fully functional.

## Working Directory

Ensure you execute your commands from `c:\Users\adria\.gemini\antigravity\scratch\kelionai-v2`.
