/**
 * The Body's book subject (spec 5.2, 5.15.2; WM-07): answers a `BookRequest` with the written book
 * the ranger holds, the held one first, else the first carried one. It never equips anything (Q7).
 * The book's text is world text: it goes into the reply as data and nothing here reads it as an
 * instruction (decision 0044).
 */
import {
  type BookReply,
  type BookRequest,
  bookSubject,
  validateBookReply,
  validateBookRequest,
} from '@geldar/contract';
import type { RequestServer } from '../mind-link/server.ts';
import { isWrittenBook, readWrittenBook } from './written-book.ts';

/** The part of a mineflayer bot the book server reads: the held item and the inventory. */
export interface BookBot {
  readonly heldItem?: unknown;
  readonly inventory: { items(): unknown[] };
}

export interface BookServerOptions {
  shard: string;
  /** The life this Body plays; a request for another life is ignored. */
  lifeId: string;
  server: RequestServer;
  bot: BookBot;
  /** Receives the item-shape diagnostic, once per process. */
  log?: (line: string) => void;
}

const NO_BOOK: BookReply = { status: 'no_book', title: '', author: '', text: '' };
const UNREADABLE: BookReply = { status: 'unreadable', title: '', author: '', text: '' };

/** Serves the book subject of one life; returns the function that stops serving. */
export function serveBooks(options: BookServerOptions): () => void {
  const { shard, lifeId, server, bot } = options;
  let shapeLogged = false;
  const log = (line: string): void => {
    if (shapeLogged) return;
    shapeLogged = true;
    options.log?.(line);
  };
  return server.serve(bookSubject(shard, lifeId), async (data, reply) => {
    const request = parseRequest(data);
    if (request === null || request.life_id !== lifeId) return;
    const answer = answerBookRequest(bot, log);
    reply(JSON.stringify(validateBookReply(answer).ok ? answer : UNREADABLE));
  });
}

/** The reply for the bot's book: the held written book, else the first carried one. Never throws. */
export function answerBookRequest(bot: BookBot, log?: (line: string) => void): BookReply {
  try {
    const first = [bot.heldItem, ...bot.inventory.items()].find(isWrittenBook);
    if (first === undefined) return NO_BOOK;
    const book = readWrittenBook(first, log);
    return book === null ? UNREADABLE : { status: 'ok', ...book };
  } catch {
    return UNREADABLE;
  }
}

function parseRequest(data: string): BookRequest | null {
  try {
    const checked = validateBookRequest(JSON.parse(data));
    return checked.ok ? checked.value : null;
  } catch {
    return null;
  }
}
