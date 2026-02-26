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

    describe('detectBackground', () => {
        test('returns classroom for teaching keywords', () => {
            expect(brain.detectBackground('i want to learn a lesson')).toBe('classroom');
        });

        test('returns lab for science keywords', () => {
            expect(brain.detectBackground('let us do a chemistry experiment')).toBe('lab');
        });

        test('returns office for code keywords', () => {
            expect(brain.detectBackground('help me debug this function')).toBe('office');
        });

        test('returns kitchen for food keywords', () => {
            expect(brain.detectBackground('show me a recipe to cook')).toBe('kitchen');
        });

        test('returns gym for workout keywords', () => {
            expect(brain.detectBackground('my workout at the gym')).toBe('gym');
        });

        test('returns zen for relax keywords', () => {
            expect(brain.detectBackground('i need to relax and breathe')).toBe('zen');
        });

        test('returns corporate for business keywords', () => {
            expect(brain.detectBackground('corporate meeting with the team')).toBe('corporate');
        });

        test('returns music for music keywords', () => {
            expect(brain.detectBackground('play a song from my playlist')).toBe('music');
        });

        test('returns travel for travel keywords', () => {
            expect(brain.detectBackground('i want to travel to a new city')).toBe('travel');
        });

        test('returns night for sleep keywords', () => {
            expect(brain.detectBackground('tell me a story before sleep')).toBe('night');
        });

        test('returns null for unrelated messages', () => {
            expect(brain.detectBackground('hello how are you')).toBeNull();
        });
    });

    test('resetAll clears tool errors', () => {
        brain.toolErrors.search = 5;
        brain.resetAll();
        expect(brain.toolErrors.search).toBe(0);
    });

    describe('refineSearchQuery', () => {
        test('removes filler words from queries', () => {
            const result = brain.refineSearchQuery('te rog spune-mi despre quantum computing');
            expect(result).not.toContain('te rog');
            expect(result).toContain('quantum');
        });

        test('returns original query when all words are filler', () => {
            const result = brain.refineSearchQuery('te rog');
            expect(result).toBe('te rog');
        });

        test('truncates very long queries', () => {
            const longQ = 'tell me everything you know about the history of artificial intelligence from the very beginning until now including all major milestones';
            const result = brain.refineSearchQuery(longQ);
            expect(result.split(' ').length).toBeLessThanOrEqual(8);
        });
    });
});
