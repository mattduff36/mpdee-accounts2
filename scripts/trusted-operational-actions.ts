export const SAFETY_CONTRACT = "accounts-finalise-v2"

export type FinaliseCommandId = "finalise" | "fap"

export type TrustedOperationalAction = {
  commandId: FinaliseCommandId
  safetyContract: typeof SAFETY_CONTRACT
  trustedOperationalAction: true
  allowsPush: boolean
  allowedDbMutations: readonly []
}

export const TRUSTED_OPERATIONAL_ACTIONS = {
  finalise: {
    commandId: "finalise",
    safetyContract: SAFETY_CONTRACT,
    trustedOperationalAction: true,
    allowsPush: false,
    allowedDbMutations: [],
  },
  fap: {
    commandId: "fap",
    safetyContract: SAFETY_CONTRACT,
    trustedOperationalAction: true,
    allowsPush: true,
    allowedDbMutations: [],
  },
} as const satisfies Record<FinaliseCommandId, TrustedOperationalAction>
