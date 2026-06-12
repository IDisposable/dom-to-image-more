// Type-level regression test for the bundled type definitions (issue #173).
// Not part of the karma suite — it's a compile-only check.
// Run with:  npm run test:types   (or: npx -p typescript tsc --noEmit ... this file)
//
// It must COMPILE. The `@ts-expect-error` lines must each produce exactly one
// error, or tsc fails (reporting an "unused" expect-error) — so this file fails
// loudly if the bundled .d.ts ever drifts.

import domtoimage, { Options, ImageErrorInfo, ResourceType } from '../dom-to-image-more';

declare const node: HTMLElement;

// --- the exposed ResourceType constants ---
const fontKind: ResourceType = domtoimage.ResourceType.FONT;
void fontKind;

// --- return types of every render method ---
domtoimage.toSvg(node).then((u: string) => u);
domtoimage.toPng(node).then((u: string) => u);
domtoimage.toJpeg(node, { quality: 0.9 }).then((u: string) => u);
domtoimage.toBlob(node).then((b: Blob) => b);
domtoimage.toCanvas(node).then((c: HTMLCanvasElement) => c);
domtoimage.toPixelData(node).then((p: Uint8ClampedArray) => p);

// --- the full Options surface (incl. fork-specific options) ---
const opts: Options = {
    bgcolor: '#fff',
    width: 100,
    height: 50,
    quality: 0.92,
    scale: 2,
    pixelRatio: 2,
    preserveScroll: true,
    ignoreCSSRuleErrors: true,
    cacheBust: true,
    styleCaching: 'relaxed',
    copyDefaultStyles: false,
    disableEmbedFonts: true,
    disableInlineImages: true,
    ensureShown: true,
    useCredentials: true,
    useCredentialsFilters: [/foo/, 'bar'],
    httpTimeout: 5000,
    imagePlaceholder: 'data:,',
    filter: (n: Node) => n.nodeType === 1,
    filterStyles: (n: Node, p: string) => !p.startsWith('--'),
    adjustPseudoElement: (
        _n: Node,
        pseudo: ':before' | ':after',
        style: CSSStyleDeclaration
    ) => {
        if (pseudo === ':after') return false;
        if (style.getPropertyValue('content').includes('—')) return { content: '"-"' };
        return undefined;
    },
    adjustClonedNode: (_n: Node, clone: Node, _after: boolean) => clone,
    onclone: (_clone: Node) => undefined,
    corsImg: { url: 'p', method: 'POST', headers: { a: 'b' } },
    requestInterceptor: (
        url: string,
        context: { type: ResourceType; status: number | undefined }
    ) =>
        context.status === undefined &&
        context.type === domtoimage.ResourceType.IMAGE &&
        url.startsWith('cached:')
            ? 'data:,'
            : undefined,
    onImageError: (info: ImageErrorInfo) => {
        const u: string = info.url;
        const s: number = info.status;
        const willUse: boolean = info.willUsePlaceholder;
        const m: string = info.message;
        void [u, s, willUse, m];
    },
};
domtoimage.toPng(node, opts).then((u: string) => u);

// --- negative cases: each must be a type error ---
// @ts-expect-error unknown option is rejected
domtoimage.toPng(node, { notAnOption: true });
// @ts-expect-error styleCaching is a 'strict' | 'relaxed' literal union
domtoimage.toSvg(node, { styleCaching: 'loose' });
// @ts-expect-error toBlob resolves a Blob, not a string
domtoimage.toBlob(node).then((s: string) => s);
