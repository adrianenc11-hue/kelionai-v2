/**
 * Audit H3 — global process handlers for unhandledRejection /
 * uncaughtException.
 *
 * These tests install the handler on a stubbed EventEmitter (not the
 * real `process`) so they can assert on the handler callbacks without
 * polluting Jest's own process state or risking `process.exit`.
 */

const { EventEmitter } = require('events');
const {
  installProcessHandlers,
  serializeReason,
  createStats,
} = require('../src/util/processHandlers');

const makeLogger = () => ({
  warn: jest.fn(),
  error: jest.fn(),
  log: jest.fn(),
});

describe('serializeReason', () => {
  it('serialises Error via its stack', () => {
    const e = new Error('boom');
    const s = serializeReason(e);
    expect(s).toMatch(/Error: boom/);
  });

  it('serialises plain objects via JSON.stringify', () => {
    expect(serializeReason({ a: 1 })).toBe('{"a":1}');
  });

  it('serialises strings verbatim', () => {
    expect(serializeReason('plain text')).toBe('plain text');
  });

  it('handles null / undefined without throwing', () => {
    expect(serializeReason(null)).toBe('null');
    expect(serializeReason(undefined)).toBe('undefined');
  });

  it('falls back to String() when JSON.stringify throws', () => {
    const circular = {};
    circular.self = circular;
    expect(() => serializeReason(circular)).not.toThrow();
  });
});

describe('createStats', () => {
  it('returns a fresh zeroed object', () => {
    const s = createStats();
    expect(s).toEqual({
      unhandledRejections: 0,
      uncaughtExceptions: 0,
      warnings: 0,
      lastReason: null,
      lastAt: null,
    });
  });
});

describe('installProcessHandlers — unhandledRejection', () => {
  it('logs and increments counter, does not exit', () => {
    const target = new EventEmitter();
    const logger = makeLogger();
    const exit = jest.fn();
    const now = jest.fn(() => 123);

    const { stats } = installProcessHandlers(target, { logger, exit, now });

    target.emit('unhandledRejection', new Error('ouch'));
    expect(stats.unhandledRejections).toBe(1);
    expect(stats.lastAt).toBe(123);
    expect(stats.lastReason).toMatch(/Error: ouch/);
    expect(exit).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('accumulates across multiple rejections', () => {
    const target = new EventEmitter();
    const logger = makeLogger();
    const { stats } = installProcessHandlers(target, { logger, exit: jest.fn() });

    target.emit('unhandledRejection', 'first');
    target.emit('unhandledRejection', new Error('second'));
    target.emit('unhandledRejection', { kind: 'third' });

    expect(stats.unhandledRejections).toBe(3);
    expect(stats.lastReason).toBe('{"kind":"third"}');
  });

  it('survives a non-error rejection reason', () => {
    const target = new EventEmitter();
    const logger = makeLogger();
    const exit = jest.fn();
    const { stats } = installProcessHandlers(target, { logger, exit });

    target.emit('unhandledRejection', 42);
    expect(stats.unhandledRejections).toBe(1);
    expect(stats.lastReason).toBe('42');
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('installProcessHandlers — uncaughtException', () => {
  it('logs, increments counter, and exits with code 1 by default', () => {
    const target = new EventEmitter();
    const logger = makeLogger();
    const exit = jest.fn();
    const now = jest.fn(() => 777);

    const { stats } = installProcessHandlers(target, { logger, exit, now });

    target.emit('uncaughtException', new Error('fatal'));
    expect(stats.uncaughtExceptions).toBe(1);
    expect(stats.lastReason).toMatch(/fatal/);
    expect(stats.lastAt).toBe(777);
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('skips exit when exitOnException=false (Jest mode)', () => {
    const target = new EventEmitter();
    const logger = makeLogger();
    const exit = jest.fn();

    const { stats } = installProcessHandlers(target, {
      logger,
      exit,
      exitOnException: false,
    });

    target.emit('uncaughtException', new Error('test-mode'));
    expect(stats.uncaughtExceptions).toBe(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it('swallows exit() itself throwing (shouldn\'t ever happen but defensive)', () => {
    const target = new EventEmitter();
    const logger = makeLogger();
    const exit = jest.fn(() => { throw new Error('exit-failed'); });

    installProcessHandlers(target, { logger, exit });
    expect(() => target.emit('uncaughtException', new Error('x'))).not.toThrow();
  });
});

describe('installProcessHandlers — warning', () => {
  it('logs first occurrence of each warning type only', () => {
    const target = new EventEmitter();
    const logger = makeLogger();
    const { stats } = installProcessHandlers(target, { logger, exit: jest.fn() });

    target.emit('warning', { name: 'MaxListenersExceededWarning', message: 'one' });
    target.emit('warning', { name: 'MaxListenersExceededWarning', message: 'two' });
    target.emit('warning', { name: 'DeprecationWarning', message: 'three' });

    // 2 distinct warning names logged, duplicates suppressed.
    expect(stats.warnings).toBe(2);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('defaults unnamed warning to "Warning"', () => {
    const target = new EventEmitter();
    const logger = makeLogger();
    const { stats } = installProcessHandlers(target, { logger, exit: jest.fn() });

    target.emit('warning', { message: 'anon' });
    target.emit('warning', { message: 'still anon' });
    expect(stats.warnings).toBe(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe('installProcessHandlers — uninstall', () => {
  it('removes all listeners so the target is quiet again', () => {
    const target = new EventEmitter();
    const logger = makeLogger();
    const handle = installProcessHandlers(target, { logger, exit: jest.fn() });

    expect(target.listenerCount('unhandledRejection')).toBe(1);
    expect(target.listenerCount('uncaughtException')).toBe(1);
    expect(target.listenerCount('warning')).toBe(1);

    handle.uninstall();

    expect(target.listenerCount('unhandledRejection')).toBe(0);
    expect(target.listenerCount('uncaughtException')).toBe(0);
    expect(target.listenerCount('warning')).toBe(0);

    // Subsequent events should not mutate stats.
    target.emit('unhandledRejection', 'post-uninstall');
    expect(handle.stats.unhandledRejections).toBe(0);
  });

  it('can install again after uninstall (idempotent pattern)', () => {
    const target = new EventEmitter();
    const logger = makeLogger();
    const first = installProcessHandlers(target, { logger, exit: jest.fn() });
    first.uninstall();
    const second = installProcessHandlers(target, { logger, exit: jest.fn() });

    target.emit('unhandledRejection', 'x');
    expect(second.stats.unhandledRejections).toBe(1);
    expect(first.stats.unhandledRejections).toBe(0);
  });
});
