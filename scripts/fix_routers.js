const fs = require('fs');
let s = fs.readFileSync('server/index.js', 'utf8');
if (!s.includes("const visionRouter = require('./routes/vision');")) {
  s = s.replace(
    "const authRouter = require('./routes/auth');",
    "const authRouter = require('./routes/auth');\nconst visionRouter = require('./routes/vision');"
  );
}
if (!s.includes("app.use('/api/admin', adminApiRouter);")) {
  s = s.replace(
    "app.use('/api/auth', authRouter);",
    "app.use('/api/auth', authRouter);\napp.use('/api/admin', adminApiRouter);"
  );
}
if (!s.includes("app.use('/api/mobile/v1', mobileApiRouter);")) {
  s = s.replace(
    "app.use('/api/auth', authRouter);",
    "app.use('/api/auth', authRouter);\napp.use('/api/mobile/v1', mobileApiRouter);"
  );
}
if (!s.includes("app.use('/api/vision', visionRouter);")) {
  s = s.replace(
    "app.use('/api/auth', authRouter);",
    "app.use('/api/auth', authRouter);\napp.use('/api/vision', visionRouter);"
  );
}
fs.writeFileSync('server/index.js', s, 'utf8');
console.log('Restored critical routes');
