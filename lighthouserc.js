module.exports = {
    ci: {
        collect: {
            url: ['http://localhost:3000/'],
            startServerCommand: 'node server/index.js',
            startServerReadyPattern: 'on port',
            startServerReadyTimeout: 60000,
            numberOfRuns: 1,
            settings: {
                chromeFlags: '--no-sandbox --disable-gpu --disable-dev-shm-usage --ignore-certificate-errors --headless=new',
            },
        },
        assert: {
            assertions: {
                // TODO: CI performance is not representative of production; restore to 0.7 when stable
                'categories:performance': ['warn', { minScore: 0.5 }],
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
