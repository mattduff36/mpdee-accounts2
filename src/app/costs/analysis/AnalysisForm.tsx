'use client'
import { useFormState, useFormStatus } from 'react-dom'
import type { ReactNode } from 'react'
export type AnalysisAction = (state: { message: string; error: boolean }, data: FormData) => Promise<{ message: string; error: boolean }>
function Submit({ label }: { label: string }) { const { pending } = useFormStatus(); return <button disabled={pending} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-wait disabled:opacity-50" type="submit">{pending ? 'Saving…' : label}</button> }
export function AnalysisForm({ action, children, label }: { action: AnalysisAction; children: ReactNode; label: string }) {
 const [state, submit] = useFormState(action, { message: '', error: false })
 return <form action={submit} className="space-y-3">{children}<Submit label={label}/>{state.message && <p role={state.error ? 'alert' : 'status'} className={`text-sm ${state.error ? 'text-rose-700' : 'text-emerald-800'}`}>{state.message}</p>}</form>
}
