'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { BarChart3, CreditCard, FileSpreadsheet, FileText, Landmark, LayoutDashboard, LogOut, Menu, Receipt, Repeat, Route, Settings, Users, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
}

interface NavSection {
  label: string
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    label: 'Overview',
    items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Sales',
    items: [
      { href: '/clients', label: 'Clients', icon: Users },
      { href: '/quotes', label: 'Quotes', icon: FileSpreadsheet },
      { href: '/invoices', label: 'Invoices', icon: FileText },
      { href: '/recurring', label: 'Recurring', icon: Repeat },
      { href: '/payments', label: 'Payments', icon: CreditCard },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/expenses', label: 'Expenses', icon: Receipt },
      { href: '/costs', label: 'Project Costs', icon: BarChart3 },
      { href: '/mileage', label: 'Mileage', icon: Route },
      { href: '/bank-import', label: 'Bank Import', icon: Landmark },
      { href: '/reports', label: 'Reports', icon: BarChart3 },
    ],
  },
  {
    label: 'System',
    items: [{ href: '/settings', label: 'Settings', icon: Settings }],
  },
]

function isNavItemActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function Sidebar({ canWrite }: { canWrite: boolean }) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const sections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canWrite || item.href !== "/settings"),
    }))
    .filter((section) => section.items.length > 0)

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)')
    const updateDrawerInert = () => {
      if (drawerRef.current) drawerRef.current.inert = !desktop.matches && !mobileOpen
      if (desktop.matches && mobileOpen) setMobileOpen(false)
    }
    updateDrawerInert()
    desktop.addEventListener('change', updateDrawerInert)
    return () => desktop.removeEventListener('change', updateDrawerInert)
  }, [mobileOpen])

  useEffect(() => {
    if (!mobileOpen) return
    const previousOverflow = document.body.style.overflow
    const main = document.querySelector('main')
    const previousMainInert = main?.inert ?? false
    document.body.style.overflow = 'hidden'
    if (main) main.inert = true
    const drawer = drawerRef.current
    const focusable = () => drawer?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []
    focusable()[0]?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMobileOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (!drawer?.contains(document.activeElement)) {
        event.preventDefault()
        const target = event.shiftKey ? last : first
        target.focus()
        return
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      if (main) main.inert = previousMainInert
      if (triggerRef.current && window.matchMedia('(max-width: 1023px)').matches) triggerRef.current.focus()
    }
  }, [mobileOpen])

  return <>
    <button
      ref={triggerRef}
      type="button"
      aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
      aria-expanded={mobileOpen}
      aria-controls="primary-navigation"
      aria-hidden={mobileOpen || undefined}
      tabIndex={mobileOpen ? -1 : 0}
      onClick={() => setMobileOpen(!mobileOpen)}
      className={cn('fixed left-4 top-4 z-50 rounded-xl bg-slate-950 p-2.5 text-white shadow-lg shadow-slate-900/20 ring-1 ring-white/10 transition hover:bg-slate-800 lg:hidden', mobileOpen && 'pointer-events-none opacity-0')}
    >
      {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
    </button>

    {mobileOpen && <div aria-hidden="true" className="fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-sm lg:hidden" />}

    <aside className={cn(
      'fixed inset-y-0 left-0 z-40 w-72 transform bg-slate-950 text-slate-100 shadow-2xl shadow-slate-950/30 ring-1 ring-white/10 transition-transform duration-200 ease-out lg:translate-x-0',
      mobileOpen ? 'translate-x-0' : '-translate-x-full',
    )} ref={drawerRef} id="primary-navigation" aria-label="Primary navigation" aria-modal={mobileOpen ? true : undefined} role={mobileOpen ? 'dialog' : undefined}>
      <div className="flex h-full flex-col">
        <div className="border-b border-white/10 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 text-base font-black text-white shadow-lg shadow-blue-900/30">A</div>
            <div>
              <span className="block text-base font-semibold tracking-tight text-white">Accounts</span>
              <span className="text-xs font-medium text-slate-400">Business control room</span>
            </div>
            <button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-sky-300 lg:hidden">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <nav aria-label="Main" className="flex-1 space-y-7 overflow-y-auto px-4 py-5">
          {sections.map(section => (
            <div key={section.label} className="space-y-2">
              <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{section.label}</p>
              <div className="space-y-1">
                {section.items.map(item => {
                  const Icon = item.icon
                  const isActive = isNavItemActive(pathname, item.href)

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition',
                        isActive
                          ? 'bg-white text-slate-950 shadow-sm'
                          : 'text-slate-300 hover:bg-white/10 hover:text-white',
                      )}
                    >
                      <Icon className={cn('h-5 w-5 shrink-0 transition', isActive ? 'text-blue-600' : 'text-slate-500 group-hover:text-slate-200')} />
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="mb-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <p className="text-xs font-medium text-slate-400">Current workspace</p>
            <p className="mt-1 text-sm font-semibold text-white">Small business accounts</p>
          </div>
          <form action="/api/auth/logout" method="post">
            <button type="submit" tabIndex={mobileOpen ? 0 : undefined} className="flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium text-rose-200 transition hover:bg-rose-500/10 hover:text-rose-100">
              <LogOut className="h-5 w-5 shrink-0" />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </aside>
  </>
}
