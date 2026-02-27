'use strict';

const { buildSystemPrompt } = require('../server/persona');

describe('buildSystemPrompt', () => {
    test('returns a non-empty string', () => {
        const prompt = buildSystemPrompt('kelion', 'en', '', null, false);
        expect(typeof prompt).toBe('string');
        expect(prompt.length).toBeGreaterThan(0);
    });

    test('includes avatar name for kelion', () => {
        const prompt = buildSystemPrompt('kelion', 'en', '', null, false);
        expect(prompt.toLowerCase()).toContain('kelion');
    });

    test('includes avatar name for kira', () => {
        const prompt = buildSystemPrompt('kira', 'en', '', null, false);
        expect(prompt.toLowerCase()).toContain('kira');
    });

    test('supports multiple languages', () => {
        const languages = ['ro', 'en', 'es', 'fr', 'de', 'it'];
        for (const lang of languages) {
            const prompt = buildSystemPrompt('kelion', lang, '', null, false);
            expect(typeof prompt).toBe('string');
            expect(prompt.length).toBeGreaterThan(0);
        }
    });

    test('handles unknown language gracefully', () => {
        const prompt = buildSystemPrompt('kelion', 'xx', '', null, false);
        expect(typeof prompt).toBe('string');
        expect(prompt.length).toBeGreaterThan(0);
    });

    test('includes memory context when provided', () => {
        const memory = 'User is a programmer';
        const prompt = buildSystemPrompt('kelion', 'en', memory, null, false);
        expect(prompt).toContain(memory);
    });

    test('includes HUMOR_IQ section', () => {
        const prompt = buildSystemPrompt('kelion', 'ro', '', null, false);
        expect(prompt).toContain('INTELIGENȚĂ UMORISTICĂ');
    });

    test('includes TEMPORAL_AWARENESS section', () => {
        const prompt = buildSystemPrompt('kelion', 'ro', '', null, false);
        expect(prompt).toContain('AWARENESS TEMPORAL');
    });

    test('includes CURIOSITY section', () => {
        const prompt = buildSystemPrompt('kelion', 'ro', '', null, false);
        expect(prompt).toContain('CURIOZITATE NATURALĂ');
    });

    test('injects current time context', () => {
        const prompt = buildSystemPrompt('kelion', 'ro', '', null, false);
        expect(prompt).toContain('ACUM:');
    });

    test('Kelion persona has catchphrases', () => {
        const prompt = buildSystemPrompt('kelion', 'ro', '', null, false);
        expect(prompt).toContain('CATCHPHRASES');
    });

    test('Kira persona has catchphrases', () => {
        const prompt = buildSystemPrompt('kira', 'ro', '', null, false);
        expect(prompt).toContain('CATCHPHRASES');
    });

    test('includes variability rules', () => {
        const prompt = buildSystemPrompt('kelion', 'ro', '', null, false);
        expect(prompt).toContain('VARIABIL');
    });
});
