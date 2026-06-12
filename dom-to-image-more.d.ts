// Type definitions for dom-to-image-more
// Project: https://github.com/1904labs/dom-to-image-more

export = domToImage;
export as namespace domtoimage;

declare const domToImage: domToImage.DomToImage;

declare namespace domToImage {
    /**
     * Configuration for routing a cross-origin image request through a proxy to
     * work around CORS restrictions. The token `#{cors}` is replaced with the
     * target image URL in `url` and in any string value of `data`.
     */
    /** Details passed to the `onImageError` callback when a resource fails to load. */
    interface ImageErrorInfo {
        /** The resource URL that failed (may include a cache-busting suffix). */
        url: string;
        /** Human-readable description of the failure. */
        message: string;
        /** HTTP status of the failed request (0 for network errors/timeouts). */
        status: number;
        /**
         * `true` if a substitute will be used — an `imagePlaceholder`, or a value
         * supplied by `requestInterceptor`'s failure call — `false` if the resource
         * is dropped (resolved to an empty string).
         */
        willUsePlaceholder: boolean;
    }

    /**
     * A console-like sink for the library's own diagnostics (see `Options.logger`).
     * Methods are optional: a missing one drops that level, so `{}` silences and
     * `{ error: fn }` keeps only errors.
     */
    interface Logger {
        warn?(...args: any[]): void;
        error?(...args: any[]): void;
    }

    interface CorsImgOptions {
        /** Proxy endpoint; `#{cors}` is replaced by the target URL. */
        url?: string;
        /** HTTP method to use against the proxy. Defaults to `GET`. */
        method?: 'GET' | 'POST' | 'get' | 'post';
        /** Request headers to send to the proxy. */
        headers?: Record<string, string>;
        /** Request body for a `POST`; `#{cors}` is substituted in string values. */
        data?: unknown;
    }

