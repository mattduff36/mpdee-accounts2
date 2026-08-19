import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"
import Link from "next/link"

const tones = {
  indigo: "text-indigo-600 hover:text-indigo-900 hover:bg-indigo-50 border-indigo-300",
  green: "text-green-600 hover:text-green-900 hover:bg-green-50 border-green-300",
  blue: "text-blue-600 hover:text-blue-900 hover:bg-blue-50 border-blue-300",
}

const baseClass =
  "inline-flex items-center justify-center p-2 rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"

export function IconAction({
  title,
  icon: Icon,
  tone = "indigo",
  href,
  onClick,
  disabled,
  loading,
  type = "button",
  external,
}: {
  title: string
  icon: LucideIcon
  tone?: keyof typeof tones
  href?: string
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  type?: "button" | "submit"
  external?: boolean
}) {
  const className = cn(baseClass, tones[tone])
  const icon = loading ? (
    <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
  ) : (
    <Icon className="h-5 w-5" aria-hidden />
  )

  if (href && !disabled && !loading) {
    if (external) {
      return (
        <a href={href} title={title} aria-label={title} className={className}>
          {icon}
        </a>
      )
    }
    return (
      <Link href={href} title={title} aria-label={title} className={className}>
        {icon}
      </Link>
    )
  }

  return (
    <button
      type={type}
      title={title}
      aria-label={title}
      className={className}
      onClick={onClick}
      disabled={disabled || loading}
    >
      {icon}
    </button>
  )
}
