import { strToU8, zipSync } from 'fflate';
import { pluginManifest, pluginMcpConfig, pluginSkill, pluginSkillName } from '../server/plugin.ts';

export function pluginArchive() {
  // An explicit allowlist keeps credentials, databases and correspondence out.
  return zipSync(
    {
      'plugin.json': strToU8(JSON.stringify(pluginManifest, null, 2) + '\n'),
      'mcp.json': strToU8(JSON.stringify(pluginMcpConfig, null, 2) + '\n'),
      [`skills/${pluginSkillName}/SKILL.md`]: strToU8(pluginSkill),
    },
    { level: 6 },
  );
}
