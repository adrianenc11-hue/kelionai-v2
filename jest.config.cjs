// Root Jest config — ensures `npx jest` from the project root picks up the
// same exclusions that server/package.json defines for `cd server && jest`.
module.exports = {
  testPathIgnorePatterns: [
    '/node_modules/',
    '__tests__/helpers/',   // helper modules, not test files
    '/e2e/',                // Playwright tests — run via `npx playwright test`
  ],
};
