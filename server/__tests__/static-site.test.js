'use strict';

const path = require('path');
const { mountStaticSite } = require('../src/utils/staticSite');

describe('mountStaticSite', () => {
  it('skips SPA/static registration when dist is missing', () => {
    const app = { use: jest.fn(), get: jest.fn() };
    const express = { static: jest.fn() };
    const logger = { log: jest.fn(), warn: jest.fn() };

    const mounted = mountStaticSite(app, express, path, '/missing/dist', {
      hasDist: false,
      logger,
    });

    expect(mounted).toBe(false);
    expect(app.use).not.toHaveBeenCalled();
    expect(app.get).not.toHaveBeenCalled();
    expect(express.static).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('API-only mode enabled'));
  });

  it('registers static handlers when dist exists', () => {
    const app = { use: jest.fn(), get: jest.fn() };
    const staticMiddleware = jest.fn();
    const express = { static: jest.fn(() => staticMiddleware) };
    const logger = { log: jest.fn(), warn: jest.fn() };

    const mounted = mountStaticSite(app, express, path, '/srv/dist', {
      hasDist: true,
      logger,
    });

    expect(mounted).toBe(true);
    expect(express.static).toHaveBeenCalledTimes(2);
    expect(app.use).toHaveBeenCalledTimes(2);
    expect(app.get).toHaveBeenCalledWith('*', expect.any(Function));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('/srv/dist'));
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
