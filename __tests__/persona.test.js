'use strict';

const { buildSystemPrompt, TRUTH_ENGINE } = require('../server/persona');

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
        expect(prompt).toContain('NOW:');
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

describe('TRUTH_ENGINE', () => {
    test('TRUTH_ENGINE appears first in prompt before persona text', () => {
        const prompt = buildSystemPrompt('kelion', 'ro', '', null, false);
        const truthIndex = prompt.indexOf('MOTORUL ADEVĂRULUI');
        const kelionIndex = prompt.indexOf('Ești Kelion');
        expect(truthIndex).toBeGreaterThanOrEqual(0);
        expect(kelionIndex).toBeGreaterThanOrEqual(0);
        expect(truthIndex).toBeLessThan(kelionIndex);
    });

    test('TRUTH_ENGINE appears first in kira prompt before persona text', () => {
        const prompt = buildSystemPrompt('kira', 'ro', '', null, false);
        const truthIndex = prompt.indexOf('MOTORUL ADEVĂRULUI');
        const kiraIndex = prompt.indexOf('Ești Kira');
        expect(truthIndex).toBeGreaterThanOrEqual(0);
        expect(kiraIndex).toBeGreaterThanOrEqual(0);
        expect(truthIndex).toBeLessThan(kiraIndex);
    });

    test('contains NENEGOCIABIL', () => {
        const prompt = buildSystemPrompt('kelion', 'ro', '', null, false);
        expect(prompt).toContain('NENEGOCIABIL');
    });

    test('contains EXCLUDEREA MINCIUNII', () => {
        const prompt = buildSystemPrompt('kelion', 'ro', '', null, false);
        expect(prompt).toContain('EXCLUDEREA MINCIUNII');
    });

    test('contains EXCLUDEREA RAPORTĂRII FALSE', () => {
        const prompt = buildSystemPrompt('kelion', 'ro', '', null, false);
        expect(prompt).toContain('EXCLUDEREA RAPORTĂRII FALSE');
    });

    test('contains ADEVĂR 100%', () => {
        const prompt = buildSystemPrompt('kelion', 'ro', '', null, false);
        expect(prompt).toContain('ADEVĂR 100%');
    });

    test('contains ETICHETARE OBLIGATORIE', () => {
        const prompt = buildSystemPrompt('kelion', 'ro', '', null, false);
        expect(prompt).toContain('ETICHETARE OBLIGATORIE');
    });

    test('contains REGULA SUPREMĂ', () => {
        const prompt = buildSystemPrompt('kelion', 'ro', '', null, false);
        expect(prompt).toContain('REGULA SUPREMĂ');
    });

    test('TRUTH_ENGINE constant contains expected sections', () => {
        expect(TRUTH_ENGINE).toContain('NENEGOCIABIL');
        expect(TRUTH_ENGINE).toContain('EXCLUDEREA MINCIUNII');
        expect(TRUTH_ENGINE).toContain('EXCLUDEREA RAPORTĂRII FALSE');
        expect(TRUTH_ENGINE).toContain('ADEVĂR 100%');
        expect(TRUTH_ENGINE).toContain('ETICHETARE OBLIGATORIE');
        expect(TRUTH_ENGINE).toContain('REGULA SUPREMĂ');
    });
});
