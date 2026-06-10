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
        browsers: ['chrome'],
        customLaunchers: {
            chrome: {
                base: 'Chrome',
                // Pin the viewport and device-pixel-ratio so renders match the
                // static reference images regardless of the host's display scaling.
                flags: [
                    '--no-sandbox',
                    '--window-size=1024,768',
                    '--force-device-scale-factor=1',
                    '--high-dpi-support=1',
                ],
                debug: true,
            },
        },

        singleRun: false,
        browserNoActivityTimeout: 60000,
    });
};
