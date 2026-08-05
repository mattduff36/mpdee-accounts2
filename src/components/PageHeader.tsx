import { cn } from "@/lib/utils"
export function PageHeader({ title, description, children, className }: { title: string; description?: string; children?: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-4 rounded-2xl border border-white/70 bg-white/85 p-5 shadow-sm shadow-slate-200/70 backdrop-blur sm:flex-row sm:items-center sm:justify-between', className)}>
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-slate-950">{title}</h1>
      {description && <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>}
    </div>
    {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
  </div>
}
