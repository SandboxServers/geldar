// Child process for alias-proxy-diagnostics.test.ts: the listener is closed at once, so the event loop drains.
import { installDiagnostics, startProxy } from '../../alias-proxy/alias-proxy.ts';

const log = (line: string): void => console.log(line);
void startProxy({
  listen: 0,
  upstreamHost: '127.0.0.1',
  upstreamPort: 9,
  aliasesFile: undefined,
  log,
  onServer: (server) => installDiagnostics(process, log, server),
}).then((proxy) => proxy.close());
