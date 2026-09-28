import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { readTaskContext } from "./task-context.mjs";
import { retryTransient } from "./reliability.mjs";

export const DASHBOARD_ORIGIN = "https://cursor.com";
export const EVENTS_ENDPOINT =
  `${DASHBOARD_ORIGIN}/api/dashboard/get-filtered-usage-events`;
const REQUEST_TIMEOUT_MS = 20_000;

function stateDatabasePath() {
  const appData =
    process.env.APPDATA ??
    (process.platform === "darwin"
      ? path.join(homedir(), "Library", "Application Support")
      : path.join(homedir(), ".config"));
  return path.join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
}

export function readCursorCredentials() {
  const database = new DatabaseSync(stateDatabasePath(), { readOnly: true });
  try {
    const select = database.prepare("SELECT value FROM ItemTable WHERE key = ?");
    const read = (key) => {
      const row = select.get(key);
      if (!row || typeof row.value !== "string") return null;
      return row.value.replace(/^"|"$/g, "").trim() || null;
    };
    const accessToken = read("cursorAuth/accessToken");
    const authId = read("cursorAuth/stripeMembershipAuthId");
    if (!accessToken || !authId) return null;
    return {
      email: read("cursorAuth/cachedEmail"),
      cookie: `WorkosCursorSessionToken=${authId}%3A%3A${accessToken}`,
      providerAccountRef: createHash("sha256")
        .update(`cursor:${authId}`)
        .digest("hex")
        .slice(0, 32),
    };
  } finally {
    database.close();
  }
}

export async function postJson(url, body, cookie) {
  return retryTransient(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
            Origin: DASHBOARD_ORIGIN,
            Referer: `${DASHBOARD_ORIGIN}/dashboard`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
          redirect: "manual",
        });
      } catch {
        const error = new Error("Cursor dashboard request failed or timed out.");
        error.transient = true;
        throw error;
      }
      if ([307, 401, 403].includes(response.status)) {
        throw new Error("Cursor session is not authorised; sign in to Cursor and retry.");
      }
      if (!response.ok) {
        const error = new Error(`Cursor dashboard returned ${response.status}.`);
        error.transient = response.status === 429 || response.status >= 500;
        throw error;
      }
      try { return await response.json(); }
      catch { throw new Error('Cursor dashboard response was not valid JSON.'); }
    } finally {
      clearTimeout(timer);
    }
  });
}
export function buildConversationProjectIndex() {
  const root = path.join(homedir(), ".cursor", "projects");
  const index = new Map();
  index.context = new Map();
  let projects;
  try {
    projects = readdirSync(root);
  } catch {
    return index;
  }
  for (const project of projects) {
    const transcripts = path.join(root, project, "agent-transcripts");
    let entries;
    try {
      entries = readdirSync(transcripts);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const id = entry.replace(/\.(jsonl|txt)$/, "");
      // A conversation appearing under two workspaces is ambiguous, never last-writer-wins.
      index.set(id, index.has(id) && index.get(id) !== project ? null : project);
      if (index.get(id)) {
        const candidate = path.join(transcripts, entry);
        let file = candidate;
        try { if (statSync(candidate).isDirectory()) file = path.join(candidate, `${id}.jsonl`); } catch { continue; }
        const context = readTaskContext(file);
        if (context) index.context.set(id, context);
      } else index.context.delete(id);
    }
  }
  return index;
}

export function projectKeyForWorkspace() {
  const cwd = process.cwd();
  const drive = cwd.slice(0, 1).toLowerCase();
  const rest = cwd.slice(2).replace(/\\/g, "-").replace(/\//g, "-").replace(/^-/, "");
  return `${drive}-${rest}`;
}

/** Verify a retained session against the provider before attributing any usage. */
export async function verifyCursorIdentity(credentials) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${DASHBOARD_ORIGIN}/api/auth/me`, {
      headers:{ Cookie:credentials.cookie, Referer:`${DASHBOARD_ORIGIN}/dashboard` },
      redirect:'manual', signal:controller.signal,
    });
    if (!response.ok) throw new Error('Cursor account identity could not be verified.');
    const identity = await response.json();
    if (typeof identity?.email !== 'string' || identity.email_verified !== true || typeof identity?.sub !== 'string' || !identity.sub) throw new Error('Cursor account identity response is unsupported.');
    return { email:identity.email, identityKey:createHash("sha256").update(`cursor-identity:${identity.sub}`).digest("hex") };
  } catch { throw new Error('Cursor account identity could not be verified.'); }
  finally { clearTimeout(timer); }
}