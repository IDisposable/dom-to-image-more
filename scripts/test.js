#!/usr/bin/env node
'use strict';

// Test runner wrapper so a positional argument becomes the Mocha title filter,
// e.g. `npm run test border` (or `npm run test -- border`) runs only tests whose
// describe/it title matches "border". With no argument it runs the full suite.
// Browser/headless/logic selection still come from env vars (KARMA_BROWSER,
// HEADLESS, LOGIC_ONLY, DPR, UPDATE_CONTROLS); GREP set here composes with them.

const path = require('path');
const { spawnSync } = require('child_process');

// Everything after the script name is the pattern (joined so multi-word
// patterns like `render web fonts` work without quoting under npm).
const pattern = process.argv.slice(2).join(' ').trim();

const env = Object.assign({}, process.env);
if (pattern) {
    env.GREP = pattern;
}

const grunt = path.join(__dirname, '..', 'node_modules', 'grunt-cli', 'bin', 'grunt');
const result = spawnSync(process.execPath, [grunt, 'test'], {
    stdio: 'inherit',
    env: env,
});

if (result.error) {
    console.error(result.error.message);
    process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
