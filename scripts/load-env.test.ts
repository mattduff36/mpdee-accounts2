import assert from "node:assert/strict"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  envLocalAuthorizesDatabaseUrl,
  getEffectiveDatabaseUrl,
  getEnvLocalDatabaseUrl,
  loadLocalEnv,
  prismaCliEnv,
  readFileEnvMap,
} from "./load-env"

test("ENV-001: .env.local wins among files; process.env wins over files", { concurrency: false }, () => {
  const dir = join(tmpdir(), `accounts-env-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const previous = process.env.DATABASE_URL
  try {
    writeFileSync(join(dir, ".env"), 'DATABASE_URL="postgresql://file:file@localhost:5432/from_env"\n')
    writeFileSync(
      join(dir, ".env.local"),
      'DATABASE_URL="postgresql://file:file@localhost:5432/from_local"\n'
    )

    const files = readFileEnvMap(dir)
    assert.equal(files.DATABASE_URL, "postgresql://file:file@localhost:5432/from_local")

    delete process.env.DATABASE_URL
    loadLocalEnv(dir)
    assert.equal(getEffectiveDatabaseUrl(dir), "postgresql://file:file@localhost:5432/from_local")

    process.env.DATABASE_URL = "postgresql://shell:shell@localhost:5432/from_shell"
    assert.equal(getEffectiveDatabaseUrl(dir), "postgresql://shell:shell@localhost:5432/from_shell")
    const childEnv = prismaCliEnv(getEffectiveDatabaseUrl(dir) as string, { ...process.env, CI: "0" })
    assert.equal(childEnv.DATABASE_URL, getEffectiveDatabaseUrl(dir))
    assert.equal(childEnv.CI, "1")
    assert.equal(
      prismaCliEnv("postgresql://shell:shell@localhost:5432/from_shell").DATABASE_URL,
      getEffectiveDatabaseUrl(dir)
    )
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previous
    rmSync(dir, { recursive: true, force: true })
  }
})

test("ENV-002: .env.local DATABASE_URL authorizes that same remote target", { concurrency: false }, () => {
  const dir = join(tmpdir(), `accounts-env-local-auth-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const remoteUrl = "postgresql://user:secret@db.example.com:5432/app"
  const otherUrl = "postgresql://user:secret@other.example.com:5432/app"
  try {
    writeFileSync(join(dir, ".env"), 'DATABASE_URL="postgresql://user:secret@localhost:5432/from_env"\n')
    writeFileSync(join(dir, ".env.local"), `DATABASE_URL="${remoteUrl}"\n`)

    assert.equal(getEnvLocalDatabaseUrl(dir), remoteUrl)
    assert.equal(envLocalAuthorizesDatabaseUrl(remoteUrl, dir), true)
    assert.equal(envLocalAuthorizesDatabaseUrl(otherUrl, dir), false)
    assert.equal(envLocalAuthorizesDatabaseUrl(undefined, dir), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("ENV-002: a remote URL only in .env is not auto-authorized", { concurrency: false }, () => {
  const dir = join(tmpdir(), `accounts-env-only-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const remoteUrl = "postgresql://user:secret@db.example.com:5432/app"
  try {
    writeFileSync(join(dir, ".env"), `DATABASE_URL="${remoteUrl}"\n`)
    assert.equal(getEnvLocalDatabaseUrl(dir), undefined)
    assert.equal(envLocalAuthorizesDatabaseUrl(remoteUrl, dir), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
