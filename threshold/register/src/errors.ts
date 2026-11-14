/** HTML error pages for the browser paths (C7-06). The JSON API keeps its problem bodies under /api/. */

const TITLES: Readonly<Record<number, { title: string; text: string }>> = {
  403: { title: 'Access refused', text: 'You do not have access to this page.' },
  404: { title: 'Page not found', text: 'There is no page at this address.' },
  429: { title: 'Too many requests', text: 'You have made too many requests.' },
  503: { title: 'Temporarily unavailable', text: 'The service is paused for a moment.' },
};

const retryHint = (seconds: number | undefined): string =>
  seconds === undefined || seconds <= 0
    ? 'Try again later.'
    : `Try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`;

/** The HTML page for a browser request that failed. Retry hints are given for 429 and 503 only. */
export function errorPage(status: number, retryAfter?: number): string {
  const entry = TITLES[status] ?? { title: 'Error', text: 'Something went wrong.' };
  const hint = status === 429 || status === 503 ? `<p>${retryHint(retryAfter)}</p>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${entry.title}</title><link rel="stylesheet" href="/register/account.css"></head><body><h1>${entry.title}</h1><p>${entry.text}</p>${hint}<p><a href="/register">Back to the start</a></p></body></html>`;
}
