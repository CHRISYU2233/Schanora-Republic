import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const files = ['system_prompt.yaml', 'fallback.yaml', 'intent_prompts.yaml', 'agent_system_prompt.yaml'];
const identity = 'You are Schanora, the knowledge-base assistant serving Schaeffler engineering teams.';
const guidance = 'Introduce yourself as Schanora when asked. The application name and underlying language model are separate. Only name the model if the runtime provides its identity. Cite available source documents for company-specific claims and say when evidence is missing.';

export async function installSchanoraPrompts(directory) {
  const prompts = await Promise.all(files.map(async (name) => {
    const file = path.join(directory, name);
    const original = await readFile(file, 'utf8');
    // Only override the stock persona lines. Keep the rest of each template,
    // including its reference syntax, localization and specialized task rules.
    const updated = original.replace(/^( +)You are WeKnora(?:, [^\r\n.]+| (?:Data Analyst|Wiki Researcher|Wiki Fixer)[^\r\n.]*)\./gm,
      (line, indent) => {
        const task = line.trim().replace(/^You are WeKnora(?:, | )/, '').replace(/ developed by Tencent,?/g, '');
        return `${indent}${identity} ${guidance} For this mode, act as ${task}`;
      });
    return { file, original, updated };
  }));
  await Promise.all(prompts.map(({ file, original, updated }) =>
    updated === original ? undefined : writeFile(file, updated, 'utf8')));
}
