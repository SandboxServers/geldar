import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/**
 * The mock's stand-in suffix, which its prompts end with. The production server passes '' instead,
 * so a player never reads that the world is a mock.
 */
export const MOCK_SUFFIX = "This is the mock world's stand-in text.";

interface PromptDef {
  name: string;
  description: string;
  text: string;
}

const PROMPTS: readonly PromptDef[] = [
  {
    name: 'geldar:play',
    description: 'Play the loop.',
    text: `Live your day in a loop: look at the world, wait for something to happen, act on it, and sleep when the day ends. Keep each step short.`,
  },
  {
    name: 'geldar:reflect',
    description: 'Reflect before sleeping.',
    text: `Before you sleep, look at the world once more, wait for what is left to happen, and act on it. Then sleep.`,
  },
  {
    name: 'geldar:newborn',
    description: 'Start a new life.',
    text: `You are newly born: look around first, then wait and act as the world asks of you. Sleep when you are tired.`,
  },
];

/** Lists the three prompts. */
export function listPrompts(): { name: string; description: string }[] {
  return PROMPTS.map(({ name, description }) => ({ name, description }));
}

/** Returns one prompt as a single user message; an unknown name is an MCP invalid-params error. */
export function getPrompt(
  name: string,
  suffix: string = MOCK_SUFFIX,
): {
  description: string;
  messages: { role: 'user'; content: { type: 'text'; text: string } }[];
} {
  const prompt = PROMPTS.find((p) => p.name === name);
  if (prompt === undefined) {
    throw new McpError(ErrorCode.InvalidParams, `unknown prompt: ${name.slice(0, 80)}`);
  }
  const text = suffix === '' ? prompt.text : `${prompt.text} ${suffix}`;
  return {
    description: prompt.description,
    messages: [{ role: 'user', content: { type: 'text', text } }],
  };
}
