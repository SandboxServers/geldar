/**
 * Inert hostile strings for the Glass security tests. Each is test data: a payload that would set
 * `__glassCanary` or fetch canary.invalid if a browser ran it. Nothing here is evaluated.
 */

/** Hostile strings for the thought text fields. Each would set `__glassCanary` or fetch a canary host. */
export const CORPUS: { name: string; value: string }[] = [
  { name: 'script tag', value: '<script>globalThis.__glassCanary = "script"</script>' },
  { name: 'img onerror', value: '<img src=x onerror="globalThis.__glassCanary = \'img\'">' },
  {
    name: 'svg onload',
    value:
      '<svg onload="globalThis.__glassCanary = \'svg\'"><script>globalThis.__glassCanary=1</script></svg>',
  },
  {
    name: 'mathml mXSS',
    value: '<math><mtext><table><mglyph><style><img src=x onerror=globalThis.__glassCanary=1>',
  },
  { name: 'javascript: url', value: 'javascript:globalThis.__glassCanary = 1' },
  { name: 'mixed-case javascript: url', value: 'JaVaScRiPt:globalThis.__glassCanary=1' },
  { name: 'data: url', value: 'data:text/html,<script>globalThis.__glassCanary=1</script>' },
  { name: 'anchor to canary host', value: '<a href="https://canary.invalid/a">link</a>' },
  { name: 'HTML comment trick', value: '<!-- --><img src=https://canary.invalid/c.png><!--' },
  { name: 'script inside comment', value: '<!--<script>globalThis.__glassCanary=1</script>-->' },
  {
    name: 'CSS injection',
    value: 'x}</style><style>body{background:url(https://canary.invalid/css)}',
  },
  // biome-ignore lint/suspicious/noTemplateCurlyInString: hostile text that must reach the page as plain text
  { name: 'backtick template payload', value: '`${globalThis.__glassCanary = 1}`' },
  { name: 'textarea breakout', value: '</textarea><script>globalThis.__glassCanary=1</script>' },
  { name: 'title breakout', value: '</title><img src=x onerror=globalThis.__glassCanary=1>' },
  { name: 'attribute breakout', value: '"><img src=x onerror=globalThis.__glassCanary=1>' },
  {
    name: 'iframe srcdoc',
    value: '<iframe srcdoc="<script>globalThis.__glassCanary=1</script>"></iframe>',
  },
  {
    name: 'form and formaction',
    value:
      '<form action="https://canary.invalid/f"><button formaction="https://canary.invalid/g">x</button></form>',
  },
  {
    name: 'meta refresh',
    value: '<meta http-equiv="refresh" content="0;url=https://canary.invalid/">',
  },
  { name: 'base href', value: '<base href="https://canary.invalid/">' },
  {
    name: 'markdown with script',
    value:
      '[click](javascript:globalThis.__glassCanary=1)\n\n<img src=x onerror=globalThis.__glassCanary=1>',
  },
  { name: 'RTL override', value: '‮evil‬' },
  { name: 'RTL isolate', value: '⁧abc⁩' },
  { name: 'zero-width run', value: '​'.repeat(1000) },
  { name: 'NUL byte', value: 'nul\u0000byte' },
  { name: 'lone high surrogate', value: 'a\uD800b' },
  { name: 'lone low surrogate', value: '\uDC00x' },
  { name: 'line and paragraph separators', value: 'a b c' },
  {
    name: 'escaped unicode text',
    value: '\\u003cscript\\u003eglobalThis.__glassCanary=1\\u003c/script\\u003e',
  },
  { name: 'fake canary marker', value: '[CANARY:script] __glassCanary' },
  { name: 'extremely long string', value: 'z'.repeat(200_000) },
  { name: 'deeply nested JSON text', value: `${'{"a":'.repeat(500)}1${'}'.repeat(500)}` },
];
