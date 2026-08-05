import { LucideIcon } from "lucide-react"
export function EmptyState({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description: string; children?: React.ReactNode }) {
  return <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/70 px-6 py-14 text-center">
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
      <Icon className="h-7 w-7" />
    </div>
    <h3 className="mt-4 text-lg font-semibold text-slate-950">{title}</h3>
    <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">{description}</p>
    {children && <div className="mt-4">{children}</div>}
  </div>
}
