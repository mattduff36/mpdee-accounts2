import { Sidebar } from "@/components/Sidebar"
import { requireAuth } from "@/lib/auth"

interface AppShellProps {
  children: React.ReactNode
}

export async function AppShell({ children }: AppShellProps) {
  await requireAuth()

  return (
    <div className="min-h-screen overflow-hidden bg-slate-50 text-slate-950">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.16),_transparent_34rem)]" />
      <Sidebar />
      <main className="relative min-h-screen lg:pl-72">
        <div className="mx-auto w-full max-w-7xl px-4 pb-10 pt-20 sm:px-6 lg:px-10 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  )
}