    interface Options {
        /**
         * A function taking a DOM node as argument. Should return true if the
         * passed node should be included in the output (excluding a node means
         * excluding its children as well). Not called on the root node.
         */
        filter?: (node: Node) => boolean;
        /**
         * A function taking the source node and a style property name as
         * arguments. Should return true if the property should be included in
         * the output.
         */
        filterStyles?: (node: Node, propertyName: string) => boolean;
        /**
         * Drop or adjust a `::before`/`::after` pseudo-element as it is recreated in
         * the clone. Receives the source node, which pseudo (`':before'` or
         * `':after'`), and the pseudo-element's computed style. Return `false` to drop
         * it, an object of CSS property overrides (keyed by CSS property name, e.g.
         * `{ content: '"-"' }`; an empty object `{}` changes nothing) to tweak it, or
         * `undefined`/`true` to keep it unchanged. Only called for pseudo-elements
         * that have `content` (so it can adjust an existing pseudo, but not synthesize
         * one from nothing).
         */
        adjustPseudoElement?: (
            node: Node,
            pseudoElement: ':before' | ':after',
            style: CSSStyleDeclaration
        ) => boolean | void | Record<string, string>;
        /**
         * Invoked on each node as it is cloned, before the `onclone` callback.
         * Receives the original node, the cloned node, and a boolean that is
         * `true` once the children have already been cloned. The return value
         * is ignored.
         */
        adjustClonedNode?: (node: Node, clone: Node, after: boolean) => Node | void;
        /**
         * Invoked when an external resource (image, font, etc.) cannot be fetched.
         * Purely observational — the render still degrades gracefully (placeholder
         * or empty string); use it for logging/telemetry of broken resources.
         */
        onImageError?: (info: ImageErrorInfo) => void;
        /**
         * Invoked with the fully cloned and modified node tree, allowing final
         * adjustments before serialization. May return a promise to defer
         * rendering until it settles.
         */
        onclone?: (clone: Node) => unknown;
        /** Background color, any valid CSS color value. */
        bgcolor?: string;
        /** Width in pixels to apply to the node before rendering. */
        width?: number;
        /** Height in pixels to apply to the node before rendering. */
        height?: number;
        /** Properties copied onto the node's style before rendering. */
        style?: Partial<CSSStyleDeclaration> & Record<string, string>;
        /**
         * Number between 0 and 1 indicating JPEG image quality (e.g. 0.92).
         * Applies to `toJpeg` only. Defaults to 1.0.
         */
        quality?: number;
        /**
         * Multiplier applied to the canvas via `ctx.scale()` on both axes to
         * increase output resolution. Defaults to 1.0.
         */
        scale?: number;
        /**
         * Device-pixel-ratio multiplier for the rasterized canvas output
         * (`toPng`/`toJpeg`/`toBlob`/`toCanvas`). Set to
         * `window.devicePixelRatio` for crisp high-DPI/Retina output. Composes
         * with `scale` (effective multiplier = `scale * pixelRatio`); an
         * oversized request is clamped to the browser's canvas limit with a
         * warning. Defaults to 1.0.
         */
        pixelRatio?: number;
        /**
         * Reflect each scrollable element's current scroll position
         * (`scrollLeft`/`scrollTop`) in the output, instead of rendering
         * everything scrolled to the top/left. Opt-in; defaults to `false` so
         * existing output is unchanged.
         */
        preserveScroll?: boolean;
        /**
         * Suppress the `console.error` logged when a (typically cross-origin)
         * stylesheet's `cssRules` cannot be read during font discovery. The
         * failure is benign and already handled gracefully; this just quiets the
         * noise. Defaults to false.
         */
        ignoreCSSRuleErrors?: boolean;
        /**
         * Data URL of a placeholder image substituted when fetching an **image**
         * resource fails (`ResourceType.IMAGE` / `ResourceType.CSS_IMAGE`). It is
         * not applied to fonts or stylesheets — those drop on failure so the CSS
         * fallback (font stack / cascade) applies. `requestInterceptor` fires
         * first. Defaults to `undefined`.
         */
        imagePlaceholder?: string;
        /**
         * Append the current time to request URLs to bust the cache. Defaults
         * to false.
         */
        cacheBust?: boolean;
        /**
         * Style-computation cache strategy: `'strict'` keys on the full
         * tag-ancestry path (most accurate), `'relaxed'` keys on only the
         * element and its nearest ascent-stopping ancestor (faster). Defaults
         * to `'strict'`.
         */
        styleCaching?: 'strict' | 'relaxed';
        /**
         * Copy the default styles of elements. Disabling can be faster but may
         * surface differences when resetting/normalizing CSS. Defaults to true.
         */
        copyDefaultStyles?: boolean;
        /**
         * Skip discovering and embedding `@font-face` web fonts into the
         * output. Defaults to false.
         */
        disableEmbedFonts?: boolean;
        /**
         * Disable inlining images into the SVG output, producing SVGs that
         * reference the original image URLs. Defaults to false.
         */
        disableInlineImages?: boolean;
        /**
         * Force the explicitly-captured root node to be shown even when it is
         * hidden by its own `display: none` or `opacity: 0` (a `visibility: hidden`
         * ancestor is always handled). Root-only and opt-in: deliberate hiding of
         * elements *inside* the captured subtree is left intact. Defaults to false.
         */
        ensureShown?: boolean;
        /**
         * Send authentication credentials with cross-origin (CORS) requests for
         * external resources. Defaults to false.
         */
        useCredentials?: boolean;
        /**
         * When non-empty, `useCredentials` is enabled automatically only for
         * URLs matching one of these patterns (each used with
         * `String.prototype.search`). Defaults to `[]`.
         */
        useCredentialsFilters?: Array<string | RegExp>;
        /**
         * Timeout in milliseconds for the XHR requests used to fetch external
         * resources. Defaults to 30000.
         */
        httpTimeout?: number;
        /**
         * Fetch and re-parse cross-origin stylesheets whose `cssRules` can't be read
         * directly, so their `@font-face` web fonts can be discovered and embedded.
         * `false` (default) keeps the current behavior of skipping unreadable sheets;
         * `true` fetches every unreadable cross-origin sheet; a predicate
         * `(href) => boolean` scopes which ones. Adds a network fetch per matched
         * sheet and degrades quietly if the fetch is itself CORS-blocked or fails.
         */
        loadExternalStyleSheet?: boolean | ((href: string) => boolean);
        /**
         * A console-like sink (`{ warn?, error? }`) the library's own diagnostics are
         * routed through. Defaults to a logger that delegates to the global `console`.
         * Provide a partial logger to redirect or silence output: a missing method
         * drops that level, so `{}` silences everything and `{ error: fn }` keeps
         * only errors.
         */
        logger?: Logger;
        /** Configuration for routing cross-origin images through a proxy. */
        corsImg?: CorsImgOptions;
        /**
         * Supply or recover any external resource (images, fonts, and stylesheets).
         * Useful for serving resources from a cache, supplying test fixtures, or
         * implementing a custom resolver/fallback.
         * Called with the resource URL and a context describing the resource `type` (see
         * {@link ResourceType}) and a `status` that signals the phase:
         * - `status` is `undefined` — **before** the fetch: return a data URL string
         *   (or a promise of one) to short-circuit the network, or `undefined`/`null`
         *   to fetch normally.
         * - `status` is a number — the fetch **failed**: return a value to use as the
         *   fallback (taking precedence over `imagePlaceholder`), or `undefined`/`null`
         *   to fall back to `imagePlaceholder`/dropping the resource. `status` is the
         *   HTTP status, or `0` for a network error/timeout. A failure call also fires
         *   when a response comes back that isn't a usable image/font (empty/non-`Blob`
         *   or undecodable body), in which case `status` may even be a `2xx` — so treat
         *   any failure call as "couldn't produce the resource".
         *
         * Note: a network error/timeout reports `status: 0`, which is falsy — test
         * the pre-fetch phase as `status === undefined`, not `!status`.
         */
        requestInterceptor?: (
            url: string,
            context: { type: ResourceType; status: number | undefined }
        ) => string | Promise<string> | undefined | null;
    }

