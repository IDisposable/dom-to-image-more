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
         * `true` if a placeholder image will be substituted, `false` if the
         * resource is dropped (resolved to an empty string).
         */
        willUsePlaceholder: boolean;
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
         * Invoked on each node as it is cloned, before the `onclone` callback.
         * Receives the original node, the cloned node, and a boolean that is
         * `true` once the children have already been cloned. The return value
         * is ignored.
         */
        adjustClonedNode?: (node: Node, clone: Node, after: boolean) => Node | void;
        /**
         * Invoked when a resource (image/font) cannot be fetched. Purely
         * observational — the render still degrades gracefully (placeholder or
         * empty string); use it for logging/telemetry of broken resources.
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
         * Data URL of a placeholder image used when fetching an image fails.
         * When unset, failed images reject. Defaults to undefined.
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
        /** Configuration for routing cross-origin images through a proxy. */
        corsImg?: CorsImgOptions;
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
         * Internal implementation surface, exposed only for unit testing and
         * advanced integration. Not part of the stable public API and may
         * change between releases. See docs/IMPL.md and docs/UTILS.md.
         */
        impl: unknown;
    }
}
