'use strict';

// SSR smoke test (issue #83): under a server-side / no-DOM environment (Angular
// Universal, Next.js, plain Node) the library must
//   1. import without throwing, and
//   2. reject a render call with a clear, catchable Error rather than a raw
//      ReferenceError ("window is not defined") deep in the pipeline.
// Run with `npm run test:node` (no browser, no karma).

const assert = require('assert');

let domtoimage;
try {
    domtoimage = require('../src/dom-to-image-more.js');
} catch (e) {
    console.error('FAIL: importing the library threw under Node:', e.message);
    process.exit(1);
}

assert.strictEqual(
    typeof domtoimage.toPng,
    'function',
    'toPng should be exported after a no-DOM import'
);

domtoimage
    .toPng({})
    .then(function () {
        console.error('FAIL: toPng resolved without a DOM (expected a rejection)');
        process.exit(1);
    })
    .catch(function (e) {
        assert.ok(
            e instanceof Error,
            'rejection should be an Error, got: ' + Object.prototype.toString.call(e)
        );
        assert.ok(
            /DOM is required/i.test(e.message),
            'expected a clear no-DOM message, got: ' + e.message
        );
        console.log('PASS: SSR import + clean no-DOM rejection (#83)');
    });
