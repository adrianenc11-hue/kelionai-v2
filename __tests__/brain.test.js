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

describe('analyzeIntent — Romanian search', () => {
    let brain;
    beforeEach(() => { brain = new KelionBrain({}); });

    test('detectează căutare: "caută informații despre Node.js"', () => {
        const r = brain.analyzeIntent('caută informații despre Node.js', 'ro');
        expect(r.needsSearch).toBe(true);
        expect(r.searchQuery.length).toBeGreaterThan(0);
    });

    test('detectează căutare: "ce este inteligența artificială?"', () => {
        const r = brain.analyzeIntent('ce este inteligența artificială?', 'ro');
        expect(r.needsSearch).toBe(true);
    });

    test('detectează căutare: "cât costă un iPhone 16?"', () => {
        const r = brain.analyzeIntent('cât costă un iPhone 16?', 'ro');
        expect(r.needsSearch).toBe(true);
    });
});

describe('analyzeIntent — Weather', () => {
    let brain;
    beforeEach(() => { brain = new KelionBrain({}); });

    test('detectează meteo cu oraș explicit: "cum e vremea în București?"', () => {
        const r = brain.analyzeIntent('cum e vremea în București?', 'ro');
        expect(r.needsWeather).toBe(true);
        expect(r.weatherCity).toBeTruthy();
    });

    test('detectează meteo fără oraș → default Bucharest', () => {
        const r = brain.analyzeIntent('e frig afară?', 'ro');
        expect(r.needsWeather).toBe(true);
        expect(r.weatherCity).toBe('Bucharest');
    });
});

describe('analyzeIntent — Image generation', () => {
    let brain;
    beforeEach(() => { brain = new KelionBrain({}); });

    test('detectează imagine: "generează o imagine cu un dragon"', () => {
        const r = brain.analyzeIntent('generează o imagine cu un dragon', 'ro');
        expect(r.needsImage).toBe(true);
    });

    test('NU declanșează imagine pentru text fără cuvânt trigger', () => {
        const r = brain.analyzeIntent('imaginea de pe ecran arată bine', 'ro');
        expect(r.needsImage).toBe(false);
    });
});

describe('analyzeIntent — Emotion detection', () => {
    let brain;
    beforeEach(() => { brain = new KelionBrain({}); });

    test('detectează tristețe', () => {
        const r = brain.analyzeIntent('sunt foarte trist azi', 'ro');
        expect(r.isEmotional).toBe(true);
        expect(r.emotionalTone).toBe('sad');
    });

    test('detectează furie', () => {
        const r = brain.analyzeIntent('sunt furios pe situație', 'ro');
        expect(r.isEmotional).toBe(true);
        expect(r.emotionalTone).toBe('angry');
    });

    test('detectează recunoștință', () => {
        const r = brain.analyzeIntent('mulțumesc mult!', 'ro');
        expect(r.isEmotional).toBe(true);
        expect(r.emotionalTone).toBe('grateful');
    });
});

describe('analyzeIntent — Emergency', () => {
    let brain;
    beforeEach(() => { brain = new KelionBrain({}); });

    test('detectează urgență: "ajutor! pericol!"', () => {
        const r = brain.analyzeIntent('ajutor! pericol!', 'ro');
        expect(r.isEmergency).toBe(true);
    });

    test('detectează urgență: "sună la 112"', () => {
        const r = brain.analyzeIntent('sună la 112', 'ro');
        expect(r.isEmergency).toBe(true);
    });
});

describe('analyzeIntent — False positives', () => {
    let brain;
    beforeEach(() => { brain = new KelionBrain({}); });

    test('salut simplu NU declanșează search', () => {
        const r = brain.analyzeIntent('bună ziua, ce mai faci?', 'ro');
        expect(r.needsSearch).toBe(false);
    });

    test('"ok" NU declanșează nimic', () => {
        const r = brain.analyzeIntent('ok', 'ro');
        expect(r.needsSearch).toBe(false);
        expect(r.needsWeather).toBe(false);
        expect(r.needsImage).toBe(false);
    });
});

describe('analyzeIntent — Complexity', () => {
    let brain;
    beforeEach(() => { brain = new KelionBrain({}); });

    test('"salut" → simple', () => {
        expect(brain.analyzeIntent('salut', 'ro').complexity).toBe('simple');
    });

    test('request multi-tool → complex', () => {
        const r = brain.analyzeIntent('caută hoteluri în Paris și arată-mi vremea și generează o imagine cu Turnul Eiffel', 'ro');
        expect(r.complexity).toBe('complex');
    });
});

