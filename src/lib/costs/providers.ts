export const DEVELOPMENT_PROVIDERS = ['openai', 'codex']

export function isDevelopmentProvider(provider: string) {
  return DEVELOPMENT_PROVIDERS.includes(provider)
}

/** Development evidence is non-additive and must not enter legacy financial reports. */
export function legacyProviderFilter() {
  return { notIn: [...DEVELOPMENT_PROVIDERS] }
}
