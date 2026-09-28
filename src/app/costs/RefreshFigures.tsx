'use client'
import {useEffect,useRef,useState,useTransition} from 'react'
import {useRouter} from 'next/navigation'
import {RefreshCw} from 'lucide-react'

export function RefreshFigures({loadedAt}:{loadedAt:number}) {
 const router=useRouter(),requested=useRef(false)
 const [pending,startTransition]=useTransition(),[message,setMessage]=useState('')
 useEffect(()=>{
  if(requested.current){requested.current=false;setMessage('Figures refreshed using saved rates and imported usage.')}
 },[loadedAt])
 return <div className="flex flex-col items-start gap-1 sm:items-end">
  <button type="button" disabled={pending} onClick={()=>{requested.current=true;setMessage('');startTransition(()=>router.refresh())}} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-wait disabled:opacity-60">
   <RefreshCw aria-hidden="true" className={`h-4 w-4 ${pending?'animate-spin motion-reduce:animate-none':''}`}/>{pending?'Refreshing…':'Refresh figures'}
  </button>
  <span role="status" className="max-w-xs text-xs text-slate-600">{message}</span>
 </div>
}
