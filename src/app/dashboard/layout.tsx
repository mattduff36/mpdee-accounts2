import { AppShell } from "@/components/AppShell"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>
}
