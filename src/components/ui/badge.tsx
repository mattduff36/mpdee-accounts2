import { cn } from "@/lib/utils"
export function Badge({ children, className, variant = 'default' }: { children: React.ReactNode; className?: string; variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' }) {
  const variants = {
    default: 'bg-blue-50 text-blue-700 ring-blue-600/15',
    success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
    warning: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    danger: 'bg-rose-50 text-rose-700 ring-rose-600/15',
    info: 'bg-sky-50 text-sky-700 ring-sky-600/15',
    neutral: 'bg-slate-100 text-slate-700 ring-slate-600/10',
  }
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', variants[variant], className)}>{children}</span>
}
