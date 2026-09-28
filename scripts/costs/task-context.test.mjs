import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTaskText } from './task-context.mjs';
test('task summary emits fixed categories, never prompt fragments or credentials', () => {
  const result = summarizeTaskText('Fix login for alice@example.com password=secret123 at C:/Users/alice/private. Database token sk-secret');
  assert.deepEqual(result, { topics: ['Database work', 'Authentication and access', 'Testing and debugging'], method: 'local-topic-rules-v1' });
  assert.equal(/alice|secret|password|Users/.test(JSON.stringify(result)), false);
});
test('unrecognized content stays private and summaries are bounded', () => {
  assert.equal(summarizeTaskText('alice@example.com secret123'), null);
  assert.equal(summarizeTaskText(''), null);
  assert.equal(summarizeTaskText('ui costs database login deploy test schedule').topics.length, 3);
});
