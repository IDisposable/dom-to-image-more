# `util` reference

Internal utility helpers used throughout **dom-to-image-more**. They are exposed for
testing and advanced integration via:

```js
domtoimage.impl.util;
```

> ⚠️ These are **implementation details**, not part of the stable public API (`toSvg`,
> `toPng`, `toJpeg`, `toBlob`, `toCanvas`, `toPixelData`). They may change between
> releases. They are documented here because the test suite and some advanced callers
> depend on them.

The object is produced by `newUtil()` in
[`src/dom-to-image-more.js`](../src/dom-to-image-more.js) and attached to
`domtoimage.impl.util`. For the rest of the `impl` surface (`fontFaces`, `images`,
`inliner`, `urlCache`, `options`, `copyOptions`), see [IMPL.md](IMPL.md).

---

## Type guards

All of these return a `boolean` and are built on `isInstanceOf`, which checks the value
against the constructor from **both** its own window and the parent window (so they work
correctly across `<iframe>` boundaries).

| Function                                | Returns `true` when the value is…                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `isElement(value)`                      | a DOM `Element`                                                                                                         |
| `isHTMLElement(value)`                  | an `HTMLElement`                                                                                                        |
| `isHTMLCanvasElement(value)`            | an `HTMLCanvasElement`                                                                                                  |
| `isHTMLImageElement(value)`             | an `HTMLImageElement`                                                                                                   |
| `isHTMLInputElement(value)`             | an `HTMLInputElement`                                                                                                   |
| `isHTMLLinkElement(value)`              | an `HTMLLinkElement`                                                                                                    |
| `isHTMLScriptElement(value)`            | an `HTMLScriptElement`                                                                                                  |
| `isHTMLStyleElement(value)`             | an `HTMLStyleElement`                                                                                                   |
| `isHTMLTextAreaElement(value)`          | an `HTMLTextAreaElement`                                                                                                |
| `isSVGElement(value)`                   | an `SVGElement`                                                                                                         |
| `isSVGRectElement(value)`               | an `SVGRectElement`                                                                                                     |
| `isShadowRoot(value)`                   | a `ShadowRoot`                                                                                                          |
| `isInShadowRoot(value)`                 | a node whose root (`getRootNode()`) is a `ShadowRoot`. Safe for `null`/`undefined` and for nodes without `getRootNode`. |
| `isElementHostForOpenShadowRoot(value)` | an `Element` that hosts an **open** shadow root (`value.shadowRoot !== null`)                                           |
| `isShadowSlotElement(value)`            | an `HTMLSlotElement` that lives inside a shadow root                                                                    |

### `isInstanceOf(value, typeName)`

`(value: any, typeName: string) => boolean`

Cross-realm `instanceof` check. Resolves the constructor named `typeName` from the value's
own window **and** `window.parent`, returning `true` if the value is an instance of
either. This is the primitive that all the guards above are built on, so type checks
survive elements that originate inside iframes.

### `isDataUrl(url)`

`(url: string) => boolean`

`true` if the string begins with `data:`.

### `isDimensionMissing(value)`

`(value: number) => boolean`

`true` when a measured dimension is unusable — i.e. `NaN`, `0`, or negative. Used to
decide when to fall back to default sizing (e.g. `width="100%"`).

---

## Geometry / dimensions

### `width(node)`

`(node: Element) => number`

Computed pixel width of `node`. Reads the CSS `width` via `getComputedStyle`; if that is
not a `px` value, falls back to `scrollWidth + border-left-width + border-right-width`.

### `height(node)`

`(node: Element) => number`

Computed pixel height of `node`. Same strategy as `width`, using
`scrollHeight + border-top-width + border-bottom-width` as the fallback.

> Note: both read live layout, so the value depends on the element's current rendered
> state (scrollbars, etc.).

---

## Window / document

### `getWindow(node)`

`(node?: Node) => Window`

Returns the `Window` that owns `node` (`node.ownerDocument.defaultView`), falling back to
the global `window`, then `global`. Tolerates a missing/`undefined` `node`. Underpins the
cross-realm type guards.

---

## URLs & resources

### `resolveUrl(url, baseUrl)`

`(url: string, baseUrl: string) => string`

Resolves a possibly relative `url` against `baseUrl` and returns the absolute URL.
Implemented by letting the browser normalize an `<a href>` inside a throwaway document
that has a `<base>` set to `baseUrl`.

### `getAndEncode(url)`

