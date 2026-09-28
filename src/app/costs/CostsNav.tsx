'use client'
import Link from 'next/link'
import {usePathname} from 'next/navigation'
const links=[['/costs','Overview'],['/costs/projects','Projects & rates'],['/costs/review','Review usage'],['/costs/analysis','Analysis & allocations'],['/costs/import','Import']]
export function CostsNav({writable}:{writable:boolean}) {
 const pathname=usePathname()
 return <nav aria-label="Project costs" className="mb-6 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1.5">{links.filter(([url])=>writable || url==='/costs').map(([href,label])=><Link key={href} href={href} aria-current={pathname===href?'page':undefined} className={`rounded-lg px-3 py-2.5 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-blue-500 ${pathname===href?'bg-blue-600 text-white':'text-slate-600 hover:bg-blue-50 hover:text-blue-800'}`}>{label}</Link>)}</nav>
}
