'use strict';

const { KelionBrain } = require('../server/brain');

describe('KelionBrain', () => {
    let brain;

    beforeEach(() => {
        brain = new KelionBrain({});
    });

    describe('constructor', () => {
        test('initializes with zero conversation count', () => {
            expect(brain.conversationCount).toBe(0);
        });

        test('initializes tool stats', () => {
            expect(brain.toolStats).toBeDefined();
            expect(typeof brain.toolStats).toBe('object');
        });

        test('initializes error log as empty array', () => {
            expect(brain.errorLog).toEqual([]);
        });
    });

    describe('getDiagnostics()', () => {
        test('returns an object with status field', () => {
            const diag = brain.getDiagnostics();
            expect(diag).toHaveProperty('status');
        });

        test('returns version 2.0', () => {
            const diag = brain.getDiagnostics();
            expect(diag.version).toBe('2.0');
        });

        test('returns healthy status with no errors', () => {
            const diag = brain.getDiagnostics();
            expect(diag.status).toBe('healthy');
        });

        test('returns conversations count', () => {
            const diag = brain.getDiagnostics();
            expect(diag).toHaveProperty('conversations');
            expect(typeof diag.conversations).toBe('number');
        });

        test('returns uptime as a number', () => {
            const diag = brain.getDiagnostics();
            expect(typeof diag.uptime).toBe('number');
            expect(diag.uptime).toBeGreaterThanOrEqual(0);
        });

        test('returns memory usage info', () => {
            const diag = brain.getDiagnostics();
            expect(diag.memory).toHaveProperty('rss');
            expect(diag.memory).toHaveProperty('heap');
        });
    });

    describe('analyzeIntent()', () => {
        test('detects weather query in Romanian', () => {
            const result = brain.analyzeIntent('cum e vremea in Bucuresti?', 'ro');
            expect(result.needsWeather).toBe(true);
        });

        test('detects weather query in English', () => {
            const result = brain.analyzeIntent('what is the weather forecast today?', 'en');
            expect(result.needsWeather).toBe(true);
        });

        test('detects search query in Romanian', () => {
            const result = brain.analyzeIntent('cauta informatii despre Node.js', 'ro');
            expect(result.needsSearch).toBe(true);
        });

        test('detects search query in English', () => {
            const result = brain.analyzeIntent('what is artificial intelligence?', 'en');
            expect(result.needsSearch).toBe(true);
        });

        test('detects image generation request', () => {
            const result = brain.analyzeIntent('genereaza o imagine cu un peisaj de munte', 'ro');
            expect(result.needsImage).toBe(true);
        });

        test('returns simple complexity for a greeting', () => {
            const result = brain.analyzeIntent('salut!', 'ro');
            expect(result.complexity).toBe('simple');
        });

        test('returns result with language field', () => {
            const result = brain.analyzeIntent('hello', 'en');
            expect(result.language).toBe('en');
        });

        test('result always has required fields', () => {
            const result = brain.analyzeIntent('test message', 'ro');
            expect(result).toHaveProperty('needsSearch');
            expect(result).toHaveProperty('needsWeather');
            expect(result).toHaveProperty('needsImage');
            expect(result).toHaveProperty('complexity');
            expect(result).toHaveProperty('emotionalTone');
        });
    });

    describe('resetTool()', () => {
        test('resets error count for a specific tool', () => {
            brain.toolErrors.search = 10;
            brain.resetTool('search');
            expect(brain.toolErrors.search).toBe(0);
        });
    });

    describe('resetAll()', () => {
        test('resets all tool error counts', () => {
            brain.toolErrors.search = 5;
            brain.toolErrors.weather = 3;
            brain.resetAll();
            expect(brain.toolErrors.search).toBe(0);
            expect(brain.toolErrors.weather).toBe(0);
        });
    });
});
