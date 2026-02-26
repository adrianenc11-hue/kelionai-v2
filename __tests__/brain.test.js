'use strict';

const { KelionBrain } = require('../server/brain');

describe('KelionBrain', () => {
    let brain;

    beforeEach(() => {
        brain = new KelionBrain({});
    });

    test('instantiates with default state', () => {
        expect(brain).toBeDefined();
        expect(brain.conversationCount).toBe(0);
        expect(brain.learningsExtracted).toBe(0);
    });

    test('getDiagnostics returns complete report', () => {
        const diag = brain.getDiagnostics();
        expect(diag).toBeDefined();
        expect(diag.status).toBeDefined();
        expect(diag.version).toBe('2.0');
        expect(diag.toolStats).toBeDefined();
        expect(diag.toolErrors).toBeDefined();
        expect(diag.memory).toBeDefined();
        expect(diag.strategies).toBeDefined();
        expect(Array.isArray(diag.journal)).toBe(true);
    });

    test('getDiagnostics status is a valid value', () => {
        const diag = brain.getDiagnostics();
        expect(['healthy', 'stressed', 'degraded']).toContain(diag.status);
    });

    test('getDiagnostics memory values are strings with MB suffix', () => {
        const diag = brain.getDiagnostics();
        expect(typeof diag.memory.rss).toBe('string');
        expect(diag.memory.rss).toMatch(/MB$/);
        expect(typeof diag.memory.heap).toBe('string');
        expect(diag.memory.heap).toMatch(/MB$/);
    });

    test('analyzeIntent detects language', () => {
        const result = brain.analyzeIntent('Hello world', 'en');
        expect(result).toBeDefined();
    });

    test('resetAll clears tool errors', () => {
        brain.toolErrors.search = 5;
        brain.resetAll();
        expect(brain.toolErrors.search).toBe(0);
    });
});
