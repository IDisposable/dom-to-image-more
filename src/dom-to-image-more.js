(function (global) {
    'use strict';

    const util = newUtil();
    const inliner = newInliner();
    const fontFaces = newFontFaces();
    const images = newImages();
    const offscreen = {
        position: 'fixed',
        left: '-9999px',
        visibility: 'hidden',
    };
    // Default impl options
    const defaultOptions = {
        // Default is to copy default styles of elements
        copyDefaultStyles: true,
        // Default is to fail on error, no placeholder
        imagePlaceholder: undefined,
        // Default cache bust is false, it will use the cache
        cacheBust: false,
        // Use (existing) authentication credentials for external URIs (CORS requests)
        useCredentials: false,
        // Use (existing) authentication credentials for external URIs (CORS requests) on some filtered requests only
        useCredentialsFilters: [],
        // Default resolve timeout
        httpTimeout: 30000,
        // Style computation cache tag rules (options are strict, relaxed)
        styleCaching: 'strict',
        // Default cors config is to request the image address directly
        corsImg: undefined,
        // Callback for adjustClonedNode eventing (to allow adjusting clone's properties)
        adjustClonedNode: undefined,
        // Callback to filter style properties to be included in the output
        filterStyles: undefined,
        // Callback to filter urls to be downloaded and inlined in the output
        filterUrls: undefined,
        // Callback invoked when a resource (image/font) cannot be fetched; receives
        // { url, message, status, willUsePlaceholder }. Purely observational — the
        // render still degrades gracefully (placeholder or empty string).
        onImageError: undefined,
        // Opt-in: force the explicitly-captured root to be shown even if it is hidden
        // by its own display:none / opacity:0 (visibility:hidden is always handled).
        // Root-only; per-element hiding inside the subtree is left intact.
        ensureShown: false,
        // Device-pixel-ratio multiplier for the rasterized canvas output (png/jpeg/
        // blob/canvas). Defaults to 1 (CSS pixels, unchanged). Set to
        // window.devicePixelRatio for crisp high-DPI/Retina output. Composes with
        // `scale` (effective multiplier = scale * pixelRatio).
        pixelRatio: 1,
    };

    const domtoimage = {
        toSvg: toSvg,
        toPng: toPng,
        toJpeg: toJpeg,
        toBlob: toBlob,
        toPixelData: toPixelData,
        toCanvas: toCanvas,
        impl: {
            fontFaces: fontFaces,
            images: images,
            util: util,
            inliner: inliner,
            urlCache: [],
            options: {},
            copyOptions: copyOptions,
        },
    };

    if (typeof exports === 'object' && typeof module === 'object') {
        module.exports = domtoimage; // eslint-disable-line no-undef
    } else {
        global.domtoimage = domtoimage;
    }

    // support node and browsers
    const ELEMENT_NODE =
        (typeof Node !== 'undefined' ? Node.ELEMENT_NODE : undefined) || 1;
    const getComputedStyle = resolveGlobal('getComputedStyle');
    const atob = resolveGlobal('atob');

    // Resolve a global by name across node/browser/worker contexts.
    function resolveGlobal(name) {
        return (
            (typeof global !== 'undefined' ? global[name] : undefined) ||
            (typeof window !== 'undefined' ? window[name] : undefined) ||
            globalThis[name]
        );
    }

    /**
     * @param {Node} node - The DOM Node object to render
     * @param {Object} options - Rendering options
     * @param {Function} options.filter - Should return true if passed node should be included in the output
     *          (excluding node means excluding it's children as well). Not called on the root node.
     * @param {Function} options.onclone - Callback function which is called when the Document has been cloned for
     *         rendering, can be used to modify the contents that will be rendered without affecting the original
     *         source document.
     * @param {String} options.bgcolor - color for the background, any valid CSS color value.
     * @param {Number} options.width - width to be applied to node before rendering.
     * @param {Number} options.height - height to be applied to node before rendering.
     * @param {Object} options.style - an object whose properties to be copied to node's style before rendering.
     * @param {Number} options.quality - a Number between 0 and 1 indicating image quality (applicable to JPEG only),
                defaults to 1.0.
     * @param {Number} options.scale - a Number multiplier to scale up the canvas before rendering to reduce fuzzy images, defaults to 1.0.
     * @param {Number} options.pixelRatio - device-pixel-ratio multiplier for the rasterized canvas (png/jpeg/blob/canvas); set to window.devicePixelRatio for crisp high-DPI output. Composes with scale. Defaults to 1.0.
     * @param {String} options.imagePlaceholder - dataURL to use as a placeholder for failed images, default behaviour is to fail fast on images we can't fetch
     * @param {Boolean} options.cacheBust - set to true to cache bust by appending the time to the request url
     * @param {String} options.styleCaching - set to 'strict', 'relaxed' to select style caching rules
     * @param {Boolean} options.copyDefaultStyles - set to false to disable use of default styles of elements
     * @param {Boolean} options.disableEmbedFonts - set to true to disable font embedding into the SVG output.
     * @param {Boolean} options.disableInlineImages - set to true to disable inlining images into the SVG output.
     * @param {Object} options.corsImg - When the image is restricted by the server from cross-domain requests, the proxy address is passed in to get the image
     *         - @param {String} url - eg: https://cors-anywhere.herokuapp.com/
     *         - @param {Enumerator} method - get, post
     *         - @param {Object} headers - eg: { "Content-Type", "application/json;charset=UTF-8" }
     *         - @param {Object} data - post payload
     * @param {Function} options.adjustClonedNode - callback for adjustClonedNode eventing (to allow adjusting clone's properties)
     * @param {Function} options.filterStyles - Should return true if passed propertyName should be included in the output
     * @param {Function} options.onImageError - called when a resource fails to fetch with { url, message, status, willUsePlaceholder }; observational only
     * @return {Promise} - A promise that is fulfilled with a SVG image data URL
     * */
    function toSvg(node, options) {
        const ownerWindow = domtoimage.impl.util.getWindow(node);
        options = options || {};
        domtoimage.impl.copyOptions(options);
        const restorations = [];

        svgRefsToInline = [];

        // Rendering needs a live DOM. Under SSR (Angular Universal, Next.js, …)
        // there is no document, so fail with a short, catchable error instead of a
        // raw ReferenceError deep in the pipeline (issue #83; see the README "Things
        // to watch out for" note on SSR). A real node — incl. jsdom — carries its
        // own document via ownerWindow, so this only trips when genuinely DOM-less.
        if (!ownerWindow || !ownerWindow.document) {
            return Promise.reject(
                new Error('dom-to-image-more: a browser DOM is required (SSR)')
            );
        }

        return waitForDocumentFonts()
            .then(function () {
                return ensureElement(node);
            })
            .then(function (clonee) {
                return cloneNode(clonee, options, null, ownerWindow);
            })
            .then(injectSvgRefs)
            .then(options.disableEmbedFonts ? Promise.resolve(node) : embedFonts)
            .then(options.disableInlineImages ? Promise.resolve(node) : inlineImages)
            .then(applyOptions)
            .then(makeSvgDataUri)
            .finally(cleanup);

        // Wait for any web fonts already loading in the source document to settle
        // before we read computed styles, clone, and rasterize — a capture taken
        // while the page's own fonts are mid-load would otherwise measure/snapshot
        // fallback glyphs (wrong metrics, or missing icon glyphs). The CSS Font
        // Loading API is not universal (older browsers, SSR/jsdom), so feature-detect;
        // race a timeout (httpTimeout) so a perpetually-pending font can't hang. If
        // the timeout wins we render anyway but warn, since the result may be missing
        // glyphs or laid out with fallback metrics.
        function waitForDocumentFonts() {
            const doc = ownerWindow.document;
            if (!doc.fonts || !doc.fonts.ready) {
                return Promise.resolve();
            }
            const cap = domtoimage.impl.options.httpTimeout || 30000;
            let timer;
            const ready = Promise.resolve(doc.fonts.ready).then(
                function () {
                    return false;
                },
                function () {
                    return false;
                }
            );
            const timeout = new Promise(function (resolve) {
                timer = ownerWindow.setTimeout(function () {
                    resolve(true);
                }, cap);
            });
            return Promise.race([ready, timeout]).then(function (timedOut) {
                ownerWindow.clearTimeout(timer);
                if (timedOut) {
                    console.warn(
                        'dom-to-image-more: timed out after ' +
                            cap +
                            'ms waiting for document fonts to finish loading ' +
                            '(document.fonts.ready); rendering anyway — the output ' +
                            'may have missing glyphs or fallback-font metrics.'
                    );
                }
            });
        }

        function ensureElement(node) {
            if (node.nodeType === ELEMENT_NODE) return node;

            const originalChild = node;
            const originalParent = node.parentNode;
            if (!originalParent) {
                throw new Error(
                    'Cannot render a non-element node that is not attached to a parent; ' +
                        'wrap it in an element or attach it to the document first.'
                );
            }
            const wrappingSpan = document.createElement('span');
            originalParent.replaceChild(wrappingSpan, originalChild);
            wrappingSpan.append(node);
            restorations.push({
                parent: originalParent,
                child: originalChild,
                wrapper: wrappingSpan,
            });
            return wrappingSpan;
        }

        // Runs on both success and failure (via .finally) so a render that rejects
        // partway can't leak the wrapper spans or the sandbox iframe into the
        // document, or leave the per-render url cache populated.
        function cleanup() {
            restoreWrappers();
            domtoimage.impl.urlCache = [];
            svgRefsToInline = [];
            removeSandbox();
        }

        // Prepend a hidden <svg><defs> holding any out-of-subtree elements that
        // <use> nodes referenced (issue #215), so the standalone clone is
        // self-contained. Ids already present in the clone are skipped to avoid
        // duplicates. Returns the clone unchanged so the chain flows through.
        function injectSvgRefs(clone) {
            if (svgRefsToInline.length === 0) {
                return clone;
            }
            const NS = 'http://www.w3.org/2000/svg';
            const holder = document.createElementNS(NS, 'svg');
            holder.setAttribute('xmlns', NS);
            holder.setAttribute('width', '0');
            holder.setAttribute('height', '0');
            holder.style.setProperty('position', 'absolute');
            holder.style.setProperty('width', '0');
            holder.style.setProperty('height', '0');
            holder.style.setProperty('overflow', 'hidden');
            const defs = document.createElementNS(NS, 'defs');
            holder.appendChild(defs);

            const existingIds = new Set();
            if (clone.getAttribute('id')) {
                existingIds.add(clone.getAttribute('id'));
            }
            clone.querySelectorAll('[id]').forEach(function (el) {
                existingIds.add(el.getAttribute('id'));
            });

            let injected = 0;
            svgRefsToInline.forEach(function (ref) {
                if (existingIds.has(ref.id)) {
                    return; // already in the clone
                }
                defs.appendChild(ref.node);
                injected += 1;
            });

            if (injected > 0) {
                clone.insertBefore(holder, clone.firstChild);
            }
            return clone;
        }

        function restoreWrappers() {
            // put the original children back where the wrappers were inserted
            while (restorations.length > 0) {
                const restoration = restorations.pop();
                try {
                    restoration.parent.replaceChild(
                        restoration.child,
                        restoration.wrapper
                    );
                } catch (e) {
                    // The DOM may have been mutated mid-render; restore
                    // best-effort and never let cleanup throw (it would mask the
                    // real success value or error).
                    console.error('domtoimage: failed to restore wrapped node', e);
                }
            }
        }

        function applyOptions(clone) {
            // The captured root's own margin would offset it inside the fixed-size
            // <foreignObject> and clip it out of the canvas (issue #38). Neutralize
            // it on the root only (descendant margins drive internal layout and are
            // left intact). A user can still set one explicitly via options.style.
            if (clone.style) {
                clone.style.margin = '0';
            }
            if (options.bgcolor) {
                clone.style.backgroundColor = options.bgcolor;
            }
            if (options.width) {
                clone.style.width = `${options.width}px`;
            }
            if (options.height) {
                clone.style.height = `${options.height}px`;
            }
            if (options.style) {
                Object.assign(clone.style, options.style);
            }

            let onCloneResult = null;

            if (typeof options.onclone === 'function') {
                onCloneResult = options.onclone(clone);
            }

            return Promise.resolve(onCloneResult).then(function () {
                return clone;
            });
        }

        function makeSvgDataUri(clone) {
            // A non-root SVG element (`<g>`, `<path>`, `<circle>`, …) is meaningless
            // inside an XHTML `<foreignObject>` and fails to rasterize (issue #205).
            // Wrap it in a real synthesized `<svg>` framed by its bounding box instead.
            if (util.isSVGElement(node) && !util.isSVGSVGElement(node)) {
                return makeNonRootSvgDataUri(clone);
            }

            const finalizeEnsureShown = revealRootIfHidden(clone);
            let width;
            let height;
            try {
                width = options.width || util.width(node);
                height = options.height || util.height(node);
            } finally {
                finalizeEnsureShown();
            }

            return Promise.resolve(clone)
                .then(function (svg) {
                    svg.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
                    return new XMLSerializer().serializeToString(svg);
                })
                .then(normalizeCssUrlQuotes)
                .then(util.escapeXhtml)
                .then(function (xhtml) {
                    const foreignObjectSizing =
                        (util.isDimensionMissing(width)
                            ? ' width="100%"'
                            : ` width="${width}"`) +
                        (util.isDimensionMissing(height)
                            ? ' height="100%"'
                            : ` height="${height}"`);
                    const svgSizing =
                        (util.isDimensionMissing(width) ? '' : ` width="${width}"`) +
                        (util.isDimensionMissing(height) ? '' : ` height="${height}"`);
                    return `<svg xmlns="http://www.w3.org/2000/svg"${svgSizing}><foreignObject${foreignObjectSizing}>${xhtml}</foreignObject></svg>`;
                })
                .then(function (svg) {
                    return `data:image/svg+xml;charset=utf-8,${svg}`;
                });
        }

        // Render a non-root SVG element (`<g>`, `<path>`, …) by wrapping its clone in a
        // freshly synthesized `<svg>` framed by the original's `getBBox()` (issue #205).
        // No `<foreignObject>` and no XHTML namespace — the element is real SVG content.
        // The element's own positioning transform placed it within its *original* svg
        // and is meaningless once extracted, so it is dropped and the bbox `x/y` drives
        // the `viewBox` so the geometry frames exactly. Falls back to a 0 box if getBBox
        // is unavailable (detached / `display:none`). `ensureShown` is honored here too,
        // so a hidden `<g>`/`<path>` root is revealed before measuring (otherwise getBBox
        // throws on a `display:none` element and the capture comes out blank).
        function makeNonRootSvgDataUri(clone) {
            const SVG_NS = 'http://www.w3.org/2000/svg';
            const finalizeEnsureShown = revealRootIfHidden(clone);
            let box;
            try {
                box = node.getBBox();
            } catch (_e) {
                box = { x: 0, y: 0, width: 0, height: 0 };
            } finally {
                finalizeEnsureShown();
            }

            clone.removeAttribute('transform');
            clone.style.removeProperty('transform');

            const width = options.width || box.width;
            const height = options.height || box.height;

            return Promise.resolve(clone)
                .then(function (svgEl) {
                    svgEl.setAttribute('xmlns', SVG_NS);
                    return new XMLSerializer().serializeToString(svgEl);
                })
                .then(normalizeCssUrlQuotes)
                .then(util.escapeXhtml)
                .then(function (inner) {
                    const sizing =
                        (util.isDimensionMissing(width) ? '' : ` width="${width}"`) +
                        (util.isDimensionMissing(height) ? '' : ` height="${height}"`);
                    const viewBox = `${box.x} ${box.y} ${box.width} ${box.height}`;
                    return `<svg xmlns="${SVG_NS}"${sizing} viewBox="${viewBox}">${inner}</svg>`;
                })
                .then(function (svg) {
                    return `data:image/svg+xml;charset=utf-8,${svg}`;
                });
        }

        // Browsers normalize CSS `url()` values to double quotes, so setting one via
        // the live style (options.style, inlined images, copied computed styles) and
        // then serializing it inside the double-quoted `style="…"` attribute escapes
        // those quotes to `&quot;` — valid, but surprising and reported as broken
        // (issue #191). Rewrite `url(&quot;X&quot;)` to single-quoted `url('X')` for
        // clean, conventional output. Single quotes don't collide with the attribute
        // delimiter, so they survive serialization unescaped. Left as-is when X itself
        // contains a single quote (the `&quot;` form is still correct there). Runs on
        // the serialized string because the live style object always re-normalizes
        // back to double quotes, so it can't be fixed before serializing.
        function normalizeCssUrlQuotes(serialized) {
            return serialized.replace(
                /url\(&quot;([^]*?)&quot;\)/g,
                function (match, inner) {
                    return inner.indexOf("'") >= 0 ? match : `url('${inner}')`;
                }
            );
        }

        // `ensureShown` opt-in: make the explicitly-captured ROOT appear even if it
        // is hidden by its own `display:none` / `opacity:0` (`visibility:hidden` is
        // already handled during cloning). Root-only and never on by default — these
        // values are often deliberate, and per-element hiding inside the subtree is
        // left intact. `opacity:0` just needs the clone overridden. `display:none` has
        // no layout box, so the original is briefly revealed *in place* to measure
        // (synchronous — no paint between set and restore, so no visible flash, though
        // it does force a reflow); the measured size feeds the SVG and the clone root
        // takes the element's real revealed display. Returns a finalize() the caller
        // runs immediately after measuring (guarded with try/finally above).
        function revealRootIfHidden(clone) {
            const noop = function () {};
            if (!options.ensureShown) {
                return noop;
            }

            const computed = getComputedStyle(node);

            if (computed.getPropertyValue('opacity') === '0') {
                clone.style.setProperty('opacity', '1');
            }

            if (computed.getPropertyValue('display') !== 'none') {
                return noop;
            }

            const previousDisplay = node.style.getPropertyValue('display');
            const previousPriority = node.style.getPropertyPriority('display');

            // Reveal without clobbering the element's intended display. The common
            // case is an inline `style="display:none"`: just dropping the inline
            // declaration lets the cascade restore the *real* shown display — e.g. a
            // class's `display:flex`/`grid` — which a blanket `revert` would have
            // discarded. If a rule still hides it, force it shown, preferring the
            // element's own inline display when it had a meaningful one (e.g. inline
            // `display:flex` defeated by a stylesheet `display:none !important`) and
            // falling back to `revert` (the UA tag default) only when the intended
            // display is genuinely unknowable.
            node.style.removeProperty('display');
            if (getComputedStyle(node).getPropertyValue('display') === 'none') {
                const fallback =
                    previousDisplay && previousDisplay !== 'none'
                        ? previousDisplay
                        : 'revert';
                node.style.setProperty('display', fallback, 'important');
            }

            return function finalize() {
                const shown = getComputedStyle(node).getPropertyValue('display');
                clone.style.setProperty('display', shown === 'none' ? 'block' : shown);
                if (previousDisplay) {
                    node.style.setProperty('display', previousDisplay, previousPriority);
                } else {
                    node.style.removeProperty('display');
                }
            };
        }
    }

    /**
     * @param {Node} node - The DOM Node object to render
     * @param {Object} options - Rendering options, @see {@link toSvg}
     * @return {Promise} - A promise that is fulfilled with a Uint8Array containing RGBA pixel data.
     * */
    function toPixelData(node, options) {
        return draw(node, options).then(function (canvas) {
            return canvas
                .getContext('2d')
                .getImageData(0, 0, util.width(node), util.height(node)).data;
        });
    }

    /**
     * @param {Node} node - The DOM Node object to render
     * @param {Object} options - Rendering options, @see {@link toSvg}
     * @return {Promise} - A promise that is fulfilled with a PNG image data URL
     * */
    function toPng(node, options) {
        return draw(node, options).then(function (canvas) {
            return canvas.toDataURL();
        });
    }

    /**
     * @param {Node} node - The DOM Node object to render
     * @param {Object} options - Rendering options, @see {@link toSvg}
     * @return {Promise} - A promise that is fulfilled with a JPEG image data URL
     * */
    function toJpeg(node, options) {
        return draw(node, options).then(function (canvas) {
            return canvas.toDataURL(
                'image/jpeg',
                (options ? options.quality : undefined) || 1.0
            );
        });
    }

    /**
     * @param {Node} node - The DOM Node object to render
     * @param {Object} options - Rendering options, @see {@link toSvg}
     * @return {Promise} - A promise that is fulfilled with a PNG image blob
     * */
    function toBlob(node, options) {
        return draw(node, options).then(util.canvasToBlob);
    }

    /**
     * @param {Node} node - The DOM Node object to render
     * @param {Object} options - Rendering options, @see {@link toSvg}
     * @return {Promise} - A promise that is fulfilled with a canvas object
     * */
    function toCanvas(node, options) {
        return draw(node, options);
    }

    function copyOptions(options) {
        // Copy options to impl options for use in impl, falling back to the
        // default for any option the caller did not supply.
        Object.keys(defaultOptions).forEach(function (name) {
            domtoimage.impl.options[name] =
                typeof options[name] === 'undefined'
                    ? defaultOptions[name]
                    : options[name];
        });
    }

    function draw(domNode, options) {
        options = options || {};
        return toSvg(domNode, options)
            .then(util.makeImage)
            .then(function (image) {
                const result = newCanvas(domNode);
                const canvas = result.canvas;
                const scale = result.scale;
                const ctx = canvas.getContext('2d');
                ctx.msImageSmoothingEnabled = false;
                ctx.imageSmoothingEnabled = false;
                if (image) {
                    ctx.scale(scale, scale);
                    // Draw into an explicit width×height box rather than relying on
                    // the image's intrinsic size. Chrome derives that intrinsic size
                    // from the SVG's width/height attributes (so this is a no-op
                    // there), but Firefox computes it unreliably for an
                    // `<foreignObject>` image and otherwise crops the result to a
                    // default/intrinsic box (issue #160). Forcing the destination
                    // rectangle makes both engines fill the same canvas.
                    ctx.drawImage(image, 0, 0, result.width, result.height);
                }
                return canvas;
            });

        function newCanvas(node) {
            let width = options.width || util.width(node);
            let height = options.height || util.height(node);

            // per https://www.w3.org/TR/CSS2/visudet.html#inline-replaced-width the default width should be 300px if height
            // not set, otherwise should be 2:1 aspect ratio for whatever height is specified
            if (util.isDimensionMissing(width)) {
                width = util.isDimensionMissing(height) ? 300 : height * 2.0;
            }

            if (util.isDimensionMissing(height)) {
                height = width / 2.0;
            }

            // Effective resolution multiplier. Both default to 1, so the default
            // output is unchanged; `pixelRatio: window.devicePixelRatio` opts into
            // crisp high-DPI output, and `scale` remains an explicit upscale.
            const requestedScale =
                (typeof options.scale === 'number' ? options.scale : 1) *
                (typeof options.pixelRatio === 'number' ? options.pixelRatio : 1);
            const scale = clampScaleToCanvasLimit(width, height, requestedScale);

            const canvas = document.createElement('canvas');
            canvas.width = width * scale;
            canvas.height = height * scale;

            if (options.bgcolor) {
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = options.bgcolor;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            return { canvas: canvas, scale: scale, width: width, height: height };
        }
    }

    // Browsers cap canvas size; beyond the cap a canvas silently produces a blank or
    // partial bitmap (issue #182 "incomplete on Retina", and the #159/#160 crash/crop
    // family). When the requested `width * height * scale` canvas would exceed a
    // conservative limit, clamp the scale to fit and warn — degrading predictably
    // instead of truncating silently. Returns the original scale when it already fits.
    function clampScaleToCanvasLimit(width, height, scale) {
        // Conservative cross-browser bounds: max single dimension and max area.
        const MAX_DIMENSION = 16384;
        const MAX_AREA = MAX_DIMENSION * MAX_DIMENSION;

        // All three must be positive finite numbers; written this way (rather than
        // `<= 0`) so NaN is also rejected, since `NaN <= 0` is false.
        const allPositive = width > 0 && height > 0 && scale > 0;
        if (!allPositive) {
            return scale;
        }

        const limit = Math.min(
            MAX_DIMENSION / width,
            MAX_DIMENSION / height,
            Math.sqrt(MAX_AREA / (width * height))
        );

        if (scale <= limit) {
            return scale;
        }

        console.warn(
            'dom-to-image-more: the requested ' +
                Math.round(width * scale) +
                '×' +
                Math.round(height * scale) +
                ' canvas exceeds the browser limit; clamping the effective scale from ' +
                scale +
                ' to ' +
                limit +
                '. Capture detail may be reduced — render a smaller region or lower scale/pixelRatio.'
        );
        return limit;
    }

    let sandbox = null;

    // Referenced SVG defs (e.g. a <symbol> a <use> points at) that live OUTSIDE the
    // rendered subtree. Collected during cloning and injected into the root clone so
    // the standalone output SVG is self-contained and `<use href="#id">` resolves
    // (issue #215). Keyed by id; reset per render.
    let svgRefsToInline = [];

    function cloneNode(node, options, parentComputedStyles, ownerWindow) {
        const filter = options.filter;
        if (
            node === sandbox ||
            util.isHTMLScriptElement(node) ||
            util.isHTMLStyleElement(node) ||
            util.isHTMLLinkElement(node) ||
            (parentComputedStyles !== null && filter && !filter(node))
        ) {
            return Promise.resolve();
        }

        return Promise.resolve(node)
            .then(makeNodeCopy)
            .then(adjustCloneBefore)
            .then(function (clone) {
                return cloneChildren(clone, getParentOfChildren(node));
            })
            .then(adjustCloneAfter)
            .then(function (clone) {
                return processClone(clone, node);
            });

        function makeNodeCopy(original) {
            if (util.isHTMLCanvasElement(original)) {
                return util.makeImage(original.toDataURL());
            }
            return original.cloneNode(false);
        }

        function adjustCloneBefore(clone) {
            if (options.adjustClonedNode) {
                options.adjustClonedNode(node, clone, false);
            }
            return Promise.resolve(clone);
        }

        function adjustCloneAfter(clone) {
            if (options.adjustClonedNode) {
                options.adjustClonedNode(node, clone, true);
            }
            return Promise.resolve(clone);
        }

        function getParentOfChildren(original) {
            if (util.isElementHostForOpenShadowRoot(original)) {
                return original.shadowRoot; // jump "down" to #shadow-root
            }
            return original;
        }

        function cloneChildren(clone, original) {
            const originalChildren = getRenderedChildren(original);
            let done = Promise.resolve();

            if (originalChildren.length !== 0) {
                const originalComputedStyles = getComputedStyle(
                    getRenderedParent(original)
                );

                util.asArray(originalChildren).forEach(function (originalChild) {
                    done = done.then(function () {
                        return cloneNode(
                            originalChild,
                            options,
                            originalComputedStyles,
                            ownerWindow
                        ).then(function (clonedChild) {
                            if (clonedChild) {
                                clone.appendChild(clonedChild);
                            }
                        });
                    });
                });
            }

            return done.then(function () {
                return clone;
            });

            function getRenderedParent(original) {
                if (util.isShadowRoot(original)) {
                    return original.host; // jump up from #shadow-root to its parent <element>
                }
                return original;
            }

            function getRenderedChildren(original) {
                if (util.isShadowSlotElement(original)) {
                    const assignedNodes = original.assignedNodes();

                    if (assignedNodes && assignedNodes.length > 0) return assignedNodes; // shadow DOM <slot> has "assigned nodes" as rendered children
                }
                return original.childNodes;
            }
        }

        function processClone(clone, original) {
            if (!util.isElement(clone) || util.isShadowSlotElement(original)) {
                return Promise.resolve(clone);
            }

            return Promise.resolve()
                .then(decodeSourceImage)
                .then(cloneStyle)
                .then(clonePseudoElements)
                .then(copyUserInput)
                .then(sanitizeAttributes)
                .then(fixSvg)
                .then(fixTableCaption)
                .then(fixResponsiveImages)
                .then(function () {
                    return clone;
                });

            // Malformed source HTML (e.g. `<div id="x"">`) makes the parser create
            // attributes whose names are illegal in XML — a lone `"` here. Serialized
            // into the XHTML <foreignObject> they produce invalid markup that fails to
            // rasterize (issue #152). No valid attribute name can contain a quote,
            // `=`, `<`, `>`, `/`, or whitespace, so drop any such attribute and let the
            // capture succeed instead of erroring.
            function sanitizeAttributes() {
                if (!clone.attributes || !clone.removeAttribute) {
                    return;
                }
                const illegal = [];
                for (let i = 0; i < clone.attributes.length; i += 1) {
                    const name = clone.attributes[i].name;
                    if (/["'=<>/\s]/.test(name)) {
                        illegal.push(name);
                    }
                }
                illegal.forEach(function (name) {
                    clone.removeAttribute(name);
                });
            }

            // An <img> contributes its height from the loaded bitmap's aspect ratio.
            // If the source image hasn't decoded yet (e.g. loading="lazy", or simply
            // not yet loaded), its computed height is ~0, so cloneStyle would copy a
            // collapsed box and the picture drops out of the capture. Forcing the
            // decode first makes the dimensions real and resolves currentSrc for
            // srcset/sizes images, so the capture is deterministic regardless of when
            // the source happened to load.
            function decodeSourceImage() {
                if (
                    !util.isHTMLImageElement(original) ||
                    typeof original.decode !== 'function'
                ) {
                    return undefined;
                }

                if (original.complete && original.naturalWidth > 0) {
                    return undefined;
                }

                return original.decode().catch(function () {
                    // Broken or blocked image: nothing to wait for, proceed with
                    // whatever dimensions/source we can read below.
                });
            }

            function fixResponsiveImages() {
                if (!util.isHTMLImageElement(clone)) {
                    return;
                }

                // Remove lazy-loading and responsive attributes
                clone.removeAttribute('loading');

                // Collapse srcset/sizes down to the single source the browser chose
                // (now resolved, thanks to decodeSourceImage), so the clone renders
                // exactly that candidate.
                if (original.srcset || original.sizes) {
                    clone.removeAttribute('srcset');
                    clone.removeAttribute('sizes');
                    clone.src = original.currentSrc || original.src;
                }
            }

            function cloneStyle() {
                // Some exotic elements are real Elements but expose no `.style`
                // object — e.g. an element in a non-HTML/SVG/MathML namespace created
                // via `createElementNS`. There's nothing to copy styles onto, and
                // touching `.style` would throw "Cannot read properties of undefined"
                // (issue #151). Skip styling such a node; its structure still clones.
                if (!clone.style) {
                    return;
                }
                copyStyle(original, clone);
                fixInheritedVisibility();

                // `visibility` is inherited, but the style copy pins each element's
                // *computed* value. So an element that is hidden only because an
                // ancestor is `visibility:hidden` ends up with an explicit
                // `visibility:hidden` of its own — and so does the captured root.
                // Rendering a node from inside a hidden subtree then comes out blank
                // (issue #167). Fix: on the captured root (no parent), force it visible
                // — the caller explicitly asked to render it; on descendants, drop
                // visibility when it merely equals the parent's (i.e. inherited) so it
                // follows the now-visible root, while keeping genuine per-element
                // overrides (visible-inside-hidden, or hidden-inside-visible). Covers
                // both the fast-path and the cssText path.
                function fixInheritedVisibility() {
                    const sourceVisibility =
                        getComputedStyle(original).getPropertyValue('visibility');

                    if (parentComputedStyles === null) {
                        // 'hidden' or 'collapse' (collapse renders like hidden off
                        // tables) — both blank the explicitly-captured root.
                        if (sourceVisibility !== 'visible') {
                            clone.style.setProperty('visibility', 'visible');
                        }
                        return;
                    }

                    const parentVisibility =
                        parentComputedStyles.getPropertyValue('visibility');
                    if (sourceVisibility === parentVisibility) {
                        clone.style.removeProperty('visibility');
                    }
                }

                function copyFont(source, target) {
                    target.font = source.font;
                    target.fontFamily = source.fontFamily;
                    target.fontFeatureSettings = source.fontFeatureSettings;
                    target.fontKerning = source.fontKerning;
                    target.fontSize = source.fontSize;
                    target.fontStretch = source.fontStretch;
                    target.fontStyle = source.fontStyle;
                    target.fontVariant = source.fontVariant;
                    target.fontVariantCaps = source.fontVariantCaps;
                    target.fontVariantEastAsian = source.fontVariantEastAsian;
                    target.fontVariantLigatures = source.fontVariantLigatures;
                    target.fontVariantNumeric = source.fontVariantNumeric;
                    target.fontVariationSettings = source.fontVariationSettings;
                    target.fontWeight = source.fontWeight;
                }

                function copyStyle(sourceElement, targetElement) {
                    const sourceComputedStyles = getComputedStyle(sourceElement);
                    if (sourceComputedStyles.cssText) {
                        targetElement.style.cssText = sourceComputedStyles.cssText;
                        copyFont(sourceComputedStyles, targetElement.style); // here we re-assign the font props.
                    } else {
                        copyUserComputedStyleFast(
                            options,
                            sourceElement,
                            sourceComputedStyles,
                            parentComputedStyles,
                            targetElement
                        );

                        // Remove positioning of initial element, which stops them from being captured correctly
                        if (parentComputedStyles === null) {
                            [
                                'inset-block',
                                'inset-block-start',
                                'inset-block-end',
                            ].forEach((prop) => targetElement.style.removeProperty(prop));
                            ['left', 'right', 'top', 'bottom'].forEach((prop) => {
                                if (targetElement.style.getPropertyValue(prop)) {
                                    targetElement.style.setProperty(prop, '0px');
                                }
                            });
                        }
                    }
                }
            }

            function clonePseudoElements() {
                const cloneClassName = util.uid();

                return Promise.all([':before', ':after'].map(clonePseudoElement));

                function clonePseudoElement(element) {
                    const style = getComputedStyle(original, element);
                    const content = style.getPropertyValue('content');

                    if (content === '' || content === 'none') {
                        return undefined;
                    }

                    const currentClass = clone.getAttribute('class') || '';
                    clone.setAttribute('class', `${currentClass} ${cloneClassName}`);

                    const selector = `.${cloneClassName}:${element}`;
                    const cssText = style.cssText
                        ? `${style.cssText} content: ${content};`
                        : formatCssProperties();

                    // Inline any url() in the pseudo-element's style (a background
                    // image, a url() `content`, a mask, …). It lives inside a <style>
                    // rule, which the image inliner that walks element styles never
                    // visits — so without this the external URL can't be fetched in
                    // the standalone output and the pseudo's background drops out
                    // (issue #16).
                    return inliner.inlineAll(cssText).then(function (inlinedCssText) {
                        const styleElement = document.createElement('style');
                        styleElement.appendChild(
                            document.createTextNode(`${selector}{${inlinedCssText}}`)
                        );
                        clone.appendChild(styleElement);
                    });

                    function formatCssProperties() {
                        const styleText = util
                            .asArray(style)
                            .map(formatProperty)
                            .join('; ');
                        return `${styleText};`;

                        function formatProperty(name) {
                            const propertyValue = style.getPropertyValue(name);
                            const propertyPriority = style.getPropertyPriority(name)
                                ? ' !important'
                                : '';
                            return `${name}: ${propertyValue}${propertyPriority}`;
                        }
                    }
                }
            }

            function copyUserInput() {
                if (util.isHTMLTextAreaElement(original)) {
                    clone.innerHTML = original.value;
                }
                if (util.isHTMLInputElement(original)) {
                    clone.setAttribute('value', original.value);
                }
            }

            function fixSvg() {
                if (util.isSVGElement(clone)) {
                    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

                    if (util.isSVGRectElement(clone)) {
                        ['width', 'height'].forEach(function (attribute) {
                            const value = clone.getAttribute(attribute);
                            if (value) {
                                clone.style.setProperty(attribute, value);
                            }
                        });
                    }

                    if (util.isSVGUseElement(clone)) {
                        collectUseReference(original);
                    }
                }
            }

            // A `<table>`'s computed height is its full element box, but the CSS
            // `height` property on a table sizes only the *grid box* (the rows) — a
            // `<caption>` is laid out outside that box. So copying the computed height
            // back onto the clone as an inline style makes the caption stack on top of
            // an already-full-height grid, growing the table by the caption's height and
            // pushing trailing siblings out of the (correctly-sized) output, which clips
            // them (issue #209). Dropping the explicit height lets the grid size itself
            // from the faithfully-cloned row heights, with the caption outside as it is
            // in the live page. Scoped to captioned tables so other tables are untouched.
            function fixTableCaption() {
                if (!util.isElement(clone) || !originalHasCaption()) {
                    return;
                }
                const display = getComputedStyle(original).getPropertyValue('display');
                if (display !== 'table' && display !== 'inline-table') {
                    return;
                }
                clone.style.removeProperty('height');
                clone.style.removeProperty('block-size');
            }

            function originalHasCaption() {
                const children = original.children || [];
                for (let i = 0; i < children.length; i += 1) {
                    if (children[i].tagName === 'CAPTION') {
                        return true;
                    }
                }
                return false;
            }

            // A <use href="#id"> often points at a <symbol>/element defined elsewhere
            // on the page, OUTSIDE the node being rendered — so that target is never
            // cloned and the <use> renders nothing. Collect a deep copy of the target
            // here; it's injected into the root clone later so the reference resolves
            // in the standalone output. (Same-document fragment refs only; external
            // sprite files `sprite.svg#id` are left untouched.)
            function collectUseReference(originalUse) {
                const href =
                    originalUse.getAttribute('href') ||
                    originalUse.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
                    originalUse.getAttribute('xlink:href');
                if (!href || href.charAt(0) !== '#') {
                    return;
                }
                const id = href.slice(1);
                if (svgRefsToInline.some((ref) => ref.id === id)) {
                    return; // already collected
                }
                const referenced = originalUse.ownerDocument.getElementById(id);
                if (!referenced) {
                    return;
                }
                const referencedClone = referenced.cloneNode(true);
                referencedClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                svgRefsToInline.push({ id: id, node: referencedClone });
            }
        }
    }

    function embedFonts(node) {
        return fontFaces.resolveAll().then(function (cssText) {
            if (cssText !== '') {
                const styleNode = document.createElement('style');
                node.appendChild(styleNode);
                styleNode.appendChild(document.createTextNode(cssText));
            }
            return node;
        });
    }

    function inlineImages(node) {
        return images.inlineAll(node).then(function () {
            return node;
        });
    }

    function newUtil() {
        let uid_index = 0;

        return {
            escape: escapeRegEx,
            isDataUrl: isDataUrl,
            canvasToBlob: canvasToBlob,
            resolveUrl: resolveUrl,
            getAndEncode: getAndEncode,
            uid: uid,
            asArray: asArray,
            escapeXhtml: escapeXhtml,
            makeImage: makeImage,
            width: width,
            height: height,
            getWindow: getWindow,
            isElement: isElement,
            isElementHostForOpenShadowRoot: isElementHostForOpenShadowRoot,
            isShadowRoot: isShadowRoot,
            isInShadowRoot: isInShadowRoot,
            isHTMLElement: isHTMLElement,
            isHTMLCanvasElement: isHTMLCanvasElement,
            isHTMLInputElement: isHTMLInputElement,
            isHTMLImageElement: isHTMLImageElement,
            isHTMLLinkElement: isHTMLLinkElement,
            isHTMLScriptElement: isHTMLScriptElement,
            isHTMLStyleElement: isHTMLStyleElement,
            isHTMLTextAreaElement: isHTMLTextAreaElement,
            isShadowSlotElement: isShadowSlotElement,
            isSVGElement: isSVGElement,
            isSVGImageElement: isSVGImageElement,
            isSVGSVGElement: isSVGSVGElement,
            isSVGRectElement: isSVGRectElement,
            isSVGUseElement: isSVGUseElement,
            isDimensionMissing: isDimensionMissing,
            isInstanceOf: isInstanceOf,
        };

        function getWindow(node) {
            const ownerDocument = node ? node.ownerDocument : undefined;
            // Bare `window`/`global` references throw a ReferenceError under SSR
            // (e.g. Angular Universal) where neither exists; guard with typeof and
            // fall back to globalThis (issue #83). A real node still resolves to its
            // own document's window first, so jsdom keeps working.
            return (
                (ownerDocument ? ownerDocument.defaultView : undefined) ||
                (typeof window !== 'undefined' ? window : undefined) ||
                (typeof global !== 'undefined' ? global : undefined) ||
                globalThis
            );
        }

        function isInstanceOf(value, typeName) {
            const ownerWindow = getWindow(value);
            return (
                instanceOfIn(value, ownerWindow, typeName) ||
                instanceOfIn(value, ownerWindow && ownerWindow.parent, typeName)
            );
        }

        // Cross-realm-safe `value instanceof win[typeName]`:
        //  - a missing constructor (win[typeName] === undefined) would make a bare
        //    `instanceof` throw a TypeError ("Right-hand side of 'instanceof' is
        //    not an object" — see issue #184), so we require an actual function;
        //  - reading a constructor off a cross-origin parent window throws a
        //    SecurityError, so any access failure is treated as "not an instance".
        function instanceOfIn(value, win, typeName) {
            try {
                const ctor = win && win[typeName];
                return typeof ctor === 'function' && value instanceof ctor;
            } catch (_e) {
                return false;
            }
        }

        function isShadowRoot(value) {
            return isInstanceOf(value, 'ShadowRoot');
        }

        function isInShadowRoot(value) {
            // not calling the method, getting the method
            if (value === null || value === undefined || value.getRootNode === undefined)
                return false;
            return isShadowRoot(value.getRootNode());
        }

        function isElement(value) {
            return isInstanceOf(value, 'Element');
        }

        function isElementHostForOpenShadowRoot(value) {
            return isElement(value) && value.shadowRoot !== null;
        }

        function isHTMLCanvasElement(value) {
            return isInstanceOf(value, 'HTMLCanvasElement');
        }

        function isHTMLElement(value) {
            return isInstanceOf(value, 'HTMLElement');
        }

        function isHTMLImageElement(value) {
            return isInstanceOf(value, 'HTMLImageElement');
        }

        function isSVGImageElement(value) {
            return isInstanceOf(value, 'SVGImageElement');
        }

        function isHTMLInputElement(value) {
            return isInstanceOf(value, 'HTMLInputElement');
        }

        function isHTMLLinkElement(value) {
            return isInstanceOf(value, 'HTMLLinkElement');
        }

        function isHTMLScriptElement(value) {
            return isInstanceOf(value, 'HTMLScriptElement');
        }

        function isHTMLStyleElement(value) {
            return isInstanceOf(value, 'HTMLStyleElement');
        }

        function isHTMLTextAreaElement(value) {
            return isInstanceOf(value, 'HTMLTextAreaElement');
        }

        function isShadowSlotElement(value) {
            return isInShadowRoot(value) && isInstanceOf(value, 'HTMLSlotElement');
        }

        function isSVGElement(value) {
            return isInstanceOf(value, 'SVGElement');
        }

        function isSVGSVGElement(value) {
            return isInstanceOf(value, 'SVGSVGElement');
        }

        function isSVGRectElement(value) {
            return isInstanceOf(value, 'SVGRectElement');
        }

        function isSVGUseElement(value) {
            return isInstanceOf(value, 'SVGUseElement');
        }

        function isDataUrl(url) {
            return url.search(/^(data:)/) !== -1;
        }

        function isDimensionMissing(value) {
            return isNaN(value) || value <= 0;
        }

        function asBlob(canvas) {
            return new Promise(function (resolve) {
                const binaryString = atob(canvas.toDataURL().split(',')[1]);
                const length = binaryString.length;
                const binaryArray = new Uint8Array(length);

                for (let i = 0; i < length; i++) {
                    binaryArray[i] = binaryString.charCodeAt(i);
                }

                resolve(
                    new Blob([binaryArray], {
                        type: 'image/png',
                    })
                );
            });
        }

        function canvasToBlob(canvas) {
            if (canvas.toBlob) {
                return new Promise(function (resolve) {
                    canvas.toBlob(resolve);
                });
            }

            return asBlob(canvas);
        }

        function resolveUrl(url, baseUrl) {
            const doc = document.implementation.createHTMLDocument();
            const base = doc.createElement('base');
            doc.head.appendChild(base);
            const a = doc.createElement('a');
            Object.assign(a.style, offscreen);
            doc.body.appendChild(a);
            base.href = baseUrl;
            a.href = url;
            return a.href;
        }

        function uid() {
            return `u${fourRandomChars()}${uid_index++}`;

            function fourRandomChars() {
                /* see https://stackoverflow.com/a/6248722/2519373 */
                return `0000${((Math.random() * Math.pow(36, 4)) << 0).toString(
                    36
                )}`.slice(-4);
            }
        }

        // Error-handling contract (intentional, complements images' inline()):
        // makeImage performs the critical, single-point-of-output conversions —
        // the final SVG -> raster image (draw) and canvas -> image snapshots — so
        // a failure here means there is no usable output. It therefore fails fast
        // (onerror rejects), which lets callers' .catch() see the error instead of
        // silently producing a blank/garbage image. Do NOT change this to resolve.
        function makeImage(uri) {
            if (uri === 'data:,') {
                return Promise.resolve();
            }

            return new Promise(function (resolve, reject) {
                // Create an SVG element to house the image
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

                // and create the Image element to insert into that wrapper
                const image = new Image();

                if (domtoimage.impl.options.useCredentials) {
                    image.crossOrigin = 'use-credentials';
                }

                image.onload = function () {
                    // Cleanup: remove the image from the document.
                    svg.remove();

                    function settle() {
                        if (window && window.requestAnimationFrame) {
                            // In order to work around a Firefox bug (webcompat/web-bugs#119834) we
                            // need to wait one extra frame before it's safe to read the image data.
                            window.requestAnimationFrame(function () {
                                resolve(image);
                            });
                        } else {
                            // If we don't have a window or requestAnimationFrame function proceed immediately.
                            resolve(image);
                        }
                    }

                    // `onload` fires once the resource is fetched, but the bitmap may
                    // not be fully decoded yet — Firefox can read a blank/transparent
                    // canvas from an `<foreignObject>` SVG that hasn't finished
                    // decoding (issue #146). When available, wait for decode() to
                    // settle first; it can reject (e.g. detached image), so fall
                    // through to the frame-wait either way rather than failing.
                    if (typeof image.decode === 'function') {
                        image.decode().then(settle, settle);
                    } else {
                        settle();
                    }
                };

                image.onerror = (event) => {
                    // Cleanup: remove the image from the document (no-op if the
                    // node was already detached).
                    svg.remove();
                    // An <img> load failure delivers a bare "error" Event (not an
                    // ErrorEvent) with no message/reason — browsers don't expose
                    // why a load failed — so it surfaces to callers as an opaque
                    // "Uncaught (in promise) Event" (issues #201, #152). Reject with
                    // a real Error instead. The only useful context is what we tried
                    // to rasterize: include the data-URI header (mime type) and its
                    // size, and keep the original event as `.cause` for debugging.
                    const header = String(uri).split(',', 1)[0]; // e.g. data:image/svg+xml;charset=utf-8
                    const error = new Error(
                        'dom-to-image-more: failed to rasterize the generated image (' +
                            header +
                            ', ' +
                            String(uri).length +
                            ' bytes). The source may contain malformed markup, an ' +
                            'unsupported element, or a tainted/cross-origin resource.'
                    );
                    error.cause = event;
                    reject(error);
                };

                svg.appendChild(image);
                Object.assign(svg.style, offscreen);
                image.src = uri;

                // Add the SVG to the document body (invisible)
                document.body.appendChild(svg);
            });
        }

        function getAndEncode(url) {
            let cacheEntry = domtoimage.impl.urlCache.find(function (el) {
                return el.url === url;
            });

            if (!cacheEntry) {
                cacheEntry = {
                    url: url,
                    promise: null,
                };
                domtoimage.impl.urlCache.push(cacheEntry);
            }

            if (cacheEntry.promise === null) {
                if (domtoimage.impl.options.cacheBust) {
                    // Cache bypass so we don't have CORS issues with cached images
                    // Source: https://developer.mozilla.org/en/docs/Web/API/XMLHttpRequest/Using_XMLHttpRequest#Bypassing_the_cache
                    url += (/\?/.test(url) ? '&' : '?') + new Date().getTime();
                }

                cacheEntry.promise = new Promise(function (resolve) {
                    const xhr = new XMLHttpRequest();
                    xhr.timeout = domtoimage.impl.options.httpTimeout;
                    xhr.onerror = placehold;
                    xhr.ontimeout = placehold;
                    xhr.onloadend = function () {
                        if (xhr.readyState === XMLHttpRequest.DONE) {
                            const status = xhr.status;
                            // In local files, status is 0 upon success in Mozilla Firefox
                            if (
                                (status === 0 &&
                                    url.toLowerCase().startsWith('file://')) ||
                                (status >= 200 && status <= 300 && xhr.response !== null)
                            ) {
                                const response = xhr.response;
                                if (!(response instanceof Blob)) {
                                    fail(
                                        'Expected response to be a Blob, but got: ' +
                                            typeof response
                                    );
                                }
                                const reader = new FileReader();
                                reader.onloadend = function () {
                                    const result = reader.result;
                                    resolve(result);
                                };
                                try {
                                    reader.readAsDataURL(response);
                                } catch (ex) {
                                    fail(
                                        'Failed to read the response as Data URL: ' +
                                            ex.toString()
                                    );
                                }
                            } else {
                                placehold();
                            }
                        }
                    };

                    function fail(message) {
                        console.error(message);
                        reportImageError(message, false);
                        resolve('');
                    }

                    function placehold() {
                        const placeholder = domtoimage.impl.options.imagePlaceholder;

                        if (placeholder) {
                            // A placeholder masks the failure visually, but still
                            // surface it so callers can observe the broken resource.
                            reportImageError(
                                'Status:' +
                                    xhr.status +
                                    ' while fetching resource: ' +
                                    url,
                                true
                            );
                            resolve(placeholder);
                        } else {
                            fail(
                                'Status:' +
                                    xhr.status +
                                    ' while fetching resource: ' +
                                    url
                            );
                        }
                    }

                    function reportImageError(message, willUsePlaceholder) {
                        const handler = domtoimage.impl.options.onImageError;
                        if (typeof handler !== 'function') {
                            return;
                        }
                        try {
                            handler({
                                url: url,
                                message: message,
                                status: xhr.status,
                                willUsePlaceholder: willUsePlaceholder,
                            });
                        } catch (e) {
                            // Never let an observer break the render.
                            console.error('onImageError handler threw: ' + e.toString());
                        }
                    }

                    function handleJson(data) {
                        try {
                            return JSON.parse(JSON.stringify(data));
                        } catch (e) {
                            fail('corsImg.data is missing or invalid:' + e.toString());
                        }
                    }

                    if (domtoimage.impl.options.useCredentialsFilters.length > 0) {
                        domtoimage.impl.options.useCredentials =
                            domtoimage.impl.options.useCredentialsFilters.filter(
                                (credentialsFilter) => url.search(credentialsFilter) >= 0
                            ).length > 0;
                    }

                    if (domtoimage.impl.options.useCredentials) {
                        xhr.withCredentials = true;
                    }

                    if (
                        domtoimage.impl.options.corsImg &&
                        url.indexOf('http') === 0 &&
                        url.indexOf(window.location.origin) === -1
                    ) {
                        const method =
                            (
                                domtoimage.impl.options.corsImg.method || 'GET'
                            ).toUpperCase() === 'POST'
                                ? 'POST'
                                : 'GET';
                        xhr.open(
                            method,
                            (domtoimage.impl.options.corsImg.url || '').replace(
                                '#{cors}',
                                url
                            ),
                            true
                        );

                        let isJson = false;
                        const headers = domtoimage.impl.options.corsImg.headers || {};
                        Object.keys(headers).forEach(function (key) {
                            if (headers[key].indexOf('application/json') !== -1) {
                                isJson = true;
                            }
                            xhr.setRequestHeader(key, headers[key]);
                        });

                        const corsData = handleJson(
                            domtoimage.impl.options.corsImg.data || ''
                        );

                        Object.keys(corsData).forEach(function (key) {
                            if (typeof corsData[key] === 'string') {
                                corsData[key] = corsData[key].replace('#{cors}', url);
                            }
                        });

                        xhr.responseType = 'blob';
                        xhr.send(isJson ? JSON.stringify(corsData) : corsData);
                    } else {
                        xhr.open('GET', url, true);
                        xhr.responseType = 'blob';
                        xhr.send();
                    }
                });
            }
            return cacheEntry.promise;
        }

        function escapeRegEx(string) {
            return string.replace(/([.*+?^${}()|[\]/\\])/g, '\\$1');
        }

        function asArray(arrayLike) {
            return Array.from(arrayLike);
        }

        function escapeXhtml(string) {
            return string.replace(/%/g, '%25').replace(/#/g, '%23').replace(/\n/g, '%0A');
        }

        function width(node) {
            const width = px(node, 'width');

            if (!isNaN(width)) return width;

            const box = svgBoundingBox(node);
            if (box) return box.width;

            const leftBorder = px(node, 'border-left-width');
            const rightBorder = px(node, 'border-right-width');
            return node.scrollWidth + leftBorder + rightBorder;
        }

        function height(node) {
            const height = px(node, 'height');

            if (!isNaN(height)) return height;

            const box = svgBoundingBox(node);
            if (box) return box.height;

            const topBorder = px(node, 'border-top-width');
            const bottomBorder = px(node, 'border-bottom-width');
            return node.scrollHeight + topBorder + bottomBorder;
        }

        // An SVG sub-element (`<g>`, `<path>`, …) has no CSS box, so getComputedStyle
        // width/height are `auto` and `scrollWidth`/`scrollHeight` don't exist — sizing
        // would come out 0/NaN. Its rendered extent is its `getBBox()` instead. Returns
        // null for non-SVG nodes and when the box is empty or unavailable (e.g. a
        // detached / `display:none` element, where getBBox throws).
        function svgBoundingBox(node) {
            if (node.nodeType !== ELEMENT_NODE || typeof node.getBBox !== 'function') {
                return null;
            }
            try {
                const box = node.getBBox();
                return box && (box.width || box.height) ? box : null;
            } catch (_e) {
                return null;
            }
        }

        function px(node, styleProperty) {
            if (node.nodeType === ELEMENT_NODE) {
                let value = getComputedStyle(node).getPropertyValue(styleProperty);
                if (value.slice(-2) === 'px') {
                    value = value.slice(0, -2);
                    return parseFloat(value);
                }
            }

            return NaN;
        }
    }

    function newInliner() {
        const URL_REGEX = /url\(\s*(["']?)((?:\\.|[^\\)])+)\1\s*\)/gm;

        return {
            inlineAll: inlineAll,
            shouldProcess: shouldProcess,
            impl: {
                readUrls: readUrls,
                inline: inline,
                urlAsRegex: urlAsRegex,
            },
        };

        function shouldProcess(string) {
            return string.search(URL_REGEX) !== -1;
        }

        function readUrls(string) {
            const result = [];
            let match;
            while ((match = URL_REGEX.exec(string)) !== null) {
                result.push(match[2]);
            }
            return result.filter(function (url) {
                return !util.isDataUrl(url);
            });
        }

        function urlAsRegex(urlValue) {
            return new RegExp(`url\\((["']?)(${util.escape(urlValue)})\\1\\)`, 'gm');
        }

        function inline(string, url, baseUrl, get) {
            return Promise.resolve(url)
                .then(function (urlValue) {
                    return baseUrl ? util.resolveUrl(urlValue, baseUrl) : urlValue;
                })
                .then(get || util.getAndEncode)
                .then(function (dataUrl) {
                    const pattern = urlAsRegex(url);
                    return string.replace(pattern, `url($1${dataUrl}$1)`);
                });
        }

        function inlineAll(string, baseUrl, get) {
            if (nothingToInline()) {
                return Promise.resolve(string);
            }

            return Promise.resolve(string)
                .then(readUrls)
                .then(function (urls) {
                    if (!domtoimage.impl.options.filterUrls) return urls;
                    return urls.filter(function (url) {
                        return domtoimage.impl.options.filterUrls(url, baseUrl);
                    });
                })
                .then(function (urls) {
                    let done = Promise.resolve(string);
                    urls.forEach(function (url) {
                        done = done.then(function (prefix) {
                            return inline(prefix, url, baseUrl, get);
                        });
                    });
                    return done;
                });

            function nothingToInline() {
                return !shouldProcess(string);
            }
        }
    }

    function newFontFaces() {
        return {
            resolveAll: resolveAll,
            impl: {
                readAll: readAll,
            },
        };

        function resolveAll() {
            return readAll()
                .then(function (webFonts) {
                    return Promise.all(
                        webFonts.map(function (webFont) {
                            return webFont.resolve();
                        })
                    );
                })
                .then(function (cssStrings) {
                    return cssStrings.join('\n');
                });
        }

        function readAll() {
            return Promise.resolve(util.asArray(document.styleSheets))
                .then(getCssRules)
                .then(selectWebFontRules)
                .then(function (rules) {
                    return rules.map(newWebFont);
                });

            function selectWebFontRules(cssRules) {
                return cssRules
                    .filter(function (rule) {
                        return rule.type === CSSRule.FONT_FACE_RULE;
                    })
                    .filter(function (rule) {
                        return inliner.shouldProcess(rule.style.getPropertyValue('src'));
                    });
            }

            function getCssRules(styleSheets) {
                const cssRules = [];
                styleSheets.forEach(function (sheet) {
                    const sheetProto = Object.getPrototypeOf(sheet);
                    // NOSONAR
                    if (Object.prototype.hasOwnProperty.call(sheetProto, 'cssRules')) {
                        try {
                            util.asArray(sheet.cssRules || []).forEach(
                                cssRules.push.bind(cssRules)
                            );
                        } catch (e) {
                            console.error(
                                'domtoimage: Error while reading CSS rules from: ' +
                                    sheet.href,
                                e.toString()
                            );
                        }
                    }
                });
                return cssRules;
            }

            function newWebFont(webFontRule) {
                return {
                    resolve: function resolve() {
                        // NOSONAR
                        const baseUrl = (webFontRule.parentStyleSheet || {}).href;
                        return inliner.inlineAll(webFontRule.cssText, baseUrl);
                    },
                    src: function () {
                        return webFontRule.style.getPropertyValue('src');
                    },
                };
            }
        }
    }

    function newImages() {
        return {
            inlineAll: inlineAll,
            impl: {
                newImage: newImage,
            },
        };

        function newImage(element) {
            return {
                inline: inline,
            };

            function inline(get) {
                if (util.isDataUrl(element.src)) {
                    return Promise.resolve();
                }

                return Promise.resolve(element.src)
                    .then(get || util.getAndEncode)
                    .then(function (dataUrl) {
                        return new Promise(function (resolve) {
                            // Error-handling contract (intentional, see makeImage):
                            // embedding a CONTENT image degrades gracefully. There may
                            // be many of them and any one being broken shouldn't sink
                            // the whole render, so onerror resolves rather than rejects
                            // (e.g. an <img src /> with no/invalid source is ignored).
                            // The fetch failure itself is still surfaced via the
                            // onImageError option inside getAndEncode.
                            element.onload = resolve;
                            element.onerror = resolve;
                            element.src = dataUrl;
                        });
                    });
            }
        }

        // An SVG <image> references its bitmap via href / xlink:href (not .src like
        // an HTML <img>), so newImage misses it and the external URL would survive
        // unfetchable in the standalone output (#121). Inline it the same way: fetch
        // and rewrite both href forms to a data URL. Mirrors the graceful contract —
        // a failed fetch is surfaced via onImageError (inside getAndEncode) and the
        // node is left as-is rather than sinking the whole render.
        function inlineSvgImage(node, get) {
            const XLINK_NS = 'http://www.w3.org/1999/xlink';
            const href =
                node.getAttribute('href') ||
                node.getAttributeNS(XLINK_NS, 'href') ||
                node.getAttribute('xlink:href');
            if (!href || util.isDataUrl(href)) {
                return Promise.resolve(node);
            }
            return Promise.resolve(href)
                .then(get || util.getAndEncode)
                .then(function (dataUrl) {
                    if (dataUrl) {
                        node.setAttributeNS(XLINK_NS, 'xlink:href', dataUrl);
                        node.setAttribute('href', dataUrl);
                    }
                    return node;
                });
        }

        function inlineAll(node) {
            if (!util.isElement(node)) {
                return Promise.resolve(node);
            }

            return inlineCSSProperty(node).then(function () {
                if (util.isHTMLImageElement(node)) {
                    return newImage(node).inline();
                } else if (util.isSVGImageElement(node)) {
                    return inlineSvgImage(node);
                } else {
                    return Promise.all(
                        util.asArray(node.childNodes).map(function (child) {
                            return inlineAll(child);
                        })
                    );
                }
            });

            function inlineCSSProperty(node) {
                // A styleless element (foreign-namespace; see #151) has no urls to
                // inline and no `.style` to read — skip rather than crash.
                if (!node.style) {
                    return Promise.resolve(node);
                }
                // `mask`/`mask-image` (and the `-webkit-` forms) are how SVG icons are
                // commonly tinted on an element (`mask: url(icon.svg); background:
                // currentColor`). Like backgrounds, their `url()`s must be inlined or
                // the standalone output can't fetch them and the icon renders blank
                // (issue #195). Names are read explicitly via getPropertyValue, so this
                // is robust regardless of which a browser enumerates.
                const properties = [
                    'background',
                    'background-image',
                    'mask',
                    'mask-image',
                    '-webkit-mask',
                    '-webkit-mask-image',
                ];

                const inliningTasks = properties.map(function (propertyName) {
                    const value = node.style.getPropertyValue(propertyName);
                    const priority = node.style.getPropertyPriority(propertyName);

                    if (!value) {
                        return Promise.resolve();
                    }

                    return inliner.inlineAll(value).then(function (inlinedValue) {
                        node.style.setProperty(propertyName, inlinedValue, priority);
                    });
                });

                return Promise.all(inliningTasks).then(function () {
                    return node;
                });
            }
        }
    }

    function setStyleProperty(targetStyle, name, value, priority) {
        const needs_prefixing = ['background-clip'].indexOf(name) >= 0;
        if (priority) {
            targetStyle.setProperty(name, value, priority);
            if (needs_prefixing) {
                targetStyle.setProperty(`-webkit-${name}`, value, priority);
            }
        } else {
            targetStyle.setProperty(name, value);
            if (needs_prefixing) {
                targetStyle.setProperty(`-webkit-${name}`, value);
            }
        }
    }

    // Marks (in a default-style map) that an element's UA font-size is relative to
    // its parent — see computeStyleForDefaults and issue #227.
    const UA_RELATIVE_FONT_SIZE_KEY = Symbol('dtim-ua-relative-font-size');

    function copyUserComputedStyleFast(
        options,
        sourceElement,
        sourceComputedStyles,
        parentComputedStyles,
        targetElement
    ) {
        const defaultStyle = domtoimage.impl.options.copyDefaultStyles
            ? getDefaultStyle(options, sourceElement)
            : {};
        const targetStyle = targetElement.style;

        util.asArray(sourceComputedStyles).forEach(function (name) {
            if (options.filterStyles) {
                if (!options.filterStyles(sourceElement, name)) {
                    return;
                }
            }

            const sourceValue = sourceComputedStyles.getPropertyValue(name);
            const defaultValue = defaultStyle[name];
            const parentValue = parentComputedStyles
                ? parentComputedStyles.getPropertyValue(name)
                : undefined;

            // Ignore setting style property on clone node, if already it has a style (through adjustCloneNode)
            const targetValue = targetStyle.getPropertyValue(name);
            if (targetValue) return;

            // If the style does not match the default, or it does not match the parent's, set it. We don't know which
            // styles are inherited from the parent and which aren't, so we have to always check both.
            // The font-size exception (#227): when the element's UA font-size is
            // relative to its parent, emit it even if it equals both default and
            // parent here, because the standalone output may resolve that relative UA
            // rule against a different parent font-size and diverge.
            if (
                sourceValue !== defaultValue ||
                (parentComputedStyles && sourceValue !== parentValue) ||
                (name === 'font-size' && defaultStyle[UA_RELATIVE_FONT_SIZE_KEY])
            ) {
                const priority = sourceComputedStyles.getPropertyPriority(name);
                setStyleProperty(targetStyle, name, sourceValue, priority);
            }
        });

        pinVisibleBorderWidths(sourceComputedStyles, targetStyle);
    }

    // Coupling guard (#203). The per-longhand diff above can DROP a
    // `border-<side>-width` when it equals the context-free sandbox default (0px)
    // while still EMITTING the matching `border-<side>-style`/`-color` (which do
    // differ — e.g. a reset like `*{ border:0 solid #e5e7eb }`). The standalone
    // output carries no page stylesheet, so a `solid` style with no pinned width
    // falls back to the CSS initial `medium` (~3px) and paints a phantom border on
    // every element. Whenever a side has a visible (non-`none`) border style, pin
    // that side's width explicitly from the source. Physical longhands are used and
    // read via getPropertyValue, which every browser resolves regardless of which
    // border names it happens to ENUMERATE from getComputedStyle (Chrome lists the
    // `border-width` shorthand and logical `border-block/inline-*`; others differ).
    function pinVisibleBorderWidths(sourceComputedStyles, targetStyle) {
        ['top', 'right', 'bottom', 'left'].forEach(function (side) {
            const styleName = `border-${side}-style`;
            const widthName = `border-${side}-width`;
            const styleValue = sourceComputedStyles.getPropertyValue(styleName);

            if (!styleValue || styleValue === 'none') {
                return; // no visible border on this side
            }
            if (targetStyle.getPropertyValue(widthName)) {
                return; // width already pinned by the diff
            }

            const widthValue = sourceComputedStyles.getPropertyValue(widthName);
            if (widthValue) {
                const priority = sourceComputedStyles.getPropertyPriority(widthName);
                setStyleProperty(targetStyle, widthName, widthValue, priority);
            }
        });
    }

    let removeDefaultStylesTimeoutId = null;
    let tagNameDefaultStyles = {};

    const ascentStoppers = [
        // these come from https://developer.mozilla.org/en-US/docs/Web/HTML/Block-level_elements
        'ADDRESS',
        'ARTICLE',
        'ASIDE',
        'BLOCKQUOTE',
        'DETAILS',
        'DIALOG',
        'DD',
        'DIV',
        'DL',
        'DT',
        'FIELDSET',
        'FIGCAPTION',
        'FIGURE',
        'FOOTER',
        'FORM',
        'H1',
        'H2',
        'H3',
        'H4',
        'H5',
        'H6',
        'HEADER',
        'HGROUP',
        'HR',
        'LI',
        'MAIN',
        'NAV',
        'OL',
        'P',
        'PRE',
        'SECTION',
        'SVG',
        'TABLE',
        'UL',
        // this is some non-standard ones
        'math', // intentionally lowercase, thanks Safari
        'svg', // in case we have an svg embedded element
        // these are ultimate stoppers in case something drastic changes in how the DOM works
        'BODY',
        'HEAD',
        'HTML',
    ];

    function getDefaultStyle(options, sourceElement) {
        const tagHierarchy = computeTagHierarchy(sourceElement);
        // The default style depends on UA attribute selectors (see
        // applyDefaultSelectorAttributes), so fold their signature into the cache
        // key — otherwise an `<a href>` and a bare `<a>` would share one cache slot.
        const tagKey = computeTagKey(tagHierarchy) + computeAttributeKey(sourceElement);
        if (tagNameDefaultStyles[tagKey]) {
            return tagNameDefaultStyles[tagKey];
        }

        // We haven't cached the answer for that hierachy yet, build a
        // sandbox (if not yet created), fill it with the hierarchy that
        // matters, and grab the default styles associated
        const sandboxWindow = ensureSandboxWindow();
        const defaultElement = constructElementHierachy(
            sandboxWindow.document,
            tagHierarchy
        );
        applyDefaultSelectorAttributes(defaultElement, sourceElement);
        const defaultStyle = computeStyleForDefaults(sandboxWindow, defaultElement);
        destroyElementHierarchy(defaultElement);

        tagNameDefaultStyles[tagKey] = defaultStyle;
        return defaultStyle;

        function computeTagHierarchy(sourceNode) {
            const tagNames = [];

            do {
                if (sourceNode.nodeType === ELEMENT_NODE) {
                    const tagName = sourceNode.tagName;
                    tagNames.push(tagName);

                    if (ascentStoppers.includes(tagName)) {
                        break;
                    }
                }

                sourceNode = sourceNode.parentNode;
            } while (sourceNode);

            return tagNames;
        }

        function computeTagKey(tagHierarchy) {
            if (options.styleCaching === 'relaxed') {
                // pick up only the ascent-stopping element tag and the element tag itself
                /* jshint unused:true */
                return tagHierarchy
                    .filter((_, i, a) => i === 0 || i === a.length - 1)
                    .join('>');
            }
            // for all other cases, fall back the the entire path
            return tagHierarchy.join('>'); // it's like CSS
        }

        function constructElementHierachy(sandboxDocument, tagHierarchy) {
            let element = sandboxDocument.body;
            do {
                const childTagName = tagHierarchy.pop();
                const childElement = sandboxDocument.createElement(childTagName);
                element.appendChild(childElement);
                element = childElement;
            } while (tagHierarchy.length > 0);

            // Ensure that there is some content, so that properties like margin are applied.
            // we use zero-width space to handle FireFox adding a pixel
            element.textContent = '\u200b';
            return element;
        }

        function computeStyleForDefaults(sandboxWindow, defaultElement) {
            const defaultStyle = {};
            const defaultComputedStyle = sandboxWindow.getComputedStyle(defaultElement);

            // Copy styles to an object, making sure that 'width' and 'height' are given the default value of 'auto', since
            // their initial value is always 'auto' despite that the default computed value is sometimes an absolute length.
            util.asArray(defaultComputedStyle).forEach(function (name) {
                defaultStyle[name] =
                    name === 'width' || name === 'height'
                        ? 'auto'
                        : defaultComputedStyle.getPropertyValue(name);
            });

            // Record whether the UA gives this element a font-size that differs from
            // its inherited (parent) one — i.e. a relative rule like h1–h6 {
            // font-size: N.Nem }. Such a value must NOT be dropped on the assumption
            // the output re-derives it: the standalone output's parent font-size can
            // differ, so the UA's relative rule resolves to a different px there
            // (issue #227 — an <h2> overridden to its parent's size lost the override
            // and the UA 1.5em re-applied). Plain elements that simply inherit
            // font-size are unaffected, so this adds no output for the common case.
            const parentElement = defaultElement.parentElement;
            if (parentElement) {
                const parentFontSize = sandboxWindow
                    .getComputedStyle(parentElement)
                    .getPropertyValue('font-size');
                defaultStyle[UA_RELATIVE_FONT_SIZE_KEY] =
                    defaultStyle['font-size'] !== parentFontSize;
            }
            return defaultStyle;
        }

        function destroyElementHierarchy(element) {
            do {
                const parentElement = element.parentElement;
                if (parentElement !== null) {
                    parentElement.removeChild(element);
                }
                element = parentElement;
            } while (element && element.tagName !== 'BODY');
        }
    }

    // UA stylesheets style some elements through attribute selectors, most notably
    // `a:any-link` / `a[href] { text-decoration: underline; color: ... }`. The
    // sandbox builds default elements from tag names alone, so a default `<a>` has
    // NO underline. A page that *removes* the underline (`a { text-decoration: none }`)
    // then matches that contextless default, the `none` is dropped as "same as
    // default", and the UA stylesheet re-applies the underline in the standalone
    // output — the link is underlined again (issue #227). Reflecting the relevant
    // attribute(s) onto the default element gives it the same UA baseline as the real
    // element, so a genuine override differs and is preserved.
    //
    // Only presence-style attributes that drive UA selectors are mirrored; the value
    // is copied verbatim where one exists. Keep this list and computeAttributeKey in
    // lockstep so the default-style cache key stays correct.
    const DEFAULT_SELECTOR_ATTRIBUTES = ['href'];

    function applyDefaultSelectorAttributes(defaultElement, sourceElement) {
        if (!sourceElement || !sourceElement.hasAttribute) {
            return;
        }
        DEFAULT_SELECTOR_ATTRIBUTES.forEach(function (attribute) {
            if (sourceElement.hasAttribute(attribute)) {
                defaultElement.setAttribute(
                    attribute,
                    sourceElement.getAttribute(attribute)
                );
            }
        });
    }

    function computeAttributeKey(sourceElement) {
        if (!sourceElement || !sourceElement.hasAttribute) {
            return '';
        }
        return DEFAULT_SELECTOR_ATTRIBUTES.filter(function (attribute) {
            return sourceElement.hasAttribute(attribute);
        })
            .map(function (attribute) {
                return `[${attribute}]`;
            })
            .join('');
    }

    function ensureSandboxWindow() {
        if (sandbox) {
            return sandbox.contentWindow;
        }

        // figure out how this document is defined (doctype and charset)
        const charsetToUse = document.characterSet || 'UTF-8';
        const docType = document.doctype;
        const docTypeDeclaration = docType
            ? `<!DOCTYPE ${escapeHTML(docType.name)} ${escapeHTML(
                  docType.publicId
              )} ${escapeHTML(docType.systemId)}`.trim() + '>'
            : '';

        // Create a hidden sandbox <iframe> element within we can create default HTML elements and query their
        // computed styles. Elements must be rendered in order to query their computed styles. The <iframe> won't
        // render at all with `display: none`, so we have to use `visibility: hidden` with `position: fixed`.
        sandbox = document.createElement('iframe');
        sandbox.id = 'domtoimage-sandbox-' + util.uid();
        Object.assign(sandbox.style, offscreen);
        document.body.appendChild(sandbox);

        return tryTechniques(
            sandbox,
            docTypeDeclaration,
            charsetToUse,
            'domtoimage-sandbox'
        );

        function escapeHTML(unsafeText) {
            if (unsafeText) {
                const div = document.createElement('div');
                div.innerText = unsafeText;
                return div.innerHTML;
            } else {
                return '';
            }
        }

        function tryTechniques(sandbox, doctype, charset, title) {
            // try the good old-fashioned document write with all the correct attributes set
            try {
                sandbox.contentWindow.document.write(
                    `${doctype}<html><head><meta charset='${charset}'><title>${title}</title></head><body></body></html>`
                );
                return sandbox.contentWindow;
            } catch (_) {
                // swallow exception and fall through to next technique
            }

            const metaCharset = document.createElement('meta');
            metaCharset.setAttribute('charset', charset);

            // let's attempt it using srcdoc, so we can still set the doctype and charset
            try {
                const sandboxDocument = document.implementation.createHTMLDocument(title);
                sandboxDocument.head.appendChild(metaCharset);
                const sandboxHTML = doctype + sandboxDocument.documentElement.outerHTML;
                sandbox.setAttribute('srcdoc', sandboxHTML);
                return sandbox.contentWindow;
            } catch (_) {
                // NOSONAR
                // swallow exception and fall through to the simplest path
            }

            // let's attempt it using contentDocument... here we're not able to set the doctype
            sandbox.contentDocument.head.appendChild(metaCharset);
            sandbox.contentDocument.title = title;
            return sandbox.contentWindow;
        }
    }

    function removeSandbox() {
        if (sandbox) {
            sandbox.remove();
            sandbox = null;
        }

        if (removeDefaultStylesTimeoutId) {
            clearTimeout(removeDefaultStylesTimeoutId);
        }

        removeDefaultStylesTimeoutId = setTimeout(() => {
            removeDefaultStylesTimeoutId = null;
            tagNameDefaultStyles = {};
        }, 20 * 1000);
    }
})(this);
