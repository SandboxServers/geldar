/**
 * Parses `git ls-files --eol` output and returns the paths whose committed
 * (index) copy contains CRLF. `.gitattributes` forces LF on everything except
 * Windows batch files, so any other CRLF in the index is a mistake.
 */
export function findCrlfInIndex(lsFilesEol: string): string[] {
  const offenders: string[] = [];
  for (const line of lsFilesEol.split('\n')) {
    // Format: "i/<eol> w/<eol> attr/<attrs>\t<path>"
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const index = line.slice(0, tab).split(/\s+/)[0];
    const path = line.slice(tab + 1);
    if ((index === 'i/crlf' || index === 'i/mixed') && !/\.(bat|cmd)$/i.test(path)) {
      offenders.push(path);
    }
  }
  return offenders;
}
