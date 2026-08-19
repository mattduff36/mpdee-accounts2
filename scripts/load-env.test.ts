import assert from "node:assert/strict"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { getEffectiveDatabaseUrl, loadLocalEnv, prismaCliEnv, readFileEnvMap } from "./load-env"

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
