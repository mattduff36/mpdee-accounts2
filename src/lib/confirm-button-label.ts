export type ConfirmPhase = "idle" | "success" | "error"

const successLabel = {
  Save: "Saved",
  Clear: "Cleared",
} as const

export function confirmButtonLabel(idle: keyof typeof successLabel, phase: ConfirmPhase): string {
  if (phase === "error") return "ERROR"
  if (phase === "success") return successLabel[idle]
  return idle
}
