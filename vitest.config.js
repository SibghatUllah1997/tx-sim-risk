"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("vitest/config");
exports.default = (0, config_1.defineConfig)({
    test: {
        include: ['tests/**/*.test.ts'],
        globals: true,
        environment: 'node',
        coverage: {
            enabled: true,
            provider: 'v8',
            reporter: ['text', 'lcov', 'html'],
            reportsDirectory: './coverage',
            all: true,
            include: ['src/**/*.ts'],
            exclude: ['**/*.d.ts', 'src/cli.ts'],
            thresholds: {
                lines: 90,
                functions: 90,
                branches: 0,
                statements: 0,
            },
        },
    },
});
