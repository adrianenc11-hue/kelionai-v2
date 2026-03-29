const express = require('express');
const path = require('path');
const app = express();
const PORT = 4444;

// Serve GLB models from app/models
app.use('/models', express.static(path.join(__dirname, '..', 'app', 'models')));

// Serve the preview page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'avatar-preview.html'));
});

app.listen(PORT, () => {
  console.log(`\n  Avatar Preview Server running at:`);
  console.log(`  → http://localhost:${PORT}\n`);
  console.log(`  Switch between Kelion and Kira to inspect textures.`);
  console.log(`  Use mouse to orbit, scroll to zoom.\n`);
});
