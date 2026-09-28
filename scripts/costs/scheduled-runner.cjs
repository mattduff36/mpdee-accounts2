// Local-only runner. Configuration and credentials never enter repository files or logs.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const directory = __dirname;
try {
const config = JSON.parse(fs.readFileSync(path.join(directory, 'config.json'), 'utf8'));
const logFile = path.join(directory, 'status.json');
const startedAt = new Date().toISOString();
const env = { ...process.env };
if (config.storageBase) env.LOCALAPPDATA = config.storageBase;
// Inherited settings cannot silently enable uploads or select another destination.
delete env.COSTS_INGEST_URL;
delete env.COSTS_INGEST_TOKEN;
delete env.COSTS_VERCEL_BYPASS_TOKEN;
const args = [path.join(directory, 'collector', 'collect.mjs'), '--days', '2'];
if (config.uploadEnabled === true) {
  const runtime = JSON.parse(fs.readFileSync(config.runtimeFile, 'utf8'));
  if (runtime.ingestUrl !== 'https://mpdee-accounts2-git-preview-mpdees-projects.vercel.app/api/costs/ingest') throw new Error('Unexpected preview upload destination.');
  env.COSTS_INGEST_URL = runtime.ingestUrl;
  env.COSTS_INGEST_TOKEN = runtime.ingestToken;
  if (runtime.vercelBypassToken) env.COSTS_VERCEL_BYPASS_TOKEN = runtime.vercelBypassToken;
  args.push('--upload');
}
fs.writeFileSync(logFile, JSON.stringify({ startedAt, state:'running', uploadEnabled:config.uploadEnabled === true }));
const child = spawn(process.execPath, args, { env, windowsHide:true, stdio:'ignore' });
let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  fs.writeFileSync(logFile, JSON.stringify({ startedAt, finishedAt:new Date().toISOString(), state:code === 0 ? 'success' : 'failed', exitCode:code, uploadEnabled:config.uploadEnabled === true }));
  process.exitCode = code;
}
child.on('error', () => finish(1));
child.on('exit', code => finish(code ?? 1));
} catch {
  // Never let JSON parser excerpts disclose a damaged credential file.
  console.error('Costs automation configuration failed; inspect local configuration without publishing its contents.');
  process.exitCode = 1;
}
