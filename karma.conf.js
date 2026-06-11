const fs = require('fs');
const path = require('path');

// Dev-only middleware: when running with UPDATE_CONTROLS=1, the spec POSTs each
// freshly-rendered image here and we overwrite the matching control-image file.
// The browser can't write files itself, so it round-trips through the karma server.
// IMPORTANT: control images are environment-specific (OS font rasterization, DPR),
// so only regenerate them in the same environment that runs the suite in CI.
function controlUpdaterMiddleware() {
    return function (request, response, next) {
        if (request.method !== 'POST' || request.url !== '/__update_control__') {
            return next();
        }

        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
            try {
                const payload = JSON.parse(body);
                const rel = String(payload.path || '').replace(/\\/g, '/');
                if (!rel || rel.indexOf('..') !== -1 || rel.startsWith('/')) {
                    throw new Error('refusing unsafe control path: ' + rel);
                }
                const target = path.join(
                    path.dirname(__filename),
                    'spec',
                    'resources',
                    rel
                );
                fs.writeFileSync(target, payload.data, 'utf8');
                response.writeHead(200, { 'Content-Type': 'text/plain' });
                response.end('updated ' + rel);
            } catch (e) {
                response.writeHead(500, { 'Content-Type': 'text/plain' });
                response.end('error: ' + e.message);
            }
        });
    };
}

module.exports = function (config) {
    const updateControls = !!process.env.UPDATE_CONTROLS;
    // LOGIC_ONLY skips the OS-font-dependent `compareToControlImage` image tests (tagged
    // with the spec's `itImage` helper) so the OS-robust logic subset can run anywhere —
    // notably in CI. The full suite (default) stays the local/WSL gate.
    const logicOnly = !!process.env.LOGIC_ONLY;
    // Run Chrome headless on display-less hosts (CI). GitHub Actions sets CI=true.
    const headless = !!process.env.HEADLESS || !!process.env.CI;
    // Browser to run: `chrome` (default) or `firefox`. See customLaunchers below.
    // Namespaced (not `BROWSER`, which WSL/Linux desktops set to the default web
    // browser, e.g. `wslview`, and would otherwise be picked up here).
    const browser = process.env.KARMA_BROWSER || 'chrome';
    // Device-pixel-ratio for the browser. Pinned to 1 by default so renders match the
    // static reference images regardless of the host's display scaling. Override for
    // ad-hoc high-DPI / fractional-DPR verification, e.g. `DPR=1.25 npm test` (the
    // image-comparison tests will then differ from the 1x controls — regenerate with
    // UPDATE_CONTROLS=1 at that DPR if you intend to re-baseline).
    const deviceScaleFactor = process.env.DPR || '1';
    // Run only the tests whose full Mocha title (describe + it) matches this
    // substring/regex, e.g. `GREP=border npm run test:chrome` for one group, or a
    // single test by its exact name. Empty (default) runs everything.
    const grep = process.env.GREP || '';

    config.set({
        basePath: '',
        frameworks: ['mocha', 'chai'],
        concurrency: 1,

        files: [
            {
                pattern: 'spec/resources/**/*',
                included: false,
                served: true,
            },
            {
                pattern: 'test-lib/fontawesome/webfonts/*.*',
                included: false,
                served: true,
            },
            {
                pattern: 'test-lib/fontawesome/css/*.*',
                included: false,
                served: true,
            },

            'test-lib/tesseract-4.0.2.min.js',

            'src/dom-to-image-more.js',
            'spec/dom-to-image-more.spec.js',
        ],

        exclude: [],
        preprocessors: {},
        reporters: ['mocha'],
        port: 9876,
        colors: true,
        logLevel: config.LOG_INFO,
        client: {
            captureConsole: true,
            // Tells the spec to POST renders to the updater middleware instead
            // of asserting against the existing control images.
            updateControls: updateControls,
            // Tells the spec's `itImage` helper to skip image-comparison tests.
            logicOnly: logicOnly,
            // Mocha options; `grep` (from GREP env) runs only matching tests.
            mocha: grep ? { grep: grep } : {},
        },

        // Register the updater plugin, but only insert it into the request
        // pipeline when UPDATE_CONTROLS=1 (beforeMiddleware runs ahead of karma's
        // file server so our POST route isn't treated as a missing file).
        plugins: [
            'karma-*',
            { 'middleware:control-updater': ['factory', controlUpdaterMiddleware] },
        ],
        beforeMiddleware: updateControls ? ['control-updater'] : [],
        autoWatch: true,
        // Which browser to run, `chrome` (default) or `firefox`. Chrome bakes the
        // control images, so Firefox should run only the OS-robust subset (pair with
        // LOGIC_ONLY=1 — image tests would otherwise diff against Chrome's renders).
        // Firefox also exercises the library's `cssText` fast-path (Chrome uses the
        // sandbox-diff path), so it's a genuine second-engine check.
        browsers: [browser],
        customLaunchers: {
            chrome: {
                base: 'Chrome',
                // Pin the viewport and device-pixel-ratio so renders match the
                // static reference images regardless of the host's display scaling.
                flags: [
                    '--no-sandbox',
                    '--window-size=1024,768',
                    `--force-device-scale-factor=${deviceScaleFactor}`,
                    '--high-dpi-support=1',
                ].concat(headless ? ['--headless=new', '--disable-gpu'] : []),
                debug: true,
            },
            firefox: {
                base: headless ? 'FirefoxHeadless' : 'Firefox',
            },
        },

        singleRun: false,
        browserNoActivityTimeout: 60000,
    });
};
