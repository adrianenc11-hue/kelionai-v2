module.exports = {
    ci: {
          collect: {
                  url: ['https://kelionai.app/'],
                  numberOfRuns: 3,
          },
          assert: {
                  assertions: {
                            'categories:performance': ['warn', { minScore: 0.6 }],
                            'categories:accessibility': ['error', { minScore: 0.7 }],
                            'categories:best-practices': ['warn', { minScore: 0.7 }],
                            'categories:seo': ['warn', { minScore: 0.7 }],
                  },
          },
          upload: {
                  target: 'temporary-public-storage',
          },
    },
};
