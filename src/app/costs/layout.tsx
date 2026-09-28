import { AppShell } from '@/components/AppShell'
import { requireAuth,canWrite } from '@/lib/auth'
import {CostsNav} from './CostsNav'
export default async function CostsLayout({ children }: { children: React.ReactNode }) {
  const user=await requireAuth()
  return <AppShell><CostsNav writable={canWrite(user)}/>{children}</AppShell>
}
