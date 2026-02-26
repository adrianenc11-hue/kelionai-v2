'use strict';

const pino = require('pino');

const logger = pino({
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    ...(process.env.NODE_ENV !== 'production' && {
        transport: {
            target: 'pino/file',
            options: { destination: 1 } // stdout
        }
    })
});

module.exports = logger;
