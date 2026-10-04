import { assertSafeDatabaseUrl } from '../database-target'

/** Local cost commands write only to the real shadow database, never the fixture database or a remote host. */
export function assertRealShadow(url: string | undefined) {
  const identity = assertSafeDatabaseUrl(url, { allowRemote: false })
  if (identity.host !== '127.0.0.1' || identity.port !== '54329' || identity.database !== 'mpdee_accounts_shadow_real') {
    throw new Error(`Refusing ${identity.host}:${identity.port ?? 'default'}/${identity.database}. Use 127.0.0.1:54329/mpdee_accounts_shadow_real.`)
  }
  return identity
}
