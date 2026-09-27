import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
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
    if ([307, 401, 403].includes(response.status)) {
      throw new Error("Cursor session is not authorised; sign in to Cursor and retry.");
    }
    if (!response.ok) {
      throw new Error(`Cursor dashboard returned ${response.status}.`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function buildConversationProjectIndex() {
  const root = path.join(homedir(), ".cursor", "projects");
  const index = new Map();
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
      const id = entry.replace(/\.jsonl$/, "");
      // A conversation appearing under two workspaces is ambiguous, never last-writer-wins.
      index.set(id, index.has(id) && index.get(id) !== project ? null : project);
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
