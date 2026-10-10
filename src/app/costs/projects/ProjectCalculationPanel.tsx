'use client'

import { useState } from 'react'
import type { CalculationRates, ProjectCalculationOverrides } from '@/lib/costs/calculation-settings'
import { inputClass } from '../ui'
import { CalculationSettingsForm } from '../settings/CalculationSettingsForm'

export type CalculationProjectOption = {
  id: string
  name: string
  slug: string
  revision: string
  overrides: ProjectCalculationOverrides | null
  effective: CalculationRates
}

const selectClass = `${inputClass} focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2`

export function ProjectCalculationPanel({
  projects,
  globalRates,
  globalRevision,
}: {
  projects: CalculationProjectOption[]
  globalRates: CalculationRates
  globalRevision: string
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const selected = projects.find(project => project.id === projectId) ?? null
  return (
    <section aria-labelledby="project-calculation-heading" className="space-y-4">
      <div>
        <h2 id="project-calculation-heading" className="text-lg font-semibold text-slate-900">Project calculation rates</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Each field inherits the global rate until you override it. Use global leaves that field following the default, including after the default changes. An explicit 0 is stored as zero and does not inherit. Save here is separate from Save all changes on the connection matrix.</p>
      </div>
      {projects.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">No active projects yet. Create one below, then set its calculation rates here.</p>
      ) : (
        <>
          <label htmlFor="calculation-project" className="block max-w-xl text-sm font-medium text-slate-700">
            Project
            <select id="calculation-project" className={selectClass} value={selected?.id ?? ''} onChange={event => setProjectId(event.target.value)}>
              {projects.map(project => <option key={project.id} value={project.id}>{project.name} ({project.slug})</option>)}
            </select>
          </label>
          {selected && (
            <CalculationSettingsForm
              key={selected.id}
              mode="project"
              projectId={selected.id}
              projectName={selected.name}
              globalRates={globalRates}
              globalRevision={globalRevision}
              revision={selected.revision}
              overrides={selected.overrides}
              effective={selected.effective}
            />
          )}
        </>
      )}
    </section>
  )
}
