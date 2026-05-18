'use strict';

const ORIGINAL_ENV = process.env;

describe('watchdog boot diagnosis', () => {
  let logSpy;
  let errorSpy;
  let smartFetch;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_API_KEYS;

    smartFetch = jest.fn();
    jest.doMock('../src/services/modelRouter', () => ({ smartFetch }));
    jest.doMock('../src/services/realTools', () => ({ toolRunTerminalCommand: jest.fn() }));

    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.env = ORIGINAL_ENV;
    jest.dontMock('../src/services/modelRouter');
    jest.dontMock('../src/services/realTools');
    jest.resetModules();
  });

  it('skips boot AI calls cleanly when no provider keys are configured', async () => {
    const watchdog = require('../src/services/watchdog');

    expect(watchdog.hasAiCredentials()).toBe(false);
    await watchdog.performBootDiagnosis();

    expect(smartFetch).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      '[WATCHDOG] Auto-Diagnosis skipped - no AI provider key configured.'
    );
  });
});
