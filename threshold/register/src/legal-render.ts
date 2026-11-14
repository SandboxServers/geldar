/** Escapes the five HTML metacharacters. Every legal line passes through it before it reaches a page. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A minimal markdown render for the three legal files (LEGAL-SERVE): headings, paragraphs and list items.
 * It passes no raw HTML through and renders no links, so any hostile line is only ever escaped text.
 */
export function renderMarkdown(md: string): string {
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flush = (): void => {
    if (para.length > 0) out.push(`<p>${escapeHtml(para.join(' '))}</p>`);
    if (list.length > 0)
      out.push(`<ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`);
    para = [];
    list = [];
  };
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^-\s+(.*)$/.exec(line);
    if (line === '') {
      flush();
    } else if (heading) {
      flush();
      const marks = heading[1] ?? '';
      const level = marks.length;
      out.push(`<h${level}>${escapeHtml(heading[2] ?? '')}</h${level}>`);
    } else if (item) {
      if (para.length > 0) flush();
      list.push(item[1] ?? '');
    } else {
      if (list.length > 0) flush();
      para.push(line);
    }
  }
  flush();
  return out.join('\n');
}
