// Child process for alias-proxy-diagnostics.test.ts: an error is thrown after the handlers are installed.
import { installDiagnostics } from '../../alias-proxy/alias-proxy.ts';

installDiagnostics(process, (line) => console.log(line));
setTimeout(() => {
  throw new Error('fixture boom');
}, 10);
