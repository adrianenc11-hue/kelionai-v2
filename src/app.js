'use strict';

const express = require('express');
const voiceRoutes = require('./routes/voice');

const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'kelion-voice' });
});

app.use('/api/voice', voiceRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  /* istanbul ignore next */
  const status = err.status || 500;
  /* istanbul ignore next */
  res.status(status).json({ error: err.message || 'Internal server error' });
});

module.exports = app;

if (require.main === module) {
  /* istanbul ignore next */
  const PORT = process.env.PORT || 3000;
  /* istanbul ignore next */
  app.listen(PORT, () => {
    console.log(`kelion-voice listening on port ${PORT}`);
  });
}
