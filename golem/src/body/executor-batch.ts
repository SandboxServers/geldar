/**
 * The wake text for a batch that stopped: fixed words around the action kinds. It names the one that
 * failed, the ones that ran before it and the ones that never ran.
 */
export function batchFailureDetail(actions: readonly { do: string }[], failedAt: number): string {
  const kinds = (list: readonly { do: string }[]): string =>
    list.map((a) => a.do).join(', ') || 'none';
  const ran = kinds(actions.slice(0, failedAt));
  const skipped = kinds(actions.slice(failedAt + 1));
  return `action ${failedAt} (${actions[failedAt]?.do}) did not complete; completed before it: ${ran}; not run: ${skipped}`;
}
