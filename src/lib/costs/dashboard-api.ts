import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { WriteAccessError } from '@/lib/auth'
import { validIngestToken } from '@/lib/costs/machine-auth'
import type { loadDashboard, saveDashboard } from '@/lib/costs/dashboard-store'
import { presetSchema } from '@/lib/costs/dashboard-model'
import { CustomRecurringError } from '@/lib/costs/custom-recurring'
import { ManualAllocationError } from '@/lib/costs/manual-allocation'

const headers={'Cache-Control':'private, no-store'}
export async function dashboardResponse(request:NextRequest,write:boolean,deps:{
  token:string|undefined
  session:()=>Promise<{id:string;role:string}|null>
  requireWrite:()=>Promise<unknown>
  load:typeof loadDashboard
  save:typeof saveDashboard
}) {
  try {
    const machine=validIngestToken(request.headers.get('authorization'),deps.token)
    const user=machine?null:await deps.session()
    if(!machine&&!user)return NextResponse.json({error:'Authentication required'},{status:401,headers})
    if(write&&!machine)await deps.requireWrite()
    // Machine writes are explicitly scoped to this dashboard endpoint. Browser writes require same origin.
    if(write&&!machine&&request.headers.get('origin')!==request.nextUrl.origin)return NextResponse.json({error:'Same-origin request required'},{status:403,headers})
    if(write) {
      const text=await request.text()
      if(Buffer.byteLength(text)>32768)return NextResponse.json({error:'Request too large'},{status:413,headers})
      const result=await deps.save(JSON.parse(text),machine?{actorType:'machine',actorId:null}:{actorType:'user',actorId:user!.id})
      return NextResponse.json(result,{headers})
    }
    const params=request.nextUrl.searchParams
    if([...params.keys()].some(k=>k!=='period')||params.getAll('period').length>1)return NextResponse.json({error:'Invalid period query'},{status:400,headers})
    return NextResponse.json(await deps.load(presetSchema.parse(params.get('period')??'this-month')),{headers})
  }catch(error) {
    if(error instanceof WriteAccessError)return NextResponse.json({error:'Write access required'},{status:403,headers})
    if(error instanceof ZodError||error instanceof SyntaxError)return NextResponse.json({error:'Check the cost details and try again'},{status:400,headers})
    if(error instanceof CustomRecurringError||error instanceof ManualAllocationError)return NextResponse.json({error:error.message},{status:error.status,headers})
    console.error('Cost dashboard request failed')
    return NextResponse.json({error:'Cost dashboard is temporarily unavailable'},{status:503,headers})
  }
}
