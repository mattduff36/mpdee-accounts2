import { cn } from "@/lib/utils"
export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_20px_60px_-35px_rgba(15,23,42,0.45)] backdrop-blur', className)}>{children}</div>
}
export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-col space-y-1.5 p-5 sm:p-6', className)}>{children}</div>
}
export function CardTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={cn('text-base font-semibold leading-none tracking-tight text-slate-950 sm:text-lg', className)}>{children}</h3>
}
export function CardDescription({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('text-sm leading-6 text-slate-500', className)}>{children}</p>
}
export function CardContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('p-5 pt-0 sm:p-6 sm:pt-0', className)}>{children}</div>
}