describe('analyzeIntent — Topics', () => {
    let brain;
    beforeEach(() => { brain = new KelionBrain({}); });

    test('detectează topic tech', () => {
        const r = brain.analyzeIntent('cum fac o aplicație în React?', 'ro');
        expect(r.topics).toContain('tech');
    });

    test('detectează topic travel', () => {
        const r = brain.analyzeIntent('vreau să călătoresc în Italia', 'ro');
        expect(r.topics).toContain('travel');
    });
});

describe('compressHistory', () => {
    let brain;
    beforeEach(() => { brain = new KelionBrain({}); });

    test('returnează array gol pentru history gol', () => {
        expect(brain.compressHistory([], null)).toEqual([]);
    });

    test('returnează history neschimbat dacă <= 20 mesaje', () => {
        const hist = Array.from({ length: 10 }, (_, i) => ({ role: 'user', content: `msg ${i}` }));
        const result = brain.compressHistory(hist, null);
        expect(result).toHaveLength(10);
    });

    test('comprimă history lung > 20 mesaje', () => {
        const hist = Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: `mesaj ${i}?` }));
        const result = brain.compressHistory(hist, 'conv-test-1');
        expect(result.length).toBeLessThan(30);
    });
});

describe('buildPlan', () => {
    let brain;
    beforeEach(() => { brain = new KelionBrain({}); });

    test('plan gol pentru mesaj simplu', () => {
        const analysis = brain.analyzeIntent('salut', 'ro');
        const plan = brain.buildPlan([{ analysis }], null);
        expect(plan).toHaveLength(0);
    });

    test('plan cu search pentru query de căutare', () => {
        const analysis = brain.analyzeIntent('caută informații despre Python', 'ro');
        const plan = brain.buildPlan([{ analysis }], null);
        expect(plan.some(p => p.tool === 'search')).toBe(true);
    });

    test('plan cu weather pentru query meteo', () => {
        const analysis = brain.analyzeIntent('cum e vremea în Cluj?', 'ro');
        const plan = brain.buildPlan([{ analysis }], null);
        expect(plan.some(p => p.tool === 'weather')).toBe(true);
    });
});

describe('refineSearchQuery', () => {
    let brain;
    beforeEach(() => { brain = new KelionBrain({}); });

    test('elimină filler words din query', () => {
        const refined = brain.refineSearchQuery('te rog spune-mi despre Python');
        expect(refined).not.toContain('te rog');
    });

    test('trunchiază query lung la 8 cuvinte', () => {
        const longQuery = 'un doi trei patru cinci sase sapte opt noua zece unsprezece doisprezece treisprezece paisprezece cincisprezece';
        const refined = brain.refineSearchQuery(longQuery);
        expect(refined.split(' ').length).toBeLessThanOrEqual(8);
    });

    test('returnează originalul dacă devine gol după cleanup', () => {
        const original = 'test query valid';
        expect(brain.refineSearchQuery(original)).toBe(original);
    });
});

describe('journalEntry', () => {
    let brain;
    beforeEach(() => { brain = new KelionBrain({}); });

    test('adaugă intrare în journal', () => {
        const initialLength = brain.journal.length;
        brain.journalEntry('test_event', 'test lesson', { extra: 'data' });
        expect(brain.journal.length).toBe(initialLength + 1);
        const last = brain.journal[brain.journal.length - 1];
        expect(last.event).toBe('test_event');
        expect(last.lesson).toBe('test lesson');
    });
});

describe('recordError și isToolDegraded', () => {
    test('înregistrează erori și marchează tool ca degraded după 5', () => {
        const testBrain = new KelionBrain({});
        expect(testBrain.isToolDegraded('search')).toBe(false);
        for (let i = 0; i < 5; i++) testBrain.recordError('search', 'test error');
        expect(testBrain.isToolDegraded('search')).toBe(true);
    });

    test('resetTool curăță erorile', () => {
        const testBrain = new KelionBrain({});
        for (let i = 0; i < 5; i++) testBrain.recordError('search', 'test error');
        testBrain.resetTool('search');
        expect(testBrain.isToolDegraded('search')).toBe(false);
    });
});

describe('decomposeTask', () => {
    let brain;
    beforeEach(() => { brain = new KelionBrain({}); });

    test('descompune request cu "și" în 2+ subtask-uri', async () => {
        const analysis = brain.analyzeIntent('caută hoteluri și arată meteo', 'ro');
        analysis.complexity = 'complex';
        const tasks = await brain.decomposeTask('caută hoteluri și arată meteo', analysis, 'ro');
        expect(tasks.length).toBeGreaterThanOrEqual(2);
    });

    test('mesaj simplu rămâne 1 task', async () => {
        const analysis = brain.analyzeIntent('salut', 'ro');
        const tasks = await brain.decomposeTask('salut', analysis, 'ro');
        expect(tasks.length).toBe(1);
    });
});
