import { describe, expect, it } from 'vitest';
import { addContentEvent, CONTENT_CAP_BYTES, capText, contentAttributes } from '../src/content.ts';

describe('content fields', () => {
  it('leaves text under the cap whole and unflagged', () => {
    expect(capText('hello')).toEqual({ text: 'hello', bytes: 5, truncated: false });
  });

  it('truncates at 32 KiB and says so', () => {
    const capped = capText('a'.repeat(40_000));
    expect(capped.truncated).toBe(true);
    expect(capped.bytes).toBe(40_000);
    expect(new TextEncoder().encode(capped.text).byteLength).toBe(CONTENT_CAP_BYTES);
    expect(CONTENT_CAP_BYTES).toBe(32 * 1024);
  });

  it('cuts multi-byte text on a character boundary, never inside one', () => {
    const capped = capText('€'.repeat(20_000));
    expect(capped.truncated).toBe(true);
    expect(new TextEncoder().encode(capped.text).byteLength).toBeLessThanOrEqual(CONTENT_CAP_BYTES);
    expect(capped.text).not.toContain('�');
  });

  it('emits the capped text with its size and truncated flag as attributes', () => {
    const attrs = contentAttributes('prompt', 'x'.repeat(40_000));
    expect(attrs['geldar.content.prompt.truncated']).toBe(true);
    expect(attrs['geldar.content.prompt.bytes']).toBe(40_000);
    expect(String(attrs['geldar.content.prompt']).length).toBe(CONTENT_CAP_BYTES);
  });

  it('drops a content field whose name is forbidden', () => {
    expect(contentAttributes('password', 'hunter2')).toEqual({});
  });

  it('records a content field as a span event and reports truncation', () => {
    const events: Array<{ name: string; attrs: Record<string, unknown> | undefined }> = [];
    const span = {
      addEvent(name: string, attrs?: Record<string, unknown>) {
        events.push({ name, attrs });
      },
    };
    expect(addContentEvent(span, 'speech', 'short line')).toBe(false);
    expect(addContentEvent(span, 'speech', 'y'.repeat(40_000))).toBe(true);
    expect(events.map((e) => e.name)).toEqual(['geldar.content.speech', 'geldar.content.speech']);
  });
});
