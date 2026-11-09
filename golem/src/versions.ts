import { createRequire } from 'node:module';
import mineflayer from 'mineflayer';

/** The package versions Golem runs on, logged at start so a protocol problem names its stack. */
export interface StackVersions {
  mineflayer: string;
  minecraftData: string;
  mineflayerPathfinder: string;
  vec3: string;
  testedVersions: string[];
}

const require = createRequire(import.meta.url);
// The exact pins from golem/package.json, used when a package's exports field hides its package.json.
const pins = (require('../package.json') as { dependencies: Record<string, string> }).dependencies;

function packageVersion(name: string): string {
  try {
    return (require(`${name}/package.json`) as { version: string }).version;
  } catch {
    return pins[name] ?? 'unknown';
  }
}

/** Reads the versions of the four wave 2 packages (decision 0022) and the Minecraft versions Mineflayer tests. */
export function stackVersions(): StackVersions {
  return {
    mineflayer: packageVersion('mineflayer'),
    minecraftData: packageVersion('minecraft-data'),
    mineflayerPathfinder: packageVersion('mineflayer-pathfinder'),
    vec3: packageVersion('vec3'),
    testedVersions: [...mineflayer.testedVersions],
  };
}