    /** The kind of external resource being fetched, passed to `requestInterceptor`. */
    type ResourceType = 'image' | 'css-image' | 'font' | 'stylesheet';

    /** Named constants for {@link ResourceType}, exposed as `domtoimage.ResourceType`. */
    interface ResourceTypes {
        /** `<img>` and SVG `<image>` content images. */
        readonly IMAGE: 'image';
        /**
         * Any image referenced via a CSS property — `background`, `mask`,
         * `content`, `border-image`, `list-style-image`, `cursor`, etc.
         */
        readonly CSS_IMAGE: 'css-image';
        /** `@font-face` `src` web fonts. */
        readonly FONT: 'font';
        /** External stylesheets. */
        readonly STYLESHEET: 'stylesheet';
    }

    interface DomToImage {
        /** Render the node to an SVG image data URL. */
        toSvg(node: Node, options?: Options): Promise<string>;
        /** Render the node to a PNG image data URL. */
        toPng(node: Node, options?: Options): Promise<string>;
        /** Render the node to a JPEG image data URL. */
        toJpeg(node: Node, options?: Options): Promise<string>;
        /** Render the node to a PNG image blob. */
        toBlob(node: Node, options?: Options): Promise<Blob>;
        /** Render the node to a canvas element. */
        toCanvas(node: Node, options?: Options): Promise<HTMLCanvasElement>;
        /**
         * Render the node and resolve with the raw RGBA pixel data, with every
         * 4 elements representing one pixel.
         */
        toPixelData(node: Node, options?: Options): Promise<Uint8ClampedArray>;
        /**
         * Named resource-kind constants for the `type` passed to
         * `requestInterceptor` (e.g. `domtoimage.ResourceType.FONT`).
         */
        ResourceType: ResourceTypes;
        /**
         * Internal implementation surface, exposed only for advanced
         * integration unit testing. Not part of the stable public API and may
         * change between releases. See docs/IMPL.md and docs/UTILS.md.
         */
        impl: unknown;
    }
}
