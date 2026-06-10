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
];
