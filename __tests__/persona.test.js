'use strict';

const { buildSystemPrompt } = require('../server/persona');

describe('buildSystemPrompt()', () => {
    test('returns a non-empty string', () => {
        const prompt = buildSystemPrompt('kelion', 'ro', null, null, null);
        expect(typeof prompt).toBe('string');
        expect(prompt.length).toBeGreaterThan(0);
    });

    test('includes kelion avatar name when avatar is kelion', () => {
        const prompt = buildSystemPrompt('kelion', 'ro', null, null, null);
        expect(prompt.toLowerCase()).toContain('kelion');
    });

    test('includes kira avatar name when avatar is kira', () => {
        const prompt = buildSystemPrompt('kira', 'ro', null, null, null);
        expect(prompt.toLowerCase()).toContain('kira');
    });

    test('includes English language context when language is en', () => {
        const prompt = buildSystemPrompt('kelion', 'en', null, null, null);
        expect(prompt).toContain('English');
    });

    test('includes Romanian language context when language is ro', () => {
        const prompt = buildSystemPrompt('kelion', 'ro', null, null, null);
        expect(prompt).toContain('română');
    });

    test('works without optional arguments', () => {
        expect(() => buildSystemPrompt('kelion', 'ro')).not.toThrow();
    });

    test('incorporates memory when provided', () => {
        const memory = 'User likes hiking';
        const prompt = buildSystemPrompt('kelion', 'en', memory, null, null);
        expect(prompt).toContain(memory);
    });
});
