import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collect } from './collect.mjs';
import { DAY_MS, saveCheckpoint, loadCheckpoint } from './reliability.mjs';

test('failed old window preserves the gap while recent usage saves and the next run resumes', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'costs-collect-integration-'));
  t.after(() => rmSync(directory, {recursive:true, force:true}));
  const accountRef = 'a'.repeat(32), now = 200 * DAY_MS + 123;
  const options = {credentials:{providerAccountRef:accountRef, cookie:'fixture-only'}, directory, days:2, now, index:new Map()};
  saveCheckpoint(directory, accountRef, 100 * DAY_MS);
  const seen = [];
  await assert.rejects(collect({...options, fetchWindow:async ({from}) => {
    seen.push(from);
    if (from === 101 * DAY_MS) throw new Error('fixture failure');
    return {events:[], quality:'complete'};
  }}), error => {
    assert.equal(error.coverage.coveredThrough, new Date(101 * DAY_MS).toISOString());
    assert.equal(error.coverage.catchingUp, true);
    return true;
  });
  assert.equal(loadCheckpoint(directory, accountRef), 101 * DAY_MS);
  assert.equal(seen.length, 10);
  assert.ok(seen.includes(200 * DAY_MS));
  assert.ok(readdirSync(directory).includes(`${accountRef}-${200 * DAY_MS}-${201 * DAY_MS}.json`));
  const outcome = await collect({...options, fetchWindow:async () => ({events:[], quality:'complete'})});
  assert.equal(outcome.coveredThrough, new Date(106 * DAY_MS).toISOString());
  assert.equal(loadCheckpoint(directory, accountRef), 106 * DAY_MS);
  assert.equal(outcome.catchingUp, true);
});
