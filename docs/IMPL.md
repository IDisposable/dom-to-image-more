# `impl` reference

Everything hanging off `domtoimage.impl` is an **internal implementation surface**,
exposed only so the unit tests (and a few advanced integrations) can reach the moving
parts. It is **not** part of the stable public API (`toSvg`, `toPng`, `toJpeg`, `toBlob`,
`toCanvas`, `toPixelData`) and may change between releases without notice.

```js
domtoimage.impl;
```

| Member        | Kind     | Summary                                                                                                          |
| ------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `util`        | object   | Low-level helpers (type guards, geometry, URL/resource fetching). Documented separately in [UTILS.md](UTILS.md). |
| `fontFaces`   | object   | Discovers `@font-face` web fonts and inlines them as `data:` URLs.                                               |
| `images`      | object   | Inlines `<img>` and SVG `<image>` sources and CSS `background`/`background-image`/`mask` URLs.                   |
| `inliner`     | object   | The URL-rewriting engine shared by `fontFaces` and `images`.                                                     |
| `urlCache`    | array    | Per-session cache of fetched resources, keyed by URL.                                                            |
| `options`     | object   | The **live, resolved** options for the current/last render.                                                      |
| `copyOptions` | function | Merges caller options over the defaults into `impl.options`.                                                     |

---

## `impl.options`

The resolved options object that the render pipeline actually reads. It is **not** the
object you pass to `toPng(node, options)` — that one is normalized by `copyOptions`
(filling in defaults for anything omitted) and the result is stored here. Inspecting it
after a call shows the effective configuration that was used.

See the **Rendering options** section of the [README](../README.md#rendering-options) for
the full list of fields and their defaults.

## `impl.copyOptions(options)`

`(options: object) => void`

Normalizes `options` against the library defaults and writes the result into
`impl.options`. Every option is copied through an explicit
`typeof options.x === 'undefined' ? default : options.x` check, so passing `{}` restores
the full default configuration. Called automatically at the start of each top-level
render; exposed mainly so tests can set up `impl.options` directly when exercising helpers
like `util.getAndEncode` in isolation.

---

## `impl.fontFaces`

Produced by `newFontFaces()`.

| Member           | Signature                  | Summary                                                                                                                                                                                                                               |
| ---------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveAll()`   | `() => Promise<string>`    | Reads every web-font `@font-face` rule, inlines its `src` URLs as `data:` URLs, and resolves to the concatenated CSS text (newline-joined) ready to drop into a single `<style>`.                                                     |
| `impl.readAll()` | `() => Promise<WebFont[]>` | Scans `document.styleSheets`, keeps only `@font-face` rules whose `src` needs processing, and returns one _web font_ object per rule. Stylesheets whose `cssRules` can't be read (e.g. cross-origin) are skipped with a logged error. |

Each _web font_ object returned by `readAll()` exposes:

- `resolve()` → `Promise<string>` — inline this rule's URLs and return its rewritten
  `cssText`.
- `src()` → `string` — the raw `src` property value of the rule.

## `impl.images`

Produced by `newImages()`.

| Member                   | Signature                                         | Summary                                                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inlineAll(node)`        | `(node: Node) => Promise<…>`                      | Recursively walks `node`, inlining the CSS `background`/`background-image`/`mask` URLs on every element, replacing HTML `<img>` `src` values with `data:` URLs, and inlining SVG `<image>` `href`/`xlink:href`. Non-element nodes pass through untouched. |
| `impl.newImage(element)` | `(element: HTMLImageElement) => { inline(get?) }` | Wraps a single image element. `inline(get?)` fetches `element.src` (via `get`, defaulting to `util.getAndEncode`) and swaps in the resulting `data:` URL; already-`data:` sources are left as-is.                                                         |

## `impl.inliner`

Produced by `newInliner()`. The shared engine that finds `url(...)` references in CSS text
and rewrites them to inlined `data:` URLs. Used by both `fontFaces` and `images`.

| Member                                     | Signature                                          | Summary                                                                                                                                                                                  |
| ------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inlineAll(string, baseUrl?, get?)`        | `(string, baseUrl?, get?) => Promise<string>`      | Finds every non-`data:` `url(...)` in `string`, fetches each, and returns the CSS with those URLs replaced by `data:` URLs. Returns the input unchanged when there is nothing to inline. |
| `shouldProcess(string)`                    | `(string) => boolean`                              | `true` if `string` contains at least one `url(...)` reference.                                                                                                                           |
| `impl.readUrls(string)`                    | `(string) => string[]`                             | Extracts the URL values from every `url(...)` in `string`, excluding ones that are already `data:` URLs.                                                                                 |
| `impl.inline(string, url, baseUrl?, get?)` | `(string, url, baseUrl?, get?) => Promise<string>` | Inlines a single `url`: resolves it against `baseUrl` (if given), fetches it, and replaces every `url(...)` occurrence of it in `string`.                                                |
| `impl.urlAsRegex(urlValue)`                | `(urlValue) => RegExp`                             | Builds the (escaped) global regex that matches `url("urlValue")` with optional quotes.                                                                                                   |

## `impl.urlCache`

An array used by `util.getAndEncode` to dedupe and cache resource fetches within a
session. Each entry is `{ url: string, promise: Promise<string> | null }`; repeat requests
for the same URL share the same in-flight/settled promise. There is no automatic eviction
— it lives for the lifetime of the module.

---

> For the `util` helpers (`isHTMLElement`, `width`, `getAndEncode`, `resolveUrl`, `uid`,
> …), see [UTILS.md](UTILS.md).
