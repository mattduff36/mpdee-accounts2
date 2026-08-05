import { cn } from "@/lib/utils"
import { forwardRef, SelectHTMLAttributes } from "react"
const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => {
  return <select className={cn('flex h-10 w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50', className)} ref={ref} {...props}>{children}</select>
})
Select.displayName = 'Select'
export { Select }
