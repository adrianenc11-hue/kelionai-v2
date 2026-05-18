'use strict';

const ORIGINAL_ENV = process.env;

describe('runtime config', () => {
  let warnSpy;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('dotenv', () => ({ config: jest.fn() }));
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'production' };
    delete process.env.SESSION_SECRET;
    delete process.env.JWT_SECRET;
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.env = ORIGINAL_ENV;
    jest.dontMock('dotenv');
    jest.resetModules();
  });

  it('keeps production bootable with ephemeral secrets when Railway secrets are missing', () => {
    const config = require('../src/config');

    expect(config.session.secret).toHaveLength(96);
    expect(config.jwt.secret).toHaveLength(96);
    expect(config.runtime.generatedSecrets).toEqual([
      'SESSION_SECRET',
      'JWT_SECRET',
    ]);
  });

  it('uses configured production secrets without marking them ephemeral', () => {
    process.env.SESSION_SECRET = 'stable-session-secret';
    process.env.JWT_SECRET = 'stable-jwt-secret';

    const config = require('../src/config');

    expect(config.session.secret).toBe('stable-session-secret');
    expect(config.jwt.secret).toBe('stable-jwt-secret');
    expect(config.runtime.generatedSecrets).toEqual([]);
  });
});
