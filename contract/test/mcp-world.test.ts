import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  ActInput,
  ActionOutcome,
  ActResult,
  DefineSkillInput,
  DefineSkillResult,
  JournalInput,
  JournalResult,
  LookInput,
  LookResult,
  McpCursor,
  McpInterest,
  McpPlayerEvent,
  McpWakeReason,
  OfferInput,
  OfferResult,
  ProposeInput,
  ProposeResult,
  ReadBookInput,
  ReadBookResult,
  SayInput,
  SayResult,
  SleepInput,
  SleepResult,
  StatusInput,
  StatusResult,
  UntrustedWorldText,
  UseSkillInput,
  UseSkillResult,
  VoteInput,
  VoteResult,
  WaitInput,
  WaitResult,
  WriteBookInput,
  WriteBookResult,
} from '../src/index.ts';
import {
  MCP_TOOL_NAMES,
  mcpToolSchemas,
  validateToolInput,
  validateToolResult,
} from '../src/index.ts';
import { ACT_RESULT_WITH_IDS, INPUT_ROWS, RESULT_ROWS } from './mcp-world-fixtures.ts';

/** Compile-time check only: every exported MCP type name resolves. */
export type AllMcpTypes = [
  ActInput,
  ActionOutcome,
  ActResult,
  DefineSkillInput,
  DefineSkillResult,
  JournalInput,
  JournalResult,
  LookInput,
  LookResult,
  McpCursor,
  McpInterest,
  McpPlayerEvent,
  McpWakeReason,
  OfferInput,
  OfferResult,
  ProposeInput,
  ProposeResult,
  ReadBookInput,
  ReadBookResult,
  SayInput,
  SayResult,
  SleepInput,
  SleepResult,
  StatusInput,
  StatusResult,
  UntrustedWorldText,
  UseSkillInput,
  UseSkillResult,
  VoteInput,
  VoteResult,
  WaitInput,
  WaitResult,
  WriteBookInput,
  WriteBookResult,
];

/** The tools of the spec 5.15.3 table. */
const SPEC_TOOLS = [
  'look',
  'wait',
  'act',
  'say',
  'read_book',
  'see',
  'view',
  'write_book',
  'define_skill',
  'use_skill',
  'offer',
  'plan_check',
  'propose',
  'vote',
  'sleep',
  'journal',
  'status',
  'survey',
];
/** Covered by mcp-play.test.ts (checked below). */
const COVERED_ELSEWHERE = ['look', 'wait', 'act', 'say'];

describe('mcp world tools: coverage', () => {
  it('has exactly the spec tools', () => {
    expect([...MCP_TOOL_NAMES].sort()).toEqual([...SPEC_TOOLS].sort());
  });

  for (const tool of COVERED_ELSEWHERE) {
    it(`mcp-play.test.ts covers ${tool}`, () => {
      const play = readFileSync(new URL('./mcp-play.test.ts', import.meta.url), 'utf8');
      expect(play).toContain(`validateToolInput('${tool}'`);
      expect(play).toContain(`validateToolResult('${tool}'`);
    });
  }

  it('has a valid input row and a valid result row for every tool', () => {
    for (const tool of SPEC_TOOLS) {
      if (COVERED_ELSEWHERE.includes(tool)) continue;
      expect(
        INPUT_ROWS.find((r) => r.tool === tool)?.valid.length,
        `${tool} input`,
      ).toBeGreaterThan(0);
      expect(
        RESULT_ROWS.find((r) => r.tool === tool)?.valid.length,
        `${tool} result`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('mcp world tools: rows', () => {
  for (const [kind, rows, validate] of [
    ['input', INPUT_ROWS, validateToolInput],
    ['result', RESULT_ROWS, validateToolResult],
  ] as const) {
    for (const row of rows) {
      it(`${row.tool} ${kind}: valid rows pass, invalid rows fail`, () => {
        for (const value of row.valid) {
          expect(validate(row.tool, value), JSON.stringify(value)).toMatchObject({ ok: true });
        }
        for (const value of row.invalid) {
          expect(validate(row.tool, value), JSON.stringify(value)).toMatchObject({ ok: false });
        }
      });
    }
  }

  it('rejects an act result with an action_ids key', () => {
    expect(validateToolResult('act', ACT_RESULT_WITH_IDS).ok).toBe(false);
  });
});

describe('mcp world tools: descriptions', () => {
  it('every input has a description under 300 characters', () => {
    for (const tool of MCP_TOOL_NAMES) {
      const { description } = mcpToolSchemas[tool];
      expect(description.length, tool).toBeGreaterThan(0);
      expect(description.length, tool).toBeLessThan(300);
    }
  });

  it('quotes the spec purposes', () => {
    const purposes: Record<string, RegExp> = {
      offer: /shrine/,
      journal: /this player's journal/,
      status: /laws in force/,
      sleep: /journal mirror/,
      define_skill: /test result/,
    };
    for (const [tool, pattern] of Object.entries(purposes)) {
      expect(mcpToolSchemas[tool as keyof typeof mcpToolSchemas].description, tool).toMatch(
        pattern,
      );
    }
  });
});
