import { cn } from "@/lib/utils"
import { ButtonHTMLAttributes, forwardRef } from "react"
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline', size?: 'sm' | 'md' | 'lg' }
const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = 'primary', size = 'md', ...props }, ref) => {
  const variants = {
    primary: 'bg-blue-600 text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700',
    secondary: 'border border-slate-200 bg-white/90 text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50',
    danger: 'bg-rose-600 text-white shadow-sm shadow-rose-600/20 hover:bg-rose-700',
    ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',
    outline: 'border border-slate-300 bg-white/60 text-slate-700 hover:bg-white hover:text-slate-950',
  }
  const sizes = { sm: 'h-9 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' }
  return <button ref={ref} className={cn('inline-flex items-center justify-center rounded-xl font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50', variants[variant], sizes[size], className)} {...props} />
})
Button.displayName = 'Button'
export { Button }
