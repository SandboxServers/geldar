import { createHash } from 'node:crypto';
import type { ReadBookResult } from '@geldar/contract';
import { ToolError } from '@geldar/mcp-mock';
import type { BodyGateway } from '../ports.ts';
import { type ToolCall, WORLD_TEXT_NOTE } from './look.ts';

/** The book id: `bk_` and 26 characters of a SHA-256 over the title, author and text. */
export function bookIdOf(book: { title: string; author: string; text: string }): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([book.title, book.author, book.text]))
    .digest('hex');
  return `bk_${digest.slice(0, 26)}`;
}

export interface ReadBookDeps {
  body: BodyGateway;
}

/**
 * `read_book`: the written book the ranger holds, asked of its Body. Its title and text go only
 * under `untrusted_world_text`; the author feeds the id and is not shown. `no_book` is a tool
 * error the character sees. Free.
 */
export async function readBookTool(deps: ReadBookDeps, call: ToolCall): Promise<ReadBookResult> {
  const reply = await deps.body.book(call.lifeId);
  if (reply.status === 'no_book') throw new ToolError('no_book', 'You hold no book.');
  if (reply.status === 'unreadable') throw new ToolError('unreadable', 'The book cannot be read.');
  return {
    book_id: bookIdOf(reply),
    kind: 'text',
    untrusted_world_text: { book: { title: reply.title, text: reply.text } },
    note: WORLD_TEXT_NOTE,
  };
}
