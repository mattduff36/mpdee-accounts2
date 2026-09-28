import { readFileSync, statSync } from 'node:fs';
// Only fixed vocabulary leaves the computer. No source fragments, paths, names or IDs.
const topics = [
  ['Interface and usability', /\b(ui|ux|interface|layout|responsive|styling|css|tailwind)\b/i],
  ['Costs and accounting', /\b(costs?|ledger|invoic\w*|expenses?|billing|accounting)\b/i],
  ['Database work', /\b(database|prisma|migration|postgres|sql)\b/i],
  ['Authentication and access', /\b(auth\w*|login|sign.in|permissions?)\b/i],
  ['Deployment and infrastructure', /\b(deploy\w*|vercel|hosting|infrastructure|build)\b/i],
  ['Testing and debugging', /\b(test\w*|debug\w*|bug|error|fix)\b/i],
  ['Scheduling and resources', /\b(schedul\w*|availability|resources?|employees?)\b/i],
];
export const CONTEXT_LABELS = topics.map(([label]) => label);
export function summarizeTaskText(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const labels = topics.filter(([, pattern]) => pattern.test(text.slice(0, 24000))).map(([label]) => label).slice(0, 3);
  return labels.length ? { topics: labels, method: 'local-topic-rules-v1' } : null;
}
export function readTaskContext(file) {
  try {
    // Bounded reads; unsupported/large transcripts simply have no description.
    if (statSync(file).size > 2_000_000) return null;
    const lines = readFileSync(file, 'utf8').split('\n').slice(0, 40);
    const texts = [];
    for (const line of lines) {
      let row; try { row = JSON.parse(line); } catch { continue; }
      const message = row.message ?? row;
      if (message.role !== 'user' && row.role !== 'user') continue;
      if (typeof message.content === 'string') texts.push(message.content);
      if (Array.isArray(message.content)) for (const part of message.content) if (part.type === 'text' && typeof part.text === 'string') texts.push(part.text);
    }
    return summarizeTaskText(texts.join(' '));
  } catch { return null; }
}