`(url: string) => Promise<string>`

Fetches a resource and resolves to a **data URL** (base64). Key behaviors:

- **Caches** by URL in `domtoimage.impl.urlCache`; concurrent/repeat requests for the same
  URL share one promise.
- Honors options: `cacheBust`, `httpTimeout`, `useCredentials` / `useCredentialsFilters`,
  `corsImg` (proxy URL/method/headers/data with the `#{cors}` token substituted), and
  `imagePlaceholder`.
- Treats HTTP status `0` as success for `file://` URLs (Firefox local-file quirk).
- On error/timeout/failure: resolves to `imagePlaceholder` if set, otherwise logs and
  resolves to `''` (never rejects).

### `makeImage(uri)`

`(uri: string) => Promise<HTMLImageElement | undefined>`

Loads `uri` into an `Image` (wrapped in an offscreen `<svg>` appended to `document.body`)
and resolves once it has loaded. Returns `undefined` for the empty data URL `data:,`.
Applies `crossOrigin = 'use-credentials'` when the `useCredentials` option is set. Removes
the temporary node on load/error, and waits one `requestAnimationFrame` before resolving
to work around a Firefox image-data timing bug.

### `canvasToBlob(canvas)`

`(canvas: HTMLCanvasElement) => Promise<Blob>`

Resolves to a PNG `Blob` of the canvas. Uses the native `canvas.toBlob` when available,
otherwise a manual `toDataURL` → `atob` → `Uint8Array` → `Blob` fallback.

---

## String helpers

### `escape(string)`

`(string: string) => string`

> Exposed as `util.escape` (implementation `escapeRegEx`).

Escapes characters that are special in a regular expression
(`. * + ? ^ $ { } ( ) | [ ] / \`) so the string can be used as a regex literal.

### `escapeXhtml(string)`

`(string: string) => string`

Escapes a string for safe embedding in the XHTML/`foreignObject` payload of the generated
SVG: replaces `%` → `%25`, `#` → `%23`, and newlines → `%0A`.

---

## Misc

### `asArray(arrayLike)`

`(arrayLike: ArrayLike<T>) => T[]`

Converts an array-like (e.g. a `NodeList` or `CSSStyleDeclaration`) into a real `Array` by
index copy.

### `uid()`

`() => string`

Returns a short unique id of the form `u<4-random-base36-chars><counter>` (e.g. `u3f9a0`).
The incrementing counter guarantees uniqueness within a session even if the random part
collides.

---

## Quick index

| Name                             | Category   | Returns                                  |
| -------------------------------- | ---------- | ---------------------------------------- |
| `isElement`                      | type guard | `boolean`                                |
| `isElementHostForOpenShadowRoot` | type guard | `boolean`                                |
| `isShadowRoot`                   | type guard | `boolean`                                |
| `isInShadowRoot`                 | type guard | `boolean`                                |
| `isHTMLElement`                  | type guard | `boolean`                                |
| `isHTMLCanvasElement`            | type guard | `boolean`                                |
| `isHTMLInputElement`             | type guard | `boolean`                                |
| `isHTMLImageElement`             | type guard | `boolean`                                |
| `isHTMLLinkElement`              | type guard | `boolean`                                |
| `isHTMLScriptElement`            | type guard | `boolean`                                |
| `isHTMLStyleElement`             | type guard | `boolean`                                |
| `isHTMLTextAreaElement`          | type guard | `boolean`                                |
| `isShadowSlotElement`            | type guard | `boolean`                                |
| `isSVGElement`                   | type guard | `boolean`                                |
| `isSVGRectElement`               | type guard | `boolean`                                |
| `isInstanceOf`                   | type guard | `boolean`                                |
| `isDataUrl`                      | type guard | `boolean`                                |
| `isDimensionMissing`             | dimensions | `boolean`                                |
| `width`                          | dimensions | `number`                                 |
| `height`                         | dimensions | `number`                                 |
| `getWindow`                      | window     | `Window`                                 |
| `resolveUrl`                     | url        | `string`                                 |
| `getAndEncode`                   | url        | `Promise<string>`                        |
| `makeImage`                      | url        | `Promise<HTMLImageElement \| undefined>` |
| `canvasToBlob`                   | url        | `Promise<Blob>`                          |
| `escape`                         | string     | `string`                                 |
| `escapeXhtml`                    | string     | `string`                                 |
| `asArray`                        | misc       | `Array`                                  |
| `uid`                            | misc       | `string`                                 |
