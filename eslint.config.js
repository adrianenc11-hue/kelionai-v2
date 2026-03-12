module.exports = [
    {
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: {
                require: "readonly", module: "readonly", exports: "readonly",
                process: "readonly", console: "readonly", __dirname: "readonly",
                __filename: "readonly", Buffer: "readonly", setTimeout: "readonly",
                setInterval: "readonly", clearInterval: "readonly", clearTimeout: "readonly",
                URL: "readonly", fetch: "readonly", FormData: "readonly",
                AbortController: "readonly", ReadableStream: "readonly",
                TextDecoder: "readonly", TextEncoder: "readonly",
                describe: "readonly", test: "readonly", expect: "readonly",
                beforeEach: "readonly", afterEach: "readonly", beforeAll: "readonly",
                afterAll: "readonly", jest: "readonly", it: "readonly"
            }
        },
        rules: {
            "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_", "destructuredArrayIgnorePattern": "^_" }],
            "no-empty": "warn",
            "no-unreachable": "error",
            "eqeqeq": "warn",
            "no-var": "warn",
            "prefer-const": "warn",
            "no-eval": "error",
            "no-throw-literal": "warn"
        }
    }
];
