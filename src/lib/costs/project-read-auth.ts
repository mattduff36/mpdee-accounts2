import { createHash, timingSafeEqual } from 'node:crypto'

export const PROJECT_READ_TOKEN_MAP_ENV = 'COSTS_PROJECT_READ_TOKEN_SHA256_BY_SLUG'

type TokenDigests = Record<string, string>

function parseDigestMap(value: string | undefined): TokenDigests {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`${PROJECT_READ_TOKEN_MAP_ENV} is not configured`)
  let parsed: unknown
  try { parsed = JSON.parse(trimmed) } catch { throw new Error(`${PROJECT_READ_TOKEN_MAP_ENV} must be a JSON object`) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${PROJECT_READ_TOKEN_MAP_ENV} must be a JSON object`)
  const entries = Object.entries(parsed as Record<string, unknown>)
  if (!entries.length) throw new Error(`${PROJECT_READ_TOKEN_MAP_ENV} must contain at least one project`)
  const result: TokenDigests = Object.create(null)
  const seenDigests = new Set<string>()
  for (const [slug, digest] of entries) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error(`${PROJECT_READ_TOKEN_MAP_ENV} contains an invalid slug or SHA-256 digest`)
    }
    if (seenDigests.has(digest)) throw new Error(`${PROJECT_READ_TOKEN_MAP_ENV} must use a distinct token for each project`)
    seenDigests.add(digest)
    result[slug] = digest
  }
  return result
}

export function validProjectReadToken(authorization: string | null, slug: string, tokenMap = process.env[PROJECT_READ_TOKEN_MAP_ENV]): boolean {
  const digests = parseDigestMap(tokenMap)
  const expectedHex = digests[slug]
  if (!expectedHex || !authorization?.startsWith('Bearer ')) return false
  const token = authorization.slice('Bearer '.length)
  if (!token || token.trim() !== token) return false
  const actual = createHash('sha256').update(token, 'utf8').digest()
  const expected = Buffer.from(expectedHex, 'hex')
  return timingSafeEqual(actual, expected)
}
