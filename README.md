# DOM to Image

[![Version](https://img.shields.io/npm/v/dom-to-image-more.svg?style=flat-square)](https://npmjs.com/package/dom-to-image-more)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/dom-to-image-more?style=flat-square)](https://bundlephobia.com/result?p=dom-to-image-more)
[![Open Issues](https://img.shields.io/github/issues/1904labs/dom-to-image-more?style=flat-square)](https://github.com/1904labs/dom-to-image-more/issues)
[![GitHub Repo stars](https://img.shields.io/github/stars/1904labs/dom-to-image-more?style=social)](https://github.com/1904labs/dom-to-image-more)
[![Twitter](https://img.shields.io/twitter/follow/idisposable.svg?style=social&label=Follow)](https://www.twitter.com/idisposable)

## Breaking Change Notice

The 3.x release branch included some breaking changes in the very infrequently used
ability to configure some utility methods used in this internal processing of
dom-to-image-more. As browsers have matured, many of the hacks we've accumulated over the
years are not needed, or better ways have been found to handle some edge-cases. With the
help of folks like @meche-gh, in #99 we removed the following members:

- `.mimes` - was the not-very-comprehensive list of mime types used to handle inlining
  things
- `.parseExtension` - was a method to extract the extension from a filename, used to guess
  mime types
- `.mimeType` - was a method to map file extensions to mime types
- `.dataAsUrl` - was a method to reassemble a `data:` URI from a Base64 representation and
  mime type

The 3.x release branch also fixed more node compatibility and `iframe` issues.

## What is it

**dom-to-image-more** is a library which can turn arbitrary DOM node, including same
origin and blob iframes, into a vector (SVG) or raster (PNG or JPEG) image, written in
JavaScript.

This fork of
[dom-to-image by Anatolii Saienko (tsayen)](https://github.com/tsayen/dom-to-image) with
some important fixes merged. We are eternally grateful for his starting point.

Anatolii's version was based on [domvas by Paul Bakaus](https://github.com/pbakaus/domvas)
and has been completely rewritten, with some bugs fixed and some new features (like web
font and image support) added.

Moved to [1904labs organization](https://github.com/1904labs/) from my repositories
2019-02-06 as of version 2.7.3

## Installation

### NPM

`npm install dom-to-image-more`

Then load

```javascript
/* in ES 6 */
import domtoimage from 'dom-to-image-more';
/* in ES 5 */
var domtoimage = require('dom-to-image-more');
```

## Usage

All the top level functions accept DOM node and rendering options, and return promises,
which are fulfilled with corresponding data URLs. Get a PNG image base64-encoded data URL
and display right away:

```javascript
var node = document.getElementById('my-node');

domtoimage
    .toPng(node)
    .then(function (dataUrl) {
        var img = new Image();
        img.src = dataUrl;
        document.body.appendChild(img);
    })
    .catch(function (error) {
        console.error('oops, something went wrong!', error);
    });
```

Get a PNG image blob and download it (using
[FileSaver](https://github.com/eligrey/FileSaver.js/), for example):

```javascript
domtoimage.toBlob(document.getElementById('my-node')).then(function (blob) {
    window.saveAs(blob, 'my-node.png');
});
```

Save and download a compressed JPEG image:

```javascript
domtoimage
    .toJpeg(document.getElementById('my-node'), { quality: 0.95 })
    .then(function (dataUrl) {
        var link = document.createElement('a');
        link.download = 'my-image-name.jpeg';
        link.href = dataUrl;
        link.click();
    });
```

Get an SVG data URL, but filter out all the `<i>` elements:

```javascript
function filter(node) {
    return node.tagName !== 'i';
}

domtoimage
    .toSvg(document.getElementById('my-node'), { filter: filter })
    .then(function (dataUrl) {
        /* do something */
    });
```

Get the raw pixel data as a
[Uint8Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array)
with every 4 array elements representing the RGBA data of a pixel:

```javascript
var node = document.getElementById('my-node');

domtoimage.toPixelData(node).then(function (pixels) {
    for (var y = 0; y < node.scrollHeight; ++y) {
        for (var x = 0; x < node.scrollWidth; ++x) {
            pixelAtXYOffset = 4 * y * node.scrollHeight + 4 * x;
            /* pixelAtXY is a Uint8Array[4] containing RGBA values of the pixel at (x, y) in the range 0..255 */
            pixelAtXY = pixels.slice(pixelAtXYOffset, pixelAtXYOffset + 4);
        }
    }
});
```

Get a canvas object:

```javascript
domtoimage.toCanvas(document.getElementById('my-node')).then(function (canvas) {
    console.log('canvas', canvas.width, canvas.height);
});
```

Adjust cloned nodes before/after children are cloned
[sample fiddle](https://jsfiddle.net/IDisposable/grLtjwe5/12/)

```javascript
const adjustClone = (node, clone, after) => {
    if (!after && clone.id === 'element') {
        clone.style.transform = 'translateY(100px)';
    }
    return clone;
};

const wrapper = document.getElementById('wrapper');
const blob = domtoimage.toBlob(wrapper, { adjustClonedNode: adjustClone });
```

---

_All the functions under `impl` are not public API and are exposed only for unit testing._
_The `impl` surface is described in [docs/IMPL.md](docs/IMPL.md) and its `impl.util`
helpers are catalogued in [docs/UTILS.md](docs/UTILS.md)._

---

### Rendering options

#### filter

A function taking DOM node as argument. Should return true if passed node should be
included in the output (excluding node means excluding it's children as well). Not called
on the root node.

#### filterStyles

A function taking the source node and a style property name as arguments. Should return
true if the passed property should be included in the output.

Sample use:

```javascript
filterStyles(node, propertyName) {
    return !propertyName.startsWith('--'); // to filter out CSS variables
}
```

#### adjustClonedNode

A function that will be invoked on each node as they are cloned. Useful to adjust nodes in
any way needed before the conversion. Note that this be invoked before the onclone
callback. The handler gets the original node, the cloned node, and a boolean that says if
we've cloned the children already (so you can handle either before or after)

Sample use:

```javascript
const adjustClone = (node, clone, after) => {
    if (!after && clone.id === 'element') {
        clone.style.transform = 'translateY(100px)';
    }
    return clone;
};
```

const wrapper = document.getElementById('wrapper'); const blob =
domtoimage.toBlob(wrapper, { adjustClonedNode: adjustClone});

#### onclone

A function taking the cloned and modified DOM node as argument. It allows to make final
adjustements to the elements before rendering, on the whole clone, after all elements have
been individually cloned. Note that this will be invoked after all the onclone callbacks
have been fired.

The cloned DOM might differ a lot from the original DOM, for example canvas will be
replaced with image tags, some class might have changed, the style are inlined. It can be
useful to log the clone to get a better senses of the transformations.

#### bgcolor

A string value for the background color, any valid CSS color value.

#### height, width

Height and width in pixels to be applied to node before rendering.

#### style

An object whose properties to be copied to node's style before rendering. You might want
to check
[this reference](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Properties_Reference)
for JavaScript names of CSS properties.

#### quality

A number between 0 and 1 indicating image quality (e.g. 0.92 => 92%) of the JPEG image.
Defaults to 1.0 (100%)

#### cacheBust

Set to true to append the current time as a query string to URL requests to enable cache
busting. Defaults to false

#### imagePlaceholder

A data URL for a placeholder image that will be used when fetching an image fails.
Defaults to undefined and will throw an error on failed images

#### onImageError

A callback invoked whenever a resource (image or font) cannot be fetched. It receives an
object `{ url, message, status, willUsePlaceholder }` where `willUsePlaceholder` is `true`
if `imagePlaceholder` will be substituted and `false` if the resource is dropped (resolved
to an empty string). This is purely observational — rendering still degrades gracefully —
and is useful for logging or telemetry of broken resources. A handler that throws is
caught and logged so it can't break the render. Defaults to undefined.

Sample use:

```javascript
domtoimage.toPng(node, {
    onImageError: ({ url, status, willUsePlaceholder }) => {
        console.warn(`dom-to-image: ${url} failed (status ${status})`, {
            willUsePlaceholder,
        });
    },
});
```

#### copyDefaultStyles

Set to true to enable the copying of the default styles of elements. This will make the
process faster. Try disabling it if seeing extra padding and using resetting / normalizing
in CSS. Defaults to true.

#### disableInlineImages

Set to true to disable the normal inlining images into the SVG output. This will generate
SVGs that reference the original image files, so they my break if a referenced URL fails.
This is always safe to use when generating a PNG/JPG file because the entire SVG image is
rendered.

#### styleCaching

Selects how computed-style lookups are cached while cloning, as a speed/accuracy
trade-off. Accepts `'strict'` (cache keyed on the full tag-ancestry path — most accurate)
or `'relaxed'` (cache keyed on only the element and its nearest ascent-stopping ancestor —
fewer cache misses, faster). Defaults to `'strict'`.

#### disableEmbedFonts

Set to true to skip discovering and embedding `@font-face` web fonts into the output.
Defaults to false (fonts are embedded).

#### httpTimeout

Timeout in milliseconds for the XHR requests used to fetch external resources (images,
fonts). On timeout the `imagePlaceholder` is used if set, otherwise the request fails.
Defaults to 30000 (30 seconds).

#### useCredentials

Set to true to send authentication credentials (cookies, HTTP auth) with cross-origin
(CORS) requests for external resources, i.e. sets `withCredentials` on the XHR and
`crossOrigin = 'use-credentials'` on images. Defaults to false.

#### useCredentialsFilters

An array of patterns; when non-empty, `useCredentials` is enabled automatically only for
URLs that match one of the patterns (each is used with `String.prototype.search`). Lets
you scope credentialed requests to specific hosts. Defaults to `[]`.

#### corsImg

Configuration for routing cross-origin image requests through a proxy to work around
[CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) restrictions. An object
with `url` (the proxy endpoint, where the token `#{cors}` is replaced by the target URL),
optional `method` (`'GET'` or `'POST'`), optional `headers`, and optional `data` (request
body, with `#{cors}` substituted in any string values). See
[Alternative Solutions to CORS Policy Issue](#alternative-solutions-to-cors-policy-issue)
below. Defaults to undefined.

#### scale

Scale value to be applied on canvas's `ctx.scale()` on both x and y axis. Can be used to
increase the image quality with higher image size.

### Alternative Solutions to CORS Policy Issue

Are you facing a [CORS policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
issue in your app? Don't worry, there are alternative solutions to this problem that you
can explore. Here are some options to consider:

1. **Use the option.corsImg support by passing images** With this option, you can setup a
   proxy service that will process the requests in a safe CORS context.

2. **Use third-party services like [allOrigins](https://allorigins.win/).** With this
   service, you can fetch the source code or an image in base64 format from any website.
   However, this method can be a bit slow.

3. **Set up your own API service.** Compared to third-party services like
   [allOrigins](https://allorigins.win/), this method can be faster, but you'll need to
   convert the image URL to base64 format. You can use the
   "[image-to-base64](https://github.com/renanbastos93/image-to-base64)" package for this
   purpose.

4. **Utilize
   [server-side functions](https://nextjs.org/docs/basic-features/data-fetching/get-server-side-props)
   features of frameworks like [Next.js](https://nextjs.org/).** This is the easiest and
   most convenient method, where you can directly fetch a URL source within
   [server-side functions](https://nextjs.org/docs/basic-features/data-fetching/get-server-side-props)
   and convert it to base64 format if needed.

By exploring these alternative solutions, you can overcome
[the CORS policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) issue in your
app and ensure that your images are accessible to everyone.

## Browsers

It's tested on latest Chrome and Firefox (49 and 45 respectively at the time of writing),
with Chrome performing significantly better on big DOM trees, possibly due to it's more
performant SVG support, and the fact that it supports `CSSStyleDeclaration.cssText`
property.

_Internet Explorer is not (and will not be) supported, as it does not support SVG
`<foreignObject>` tag_

_Safari [is not supported](https://github.com/tsayen/dom-to-image/issues/27), as it uses a
stricter security model on `<foreignObject`> tag. Suggested workaround is to use `toSvg`
and render on the server._`

## Dependencies

The newest language features the code relies on are `globalThis` (ES2020) and
`Promise.prototype.finally` (ES2018), so it needs at least Chrome 71, Edge 79, Firefox 65,
Opera 58, Safari 12.1, or Node 12.

### Source

Only standard lib is currently used, but make sure your browser supports:

- [Promise](https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/Promise)
- SVG `<foreignObject>` tag

### Tests

As of this v3 branch chain, the testing jig is taking advantage of the `onclone` hook to
insert the clone-output into the testing page. This should make it a tiny bit easier to
track down where exactly the inlining of CSS styles against the DOM nodes is wrong.

Most importantly, tests **only** depend on:

- [ocrad.js](https://github.com/antimatter15/ocrad.js), for the parts when you can't
  compare images (due to the browser rendering differences) and just have to test whether
  the text is rendered

## How it works

There might some day exist (or maybe already exists?) a simple and standard way of
exporting parts of the HTML to image (and then this script can only serve as an evidence
of all the hoops I had to jump through in order to get such obvious thing done) but I
haven't found one so far.

This library uses a feature of SVG that allows having arbitrary HTML content inside of the
`<foreignObject>` tag. So, in order to render that DOM node for you, following steps are
taken:

1. Clone the original DOM node recursively

1. Compute the style for the node and each sub-node and copy it to corresponding clone
    - and don't forget to recreate pseudo-elements, as they are not cloned in any way, of
      course

1. Embed web fonts
    - find all the `@font-face` declarations that might represent web fonts

    - parse file URLs, download corresponding files

    - base64-encode and inline content as `data:` URLs

    - concatenate all the processed CSS rules and put them into one `<style>` element,
      then attach it to the clone

1. Embed images
    - embed image URLs in `<img>` elements

    - inline images used in `background` CSS property, in a fashion similar to fonts

1. Serialize the cloned node to XML

1. Wrap XML into the `<foreignObject>` tag, then into the SVG, then make it a data URL

1. Optionally, to get PNG content or raw pixel data as a Uint8Array, create an Image
   element with the SVG as a source, and render it on an off-screen canvas, that you have
   also created, then read the content from the canvas

1. Done!

### Beyond the basics

A few things the cloning step does that aren't obvious from the list above:

- **SVG `<use>` → `<symbol>` inlining.** An `<svg>` often paints an icon with
  `<use href="#icon">` where the referenced `<symbol>` (or any element) lives **elsewhere
  on the page** — outside the node you're rendering. That target would never be cloned, so
  the `<use>` would render nothing. The library detects each `<use>`, resolves its
  `href`/`xlink:href` against the **live** document, and injects a copy of the referenced
  element into a hidden `<defs>` in the output so the reference still resolves in the
  standalone image. The `<use>` element itself is left in place (keeping its own
  position, size, and inherited `currentColor`). Same-document references only —
  external sprite files (`sprite.svg#icon`) are left untouched.

- **Default-style optimization (`styleCaching`).** Copying every computed style onto every
  clone produces enormous SVGs. Instead, the library computes each element's _browser
  default_ styles (for its tag, in a throwaway sandbox iframe) and emits only the
  properties that actually differ from the default or the parent. `styleCaching` (`'strict'`
  by default, or `'relaxed'`) tunes how aggressively those per-tag computations are reused
  across siblings.

- **Pseudo-elements and form state.** `::before`/`::after` aren't cloned by the DOM, so
  they're recreated as real elements carrying the pseudo-element's computed style. Current
  values of form controls (`<input>`, `<textarea>`, checked/selected state) are copied too,
  since those live in the DOM, not in attributes.

- **Open shadow DOM.** Open shadow roots and their slot-assigned (projected) nodes are
  walked and flattened into the clone, so web-component content renders.

- **Cross-origin resources.** Web fonts and images are fetched and base64-inlined; for
  images that block CORS you can route them through a proxy with the [corsImg](#corsimg)
  option, send cookies with `useCredentials`/`useCredentialsFilters`, or cap slow fetches
  with `httpTimeout`. A broken **content image** degrades gracefully (see _Things to watch
  out for_ below).

- **No mutation of your DOM.** All of this happens on a detached clone, and any temporary
  helpers (the sandbox iframe, wrapper spans for non-element nodes) are tracked and removed
  in a `finally`, so a render that throws part-way can't leak nodes into your page.

## Using Typescript

This package ships its own type definitions (`dom-to-image-more.d.ts`), so no separate
`@types/...` install is needed. Just import and use it:

```typescript
import domtoimage, { Options } from 'dom-to-image-more';

const node = document.getElementById('my-node')!;
const options: Options = { quality: 0.95, styleCaching: 'relaxed' };

domtoimage.toPng(node, options).then((dataUrl: string) => {
    /* ... */
});
```

The bundled types cover every rendering option documented above (including fork-specific
ones such as `adjustClonedNode`, `filterStyles`, `styleCaching`, `corsImg`,
`useCredentials`/`useCredentialsFilters`, `httpTimeout`, and `disableEmbedFonts`). The
default import works with `esModuleInterop` enabled; otherwise use
`import domtoimage = require('dom-to-image-more');`.

The `impl` member is intentionally typed as `unknown`, since it is an internal surface
that may change between releases and should not be depended on; cast it explicitly if you
need to reach into it for testing.

## Things to watch out for

- if the DOM node you want to render includes a `<canvas>` element with something drawn on
  it, it should be handled fine, unless the canvas is
  [tainted](https://developer.mozilla.org/en-US/docs/Web/HTML/CORS_enabled_image) - in
  this case rendering will rather not succeed.

- at the time of writing, Firefox has a problem with some external stylesheets (see issue
  #13). In such case, the error will be caught and logged.

- By design failed resources are handled at two different levels. A broken **content
  image** (an `<img>` inside the node you're rendering) degrades gracefully — it's skipped
  and the rest of the node still renders, and you can observe it via the
  [onImageError](#onimageerror) callback. But a failure of the **final rasterization**
  (turning the SVG into a PNG/JPEG/canvas) or a `<canvas>` snapshot is fatal — the
  returned promise rejects so your `.catch()` can handle it, rather than silently
  returning a blank image. In short: missing content degrades, a broken output rejects.

## Authors

Marc Brooks, Anatolii Saienko (original dom-to-image), Paul Bakaus (original idea), Aidas
Klimas (fixes), Edgardo Di Gesto (fixes), 樊冬 Fan Dong (fixes), Shrijan Tripathi (docs),
SNDST00M (optimize), Joseph White (performance CSS), Phani Rithvij (test), David
DOLCIMASCOLO (packaging), Zee (ZM) @zm-cttae (many major updates), Joshua Walsh
@JoshuaWalsh (Firefox issues), Emre Coban @emrecoban (documentation), Nate Stuyvesant
@nstuyvesant (fixes), King Wang @eachmawzw (CORS image proxy), TMM Schmit @tmmschmit
(useCredentialsFilters), Aravind @codesculpture (fix overridden props), Shi Wenyu @cWenyu
(shadow slot fix), David Burns @davidburns573 and Yujia Cheng @YujiaCheng1996 (font copy
optional), Julien Dorra @juliendorra (documentation), Sean Zhang @SeanZhang-eaton (regex
fixes), Ludovic Bouges @ludovic (style property filter), Roland Ma @RolandMa1986 (URL
regex)", Kasim Tan @kasimtan, Matthias Zach @matthiaszach (iframe fixes), Kamran Ayub
@kamranayub (filter URL option)

## License

MIT
