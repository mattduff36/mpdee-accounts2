'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireWrite } from '@/lib/auth'
import { costTransaction } from '@/lib/costs/service'
import {
  saveGlobalCalculationSettings as persistGlobalCalculationSettings,
  saveProjectCalculationSettings as persistProjectCalculationSettings,
  type CalculationSettingsSaveResult,
  type CalculationSettingsSaveTx,
} from '@/lib/costs/calculation-settings-save'

export type { CalculationSettingsSaveResult }

function isNextControlFlow(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('digest' in error)) return false
  const digest = (error as { digest?: unknown }).digest
  return typeof digest === 'string' && (digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_HTTP_ERROR_FALLBACK'))
}

function stopped(error: unknown): CalculationSettingsSaveResult {
  if (isNextControlFlow(error)) throw error
  return { ok: false, message: 'Nothing was saved. Reload the page and try again.' }
}

export async function saveGlobalCalculationSettings(raw: unknown): Promise<CalculationSettingsSaveResult> {
  await requireWrite()
  const actor = await requireAuth()
  try {
    const result = await costTransaction(tx => persistGlobalCalculationSettings(raw, actor, tx as unknown as CalculationSettingsSaveTx))
    if (result.ok) revalidatePath('/costs', 'layout')
    return result
  } catch (error) {
    return stopped(error)
  }
}

export async function saveProjectCalculationSettings(raw: unknown): Promise<CalculationSettingsSaveResult> {
  await requireWrite()
  const actor = await requireAuth()
  try {
    const result = await costTransaction(tx => persistProjectCalculationSettings(raw, actor, tx as unknown as CalculationSettingsSaveTx))
    if (result.ok) revalidatePath('/costs', 'layout')
    return result
  } catch (error) {
    return stopped(error)
  }
}
