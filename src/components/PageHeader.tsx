import { cn } from "@/lib/utils"
export function PageHeader({ title, description, children, className }: { title: string; description?: string; children?: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-4 border-b border-blue-200/70 pb-5 sm:flex-row sm:items-start sm:justify-between', className)}>
    <div className="min-w-0">
      <h1 className="text-2xl font-bold tracking-tight text-blue-950">{title}</h1>
      {description && <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>}
    </div>
    {children && <div className="flex shrink-0 flex-wrap items-center gap-3">{children}</div>}
  </div>
}
