'use client'

import { FormEvent, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { CalculationRates, ProjectCalculationOverrides } from '@/lib/costs/calculation-settings'
import { buttonClass, inputClass, panel } from '../ui'
import { saveGlobalCalculationSettings, saveProjectCalculationSettings, type CalculationSettingsSaveResult } from './actions'

const fieldClass = `${inputClass} focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2`
const PERCENT = /^(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/
const POUNDS = /^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/

export function formatPercentInput(bps: number): string {
  const whole = Math.trunc(bps / 100)
  const fraction = Math.abs(bps % 100)
  if (fraction === 0) return String(whole)
  if (fraction % 10 === 0) return `${whole}.${fraction / 10}`
  return `${whole}.${String(fraction).padStart(2, '0')}`
}

export function formatPoundsInput(pence: number): string {
  const whole = Math.trunc(pence / 100)
  const fraction = Math.abs(pence % 100)
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, '0')}`
}

function formatPoundsLabel(pence: number): string {
  const whole = Math.trunc(pence / 100)
  const fraction = Math.abs(pence % 100)
  return `£${whole}.${String(fraction).padStart(2, '0')}`
}

type RateKey = 'includedPremiumBps' | 'includedGrokComposerBps' | 'onDemandBps' | 'dailyHostingPence'

const RATE_FIELDS: { key: RateKey; id: string; inheritId: string; label: string; kind: 'percent' | 'pounds'; hint: string }[] = [
  { key: 'includedPremiumBps', id: 'included-premium-percent', inheritId: 'use-global-included-premium', label: 'Included premium usage %', kind: 'percent', hint: 'Percentage of the standard nominal amount for included premium models.' },
  { key: 'includedGrokComposerBps', id: 'included-grok-composer-percent', inheritId: 'use-global-included-grok-composer', label: 'Included Grok and Composer usage %', kind: 'percent', hint: 'Percentage of the standard nominal amount for included Grok and Composer models.' },
  { key: 'onDemandBps', id: 'on-demand-percent', inheritId: 'use-global-on-demand', label: 'All on-demand usage %', kind: 'percent', hint: 'Percentage of the provider charge for on-demand usage.' },
  { key: 'dailyHostingPence', id: 'daily-hosting-pounds', inheritId: 'use-global-daily-hosting', label: 'Daily Vercel hosting charge £', kind: 'pounds', hint: 'Enter the amount excluding VAT. Added to actual Vercel hosting costs only for projects with the fee enabled.' },
]

type FieldState = { inherit: boolean; text: string }

function initialRate(kind: 'percent' | 'pounds', globalValue: number, override: number | null | undefined, project: boolean): FieldState {
  const globalText = kind === 'percent' ? formatPercentInput(globalValue) : formatPoundsInput(globalValue)
  if (!project || override === null || override === undefined) return { inherit: project, text: project ? '' : globalText }
  return { inherit: false, text: kind === 'percent' ? formatPercentInput(override) : formatPoundsInput(override) }
}

type GlobalProps = { mode: 'global'; rates: CalculationRates; revision: string }
type ProjectProps = {
  mode: 'project'
  projectId: string
  projectName: string
  globalRates: CalculationRates
  globalRevision: string
  revision: string
  overrides: ProjectCalculationOverrides | null
  effective: CalculationRates
}
type Props = GlobalProps | ProjectProps

export function CalculationSettingsForm(props: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const project = props.mode === 'project'
  const globalRates = project ? props.globalRates : props.rates
  const [revision, setRevision] = useState(props.revision)
  const [globalRevision, setGlobalRevision] = useState(project ? props.globalRevision : props.revision)
  const [rates, setRates] = useState<Record<RateKey, FieldState>>({
    includedPremiumBps: initialRate('percent', globalRates.includedPremiumBps, project ? props.overrides?.includedPremiumBps : props.rates.includedPremiumBps, project),
    includedGrokComposerBps: initialRate('percent', globalRates.includedGrokComposerBps, project ? props.overrides?.includedGrokComposerBps : props.rates.includedGrokComposerBps, project),
    onDemandBps: initialRate('percent', globalRates.onDemandBps, project ? props.overrides?.onDemandBps : props.rates.onDemandBps, project),
    dailyHostingPence: initialRate('pounds', globalRates.dailyHostingPence, project ? props.overrides?.dailyHostingPence : props.rates.dailyHostingPence, project),
  })
  const [hostingEnabled, setHostingEnabled] = useState(project ? props.overrides?.hostingEnabled ?? false : false)
  const [hostingStartDate, setHostingStartDate] = useState(project ? props.overrides?.hostingStartDate ?? '' : '')
  const [hostingEndDate, setHostingEndDate] = useState(project ? props.overrides?.hostingEndDate ?? '' : '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<CalculationSettingsSaveResult | null>(null)

  function updateRate(key: RateKey, change: Partial<FieldState>) {
    setRates(current => ({ ...current, [key]: { ...current[key], ...change } }))
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {}
    for (const field of RATE_FIELDS) {
      const state = rates[field.key]
      if (project && state.inherit) continue
      const pattern = field.kind === 'percent' ? PERCENT : POUNDS
      if (!pattern.test(state.text)) next[field.id] = field.kind === 'percent'
        ? 'Enter 0 to 1000, with at most two decimal places. Zero is a real rate.'
        : 'Enter £0 to £100000, with at most two decimal places. Zero is a real charge.'
    }
    if (project) {
      if (hostingEndDate && !hostingStartDate) next['hosting-start-date'] = 'Enter a start date before an end date.'
      if (hostingEnabled && !hostingStartDate) next['hosting-start-date'] = 'A start date is required while the fee is enabled.'
      if (hostingStartDate && hostingEndDate && hostingEndDate < hostingStartDate) next['hosting-end-date'] = 'The end date is before the start date.'
    }
    return next
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors = validate()
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      setMessage({ ok: false, message: 'Check the highlighted fields, then try again.' })
      return
    }
    const payloadRates = {
      includedPremiumBps: project && rates.includedPremiumBps.inherit ? null : rates.includedPremiumBps.text,
      includedGrokComposerBps: project && rates.includedGrokComposerBps.inherit ? null : rates.includedGrokComposerBps.text,
      onDemandBps: project && rates.onDemandBps.inherit ? null : rates.onDemandBps.text,
      dailyHostingPence: project && rates.dailyHostingPence.inherit ? null : rates.dailyHostingPence.text,
    }
    startTransition(async () => {
      const result = project
        ? await saveProjectCalculationSettings({
          projectId: props.projectId,
          expectedRevision: revision,
          expectedGlobalRevision: globalRevision,
          ...payloadRates,
          hostingEnabled,
          hostingStartDate: hostingStartDate || null,
          hostingEndDate: hostingEndDate || null,
        })
        : await saveGlobalCalculationSettings({ expectedRevision: revision, ...payloadRates })
      setMessage(result)
      if (!result.ok) return
      if (result.globalRevision) setGlobalRevision(result.globalRevision)
      if (project && result.projectRevision) setRevision(result.projectRevision)
      if (!project && result.globalRevision) setRevision(result.globalRevision)
      router.refresh()
    })
  }

  const formId = project ? 'project-calculation-form' : 'global-calculation-form'
  const saveId = project ? 'save-project-calculation' : 'save-global-calculation'

  return (
    <form id={formId} onSubmit={onSubmit} className={`${panel} space-y-5`} noValidate>
      <div className="space-y-2 text-sm leading-6 text-slate-600">
        <p>Included premium usage and included Grok and Composer usage are percentages of the standard nominal amount. All on-demand usage is a percentage of the provider charge. The daily Vercel hosting fee is added to actual Vercel hosting costs only for projects that enable it.</p>
        <p id="calculation-recalculation-note">Saving recalculates historical estimates. Issued invoices are unchanged.</p>
      </div>
      {project && (
        <dl id="effective-calculation-rates" className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
          <div><dt className="text-sm text-slate-500">Current included premium</dt><dd className="font-semibold text-slate-900">{formatPercentInput(props.effective.includedPremiumBps)}%</dd></div>
          <div><dt className="text-sm text-slate-500">Current included Grok and Composer</dt><dd className="font-semibold text-slate-900">{formatPercentInput(props.effective.includedGrokComposerBps)}%</dd></div>
          <div><dt className="text-sm text-slate-500">Current on-demand</dt><dd className="font-semibold text-slate-900">{formatPercentInput(props.effective.onDemandBps)}%</dd></div>
          <div><dt className="text-sm text-slate-500">Current daily hosting</dt><dd className="font-semibold text-slate-900">{formatPoundsLabel(props.effective.dailyHostingPence)}</dd></div>
        </dl>
      )}
      <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-base font-semibold text-slate-900">{project ? `Rates for ${props.projectName}` : 'Default rates'}</legend>
        {RATE_FIELDS.map(field => {
          const state = rates[field.key]
          const globalValue = globalRates[field.key]
          const globalText = field.kind === 'percent' ? `${formatPercentInput(globalValue)}%` : formatPoundsLabel(globalValue)
          const describedBy = [`${field.id}-hint`, errors[field.id] ? `${field.id}-error` : ''].filter(Boolean).join(' ')
          return (
            <div key={field.key} className="min-w-0">
              <label htmlFor={field.id} className="block text-sm font-medium text-slate-700">{field.label}</label>
              {project && (
                <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-slate-700" htmlFor={field.inheritId}>
                  <input
                    id={field.inheritId}
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                    checked={state.inherit}
                    onChange={event => updateRate(field.key, { inherit: event.target.checked, text: event.target.checked ? '' : state.text })}
                  />
                  Use global ({globalText})
                </label>
              )}
              <input
                id={field.id}
                className={fieldClass}
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                min={0}
                max={field.kind === 'percent' ? 1000 : 100000}
                step="0.01"
                disabled={project && state.inherit}
                placeholder={project && state.inherit ? globalText : '0'}
                aria-invalid={errors[field.id] ? true : undefined}
                aria-describedby={describedBy}
                value={project && state.inherit ? '' : state.text}
                onChange={event => updateRate(field.key, { text: event.target.value })}
              />
              <p id={`${field.id}-hint`} className="mt-1 text-sm text-slate-500">{field.hint}{project && state.inherit ? ` Inheriting ${globalText} until you set an explicit value.` : ''}</p>
              {errors[field.id] && <p id={`${field.id}-error`} className="mt-1 text-sm text-red-700">{errors[field.id]}</p>}
            </div>
          )
        })}
      </fieldset>
      {project && (
        <fieldset disabled={pending} className="grid gap-4 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
          <legend className="px-1 text-base font-semibold text-slate-900">Daily hosting for this project</legend>
          <p className="sm:col-span-2 text-sm leading-6 text-slate-600">Enable the fee to add this project&apos;s daily charge to actual Vercel hosting between the UTC dates. Turning it off removes the fee from recalculated reports while keeping the saved rate and dates. Fees are included only for dates covered by each report.</p>
          <label htmlFor="hosting-enabled" className="sm:col-span-2 flex min-h-11 items-center gap-2 text-sm font-medium text-slate-800">
            <input id="hosting-enabled" type="checkbox" className="h-4 w-4 rounded border-slate-300 text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2" checked={hostingEnabled} onChange={event => setHostingEnabled(event.target.checked)} />
            Enable daily hosting fee
          </label>
          <div>
            <label htmlFor="hosting-start-date" className="block text-sm font-medium text-slate-700">Hosting start date (UTC)</label>
            <input id="hosting-start-date" type="date" className={fieldClass} value={hostingStartDate} aria-invalid={errors['hosting-start-date'] ? true : undefined} aria-describedby="hosting-date-hint hosting-start-date-error" onChange={event => setHostingStartDate(event.target.value)} />
            {errors['hosting-start-date'] && <p id="hosting-start-date-error" className="mt-1 text-sm text-red-700">{errors['hosting-start-date']}</p>}
          </div>
          <div>
            <label htmlFor="hosting-end-date" className="block text-sm font-medium text-slate-700">Hosting end date (UTC, inclusive, optional)</label>
            <input id="hosting-end-date" type="date" className={fieldClass} value={hostingEndDate} aria-invalid={errors['hosting-end-date'] ? true : undefined} aria-describedby="hosting-date-hint hosting-end-date-error" onChange={event => setHostingEndDate(event.target.value)} />
            {errors['hosting-end-date'] && <p id="hosting-end-date-error" className="mt-1 text-sm text-red-700">{errors['hosting-end-date']}</p>}
          </div>
          <p id="hosting-date-hint" className="sm:col-span-2 text-sm text-slate-500">The start date is required while the fee is enabled. The end date is an inclusive UTC calendar date.</p>
        </fieldset>
      )}
      <div id="calculation-feedback" aria-live="polite" aria-atomic="true">
        {message && <p role={message.ok ? 'status' : 'alert'} className={`rounded-xl border p-4 text-sm ${message.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>{message.message}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button id={saveId} className={buttonClass} type="submit" disabled={pending}>{pending ? 'Saving…' : project ? 'Save project rates' : 'Save calculation defaults'}</button>
        {project && <a href="/costs/settings" className="text-sm font-medium text-blue-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">Open global calculation setup</a>}
      </div>
    </form>
  )
}
