/* eslint-disable no-undef */
(function (global) {
    'use strict';

    const assert = global.chai.assert;
    const domtoimage = global.domtoimage;
    const Promise = global.Promise;
    const Tesseract = global.Tesseract;
    const BASE_URL = '/base/spec/resources/';
    const validPlaceholder =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAMSURBVBhXY7h79y4ABTICmGnXPbMAAAAASUVORK5CYII=';

    // When the suite is launched with UPDATE_CONTROLS=1 the karma config sets this
    // flag; instead of asserting against the stored control images, the comparison
    // helpers POST each freshly-rendered image back to the karma updater middleware,
    // which overwrites the matching control-image file. Run it in the SAME
    // environment that validates the suite in CI (font rasterization/DPR differ).
    const UPDATE_CONTROLS = !!(
        global.__karma__ &&
        global.__karma__.config &&
        global.__karma__.config.updateControls
    );
    // Tests that compare a render against a stored control image are OS-font-dependent
    // (ClearType vs FreeType, etc.), so they can't run cross-OS in CI. They are declared
    // with `itImage(...)` instead of `it(...)`; under LOGIC_ONLY the karma config sets
    // `logicOnly` and they're skipped, leaving the OS-robust logic subset to run anywhere.
    const LOGIC_ONLY = !!(
        global.__karma__ &&
        global.__karma__.config &&
        global.__karma__.config.logicOnly
    );
    function itImage(title, fn) {
        return (LOGIC_ONLY ? it.skip : it)(title, fn);
    }
    let currentControlPath = null;

    function writeControlImage(dataUrl) {
        if (!currentControlPath) {
            return Promise.reject(
                new Error('UPDATE_CONTROLS: no control-image path for this test')
            );
        }
        return fetch('/__update_control__', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: currentControlPath, data: dataUrl }),
        }).then(function (res) {
            if (!res.ok) {
                return res.text().then(function (text) {
                    throw new Error('control update failed: ' + text);
                });
            }
        });
    }

    describe('domtoimage', function () {
        afterEach(purgePage);

        it('should load', function () {
            assert.ok(domtoimage);
        });

        describe('features', function () {
            // #151: an element in a non-HTML/SVG/MathML namespace (created via
            // createElementNS) is a real Element but has no `.style` object, so the
            // style copy / image inliner threw "Cannot read properties of undefined".
            // Such nodes are now skipped for styling and still render.
            it('does not crash on a styleless foreign-namespace element (#151)', function (done) {
                loadTestPage()
                    .then(function () {
                        const foreign = document.createElementNS(
                            'http://example.com/ns',
                            'thing'
                        );
                        foreign.id = 'foreign';
                        foreign.textContent = 'x';
                        assert.isUndefined(
                            foreign.style,
                            'precondition: the foreign element has no .style'
                        );
                        domNode().appendChild(foreign);
                        return renderToSvg(domNode());
                    })
                    .then(function (svg) {
                        // Render resolves (no throw) and the node still appears.
                        assert.include(
                            decodeURIComponent(svg),
                            'id="foreign"',
                            'the styleless element should still be in the output'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            // #182: opt-in `pixelRatio` multiplies the rasterized canvas resolution
            // (composes with `scale`), for crisp high-DPI/Retina output.
            it('pixelRatio scales the output canvas resolution (#182)', function (done) {
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<div id="box" style="width:100px;height:50px;background:red"></div>';
                        return domtoimage.toCanvas(document.getElementById('box'), {
                            pixelRatio: 2,
                        });
                    })
                    .then(function (canvas) {
                        assert.equal(canvas.width, 200, '2x pixelRatio → 2x width');
                        assert.equal(canvas.height, 100, '2x pixelRatio → 2x height');
                    })
                    .then(done)
                    .catch(done);
            });

            // #182 / #159 / #160: a canvas past the browser size limit silently yields
            // a partial/blank bitmap. We now clamp the effective scale to fit and warn,
            // so an oversized capture degrades predictably instead of truncating.
            it('clamps an oversized canvas and warns (#182)', function (done) {
                const origWarn = console.warn;
                let warned = false;
                console.warn = function () {
                    warned = true;
                };
                function restore() {
                    console.warn = origWarn;
                }
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<div id="wide" style="width:17000px;height:20px;background:red"></div>';
                        return domtoimage.toCanvas(document.getElementById('wide'));
                    })
                    .then(function (canvas) {
                        restore();
                        assert.isAtMost(
                            canvas.width,
                            16384,
                            'canvas width must be clamped to the limit'
                        );
                        assert.isTrue(warned, 'an oversized canvas must warn');
                    })
                    .then(done)
                    .catch(function (e) {
                        restore();
                        done(e);
                    });
            });

            // #168: flex misalignment in exports was attributed to flexbox handling,
            // but it only reproduces at fractional devicePixelRatio (Windows 125% scale
            // or 125% browser zoom) — a sub-pixel re-snapping fidelity limit of the
            // SVG-foreignObject approach, not a dropped style. At DPR=1 the flex layout
            // is reproduced faithfully; this guards that the flex styles aren't dropped
            // and the cloned items lay out identically to the originals.
            it('reproduces a flex layout faithfully (#168)', function (done) {
                let liveWidths;
                let cloneWidths;
                loadTestPage()
                    .then(function () {
                        domNode().style.width = '201px';
                        domNode().innerHTML =
                            '<div id="flex" style="display:flex;gap:3px;justify-content:space-between;align-items:center">' +
                            '<div class="it" style="flex:1;height:20px;background:red"></div>' +
                            '<div class="it" style="flex:1;height:20px;background:green"></div>' +
                            '<div class="it" style="flex:1;height:20px;background:blue"></div>' +
                            '</div>';
                        liveWidths = measureItemWidths(domNode());
                        return domtoimage.toSvg(domNode(), {
                            onclone: function (clone) {
                                clone.style.position = 'absolute';
                                clone.style.left = '-9999px';
                                document.body.appendChild(clone);
                                cloneWidths = measureItemWidths(clone);
                                document.body.removeChild(clone);
                                clone.style.position = '';
                                clone.style.left = '';
                                return clone;
                            },
                        });
                    })
                    .then(function (svg) {
                        const flex = (decodeURIComponent(svg).match(
                            /<div id="flex"[^>]*>/
                        ) || [])[0];
                        assert.isString(flex, 'flex container should be present');
                        assert.match(
                            flex,
                            /display:\s*flex/,
                            'display:flex must be preserved'
                        );
                        assert.match(
                            flex,
                            /(column-)?gap:\s*3px/,
                            'gap must be preserved'
                        );
                        assert.match(
                            flex,
                            /justify-content:\s*space-between/,
                            'justify-content must be preserved'
                        );
                        // The clone's flex items must lay out exactly like the originals.
                        assert.deepEqual(
                            cloneWidths,
                            liveWidths,
                            'cloned flex items must match the live layout'
                        );
                    })
                    .then(done)
                    .catch(done);

                function measureItemWidths(root) {
                    return Array.prototype.map.call(
                        root.querySelectorAll('.it'),
                        function (el) {
                            return Math.round(el.getBoundingClientRect().width * 100);
                        }
                    );
                }
            });

            // #195: an SVG icon rendered on an element via a CSS mask
            // (`mask: url(icon.svg); background: currentColor`) came out blank because
            // the inliner only inlined `background`/`background-image`, leaving the mask
            // url external — and the standalone output can't fetch external resources.
            // The inliner now inlines mask urls too.
            it('inlines a CSS mask-image url (#195)', function (done) {
                this.timeout(15000);
                const url = '/base/spec/resources/images/image.png';
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<i id="maskicon" style="display:inline-block;width:20px;height:20px;' +
                            'background-color:red;-webkit-mask-image:url(' +
                            url +
                            ');mask-image:url(' +
                            url +
                            ')"></i>';
                        return renderToSvg(domNode());
                    })
                    .then(function (svg) {
                        const decoded = decodeURIComponent(svg);
                        const mask = (decoded.match(/<i id="maskicon"[^>]*>/) || [])[0];
                        assert.isString(mask, 'masked icon should be in the output');
                        assert.include(
                            mask,
                            'data:image',
                            'the mask url must be inlined as a data: URL'
                        );
                        assert.notInclude(
                            mask,
                            'image.png',
                            'the external mask url must not survive (unfetchable in the output)'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            // #149: an icon delivered as an `@font-face` glyph via a `::before`
            // pseudo-element. The composition works — the web font is embedded and the
            // pseudo-element's `content` glyph + font-family are captured. (The original
            // report's failure was an external icon font that couldn't be embedded —
            // the documented web-font/CORS limitation — not a distinct bug.)
            it('captures an icon-font glyph from a ::before pseudo-element (#149)', function (done) {
                this.timeout(15000);
                const style = document.createElement('style');
                style.id = 's149';
                style.textContent =
                    "@font-face { font-family: 'Ico149'; src: url('/base/test-lib/fontawesome/webfonts/fa-solid-900.woff2') format('woff2'); }" +
                    '#icon::before { content: "\\2605"; font-family: "Ico149"; font-size: 30px; }';
                document.head.appendChild(style);
                function cleanup() {
                    const el = document.getElementById('s149');
                    if (el) {
                        el.remove();
                    }
                }
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML = '<span id="icon"></span>';
                        return renderToSvg(domNode());
                    })
                    .then(function (svg) {
                        const decoded = decodeURIComponent(svg);
                        // The web font must be inlined...
                        assert.include(
                            decoded,
                            'base64',
                            'the @font-face glyph font must be embedded'
                        );
                        // ...and the pseudo-element must keep its glyph + font.
                        assert.include(
                            decoded,
                            'content: "★"',
                            'the ::before glyph content must be preserved'
                        );
                        assert.include(
                            decoded,
                            'Ico149',
                            'the icon font-family must reach the pseudo-element'
                        );
                    })
                    .then(cleanup)
                    .then(done)
                    .catch(function (e) {
                        cleanup();
                        done(e);
                    });
            });

            // #139: an SVG icon used via `<use xlink:href="#id">` referencing a
            // `<symbol>` defined OUTSIDE the rendered subtree (the Vue/webpack
            // svg-sprite pattern) was missing from the export. Closed by #215's
            // collect-and-inject (legacy xlink:href + currentColor preserved).
            it('renders an out-of-subtree icon-sprite <use xlink:href> (#139)', function (done) {
                loadTestPage()
                    .then(function () {
                        const sprite =
                            '<svg style="display:none" xmlns="http://www.w3.org/2000/svg">' +
                            '<symbol id="icon-star" viewBox="0 0 10 10">' +
                            '<path id="starpath" d="M5 0 L6 4 L10 4 L7 6 L8 10 L5 7 L2 10 L3 6 L0 4 L4 4 Z" fill="currentColor"></path>' +
                            '</symbol></svg>';
                        document
                            .querySelector('#test-root')
                            .insertAdjacentHTML('afterbegin', sprite);
                        domNode().innerHTML =
                            '<div style="color:red"><svg class="icon" width="20" height="20" xmlns="http://www.w3.org/2000/svg">' +
                            '<use xlink:href="#icon-star"></use></svg></div>';
                        return renderToSvg(domNode());
                    })
                    .then(function (svg) {
                        const decoded = decodeURIComponent(svg);
                        assert.include(
                            decoded,
                            'id="icon-star"',
                            'referenced symbol must be injected'
                        );
                        assert.include(
                            decoded,
                            'id="starpath"',
                            "the symbol's contents must be injected"
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            // ensureShown must reach the non-root SVG path too: a display:none <g> would
            // throw in getBBox and render blank otherwise (PR #230 review).
            it('ensureShown reveals a hidden non-root SVG element', function (done) {
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<svg width="50" height="50" xmlns="http://www.w3.org/2000/svg">' +
                            '<g id="hg" style="display:none">' +
                            '<rect x="0" y="0" width="20" height="15" fill="red"></rect>' +
                            '</g></svg>';
                        return domtoimage.toSvg(document.getElementById('hg'), {
                            ensureShown: true,
                        });
                    })
                    .then(function (svg) {
                        assert.match(
                            svg,
                            /<svg[^>]*\swidth="\d\d?"/,
                            'a revealed <g> must be measured (non-zero size), not blank'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            // #205: rendering a non-root SVG element (`<g>`, `<path>`, …) directly used
            // to reject — the bare element was wrapped in an XHTML <foreignObject> where
            // it can't render. It is now wrapped in a real <svg> framed by its getBBox,
            // so it rasterizes. Render the <g> and sample a pixel inside its red rect.
            it('renders a non-root SVG <g> element (#205)', function (done) {
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">' +
                            '<g id="grp" transform="translate(10,10)">' +
                            '<rect x="0" y="0" width="40" height="30" fill="rgb(255,0,0)"></rect>' +
                            '<circle cx="60" cy="20" r="15" fill="rgb(0,0,255)"></circle>' +
                            '</g></svg>';
                        return domtoimage.toPixelData(document.getElementById('grp'));
                    })
                    .then(function (pixels) {
                        assert.isAbove(
                            pixels.length,
                            0,
                            'should produce pixel data, not reject'
                        );
                        // bbox is 75x35; sample (5,5) which is inside the red rect.
                        const i = (5 * 75 + 5) * 4;
                        assert.isAbove(
                            pixels[i],
                            200,
                            'red channel at the rect should be high'
                        );
                        assert.isBelow(
                            pixels[i + 2],
                            80,
                            'blue channel at the rect should be low'
                        );
                        assert.isAbove(
                            pixels[i + 3],
                            200,
                            'pixel at the rect should be opaque'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            // #191: a CSS `url()` set via options.style (the browser normalizes it to
            // double quotes) was serialized inside the double-quoted style attribute as
            // `url(&quot;…&quot;)`. We now emit clean single-quoted `url('…')`.
            it('emits clean url() quotes for background-image (#191)', function (done) {
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML = '<div id="bg">x</div>';
                        return domtoimage.toSvg(document.getElementById('bg'), {
                            style: {
                                'background-image': "url('https://example.com/img.png')",
                            },
                        });
                    })
                    .then(function (svg) {
                        const bg = (svg.match(/<div id="bg"[^>]*>/) || [])[0];
                        assert.isString(bg, 'the styled div should be in the output');
                        assert.notInclude(
                            bg,
                            '&quot;',
                            'url() quotes must not be HTML-escaped'
                        );
                        assert.include(
                            bg,
                            "url('https://example.com/img.png')",
                            'background-image should carry a clean single-quoted url()'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            // ensureShown (opt-in): force the explicitly-captured root to appear even
            // when it is hidden by its own display:none / opacity:0. display:none has no
            // layout box, so the original is briefly revealed in place to measure, the
            // size feeds the SVG, and the clone root takes the revealed UA display. The
            // original must be left exactly as it was.
            it('ensureShown renders a display:none root and restores the original', function (done) {
                let original;
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<div id="none" style="display:none">natural sized content</div>';
                        original = document.getElementById('none');
                        return domtoimage.toSvg(original, { ensureShown: true });
                    })
                    .then(function (svg) {
                        const root = (svg.match(/<div id="none"[^>]*>/) || [])[0];
                        assert.isString(root, 'root should be in the output');
                        // Clone root un-hidden, and the SVG got a real measured size.
                        assert.notMatch(
                            root,
                            /display:\s*none/,
                            'clone root must not stay display:none'
                        );
                        assert.match(
                            svg,
                            /<svg[^>]*\swidth="\d/,
                            'a display:none root must be measured to a real width'
                        );
                        // The live original must be untouched.
                        assert.equal(
                            original.style.display,
                            'none',
                            'the original inline display:none must be restored'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            it('ensureShown reveals an opacity:0 root', function (done) {
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<div id="op" style="opacity:0;width:30px;height:10px">y</div>';
                        return domtoimage.toSvg(document.getElementById('op'), {
                            ensureShown: true,
                        });
                    })
                    .then(function (svg) {
                        const root = (svg.match(/<div id="op"[^>]*>/) || [])[0];
                        assert.isString(root, 'root should be in the output');
                        assert.match(
                            root,
                            /opacity:\s*1/,
                            'opacity:0 root must be forced opaque'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            // ensureShown must reveal the element's REAL display, not a blanket reset:
            // an inline `display:none` over a class's `display:flex` should come back as
            // flex (dropping the inline lets the cascade restore it), not `block`.
            it('ensureShown restores the real display, not block (#ensureShown flex)', function (done) {
                const style = document.createElement('style');
                style.id = 'flex-es';
                style.textContent = '#flexroot { display: flex; }';
                document.head.appendChild(style);
                function cleanup() {
                    const el = document.getElementById('flex-es');
                    if (el) {
                        el.remove();
                    }
                }
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<div id="flexroot" style="display:none"><span>a</span></div>';
                        return domtoimage.toSvg(document.getElementById('flexroot'), {
                            ensureShown: true,
                        });
                    })
                    .then(function (svg) {
                        const root = (svg.match(/<div id="flexroot"[^>]*>/) || [])[0];
                        assert.isString(root, 'root should be in the output');
                        assert.match(
                            root,
                            /display:\s*flex/,
                            'shown display must be the real flex, not a reverted block'
                        );
                    })
                    .then(cleanup)
                    .then(done)
                    .catch(function (e) {
                        cleanup();
                        done(e);
                    });
            });

            // ensureShown edge: a meaningful inline display defeated by a stylesheet
            // `display:none !important` should be recovered from the inline value, not
            // reverted to the UA default.
            it('ensureShown recovers an inline display under !important none', function (done) {
                const style = document.createElement('style');
                style.id = 'imp-es';
                style.textContent = '#improot { display: none !important; }';
                document.head.appendChild(style);
                function cleanup() {
                    const el = document.getElementById('imp-es');
                    if (el) {
                        el.remove();
                    }
                }
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<div id="improot" style="display:flex"><span>a</span></div>';
                        return domtoimage.toSvg(document.getElementById('improot'), {
                            ensureShown: true,
                        });
                    })
                    .then(function (svg) {
                        const root = (svg.match(/<div id="improot"[^>]*>/) || [])[0];
                        assert.isString(root, 'root should be in the output');
                        assert.match(
                            root,
                            /display:\s*flex/,
                            'must recover the inline flex, not revert to block'
                        );
                    })
                    .then(cleanup)
                    .then(done)
                    .catch(function (e) {
                        cleanup();
                        done(e);
                    });
            });

            // ensureShown is root-only: a deliberately hidden *descendant* stays hidden,
            // and the flag is opt-in (default off leaves the root hidden).
            it('ensureShown is root-only and opt-in', function (done) {
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<div id="host">shown' +
                            '<div id="child" style="display:none">child</div></div>';
                        return Promise.all([
                            domtoimage.toSvg(document.getElementById('host'), {
                                ensureShown: true,
                            }),
                            domtoimage.toSvg(document.getElementById('child')),
                        ]);
                    })
                    .then(function (r) {
                        const child = (r[0].match(/<div id="child"[^>]*>/) || [])[0];
                        assert.match(
                            child,
                            /display:\s*none/,
                            'a hidden descendant must stay hidden (root-only)'
                        );
                        // Without the flag, a display:none root is not measured.
                        assert.notMatch(
                            r[1],
                            /<svg[^>]*\swidth="\d/,
                            'default (no ensureShown) must not reveal a hidden root'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            // #167: capturing a node that sits inside a `visibility:hidden` ancestor
            // rendered blank — the inherited computed `visibility:hidden` was pinned
            // onto the captured root and every descendant. The root is now forced
            // visible (the caller explicitly asked to render it) and inherited
            // visibility is dropped on descendants so they follow it.
            it('renders a node captured from inside a visibility:hidden ancestor (#167)', function (done) {
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<div id="hiddenParent" style="visibility:hidden">' +
                            '<div id="target" style="width:40px;height:20px;background:red">' +
                            '<span id="kid">hi</span></div></div>';
                        return domtoimage.toSvg(document.getElementById('target'));
                    })
                    .then(function (svg) {
                        const decoded = decodeURIComponent(svg);
                        const target = (decoded.match(/<div id="target"[^>]*>/) || [])[0];
                        const kid = (decoded.match(/<span id="kid"[^>]*>/) || [])[0];
                        assert.isString(target, 'target should be in the output');
                        // Root forced visible; descendant must not carry hidden.
                        assert.notMatch(
                            target,
                            /visibility:\s*hidden/,
                            'captured root must not stay hidden'
                        );
                        assert.notMatch(
                            kid,
                            /visibility:\s*hidden/,
                            'descendant must not inherit a pinned hidden'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            // #167 guard: a *genuine* per-element `visibility:hidden` inside an
            // otherwise-visible capture must still be preserved (not blanket-reset).
            it('preserves an explicit visibility:hidden within a visible capture (#167)', function (done) {
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<div id="vis">shown' +
                            '<span id="gone" style="visibility:hidden">hidden</span>' +
                            '</div>';
                        return domtoimage.toSvg(document.getElementById('vis'));
                    })
                    .then(function (svg) {
                        const decoded = decodeURIComponent(svg);
                        const gone = (decoded.match(/<span id="gone"[^>]*>/) || [])[0];
                        assert.isString(gone, 'span should be in the output');
                        assert.match(
                            gone,
                            /visibility:\s*hidden/,
                            'an explicit visibility:hidden override must be preserved'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            // #227 (part 1): UA stylesheets underline `a[href]`. The sandbox builds a
            // default `<a>` from the tag name alone (no href), so its baseline has no
            // underline. A page that removes the underline (`a{text-decoration:none}`)
            // then matched that contextless default, the `none` was dropped, and the
            // output's UA stylesheet re-applied the underline. Building the default
            // anchor WITH the href fixes the baseline so the override is preserved.
            it('preserves a removed underline on a[href] (#227)', function (done) {
                const style = document.createElement('style');
                style.id = 'reset-227a';
                style.textContent = 'a { text-decoration: none; }';
                document.head.appendChild(style);
                function cleanup() {
                    const el = document.getElementById('reset-227a');
                    if (el) {
                        el.remove();
                    }
                }
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<a id="lnk" href="https://example.com">a link</a>';
                        return renderToSvg(domNode());
                    })
                    .then(function (svg) {
                        const decoded = decodeURIComponent(svg);
                        const anchor = (decoded.match(/<a id="lnk"[^>]*>/) || [])[0];
                        assert.isString(anchor, 'anchor should be in the output');
                        // The removed underline must be pinned, otherwise the output
                        // UA a[href] rule re-underlines the link.
                        assert.match(
                            anchor,
                            /text-decoration(-line)?:\s*none/,
                            'anchor must pin text-decoration:none so the underline is not re-applied'
                        );
                    })
                    .then(cleanup)
                    .then(done)
                    .catch(function (e) {
                        cleanup();
                        done(e);
                    });
            });

            // #227 (part 2): an element whose UA font-size is relative to its parent
            // (h1–h6 are N.Nem). When the page overrides it to coincide with both the
            // context-free sandbox default AND the parent, the diff dropped it — but
            // the standalone output resolves the UA relative rule against a different
            // parent font-size, so it diverged. We now always emit font-size for such
            // elements.
            it('preserves an overridden font-size on headings (#227)', function (done) {
                const style = document.createElement('style');
                style.id = 'reset-227b';
                // Parent 24px; h2 overridden to 1em (= 24px), which coincides with
                // the UA-default h2 (1.5em of 16px = 24px) and the parent — the exact
                // drop case. Without the fix the output h2 re-applies UA 1.5em → 36px.
                style.textContent =
                    '#dom-node { font-size: 24px; } #hd { font-size: 1em; }';
                document.head.appendChild(style);
                function cleanup() {
                    const el = document.getElementById('reset-227b');
                    if (el) {
                        el.remove();
                    }
                }
                let liveFontSize = '';
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML = '<h2 id="hd">Heading</h2>';
                        liveFontSize = getComputedStyle(
                            document.getElementById('hd')
                        ).getPropertyValue('font-size');
                        return renderToSvg(domNode());
                    })
                    .then(function (svg) {
                        const decoded = decodeURIComponent(svg);
                        const h2 = (decoded.match(/<h2 id="hd"[^>]*>/) || [])[0];
                        assert.isString(h2, 'h2 should be in the output');
                        assert.match(
                            h2,
                            new RegExp(
                                'font-size:\\s*' + liveFontSize.replace('.', '\\.')
                            ),
                            'h2 must pin its overridden font-size (' +
                                liveFontSize +
                                ') so the UA 1.5em rule does not re-apply'
                        );
                    })
                    .then(cleanup)
                    .then(done)
                    .catch(function (e) {
                        cleanup();
                        done(e);
                    });
            });

            // #203: a CSS reset like Tailwind Preflight (`*{ border-width:0;
            // border-style:solid; border-color:#e5e7eb }`) makes border-style/color
            // differ from the context-free sandbox default (so they're emitted) while
            // border-width equals the default 0 (so it was dropped). In the standalone
            // output with no stylesheet, a solid style with no width paints the CSS
            // initial `medium` (~3px) phantom border on every element. The fix pins the
            // width whenever a side has a visible style.
            it('does not paint phantom borders under a border reset (#203)', function (done) {
                const style = document.createElement('style');
                style.id = 'reset-203';
                style.textContent =
                    '* { border-width: 0; border-style: solid; border-color: rgb(229, 231, 235); }';
                document.head.appendChild(style);

                function cleanupReset() {
                    const el = document.getElementById('reset-203');
                    if (el) {
                        el.remove();
                    }
                }

                loadTestPage()
                    .then(function () {
                        domNode().innerHTML = '<div id="inner">hello world</div>';
                        return renderToSvg(domNode());
                    })
                    .then(function (svg) {
                        const decoded = decodeURIComponent(svg);
                        const match = decoded.match(/<div id="inner"[^>]*>/);
                        assert.isNotNull(match, 'inner div should be in the output');
                        const inner = match[0];
                        // The reset makes border-style solid, which alone would paint a
                        // `medium` border. The width must be pinned to 0 so it doesn't.
                        if (/border[^;"]*style:\s*solid/.test(inner)) {
                            assert.match(
                                inner,
                                /border(-[a-z]+)?-width:\s*0px/,
                                'a solid border style must be accompanied by a pinned 0px width'
                            );
                        }
                    })
                    .then(cleanupReset)
                    .then(done)
                    .catch(function (e) {
                        cleanupReset();
                        done(e);
                    });
            });

            // #215: a <use> that references a <symbol>/element defined OUTSIDE the
            // rendered subtree would render nothing, because the referenced node was
            // never cloned. We now collect the target and inject it into the output
            // SVG so the reference resolves in the standalone image.
            it('inlines out-of-subtree SVG referenced by <use> (#215)', function (done) {
                loadTestPage()
                    .then(function () {
                        const sprite =
                            '<svg style="display:none" xmlns="http://www.w3.org/2000/svg">' +
                            '<symbol id="diamond" viewBox="0 0 10 10">' +
                            '<rect id="symrect" x="2" y="2" width="6" height="6" fill="red"></rect>' +
                            '</symbol></svg>';
                        // Sibling of #dom-node, NOT inside it — so it is never cloned.
                        document
                            .querySelector('#test-root')
                            .insertAdjacentHTML('afterbegin', sprite);
                        domNode().innerHTML =
                            '<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg">' +
                            '<use href="#diamond" width="20" height="20"></use></svg>';
                        return renderToSvg(domNode());
                    })
                    .then(function (svg) {
                        const decoded = decodeURIComponent(svg);
                        // The referenced symbol (and its contents) must be present in
                        // the standalone output, otherwise <use href="#diamond"> is
                        // dangling and nothing rasterizes.
                        assert.include(
                            decoded,
                            'id="diamond"',
                            'referenced <symbol> should be injected into the output'
                        );
                        assert.include(
                            decoded,
                            'id="symrect"',
                            "referenced symbol's contents should be injected"
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            // #215: when the referenced id already exists inside the rendered
            // subtree, we must NOT inject a duplicate of it.
            it('does not duplicate <use> targets already in the subtree (#215)', function (done) {
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg">' +
                            '<defs><rect id="inside" x="0" y="0" width="6" height="6" fill="blue"></rect></defs>' +
                            '<use href="#inside" width="20" height="20"></use></svg>';
                        return renderToSvg(domNode());
                    })
                    .then(function (svg) {
                        const decoded = decodeURIComponent(svg);
                        const occurrences = decoded.split('id="inside"').length - 1;
                        assert.equal(
                            occurrences,
                            1,
                            'in-subtree target must not be duplicated'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            // #209: a <table>'s computed height is its full element box, but CSS
            // `height` on a table sizes only the grid box (the <caption> sits outside
            // it). Copying the computed height back as an inline style made the caption
            // stack on top of a full-height grid, growing the cloned table by the
            // caption height and pushing trailing siblings out of the output (clipping
            // them). The clone's table must lay out at the same height as the original.
            it('does not grow a captioned table in the clone (#209)', function (done) {
                let host;
                let originalTableHeight = -1;
                let cloneTableHeight = -1;
                loadTestPage()
                    .then(function () {
                        host = domNode();
                        host.style.width = '200px';
                        host.innerHTML =
                            '<table><caption>A Table Caption</caption>' +
                            '<thead><tr><th>A</th></tr></thead>' +
                            '<tbody><tr><td>Long text text text text text text text</td></tr></tbody>' +
                            '</table><div style="color:red">Bottom text</div>';
                        originalTableHeight = host
                            .querySelector('table')
                            .getBoundingClientRect().height;
                        return domtoimage.toSvg(host, {
                            onclone: function (clone) {
                                // Lay the clone out offscreen and measure its table.
                                clone.style.position = 'absolute';
                                clone.style.left = '-9999px';
                                clone.style.top = '0';
                                document.body.appendChild(clone);
                                cloneTableHeight = clone
                                    .querySelector('table')
                                    .getBoundingClientRect().height;
                                document.body.removeChild(clone);
                                clone.style.position = '';
                                clone.style.left = '';
                                clone.style.top = '';
                                return clone;
                            },
                        });
                    })
                    .then(function () {
                        // Without the fix the clone's table is taller by the caption
                        // height (~18px); allow 1px of sub-pixel slack.
                        assert.isAtMost(
                            cloneTableHeight,
                            originalTableHeight + 1,
                            'cloned captioned table must not grow taller than the original'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            it('should handle adjustClonedNode', function (done) {
                function oncloned(_node, clone, after) {
                    /* jshint unused:false */
                    if (!after && clone.id === 'element') {
                        clone.style.transform = 'translateY(100px)';
                    }
                    return clone;
                }

                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<div id="element" style="width:30px;height:30px;background:red"></div>';
                        return renderToSvg(domNode(), {
                            adjustClonedNode: oncloned,
                        });
                    })
                    .then(function (svg) {
                        const el = (decodeURIComponent(svg).match(
                            /<div id="element"[^>]*>/
                        ) || [])[0];
                        assert.isString(el, 'the element should be in the output');
                        assert.match(
                            el,
                            /transform:\s*translateY\(100px\)/,
                            'adjustClonedNode must apply the transform to the clone'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            it('should handle filterStyles', function (done) {
                function filterStyles(_node, propertyName) {
                    /* jshint unused:false */
                    return propertyName !== 'background-color';
                }
                // The color must come from a stylesheet (not an inline attribute, which
                // is cloned verbatim) so the computed-style copy — where filterStyles
                // applies — is what carries it.
                const style = document.createElement('style');
                style.id = 'fs-style';
                style.textContent =
                    '#fs { background-color: rgb(1, 2, 3); width: 20px; height: 20px; }';
                document.head.appendChild(style);
                function cleanup() {
                    const el = document.getElementById('fs-style');
                    if (el) {
                        el.remove();
                    }
                }

                loadTestPage()
                    .then(function () {
                        domNode().innerHTML = '<div id="fs"></div>';
                        return Promise.all([
                            renderToSvg(domNode()),
                            renderToSvg(domNode(), { filterStyles: filterStyles }),
                        ]);
                    })
                    .then(function (results) {
                        const baseline = (decodeURIComponent(results[0]).match(
                            /<div id="fs"[^>]*>/
                        ) || [])[0];
                        const filtered = (decodeURIComponent(results[1]).match(
                            /<div id="fs"[^>]*>/
                        ) || [])[0];
                        assert.include(
                            baseline,
                            'background-color: rgb(1, 2, 3)',
                            'baseline must emit background-color'
                        );
                        assert.notInclude(
                            filtered,
                            'background-color',
                            'filterStyles must drop background-color'
                        );
                    })
                    .then(cleanup)
                    .then(done)
                    .catch(function (e) {
                        cleanup();
                        done(e);
                    });
            });

            it('should clean up wrappers and sandbox when a render fails', function (done) {
                loadTestPage('small/dom-node.html', 'small/style.css')
                    .then(function () {
                        const host = domNode();
                        // A bare text node forces ensureElement to wrap it, giving
                        // cleanup something to restore.
                        host.textContent = 'text to render';
                        const textNode = host.firstChild;

                        return domtoimage
                            .toSvg(textNode, {
                                onclone: function () {
                                    throw new Error('boom-during-render');
                                },
                            })
                            .then(
                                function () {
                                    throw new Error('expected the render to reject');
                                },
                                function (err) {
                                    assert.match(err.message, /boom-during-render/);
                                    // wrapper span removed, original text node restored
                                    assert.equal(
                                        host.firstChild,
                                        textNode,
                                        'wrapped node should be restored on failure'
                                    );
                                    // no sandbox iframe left behind
                                    assert.equal(
                                        document.querySelectorAll(
                                            '[id^="domtoimage-sandbox"]'
                                        ).length,
                                        0,
                                        'sandbox iframe should be removed on failure'
                                    );
                                }
                            );
                    })
                    .then(done)
                    .catch(done);
            });

            itImage('should render to svg', function (done) {
                loadTestPage(
                    'small/dom-node.html',
                    'small/style.css',
                    'small/control-image'
                )
                    .then(renderToSvg)
                    .then(check)
                    .then(done)
                    .catch(done);
            });

            itImage('should render to png', function (done) {
                loadTestPage(
                    'small/dom-node.html',
                    'small/style.css',
                    'small/control-image'
                )
                    .then(renderToPng)
                    .then(check)
                    .then(done)
                    .catch(done);
            });

            it('should handle border', function (done) {
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<div id="bd" style="border:3px solid rgb(0,128,0);width:20px;height:20px"></div>';
                        return renderToSvg(domNode());
                    })
                    .then(function (svg) {
                        const el = (decodeURIComponent(svg).match(/<div id="bd"[^>]*>/) ||
                            [])[0];
                        assert.isString(el, 'element should be in output');
                        assert.include(
                            el,
                            'rgb(0, 128, 0)',
                            'border color should be captured'
                        );
                        assert.include(el, '3px', 'border width should be captured');
                    })
                    .then(done)
                    .catch(done);
            });

            itImage('should render to jpeg', function (done) {
                loadTestPage(
                    'small/dom-node.html',
                    'small/style.css',
                    'small/control-image-jpeg'
                )
                    .then(renderToJpeg)
                    .then(check)
                    .then(done)
                    .catch(done);
            });

            itImage(
                'should use quality parameter when rendering to jpeg',
                function (done) {
                    loadTestPage(
                        'small/dom-node.html',
                        'small/style.css',
                        'small/control-image-jpeg-low'
                    )
                        .then(() => renderToJpeg(null, { quality: 0.5 }))
                        .then(check)
                        .then(done)
                        .catch(done);
                }
            );

            itImage('should render to blob', function (done) {
                loadTestPage(
                    'small/dom-node.html',
                    'small/style.css',
                    'small/control-image'
                )
                    .then(renderToBlob)
                    .then(function (blob) {
                        return global.URL.createObjectURL(blob);
                    })
                    .then(check)
                    .then(done)
                    .catch(done);
            });

            itImage('should render bigger node', function (done) {
                loadTestPage(
                    'bigger/dom-node.html',
                    'bigger/style.css',
                    'bigger/control-image'
                )
                    .then(function () {
                        const parent = domNode();
                        const child = parent.children[0];
                        for (let i = 0; i < 10; i++) {
                            parent.append(child.cloneNode(true));
                        }
                    })
                    .then(renderToPngAndCheck)
                    .then(done)
                    .catch(done);
            });

            it('should handle "#" in colors and attributes', function (done) {
                // A literal `#` in the serialized SVG would truncate the data URI
                // (it starts a fragment); it must be escaped to %23 and round-trip.
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<div id="ha#sh" title="a#b">text#with#hashes</div>';
                        return renderToSvg(domNode());
                    })
                    .then(function (svg) {
                        const body = svg.slice(svg.indexOf(',') + 1);
                        assert.notInclude(
                            body,
                            '#',
                            'literal # must be escaped so the data URI is not truncated'
                        );
                        assert.include(
                            decodeURIComponent(svg),
                            'text#with#hashes',
                            'content with # must round-trip'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            it('should render nested svg with broken namespace', function (done) {
                // svg/path declare the (wrong) XHTML namespace; the path must still
                // survive serialization rather than being dropped or throwing.
                loadTestPage('svg-ns/dom-node.html', 'svg-ns/style.css')
                    .then(function () {
                        return renderToSvg(domNode());
                    })
                    .then(function (svg) {
                        assert.include(
                            decodeURIComponent(svg),
                            'M10 10 H 90 V 90 H 10 L 10 10',
                            'the path data must survive the broken namespace'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            it('should render svg <rect> with width and height', function (done) {
                loadTestPage('svg-rect/dom-node.html', 'svg-rect/style.css')
                    .then(function () {
                        return renderToSvg(domNode());
                    })
                    .then(function (svg) {
                        const rect = (decodeURIComponent(svg).match(/<rect[^>]*\/?>/) ||
                            [])[0];
                        assert.isString(rect, '<rect> should be in the output');
                        assert.match(rect, /width="100"/, 'rect width must be preserved');
                        assert.match(
                            rect,
                            /height="100"/,
                            'rect height must be preserved'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            itImage('should render whole node when its scrolled', function (done) {
                let domNode;
                loadTestPage(
                    'scroll/dom-node.html',
                    'scroll/style.css',
                    'scroll/control-image'
                )
                    .then(function () {
                        domNode = document.querySelectorAll('#scrolled')[0];
                    })
                    .then(renderToPng)
                    .then(makeImgElement)
                    .then(function (image) {
                        return drawImgElement(image, domNode);
                    })
                    .then(compareToControlImage)
                    .then(done)
                    .catch(done);
            });

            it('should render text nodes', function (done) {
                this.timeout(30000);
                loadTestPage('text/dom-node.html', 'text/style.css')
                    .then(renderToPng)
                    .then(drawDataUrl)
                    .then(assertTextRendered(['SOME TEXT', 'SOME MORE TEXT']))
                    .then(done)
                    .catch(done);
            });

            it('should render bare text nodes not wrapped in an element', function (done) {
                this.timeout(30000);
                loadTestPage('bare-text-nodes/dom-node.html', 'bare-text-nodes/style.css')
                    // NOTE: Using first child node of domNode()!
                    .then((node) => renderChildToPng(node)) //, { width: 200, height: 200 }))
                    .then(drawDataUrl)
                    .then(assertTextRendered(['BARE TEXT']))
                    .then(done)
                    .catch(done);
            });

            it('should preserve content of ::before and ::after pseudo elements', function (done) {
                this.timeout(30000);
                loadTestPage('pseudo/dom-node.html', 'pseudo/style.css', undefined)
                    .then(renderToPng)
                    .then(drawDataUrl)
                    .then(
                        assertTextRendered([
                            'AAA',
                            'Before BBB',
                            'CCC JustAfter',
                            'BothBefore DDD BothAfter',
                            'EEE',
                        ])
                    )
                    .then(done)
                    .catch(done);
            });

            it('should use node filter', function (done) {
                function filter(node) {
                    if (node.classList) {
                        return !node.classList.contains('omit');
                    }
                    return true;
                }

                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<span id="keep">keep</span>' +
                            '<span id="drop" class="omit">drop</span>';
                        return renderToSvg(domNode(), { filter: filter });
                    })
                    .then(function (svg) {
                        const decoded = decodeURIComponent(svg);
                        assert.include(
                            decoded,
                            'id="keep"',
                            'unfiltered node should be kept'
                        );
                        assert.notInclude(
                            decoded,
                            'id="drop"',
                            'filtered (.omit) node should be excluded'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            it('should not apply node filter to root node', function (done) {
                // Filter keeps only `.include`; the captured root has no such class,
                // so this proves the filter is not applied to the root itself.
                function filter(node) {
                    if (node.classList) {
                        return node.classList.contains('include');
                    }
                    return false;
                }

                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<span id="inc" class="include">inc</span>' +
                            '<span id="exc">exc</span>';
                        return renderToSvg(domNode(), { filter: filter });
                    })
                    .then(function (svg) {
                        const decoded = decodeURIComponent(svg);
                        assert.include(
                            decoded,
                            'id="dom-node"',
                            'the root must render even though the filter rejects it'
                        );
                        assert.include(
                            decoded,
                            'id="inc"',
                            'an included child should be kept'
                        );
                        assert.notInclude(
                            decoded,
                            'id="exc"',
                            'a non-included child should be excluded'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            it('should apply styles from an external stylesheet', function (done) {
                // sheet/dom-node.html only contains a <link> to sheet.css, which
                // sets #dom-node { background-color: red }. The rendered output must
                // reflect the externally-loaded rule (not just inline/embedded CSS).
                this.timeout(5000);
                loadTestPage('sheet/dom-node.html', 'sheet/style.css')
                    .then(function () {
                        // The <link>ed sheet loads asynchronously and loadTestPage
                        // does not await it; wait until the rule actually applies
                        // before rendering (cold headless Firefox can be slow to
                        // fetch it, otherwise the capture races the load).
                        return waitForCondition(function () {
                            return (
                                getComputedStyle(domNode()).backgroundColor ===
                                'rgb(255, 0, 0)'
                            );
                        }, 4000);
                    })
                    .then(function () {
                        return renderToSvg(domNode());
                    })
                    .then(function (svg) {
                        const decoded = decodeURIComponent(svg);
                        const root = (decoded.match(
                            /<div id="dom-node"[^>]*style="[^"]*"/
                        ) || [])[0];
                        assert.isString(root, '#dom-node should be in the output');
                        assert.match(
                            root,
                            /background-color:\s*rgb\(255,\s*0,\s*0\)/,
                            'external stylesheet rule must be honored'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            itImage('should render web fonts', function (done) {
                this.timeout(5000);
                loadTestPage(
                    'fonts/dom-node.html',
                    'fonts/style.css',
                    'fonts/control-image'
                )
                    .then(renderToPngAndCheck)
                    .then(done)
                    .catch(done);
            });

            itImage('should not copy web font', function (done) {
                this.timeout(5000);
                loadTestPage(
                    'fonts/dom-node.html',
                    'fonts/style.css',
                    'fonts/control-image-no-font'
                )
                    .then(() => renderToPng(domNode(), { disableEmbedFonts: true }))
                    .then(check)
                    .then(done)
                    .catch(done);
            });

            it('should render images', function (done) {
                this.timeout(30000);
                loadTestPage('images/dom-node.html', 'images/style.css')
                    .then(renderToPng)
                    .then(drawDataUrl)
                    .then(assertTextRendered(['PNG', 'JPG']))
                    .then(done)
                    .catch(done);
            });

            itImage('should render active image in srcset', function (done) {
                this.timeout(30000);
                loadTestPage(
                    'srcset/dom-node.html',
                    'srcset/style.css',
                    'srcset/control-image'
                )
                    .then(renderToPng)
                    .then(check)
                    .then(done)
                    .catch(done);
            });

            itImage('should render background images', function (done) {
                loadTestPage(
                    'css-bg/dom-node.html',
                    'css-bg/style.css',
                    'css-bg/control-image'
                )
                    .then(renderToPngAndCheck)
                    .then(done)
                    .catch(done);
            });

            itImage('should render iframe of street view', function (done) {
                this.timeout(60000);
                loadTestPage(
                    'iframe/street-view.html',
                    'iframe/style.css',
                    'iframe/control-image'
                )
                    .then(renderToPngAndCheck)
                    .then(done)
                    .catch(done);
            });

            it('should render user input from <textarea>', function (done) {
                loadTestPage('textarea/dom-node.html', 'textarea/style.css')
                    .then(function () {
                        document.getElementById('input').value = 'USER\nINPUT';
                    })
                    .then(renderToPng)
                    .then(drawDataUrl)
                    .then(assertTextRendered(['USER\nINPUT']))
                    .then(done)
                    .catch(done);
            });

            it('should render user input from <input>', function (done) {
                loadTestPage('input/dom-node.html', 'input/style.css')
                    .then(function () {
                        document.getElementById('input').value = 'USER INPUT';
                    })
                    .then(renderToPng)
                    .then(drawDataUrl)
                    .then(assertTextRendered(['USER INPUT']))
                    .then(done)
                    .catch(done);
            });

            it('should render content from <canvas>', function (done) {
                loadTestPage('canvas/dom-node.html', 'canvas/style.css')
                    .then(function () {
                        const canvas = document.getElementById('content');
                        const ctx = canvas.getContext('2d');
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                        ctx.fillStyle = '#000000';
                        ctx.font = '100px monospace';
                        ctx.fillText('0', canvas.width / 2, canvas.height / 2);
                    })
                    .then(renderToPng)
                    .then(drawDataUrl)
                    .then(assertTextRendered(['0']))
                    .then(done)
                    .catch(done);
            });

            it('should handle zero-width <canvas>', function (done) {
                loadTestPage('canvas/empty-data.html', 'canvas/empty-style.css')
                    .then(renderToSvg)
                    .then(function (dataUrl) {
                        const img = new Image();
                        document.getElementById('result').appendChild(img);
                        img.src = dataUrl;
                    })
                    .then(done)
                    .catch(done);
            });

            it('should render bgcolor', function (done) {
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<div id="b" style="width:30px;height:20px"></div>';
                        return domtoimage.toPixelData(document.getElementById('b'), {
                            bgcolor: '#ffff00',
                        });
                    })
                    .then(function (px) {
                        // bgcolor fills the canvas behind the transparent content.
                        const i = (2 * 30 + 2) * 4; // pixel (2,2), width 30
                        assert.equal(px[i], 255, 'red channel');
                        assert.equal(px[i + 1], 255, 'green channel');
                        assert.equal(px[i + 2], 0, 'blue channel');
                        assert.isAbove(px[i + 3], 200, 'opaque');
                    })
                    .then(done)
                    .catch(done);
            });

            it('should render bgcolor in SVG', function (done) {
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<div id="b" style="width:30px;height:20px"></div>';
                        return domtoimage.toSvg(document.getElementById('b'), {
                            bgcolor: '#ffff00',
                        });
                    })
                    .then(function (svg) {
                        const root = (decodeURIComponent(svg).match(
                            /<div id="b"[^>]*>/
                        ) || [])[0];
                        assert.isString(root, 'root should be in the output');
                        assert.match(
                            root,
                            /background-color:\s*rgb\(255,\s*255,\s*0\)/,
                            'bgcolor option must be applied to the root'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            it('should not crash when loading external stylesheet causes error', function (done) {
                loadTestPage('ext-css/dom-node.html', 'ext-css/style.css')
                    .then(renderToPng)
                    .then(() => done())
                    .catch(done);
            });

            it('should convert an element to an array of pixels', function (done) {
                loadTestPage('pixeldata/dom-node.html', 'pixeldata/style.css')
                    .then(renderToPixelData)
                    .then(function (pixels) {
                        for (let y = 0; y < domNode().scrollHeight; ++y) {
                            for (let x = 0; x < domNode().scrollWidth; ++x) {
                                const rgba = [0, 0, 0, 0];

                                if (y < 10) {
                                    rgba[0] = 255;
                                } else if (y < 20) {
                                    rgba[1] = 255;
                                } else {
                                    rgba[2] = 255;
                                }

                                if (x < 10) {
                                    rgba[3] = 255;
                                } else if (x < 20) {
                                    rgba[3] = parseInt(0.4 * 255);
                                } else {
                                    rgba[3] = parseInt(0.2 * 255);
                                }

                                const offset = 4 * y * domNode().scrollHeight + 4 * x;
                                assert.deepEqual(
                                    Uint8Array.from(pixels.slice(offset, offset + 4)),
                                    Uint8Array.from(rgba)
                                );
                            }
                        }
                    })
                    .then(done)
                    .catch(done);
            });

            it('should apply width and height options to the node copy', function (done) {
                // The width/height options must size the SVG to the requested box,
                // overriding the element's own 100x100 dimensions.
                loadTestPage()
                    .then(function () {
                        const node = domNode();
                        node.style.width = '100px';
                        node.style.height = '100px';
                        node.style.backgroundColor = 'red';
                        return renderToSvg(node, { width: 200, height: 200 });
                    })
                    .then(function (svg) {
                        const decoded = decodeURIComponent(svg);
                        assert.match(
                            decoded,
                            /<svg[^>]*\swidth="200"/,
                            'width option must size the SVG'
                        );
                        assert.match(
                            decoded,
                            /<svg[^>]*\sheight="200"/,
                            'height option must size the SVG'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            itImage(
                'should apply style text to node copy being rendered',
                function (done) {
                    loadTestPage(
                        'style/dom-node.html',
                        'style/style.css',
                        'style/control-image'
                    )
                        .then(() =>
                            renderToPng(domNode(), {
                                style: {
                                    'background-color': 'red',
                                    'transform': 'scale(0.5)',
                                },
                            })
                        )
                        .then(check)
                        .then(done)
                        .catch(done);
                }
            );

            itImage('should apply handle background-clip:text', function (done) {
                loadTestPage(
                    'background-clip/dom-node.html',
                    'background-clip/style.css',
                    'background-clip/control-image'
                )
                    .then(renderToPng)
                    .then(check)
                    .then(done)
                    .catch(done);
            });

            it('should combine dimensions and style', function (done) {
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML = '<div id="cd">x</div>';
                        return renderToSvg(domNode(), {
                            width: 200,
                            height: 200,
                            style: {
                                'transform': 'scale(2)',
                                'transform-origin': 'top left',
                            },
                        });
                    })
                    .then(function (svg) {
                        const decoded = decodeURIComponent(svg);
                        assert.match(
                            decoded,
                            /<svg[^>]*\swidth="200"/,
                            'width option must size the SVG'
                        );
                        assert.match(
                            decoded,
                            /<svg[^>]*\sheight="200"/,
                            'height option must size the SVG'
                        );
                        // The style option is applied to the captured root (#dom-node).
                        const root = (decoded.match(/<div id="dom-node"[^>]*>/) || [])[0];
                        assert.match(
                            root,
                            /transform:\s*scale\(2\)|matrix\(2,/,
                            'style option must apply the transform to the root'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            it('should render an HTML <a> (not confused with SVG <a>)', function (done) {
                // issue #90: an HTML anchor must round-trip with its attribute-selector
                // styling applied, not be treated as an SVG <a> element.
                loadTestPage('svg-styles/dom-node.html', 'svg-styles/style.css')
                    .then(function () {
                        return renderToSvg(domNode());
                    })
                    .then(function (svg) {
                        const decoded = decodeURIComponent(svg);
                        const anchor = (decoded.match(/<a [^>]*>/) || [])[0];
                        assert.isString(anchor, '<a> should be in the output');
                        assert.include(
                            anchor,
                            'href="#dom-node"',
                            'anchor href must round-trip'
                        );
                        assert.match(
                            anchor,
                            /color:\s*rgb\(0,\s*0,\s*0\)/,
                            'attribute-selector color must be applied'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            itImage('should render defaults styles when reset', function (done) {
                this.timeout(30000);
                loadTestPage(
                    'defaultStyles/defaultStyles.html',
                    'defaultStyles/style.css',
                    'defaultStyles/control-image'
                )
                    .then(renderToSvg)
                    .then(check)
                    .then(done)
                    .catch(done);
            });

            it('should honor zero-padding table elements', function (done) {
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<table style="border-collapse:collapse"><tbody><tr>' +
                            '<td id="cell" style="padding:0">x</td></tr></tbody></table>';
                        return renderToSvg(domNode());
                    })
                    .then(function (svg) {
                        const cell = (decodeURIComponent(svg).match(
                            /<td id="cell"[^>]*>/
                        ) || [])[0];
                        assert.isString(cell, 'cell should be in output');
                        assert.match(
                            cell,
                            /padding:\s*0px|padding-top:\s*0px/,
                            'zero cell padding must be preserved (UA table padding not re-added)'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            itImage(
                'should render open shadow DOM roots with assigned nodes intact',
                function (done) {
                    this.timeout(60000);
                    loadTestPage(
                        'shadow-dom/dom-node.html',
                        'shadow-dom/styles.css',
                        'shadow-dom/control-image'
                    )
                        .then(renderToPngAndCheck)
                        .then(done)
                        .catch(done);
                }
            );

            it('should not get fooled by math elements', function (done) {
                loadTestPage()
                    .then(function () {
                        domNode().innerHTML =
                            '<math id="m"><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow></math>';
                        return renderToSvg(domNode());
                    })
                    .then(function (svg) {
                        const decoded = decodeURIComponent(svg);
                        // MathML must not break the default-style/ascent-stopper path
                        // (lowercase 'math'); the render succeeds and structure survives.
                        assert.include(
                            decoded,
                            'id="m"',
                            'the <math> element should render without error'
                        );
                        assert.include(
                            decoded,
                            '<mi',
                            'math children should be preserved'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            function compareToControlImage(image) {
                // Tests that draw a sub-region (e.g. scrolled node) reach the
                // comparison directly rather than via check(); regenerate from the
                // re-encoded image so the saved control matches what gets compared.
                if (UPDATE_CONTROLS) {
                    return writeControlImage(getImageDataURL(image, 'image/png'));
                }

                const imageUrl = getImageDataURL(image, 'image/png');
                const controlUrl = getImageDataURL(controlImage(), 'image/png');

                if (imageUrl !== controlUrl) {
                    var escapedImage = escapeImage(image.src);

                    console.debug(`
                    <html>
                        <body>
                            <h2>Source</h2>\n<img src='${escapedImage}'/>
                            <h2>Output</h2>\n<img src='${imageUrl}'/>
                            <h2>Control</h2>\n<img src='${controlUrl}'/>
                        </body>
                    </html>
                    `);
                }
                assert.equal(
                    imageUrl,
                    controlUrl,
                    'rendered and control images should be same'
                );

                function escapeImage(image) {
                    if (image.indexOf('image/svg') >= 0) {
                        const svgStart = image.indexOf('<svg');
                        const svgEnd = image.lastIndexOf('</svg>');
                        const prefix = image.substring(0, svgStart);
                        const postfix = image.substring(svgEnd + 6);
                        const embeddedSvg = image.substring(svgStart, svgEnd + 6);
                        const escapedSvg = escapeHtml(embeddedSvg);
                        return prefix + escapedSvg + postfix;
                    } else {
                        return image;
                    }
                }
            }

            const matchHtmlRegExp = /["'&<>]/;
            function escapeHtml(string) {
                var str = '' + string;
                var match = matchHtmlRegExp.exec(str);

                if (!match) {
                    return str;
                }

                var escape;
                var html = '';
                var index = 0;
                var lastIndex = 0;

                for (index = match.index; index < str.length; index++) {
                    switch (str.charCodeAt(index)) {
                        case 34: // "
                            escape = '&quot;';
                            break;
                        case 38: // &
                            escape = '&amp;';
                            break;
                        case 39: // '
                            escape = '&#39;';
                            break;
                        case 60: // <
                            escape = '&lt;';
                            break;
                        case 62: // >
                            escape = '&gt;';
                            break;
                        default:
                            continue;
                    }

                    if (lastIndex !== index) {
                        html += str.substring(lastIndex, index);
                    }

                    lastIndex = index + 1;
                    html += escape;
                }

                return lastIndex !== index
                    ? html + str.substring(lastIndex, index)
                    : html;
            }

            function getImageDataURL(image, mimetype) {
                var canvas = document.createElement('canvas');
                canvas.height = image.naturalHeight;
                canvas.width = image.naturalWidth;
                var ctx = canvas.getContext('2d');
                ctx.msImageSmoothingEnabled = false;
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(image, 0, 0);
                return canvas.toDataURL(mimetype);
            }

            function renderToPngAndCheck() {
                return Promise.resolve().then(renderToPng).then(check);
            }

            function check(dataUrl) {
                // In regeneration mode the raw render IS the new control image,
                // which keeps the original format (PNG or SVG data URL) intact.
                if (UPDATE_CONTROLS) {
                    return writeControlImage(dataUrl);
                }
                return Promise.resolve(dataUrl)
                    .then(drawDataUrl)
                    .then(compareToControlImage);
            }

            function drawDataUrl(dataUrl, dimensions) {
                return Promise.resolve(dataUrl)
                    .then(makeImgElement)
                    .then(function (image) {
                        return drawImgElement(image, null, dimensions);
                    });
            }

            function assertTextRendered(lines) {
                return function () {
                    return new Promise(function (resolve, reject) {
                        Tesseract.recognize(canvas(), 'eng').then((response) => {
                            const text = response.data.text;
                            lines.forEach(function (line) {
                                try {
                                    assert.include(text, line);
                                } catch (e) {
                                    console.debug(e);
                                    console.debug(response);
                                    reject(e);
                                }
                            });
                        });
                        resolve();
                    });
                };
            }

            function makeImgElement(src) {
                return new Promise(function (resolve, reject) {
                    const image = new Image();
                    image.onload = function () {
                        resolve(image);
                    };
                    image.onerror = function (ev) {
                        reject(ev);
                    };
                    image.src = src;
                });
            }

            function drawImgElement(image, node, dimensions) {
                node = node || domNode();
                dimensions = dimensions || {};
                const c = canvas();
                c.height = dimensions.height || node.offsetHeight.toString();
                c.width = dimensions.width || node.offsetWidth.toString();
                const ctx = c.getContext('2d');
                ctx.msImageSmoothingEnabled = false;
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(image, 0, 0);
                return image;
            }
        });

        describe('inliner', function () {
            const NO_BASE_URL = null;

            it('should process urls', function () {
                const should = domtoimage.impl.inliner.shouldProcess;
                assert.deepEqual(should('url("http://acme.com/file")'), true);
                assert.deepEqual(should('nope("http://acme.com/file")'), false);
            });

            it('should parse urls', function () {
                const parse = domtoimage.impl.inliner.impl.readUrls;
                assert.deepEqual(parse('url("http://acme.com/file")'), [
                    'http://acme.com/file',
                ]);
                assert.deepEqual(parse("url(foo.com), url('bar.org')"), [
                    'foo.com',
                    'bar.org',
                ]);
                // #138: matched quotes (incl. values containing spaces) must
                // extract cleanly — guards the symmetric-quote backreference regex.
                assert.deepEqual(parse("url('/img/b g.png')"), ['/img/b g.png']);
                assert.deepEqual(parse('url("/img/b g.png")'), ['/img/b g.png']);
            });

            it('should ignore data urls', function () {
                const parse = domtoimage.impl.inliner.impl.readUrls;
                assert.deepEqual(parse('url(foo.com), url(data:AAA)'), ['foo.com']);
            });

            it('should build a decent escaped regex urls', function () {
                const regexer = domtoimage.impl.inliner.impl.urlAsRegex;

                one('http://foo.com', 'url("http://foo.com")', '"');
                one('http://foo.com', "url('http://foo.com')", "'");
                one('http://foo.com', 'url(http://foo.com)', '');
                one(
                    'http://foo.com',
                    'url("http://bar.org") and url(\'http://foo.com\')',
                    "'"
                );
                one('https://example.org', 'url(ping.png)', null);

                function one(input, css, expectation) {
                    const pattern = regexer(input);
                    const findings = pattern.exec(css);
                    //console.log({ pattern: pattern.toString(), input, css, findings, expectation});

                    if (findings) {
                        assert.deepEqual(findings.slice(1, 3), [expectation, input]);
                    } else {
                        assert.isNull(expectation);
                    }
                }
            });

            it('should inline url', function (done) {
                const inline = domtoimage.impl.inliner.impl.inline;

                inline(
                    'url(http://acme.com/image.png), url(foo.com)',
                    'http://acme.com/image.png',
                    NO_BASE_URL,
                    function () {
                        return Promise.resolve('data:image/png;base64,AAA');
                    }
                )
                    .then(function (result) {
                        assert.equal(
                            result,
                            'url(data:image/png;base64,AAA), url(foo.com)'
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            it('should resolve urls if base url given', function (done) {
                const inline = domtoimage.impl.inliner.impl.inline;

                inline(
                    'url(images/image.png)',
                    'images/image.png',
                    'http://acme.com/',
                    function (url) {
                        return Promise.resolve(
                            {
                                'http://acme.com/images/image.png':
                                    'data:image/png;base64,AAA',
                            }[url]
                        );
                    }
                )
                    .then(function (result) {
                        assert.equal(result, 'url(data:image/png;base64,AAA)');
                    })
                    .then(done)
                    .catch(done);
            });

            it('should inline all urls', function (done) {
                const inlineAll = domtoimage.impl.inliner.inlineAll;

                inlineAll(
                    'url(http://acme.com/image.png), url("foo.com/font.ttf")',
                    NO_BASE_URL,
                    function (url) {
                        return Promise.resolve(
                            {
                                'http://acme.com/image.png': 'data:image/png;base64,AAA',
                                'foo.com/font.ttf':
                                    'data:application/font-truetype;base64,BBB',
                            }[url]
                        );
                    }
                )
                    .then(function (result) {
                        assert.equal(
                            result,
                            'url(data:image/png;base64,AAA), url("data:application/font-truetype;base64,BBB")'
                        );
                    })
                    .then(done)
                    .catch(done);
            });
        });

        describe('util', function () {
            it('should get and encode resource', function (done) {
                const getAndEncode = domtoimage.impl.util.getAndEncode;
                getResource('util/fontawesome.base64')
                    .then(function (testResource) {
                        return getAndEncode(`${BASE_URL}util/fontawesome.woff2`).then(
                            function (resource) {
                                assert.equal(resource, testResource);
                            }
                        );
                    })
                    .then(done)
                    .catch(done);
            });

            it('should return empty result if cannot get resource', function (done) {
                domtoimage.impl.util
                    .getAndEncode(`${BASE_URL}util/not-found?should-be=empty`)
                    .then(function (resource) {
                        assert.equal(resource, '');
                    })
                    .then(done)
                    .catch(done);
            });

            it('should return placeholder result if cannot get resource and placeholder is provided', function (done) {
                domtoimage.impl.copyOptions({}); // since we're bypassing the normal options flow
                domtoimage.impl.options.imagePlaceholder = validPlaceholder;
                domtoimage.impl.util
                    .getAndEncode(`${BASE_URL}util/not-found?should-be=placeholder`)
                    .then(function (resource) {
                        assert.equal(resource, validPlaceholder);
                    })
                    .then(done)
                    .catch(done);
            });

            it('should resolve url', function () {
                const resolve = domtoimage.impl.util.resolveUrl;

                assert.equal(
                    resolve('font.woff', 'http://acme.com'),
                    'http://acme.com/font.woff'
                );
                assert.equal(
                    resolve('/font.woff', 'http://acme.com/fonts/woff'),
                    'http://acme.com/font.woff'
                );

                assert.equal(
                    resolve('../font.woff', 'http://acme.com/fonts/woff/'),
                    'http://acme.com/fonts/font.woff'
                );
                assert.equal(
                    resolve('../font.woff', 'http://acme.com/fonts/woff'),
                    'http://acme.com/font.woff'
                );
            });

            it('should generate distinct uids', function () {
                const uid1 = domtoimage.impl.util.uid();
                assert(uid1.length >= 4);
                const uid2 = domtoimage.impl.util.uid();
                assert(uid2.length >= 4);
                assert.notEqual(uid1, uid2);
            });

            it('isInstanceOf matches real constructors across realms', function () {
                const div = document.createElement('div');
                const img = document.createElement('img');
                assert.isTrue(domtoimage.impl.util.isInstanceOf(div, 'HTMLElement'));
                assert.isTrue(domtoimage.impl.util.isInstanceOf(img, 'HTMLImageElement'));
                assert.isFalse(
                    domtoimage.impl.util.isInstanceOf(div, 'HTMLImageElement')
                );
            });

            it('isInstanceOf returns false instead of throwing for a missing constructor (issue #184)', function () {
                const div = document.createElement('div');
                // A bare `value instanceof window['NoSuchConstructorXYZ']` throws
                // "Right-hand side of 'instanceof' is not an object".
                assert.doesNotThrow(function () {
                    domtoimage.impl.util.isInstanceOf(div, 'NoSuchConstructorXYZ');
                });
                assert.isFalse(
                    domtoimage.impl.util.isInstanceOf(div, 'NoSuchConstructorXYZ')
                );
            });

            it('makeImage rejects with a real Error, not a bare Event (issues #201, #152)', function (done) {
                // A malformed image source makes the <img> fire onerror; the
                // rejection must be a real Error with a message (not the raw
                // Event, which surfaces as an opaque "Uncaught (in promise) Event").
                domtoimage.impl.util
                    .makeImage('data:image/png;base64,!not-valid-base64!')
                    .then(function () {
                        done(new Error('expected makeImage to reject'));
                    })
                    .catch(function (err) {
                        assert.instanceOf(err, Error);
                        assert.match(err.message, /dom-to-image-more/);
                        assert.ok(err.cause, 'original event preserved as cause');
                        done();
                    });
            });

            it('offscreen helper styles must be applied with Object.assign, not assignment (guards #214/#199)', function () {
                // The offscreen sandbox iframe / makeImage svg MUST be positioned
                // with Object.assign(el.style, offscreen). A plain `el.style = {}`
                // is a silent no-op (style is [PutForwards=cssText] → "[object
                // Object]" → ignored), which left the sandbox iframe in normal flow
                // and caused the scrollbar flicker/jerk. This guards against anyone
                // "simplifying" it back to the broken assignment form.
                const offscreen = {
                    position: 'fixed',
                    left: '-9999px',
                    visibility: 'hidden',
                };

                const broken = document.createElement('div');
                broken.style = offscreen; // the no-op pattern
                assert.equal(
                    broken.style.position,
                    '',
                    'el.style = {object} must NOT apply styles'
                );

                const correct = document.createElement('div');
                Object.assign(correct.style, offscreen); // the fix
                assert.equal(correct.style.position, 'fixed');
                assert.equal(correct.style.left, '-9999px');
                assert.equal(correct.style.visibility, 'hidden');
            });
        });

        describe('web fonts', function () {
            const fontFaces = domtoimage.impl.fontFaces;

            it('should read non-local font faces', function (done) {
                loadTestPage('fonts/web-fonts/empty.html', 'fonts/web-fonts/rules.css')
                    .then(function () {
                        return fontFaces.impl.readAll();
                    })
                    .then(function (webFonts) {
                        assert.equal(webFonts.length, 3);
                        const sources = webFonts.map(function (webFont) {
                            return webFont.src();
                        });
                        assertSomeIncludesAll(sources, [
                            'http://fonts.com/font1.woff',
                            'http://fonts.com/font1.woff2',
                        ]);
                        assertSomeIncludesAll(sources, [
                            'http://fonts.com/font2.ttf?v1.1.3',
                        ]);
                        assertSomeIncludesAll(sources, ['data:font/woff2;base64,AAA']);
                    })
                    .then(done)
                    .catch(done);
            });

            it('readAll skips stylesheets whose cssRules access throws (cross-origin SecurityError) — issue #161', function (done) {
                // A cross-origin stylesheet (e.g. accounts.google.com/gsi/style)
                // throws SecurityError when its cssRules are read. getCssRules has
                // guarded this with try/catch since the fork (v2.7.1); lock in that
                // it skips the unreadable sheet and still resolves rather than
                // letting the SecurityError reject the whole render.
                function ThrowingSheet() {}
                Object.defineProperty(ThrowingSheet.prototype, 'cssRules', {
                    get: function () {
                        throw new DOMException('blocked', 'SecurityError');
                    },
                });
                const sheet = new ThrowingSheet();
                sheet.href = 'https://accounts.google.com/gsi/style';

                Object.defineProperty(document, 'styleSheets', {
                    configurable: true,
                    get: function () {
                        return [sheet];
                    },
                });
                try {
                    // readAll() reads document.styleSheets synchronously here, so
                    // it captures the throwing sheet before the finally restores.
                    fontFaces.impl
                        .readAll()
                        .then(function (webFonts) {
                            assert.isArray(webFonts); // resolved, did not throw
                        })
                        .then(done)
                        .catch(done);
                } finally {
                    delete document.styleSheets; // restore the native accessor
                }
            });

            function assertSomeIncludesAll(haystacks, needles) {
                const found = haystacks.some(function (haystack) {
                    return needles.every(function (needle) {
                        return haystack.indexOf(needle) !== -1;
                    });
                });
                if (!found) {
                    assert.fail(
                        `\nnone of\n[ ${haystacks.join(
                            '\n'
                        )} ]\nincludes all of \n[ ${needles.join(', ')} ]\n`
                    );
                }
            }
        });

        describe('images', function () {
            it('should not inline images with data url', function (done) {
                const originalSrc = 'data:image/jpeg;base64,AAA';
                const img = new Image();
                img.src = originalSrc;

                domtoimage.impl.images.impl
                    .newImage(img)
                    .inline(function () {
                        return Promise.resolve('XXX');
                    })
                    .then(function () {
                        assert.equal(img.src, originalSrc);
                    })
                    .then(done)
                    .catch(done);
            });

            it('should handle HTTP status 0 (network error) with placeholder', function (done) {
                const originalXHR = global.XMLHttpRequest;
                try {
                    domtoimage.impl.copyOptions({}); // since we're bypassing the normal options flow
                    domtoimage.impl.options.imagePlaceholder = validPlaceholder;

                    // Mock XMLHttpRequest to simulate status 0
                    global.XMLHttpRequest = function () {
                        const mockXHR = {
                            readyState: XMLHttpRequest.UNSENT,
                            status: 0,
                            response: null,
                            onloadend: null,
                            onerror: null,
                            ontimeout: null,
                            responseType: '',
                            timeout: 0,
                            withCredentials: false,
                            open: function () {},
                            send: function () {
                                // Simulate the request completing with status 0
                                setTimeout(() => {
                                    mockXHR.readyState = XMLHttpRequest.DONE;
                                    mockXHR.status = 0;
                                    if (mockXHR.onloadend) {
                                        mockXHR.onloadend();
                                    }
                                }, 10);
                            },
                            setRequestHeader: function () {},
                        };
                        return mockXHR;
                    };

                    domtoimage.impl.util
                        .getAndEncode(
                            'http://example.com/test-image-with-placeholder.png'
                        )
                        .then(function (resource) {
                            assert.equal(resource, validPlaceholder);
                        })
                        .then(done)
                        .catch(done);
                } finally {
                    global.XMLHttpRequest = originalXHR;
                }
            });

            it('should handle HTTP status 0 (network error) without placeholder', function (done) {
                const originalXHR = global.XMLHttpRequest;
                try {
                    domtoimage.impl.copyOptions({}); // since we're bypassing the normal options flow
                    domtoimage.impl.options.imagePlaceholder = undefined;

                    // Mock XMLHttpRequest to simulate status 0
                    global.XMLHttpRequest = function () {
                        const mockXHR = {
                            readyState: XMLHttpRequest.UNSENT,
                            status: 0,
                            response: null,
                            onloadend: null,
                            ontimeout: null,
                            responseType: '',
                            timeout: 0,
                            withCredentials: false,
                            open: function () {},
                            send: function () {
                                // Simulate the request completing with status 0
                                setTimeout(() => {
                                    mockXHR.readyState = XMLHttpRequest.DONE;
                                    mockXHR.status = 0;
                                    if (mockXHR.onloadend) {
                                        mockXHR.onloadend();
                                    }
                                }, 10);
                            },
                            setRequestHeader: function () {},
                        };
                        return mockXHR;
                    };

                    domtoimage.impl.util
                        .getAndEncode(
                            'http://example.com/test-image-without-placeholder.png'
                        )
                        .then(function (resource) {
                            // Should return empty string when status is 0 and no placeholder
                            assert.equal(resource, '');
                        })
                        .then(done)
                        .catch(done);
                } finally {
                    global.XMLHttpRequest = originalXHR;
                }
            });

            function mockFailingXHR(status) {
                return function () {
                    const mockXHR = {
                        readyState: XMLHttpRequest.UNSENT,
                        status: 0,
                        response: null,
                        onloadend: null,
                        ontimeout: null,
                        responseType: '',
                        timeout: 0,
                        withCredentials: false,
                        open: function () {},
                        send: function () {
                            setTimeout(() => {
                                mockXHR.readyState = XMLHttpRequest.DONE;
                                mockXHR.status = status;
                                if (mockXHR.onloadend) {
                                    mockXHR.onloadend();
                                }
                            }, 10);
                        },
                        setRequestHeader: function () {},
                    };
                    return mockXHR;
                };
            }

            it('should invoke onImageError (without placeholder) when a fetch fails', function (done) {
                const originalXHR = global.XMLHttpRequest;
                try {
                    domtoimage.impl.copyOptions({});
                    domtoimage.impl.options.imagePlaceholder = undefined;

                    let reported = null;
                    domtoimage.impl.options.onImageError = function (info) {
                        reported = info;
                    };

                    global.XMLHttpRequest = mockFailingXHR(404);

                    const url = 'http://example.com/onImageError-no-placeholder.png';
                    domtoimage.impl.util
                        .getAndEncode(url)
                        .then(function (resource) {
                            assert.equal(resource, '');
                            assert.ok(reported, 'onImageError should have been called');
                            assert.equal(reported.url, url);
                            assert.equal(reported.status, 404);
                            assert.equal(reported.willUsePlaceholder, false);
                            assert.isString(reported.message);
                        })
                        .then(done)
                        .catch(done);
                } finally {
                    // We don't reset onImageError here — the mocked failure fires
                    // asynchronously (after this synchronous finally), and the next
                    // test's copyOptions({}) clears it anyway.
                    global.XMLHttpRequest = originalXHR;
                }
            });

            it('should invoke onImageError (willUsePlaceholder) when a placeholder is set', function (done) {
                const originalXHR = global.XMLHttpRequest;
                try {
                    domtoimage.impl.copyOptions({});
                    domtoimage.impl.options.imagePlaceholder = validPlaceholder;

                    let reported = null;
                    domtoimage.impl.options.onImageError = function (info) {
                        reported = info;
                    };

                    global.XMLHttpRequest = mockFailingXHR(500);

                    const url = 'http://example.com/onImageError-with-placeholder.png';
                    domtoimage.impl.util
                        .getAndEncode(url)
                        .then(function (resource) {
                            assert.equal(resource, validPlaceholder);
                            assert.ok(reported, 'onImageError should have been called');
                            assert.equal(reported.url, url);
                            assert.equal(reported.status, 500);
                            assert.equal(reported.willUsePlaceholder, true);
                        })
                        .then(done)
                        .catch(done);
                } finally {
                    global.XMLHttpRequest = originalXHR;
                }
            });

            it('should not let a throwing onImageError handler break the render', function (done) {
                const originalXHR = global.XMLHttpRequest;
                try {
                    domtoimage.impl.copyOptions({});
                    domtoimage.impl.options.imagePlaceholder = undefined;
                    domtoimage.impl.options.onImageError = function () {
                        throw new Error('boom');
                    };

                    global.XMLHttpRequest = mockFailingXHR(404);

                    domtoimage.impl.util
                        .getAndEncode('http://example.com/onImageError-throws.png')
                        .then(function (resource) {
                            // The throwing handler is swallowed; the fetch still
                            // resolves to the empty-string fallback.
                            assert.equal(resource, '');
                        })
                        .then(done)
                        .catch(done);
                } finally {
                    // Leave the throwing handler in place so it actually fires on
                    // the async failure (proving it's caught); the next test's
                    // copyOptions({}) clears it before any further fetch.
                    global.XMLHttpRequest = originalXHR;
                }
            });

            it('should not use placeholder when HTTP status 0 occurs with a local file', function (done) {
                const originalXHR = global.XMLHttpRequest;
                try {
                    domtoimage.impl.copyOptions({}); // since we're bypassing the normal options flow
                    domtoimage.impl.options.imagePlaceholder = validPlaceholder;

                    // Mock XMLHttpRequest to simulate status 0
                    global.XMLHttpRequest = function () {
                        const mockXHR = {
                            readyState: XMLHttpRequest.UNSENT,
                            status: 0,
                            response: null,
                            onloadend: null,
                            ontimeout: null,
                            responseType: '',
                            timeout: 0,
                            withCredentials: false,
                            open: function () {},
                            send: function () {
                                // Simulate the request completing with status 0
                                setTimeout(() => {
                                    mockXHR.readyState = XMLHttpRequest.DONE;
                                    mockXHR.status = 0;
                                    mockXHR.response = testPNGBlob(); // Simulate a local file response
                                    if (mockXHR.onloadend) {
                                        mockXHR.onloadend();
                                    }
                                }, 10);
                            },
                            setRequestHeader: function () {},
                        };
                        return mockXHR;
                    };

                    domtoimage.impl.util
                        .getAndEncode('file://test-image-no-placeholder.png')
                        .then(function (resource) {
                            // Should NOT return the placeholder since a zero status is expected for local files
                            assert.notEqual(resource, validPlaceholder);
                        })
                        .then(done)
                        .catch(done);
                } finally {
                    global.XMLHttpRequest = originalXHR;
                }
            });
        });

        describe('styles', function () {
            it('should compute correct keys', function (done) {
                this.timeout(30000);
                loadTestPage(
                    'padding/dom-node.html',
                    'padding/style.css',
                    'padding/control-image'
                )
                    .then(() => renderToSvg(domNode(), { styleCaching: 'strict' }))
                    .then((strict) =>
                        renderToSvg(domNode(), { styleCaching: 'relaxed' }).then(
                            (relaxed) => {
                                if (strict !== relaxed) {
                                    console.log(
                                        `\n\nstrict: ${strict}\n\nrelaxed: ${relaxed}\n\n`
                                    );
                                }
                                assert.equal(strict, relaxed, 'SVG rendered be same');
                            }
                        )
                    )
                    .then(done)
                    .catch(done);
            });
        });

        function loadTestPage(html, css, controlImage) {
            currentControlPath = controlImage || null;
            return loadPage()
                .then(function (document) {
                    if (!html) return document;

                    return getResource(html).then(function (html) {
                        document.querySelector('#dom-node').innerHTML = html;
                        return document;
                    });
                })
                .then(function (document) {
                    if (!css) return document;

                    return getResource(css).then(function (css) {
                        document
                            .querySelector('#style')
                            .append(document.createTextNode(css));
                        return document;
                    });
                })
                .then(function (document) {
                    if (!controlImage) return document;

                    return getResource(controlImage).then(function (image) {
                        document
                            .querySelector('#control-image')
                            .setAttribute('src', image);
                        return document;
                    });
                });
        }

        // Poll `predicate` once per animation frame until it returns truthy or the
        // timeout elapses. Used to await asynchronously-applied state (e.g. an
        // external <link> stylesheet that loadTestPage does not block on).
        function waitForCondition(predicate, timeoutMs) {
            const deadline = Date.now() + (timeoutMs || 2000);
            return new Promise(function (resolve, reject) {
                (function poll() {
                    let satisfied = false;
                    try {
                        satisfied = predicate();
                    } catch (_e) {
                        satisfied = false;
                    }
                    if (satisfied) {
                        resolve();
                    } else if (Date.now() > deadline) {
                        reject(new Error('waitForCondition timed out'));
                    } else {
                        requestAnimationFrame(poll);
                    }
                })();
            });
        }

        function loadPage() {
            return getResource('page.html').then(function (html) {
                const root = document.createElement('div');
                root.id = 'test-root';
                root.innerHTML = html;
                document.body.appendChild(root);
                return document;
            });
        }

        function purgePage() {
            const root = document.querySelector('#test-root');
            if (root) {
                root.remove();
            }
        }

        function domNode() {
            return document.querySelectorAll('#dom-node')[0];
        }

        function clonedNode() {
            return document.querySelectorAll('#cloned-node')[0];
        }

        function controlImage() {
            return document.querySelectorAll('#control-image')[0];
        }

        function canvas() {
            return document.querySelectorAll('#canvas')[0];
        }

        function getResource(fileName) {
            const url = BASE_URL + fileName;
            const request = new XMLHttpRequest();
            request.open('GET', url, true);
            request.responseType = 'text';

            return new Promise(function (resolve, reject) {
                request.onload = function () {
                    if (this.status === 200) {
                        resolve(request.response.toString().trim());
                    } else {
                        reject(new Error(`cannot load ${url}`));
                    }
                };
                request.send();
            });
        }

        const debugOptions = { onclone: cloneCatcher, debugCache: true };

        function cloneCatcher(clone) {
            clonedNode().replaceChildren(clone);
            return clone;
        }

        // all of these helpers completely ignore the incoming node as it usually is the test page

        function renderToBlob(_node, options) {
            /* jshint unused:false */
            return domtoimage.toBlob(domNode(), Object.assign({}, debugOptions, options));
        }

        function renderToJpeg(_node, options) {
            /* jshint unused:false */
            return domtoimage.toJpeg(domNode(), Object.assign({}, debugOptions, options));
        }

        function renderToPixelData(_node, options) {
            /* jshint unused:false */
            return domtoimage.toPixelData(
                domNode(),
                Object.assign({}, debugOptions, options)
            );
        }

        function renderToPng(_node, options) {
            /* jshint unused:false */
            return domtoimage.toPng(domNode(), Object.assign({}, debugOptions, options));
        }

        function renderChildToPng(_node, options) {
            /* jshint unused:false */
            const firstChild = domNode().childNodes[0];
            return domtoimage.toPng(firstChild, Object.assign({}, debugOptions, options));
        }

        function renderToSvg(_node, options) {
            /* jshint unused:false */
            return domtoimage.toSvg(domNode(), Object.assign({}, debugOptions, options));
        }

        function testPNGBlob() {
            // create a PNG Blob (1x1 pixel with 0xaabbccff color)
            const pngBase64 =
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8//8/AwAI/wH+9QAAAABJRU5ErkJggg==';
            const byteCharacters = atob(pngBase64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'image/png' });
            return blob;
        }
    });
})(this);
