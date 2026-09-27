import { PrismaClient } from "@prisma/client"
import { hashPassword, READONLY_ROLE, verifyPassword } from "../src/lib/auth"
import {
  assertSafeDatabaseUrl,
  formatDatabaseTargetIdentity,
  sanitizeDatabaseOutput,
} from "./database-target"
import { getEffectiveDatabaseUrl, loadLocalEnv } from "./load-env"

const PLACEHOLDER_PASSWORDS = new Set([
  "change-this-before-production",
  "changeme123",
  "password",
])

export type ExistingReadonlyUser = {
  id: string
  email: string
  role: string
  isActive: boolean
  passwordHash: string
}

export type ReadonlyUserUpdate = {
  email?: string
  passwordHash?: string
  isActive?: boolean
}

type ReadonlyCredentials = {
  email: string
  password: string
}

type EnsureReadonlyDeps = {
  databaseUrl: string | undefined
  allowRemote: boolean
  deactivate: boolean
  userEmail: string | undefined
  userPassword: string | undefined
  adminEmail: string | undefined
  adminPassword: string | undefined
  findMatches: (email: string) => Promise<ExistingReadonlyUser[]>
  createUser: (data: {
    email: string
    passwordHash: string
    name: string
    role: typeof READONLY_ROLE
    isActive: true
  }) => Promise<void>
  updateUser: (id: string, data: ReadonlyUserUpdate) => Promise<void>
  hashPassword: (plain: string) => Promise<string>
  verifyPassword: (plain: string, hash: string) => Promise<boolean>
  disconnect: () => Promise<void>
  log: (message: string) => void
}

export function parseEnsureReadonlyArgs(argv: string[]): { allowRemote: boolean; deactivate: boolean } {
  const unknown = argv.filter((arg) => arg !== "--allow-remote-db" && arg !== "--deactivate")
  if (unknown.length > 0) {
    throw new Error("Unknown argument")
  }
  return {
    allowRemote: argv.includes("--allow-remote-db"),
    deactivate: argv.includes("--deactivate"),
  }
}

export function assertReadonlyUserRequest(input: {
  userEmail: string | undefined
  userPassword: string | undefined
  adminEmail: string | undefined
  adminPassword: string | undefined
}): ReadonlyCredentials {
  const email = input.userEmail?.trim() ?? ""
  const password = input.userPassword ?? ""
  if (!email) throw new Error("USER_EMAIL is required")
  if (!password) throw new Error("USER_PASSWORD is required")
  if (password.length < 12) throw new Error("USER_PASSWORD must be at least 12 characters")
  if (PLACEHOLDER_PASSWORDS.has(password)) throw new Error("USER_PASSWORD is a placeholder")
  if (input.adminPassword && password === input.adminPassword) {
    throw new Error("USER_PASSWORD must differ from ADMIN_PASSWORD")
  }
  const adminEmail = input.adminEmail?.trim() ?? ""
  if (adminEmail && email.toLowerCase() === adminEmail.toLowerCase()) {
    throw new Error("USER_EMAIL must not match ADMIN_EMAIL")
  }
  return { email, password }
}

export async function runEnsureReadonlyUser(deps: EnsureReadonlyDeps): Promise<number> {
  let code = 0
  try {
    const identity = assertSafeDatabaseUrl(deps.databaseUrl, { allowRemote: deps.allowRemote })
    deps.log(`Database target: ${formatDatabaseTargetIdentity(identity)}`)
    deps.log(`Action: ${deps.deactivate ? "deactivate" : "ensure"}`)
    const { email, password } = assertReadonlyUserRequest(deps)
    const matches = await deps.findMatches(email)
    if (matches.length > 1) throw new Error("Multiple accounts match USER_EMAIL")
    const match = matches[0]

    if (match && match.role !== READONLY_ROLE) {
      throw new Error("Existing account is not read-only")
    }

    if (deps.deactivate) {
      if (!match) throw new Error("Read-only account was not found")
      if (!match.isActive) {
        deps.log("Readonly user: already inactive")
        return 0
      }
      await deps.updateUser(match.id, { isActive: false })
      deps.log("Readonly user: deactivated")
      return 0
    }

    if (!match) {
      await deps.createUser({
        email,
        passwordHash: await deps.hashPassword(password),
        name: "Read-only",
        role: READONLY_ROLE,
        isActive: true,
      })
      deps.log("Readonly user: created")
      return 0
    }

    const update: ReadonlyUserUpdate = {}
    if (match.email !== email) update.email = email
    if (!(await deps.verifyPassword(password, match.passwordHash))) {
      update.passwordHash = await deps.hashPassword(password)
    }
    if (!match.isActive) update.isActive = true
    if (Object.keys(update).length === 0) {
      deps.log("Readonly user: unchanged")
      return 0
    }
    await deps.updateUser(match.id, update)
    deps.log("Readonly user: refreshed")
  } catch (error) {
    const message = error instanceof Error ? error.message : "Read-only user update failed"
    deps.log(sanitizeDatabaseOutput(message))
    code = 1
  } finally {
    await deps.disconnect()
  }
  return code
}

async function main(): Promise<number> {
  const options = parseEnsureReadonlyArgs(process.argv.slice(2))
  loadLocalEnv()
  const prisma = new PrismaClient()
  return runEnsureReadonlyUser({
    databaseUrl: getEffectiveDatabaseUrl(),
    allowRemote: options.allowRemote,
    deactivate: options.deactivate,
    userEmail: process.env.USER_EMAIL,
    userPassword: process.env.USER_PASSWORD,
    adminEmail: process.env.ADMIN_EMAIL,
    adminPassword: process.env.ADMIN_PASSWORD,
    findMatches: async (email) => {
      const users = await prisma.user.findMany({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true, email: true, role: true, isActive: true, password: true },
      })
      return users.map((user) => ({
        id: user.id,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        passwordHash: user.password,
      }))
    },
    createUser: async (data) => {
      await prisma.user.create({
        data: {
          email: data.email,
          password: data.passwordHash,
          name: data.name,
          role: data.role,
          isActive: data.isActive,
        },
      })
    },
    updateUser: async (id, data) => {
      await prisma.user.update({
        where: { id },
        data: {
          ...(data.email !== undefined ? { email: data.email } : {}),
          ...(data.passwordHash !== undefined ? { password: data.passwordHash } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        },
      })
    },
    hashPassword,
    verifyPassword,
    disconnect: () => prisma.$disconnect(),
    log: (message) => {
      console.log(sanitizeDatabaseOutput(message))
    },
  })
}

const invokedDirectly = /\/ensure-readonly-user\.ts$/.test((process.argv[1] ?? "").replace(/\\/g, "/"))
if (invokedDirectly) {
  main()
    .then((code) => {
      process.exit(code)
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Read-only user update failed"
      console.error(sanitizeDatabaseOutput(message))
      process.exit(1)
    })
}
