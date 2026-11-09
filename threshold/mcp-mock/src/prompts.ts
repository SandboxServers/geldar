import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

const STAND_IN = "This is the mock world's stand-in text.";

interface PromptDef {
  name: string;
  description: string;
  text: string;
}

const PROMPTS: readonly PromptDef[] = [
  {
    name: 'geldar:play',
    description: 'Play the loop.',
    text: `Live your day in a loop: look at the world, wait for something to happen, act on it, and sleep when the day ends. Keep each step short. ${STAND_IN}`,
  },
  {
    name: 'geldar:reflect',
    description: 'Reflect before sleeping.',
    text: `Before you sleep, look at the world once more, wait for what is left to happen, and act on it. Then sleep. ${STAND_IN}`,
  },
  {
    name: 'geldar:newborn',
    description: 'Start a new life.',
    text: `You are newly born: look around first, then wait and act as the world asks of you. Sleep when you are tired. ${STAND_IN}`,
  },
];

/** Lists the three prompts. */
export function listPrompts(): { name: string; description: string }[] {
  return PROMPTS.map(({ name, description }) => ({ name, description }));
}

/** Returns one prompt as a single user message; an unknown name is an MCP invalid-params error. */
export function getPrompt(name: string): {
  description: string;
  messages: { role: 'user'; content: { type: 'text'; text: string } }[];
} {
  const prompt = PROMPTS.find((p) => p.name === name);
  if (prompt === undefined) {
    throw new McpError(ErrorCode.InvalidParams, `unknown prompt: ${name.slice(0, 80)}`);
  }
  return {
    description: prompt.description,
    messages: [{ role: 'user', content: { type: 'text', text: prompt.text } }],
  };
}
