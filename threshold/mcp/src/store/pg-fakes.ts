import type { Client, Pool } from 'pg';

/** One statement a fake pool received, with the values it was bound to. */
export interface SentQuery {
  text: string;
  values: unknown[];
}

export type QueryAnswer = (text: string, values: unknown[]) => { rows: unknown[] };

/** A `pg` Pool stand-in: it records every statement and answers from `answer`. No database. */
export class FakePool {
  readonly sent: SentQuery[] = [];

  private readonly answer: QueryAnswer;

  constructor(answer: QueryAnswer = () => ({ rows: [] })) {
    this.answer = answer;
  }

  async query(text: string, values: unknown[] = []): Promise<{ rows: unknown[] }> {
    this.sent.push({ text, values });
    return this.answer(text, values);
  }

  asPool(): Pool {
    return this as unknown as Pool;
  }
}

type Handler = (...args: never[]) => void;

/**
 * A `pg` Client stand-in for the LISTEN connection. Tests drive it with `emit`; `connectError`
 * makes the next connect fail.
 */
export class FakeListener {
  readonly queries: string[] = [];
  connectError: Error | null = null;
  ended = false;
  private readonly handlers = new Map<string, Handler[]>();

  on(event: string, handler: Handler): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      (handler as (...values: unknown[]) => void)(...args);
    }
  }

  async connect(): Promise<void> {
    if (this.connectError !== null) throw this.connectError;
  }

  async query(text: string): Promise<{ rows: unknown[] }> {
    this.queries.push(text);
    return { rows: [] };
  }

  async end(): Promise<void> {
    this.ended = true;
    this.emit('end');
  }

  asClient(): Client {
    return this as unknown as Client;
  }
}
