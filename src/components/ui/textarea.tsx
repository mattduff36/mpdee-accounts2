import { cn } from "@/lib/utils"
import { forwardRef, TextareaHTMLAttributes } from "react"
const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => {
  return <textarea className={cn('flex min-h-[88px] w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50', className)} ref={ref} {...props} />
})
Textarea.displayName = 'Textarea'
export { Textarea }
