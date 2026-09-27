import { createHash, timingSafeEqual } from 'node:crypto'
export function validIngestToken(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer ')) return false
  const hash = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(hash(header.slice(7)), hash(secret))
}
