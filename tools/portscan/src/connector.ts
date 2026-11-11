import { connect } from 'node:net';
import type { Connector, Probe } from './scan.ts';

/**
 * The real TCP connector. A completed handshake is open; a refusal or any other socket error is closed; no
 * answer within `timeoutMs` is a timeout. An abort ends the attempt as closed, and the scan then stops.
 * No test uses this connector: tests inject a fake one.
 */
export function tcpConnector(host: string, timeoutMs: number): Connector {
  return (port, signal) =>
    new Promise<Probe>((resolve) => {
      const socket = connect({ host, port });
      let settled = false;
      const finish = (result: Probe): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        socket.destroy();
        resolve(result);
      };
      const timer = setTimeout(() => finish('timeout'), timeoutMs);
      const onAbort = (): void => finish('closed');
      signal.addEventListener('abort', onAbort, { once: true });
      socket.once('connect', () => finish('open'));
      socket.once('error', () => finish('closed'));
    });
}
