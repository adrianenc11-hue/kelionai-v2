module.exports = {
    ci: {
        collect: {
            url: ['http://localhost:3000/'],
            startServerCommand: 'node server/index.js',
            startServerReadyPattern: 'on port',
            startServerReadyTimeout: 30000,
            numberOfRuns: 1,
            settings: {
                chromeFlags: '--no-sandbox --disable-gpu --ignore-certificate-errors',
            },
        },
        assert: {
            assertions: {
                'categories:performance': ['warn', { minScore: 0.7 }],
                'categories:accessibility': ['error', { minScore: 0.9 }],
                'categories:best-practices': ['warn', { minScore: 0.8 }],
                'categories:seo': ['warn', { minScore: 0.8 }],
            },
        },
        upload: {
            target: 'temporary-public-storage',
        },
    },
};
