'use server'
import { revalidatePath } from 'next/cache'
import { requireAuth, requireWrite } from '@/lib/auth'
import { costTransaction } from '@/lib/costs/service'
import { InvoiceProjectLinkError, linkInvoiceToProject, unlinkInvoiceFromProject, type InvoiceProjectLinkResult, type InvoiceProjectLinkTx } from '@/lib/costs/invoice-project-link'

const value = (form: FormData, key: string) => String(form.get(key) || '')

function fail(error: unknown) {
  if (error instanceof InvoiceProjectLinkError) return { message: error.message, error: true }
  return { message: 'Could not save. Refresh and try again.', error: true }
}

function saved(result: InvoiceProjectLinkResult) {
  revalidatePath('/costs/analysis')
  revalidatePath('/costs/projects')
  if (result.status === 'created') return { message: 'Project-only invoice link saved. The whole invoice excluding VAT counts toward this project.', error: false }
  if (result.status === 'updated') return { message: 'Project-only link updated. The service-period association, if any, was left unchanged.', error: false }
  if (result.status === 'unchanged') return { message: 'This invoice is already linked to that project.', error: false }
  if (result.status === 'removed' && result.servicePeriodRemains) return { message: 'Project-only link removed. The service-period association still counts this invoice.', error: false }
  if (result.status === 'removed') return { message: 'Project-only link removed. No service-period association was changed.', error: false }
  return { message: 'No project-only link was on file for that invoice and project.', error: false }
}

async function run(form: FormData, apply: (tx: InvoiceProjectLinkTx, input: { invoiceId: string; projectId: string; reason: string; actorId: string; now: Date }) => Promise<InvoiceProjectLinkResult>) {
  const actor = await requireAuth()
  try {
    const result = await costTransaction(tx => apply(tx as unknown as InvoiceProjectLinkTx, {
      invoiceId: value(form, 'invoiceId'),
      projectId: value(form, 'projectId'),
      reason: value(form, 'reason'),
      actorId: actor.id,
      now: new Date(),
    }))
    return saved(result)
  } catch (error) {
    return fail(error)
  }
}

export async function saveInvoiceProjectLink(_state: { message: string; error: boolean }, form: FormData) {
  await requireWrite()
  return run(form, linkInvoiceToProject)
}

export async function removeInvoiceProjectLink(_state: { message: string; error: boolean }, form: FormData) {
  await requireWrite()
  return run(form, unlinkInvoiceFromProject)
}
