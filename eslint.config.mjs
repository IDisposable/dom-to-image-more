import globals from 'globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
});

export default [
    ...compat.extends('eslint:recommended'),
    {
        languageOptions: {
            globals: {
                ...globals.browser,
            },

            ecmaVersion: 'latest',
            sourceType: 'module',
        },

        rules: {
            // Formatting (indent, quotes, semi, linebreak-style, etc.) is owned
            // by Prettier and verified via `prettier --check` in the lint script.
            'no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                },
            ],
        },
    },
    {
        // Build/test config files run in Node (CommonJS), not the browser, so
        // they need Node globals (require, module, process, __dirname, …) and the
        // CommonJS source type instead of the browser/ESM defaults above.
        files: ['karma.conf.js', 'Gruntfile.js'],
        languageOptions: {
            globals: {
                ...globals.node,
            },
            sourceType: 'commonjs',
        },
    },
];
