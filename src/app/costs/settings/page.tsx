import { PageHeader } from '@/components/PageHeader'
import { requireWrite } from '@/lib/auth'
import { loadCalculationSettings } from '@/lib/costs/calculation-settings-load'
import { CalculationSettingsForm } from './CalculationSettingsForm'

export const dynamic = 'force-dynamic'

export default async function CostCalculationSettingsPage() {
  await requireWrite()
  const settings = await loadCalculationSettings()
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cost calculation setup"
        description="Set the default cost calculation rates for every project. Individual projects can override any rate."
      />
      <CalculationSettingsForm mode="global" rates={settings.global} revision={settings.globalRevision} />
    </div>
  )
}
