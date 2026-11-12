// The one-line status under the toolbar, so a bad pane is diagnosable without devtools.

export interface StatusInfo {
  connected: boolean;
  chunks: number;
  entities: number;
  atlas:
    | { state: 'loading' }
    | { state: 'ready'; count: number }
    | { state: 'failed'; error: string };
}

export function statusLine(s: StatusInfo): string {
  const atlas =
    s.atlas.state === 'ready'
      ? `atlas ready (${s.atlas.count})`
      : s.atlas.state === 'failed'
        ? `atlas FAILED (${s.atlas.error})`
        : 'atlas loading';
  return `${s.connected ? 'connected' : 'not connected'} | chunks ${s.chunks} | entities ${s.entities} | ${atlas}`;
}

/** The top bar: one line summarising every open pane (connected if any is; counts are summed). */
export function aggregateStatus(
  panes: Omit<StatusInfo, 'atlas'>[],
  atlas: StatusInfo['atlas'],
): StatusInfo {
  return {
    connected: panes.some((p) => p.connected),
    chunks: panes.reduce((n, p) => n + p.chunks, 0),
    entities: panes.reduce((n, p) => n + p.entities, 0),
    atlas,
  };
}
