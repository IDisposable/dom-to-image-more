module.exports = function (config) {
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
        },
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
