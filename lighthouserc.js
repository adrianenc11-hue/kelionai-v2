module.exports = {
    ci: {
        collect: {
            // LIVE ONLY — scan direct pe producție
            url: ['https://kelionai.app/'],
            // NU porni server local — folosim site-ul live
            numberOfRuns: 3,
            settings: {
                chromeFlags: '--no-sandbox --disable-gpu --headless=new',
                // Throttling mai generos pentru producție
                throttling: {
                    cpuSlowdownMultiplier: 1,
                },
            },
        },
        assert: {
            assertions: {
                'categories:performance': ['warn', { minScore: 0.6 }],
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
