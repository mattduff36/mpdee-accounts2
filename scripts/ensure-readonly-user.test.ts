import assert from "node:assert/strict"
import { test } from "node:test"
import { READONLY_ROLE } from "../src/lib/auth"
import {
  parseEnsureReadonlyArgs,
  runEnsureReadonlyUser,
  type ExistingReadonlyUser,
} from "./ensure-readonly-user"

const LOCAL_URL = "postgresql://user:secret@localhost:5432/app"
const REMOTE_URL = "postgresql://user:secret@ep-example.eu-west-2.aws.neon.tech/neondb"
const PASSWORD = "readonly-password"

function harness(overrides: Partial<Parameters<typeof runEnsureReadonlyUser>[0]> = {}) {
  const calls = {
    find: 0,
    create: [] as Array<Parameters<Parameters<typeof runEnsureReadonlyUser>[0]["createUser"]>[0]>,
    update: [] as Array<{ id: string; data: Parameters<Parameters<typeof runEnsureReadonlyUser>[0]["updateUser"]>[1] }>,
    hash: 0,
    disconnect: 0,
  }
  const logs: string[] = []
  const deps: Parameters<typeof runEnsureReadonlyUser>[0] = {
    databaseUrl: LOCAL_URL,
    allowRemote: false,
    deactivate: false,
    userEmail: "reader@example.com",
    userPassword: PASSWORD,
    adminEmail: "admin@example.com",
    adminPassword: "different-admin-password",
    findMatches: async () => {
      calls.find += 1
      return []
    },
    createUser: async (data) => {
      calls.create.push(data)
    },
    updateUser: async (id, data) => {
      calls.update.push({ id, data })
    },
    hashPassword: async (plain) => {
      calls.hash += 1
      return `hash:${plain}`
    },
    verifyPassword: async (plain, hash) => hash === `hash:${plain}`,
    disconnect: async () => {
      calls.disconnect += 1
    },
    log: (message) => logs.push(message),
    ...overrides,
  }
  return { calls, logs, deps }
}

function user(overrides: Partial<ExistingReadonlyUser> = {}): ExistingReadonlyUser {
  return {
    id: "user_1",
    email: "reader@example.com",
    role: READONLY_ROLE,
    isActive: true,
    passwordHash: `hash:${PASSWORD}`,
    ...overrides,
  }
}

test("parseEnsureReadonlyArgs accepts only the remote and deactivate flags", () => {
  assert.deepEqual(parseEnsureReadonlyArgs(["--allow-remote-db"]), { allowRemote: true, deactivate: false })
  assert.deepEqual(parseEnsureReadonlyArgs(["--deactivate", "--allow-remote-db"]), {
    allowRemote: true,
    deactivate: true,
  })
  assert.throws(() => parseEnsureReadonlyArgs(["--force"]), /Unknown argument/)
})

test("readonly provisioner creates a read-only user and can rerun without writes", async () => {
  const stored: ExistingReadonlyUser[] = []
  const first = harness({
    userEmail: "  reader@example.com  ",
    findMatches: async () => stored,
    createUser: async (data) => {
      stored.push({
        id: "user_1",
        email: data.email,
        role: data.role,
        isActive: data.isActive,
        passwordHash: data.passwordHash,
      })
    },
  })
  assert.equal(await runEnsureReadonlyUser(first.deps), 0)
  assert.equal(stored.length, 1)
  assert.equal(stored[0]?.email, "reader@example.com")
  assert.equal(stored[0]?.role, "readonly")
  assert.equal(stored[0]?.isActive, true)
  assert.equal(stored[0]?.passwordHash, `hash:${PASSWORD}`)
  assert.equal(first.logs.some((line) => line.includes("secret") || line.includes(PASSWORD)), false)

  const second = harness({
    findMatches: async () => stored,
    createUser: async () => {
      throw new Error("unexpected create")
    },
    updateUser: async () => {
      throw new Error("unexpected update")
    },
  })
  assert.equal(await runEnsureReadonlyUser(second.deps), 0)
  assert.equal(second.logs.includes("Readonly user: unchanged"), true)
  assert.equal(second.calls.hash, 0)
})

test("readonly provisioner refreshes the password, casing, and inactive state", async () => {
  const password = harness({
    findMatches: async () => [user({ passwordHash: "hash:old-password-value" })],
  })
  assert.equal(await runEnsureReadonlyUser(password.deps), 0)
  assert.deepEqual(password.calls.update, [{ id: "user_1", data: { passwordHash: `hash:${PASSWORD}` } }])

  const inactive = harness({
    findMatches: async () => [user({ isActive: false })],
  })
  assert.equal(await runEnsureReadonlyUser(inactive.deps), 0)
  assert.deepEqual(inactive.calls.update, [{ id: "user_1", data: { isActive: true } }])
  assert.equal(inactive.calls.hash, 0)

  const casing = harness({
    findMatches: async () => [user({ email: "Reader@example.com" })],
  })
  assert.equal(await runEnsureReadonlyUser(casing.deps), 0)
  assert.deepEqual(casing.calls.update, [{ id: "user_1", data: { email: "reader@example.com" } }])
})

test("readonly provisioner deactivates only an active read-only user", async () => {
  const active = harness({
    deactivate: true,
    findMatches: async () => [user()],
  })
  assert.equal(await runEnsureReadonlyUser(active.deps), 0)
  assert.deepEqual(active.calls.update, [{ id: "user_1", data: { isActive: false } }])
  assert.equal(active.calls.hash, 0)

  const inactive = harness({
    deactivate: true,
    findMatches: async () => [user({ isActive: false })],
  })
  assert.equal(await runEnsureReadonlyUser(inactive.deps), 0)
  assert.deepEqual(inactive.calls.update, [])
  assert.equal(inactive.logs.includes("Readonly user: already inactive"), true)
})

test("readonly provisioner aborts without writing on unsafe input", async () => {
  const cases: Array<Partial<Parameters<typeof runEnsureReadonlyUser>[0]>> = [
    { userEmail: "Admin@example.com", adminEmail: "admin@example.com" },
    { userPassword: "short-pass" },
    { userPassword: "change-this-before-production" },
    { userPassword: "different-admin-password", adminPassword: "different-admin-password" },
    { databaseUrl: REMOTE_URL, allowRemote: false },
    { findMatches: async () => [user(), user({ id: "user_2", email: "Reader@example.com" })] },
    { findMatches: async () => [user({ role: "admin" })] },
    { deactivate: true, findMatches: async () => [] },
  ]

  for (const overrides of cases) {
    const run = harness(overrides)
    assert.equal(await runEnsureReadonlyUser(run.deps), 1)
    assert.deepEqual(run.calls.create, [])
    assert.deepEqual(run.calls.update, [])
    assert.equal(run.calls.disconnect, 1)
    assert.equal(run.logs.some((line) => line.includes(PASSWORD) || line.includes("secret")), false)
  }
})

test("readonly provisioner allows an explicit remote target", async () => {
  const run = harness({ databaseUrl: REMOTE_URL, allowRemote: true })
  assert.equal(await runEnsureReadonlyUser(run.deps), 0)
  assert.equal(run.logs.includes("Database target: ep-example.eu-west-2.aws.neon.tech/neondb"), true)
  assert.equal(run.logs.includes("Action: ensure"), true)
  assert.equal(run.calls.create.length, 1)
})
