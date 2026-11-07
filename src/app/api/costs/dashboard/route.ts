import { NextRequest } from 'next/server'
import { getSessionUser, requireApiWrite } from '@/lib/auth'
import { dashboardResponse } from '@/lib/costs/dashboard-api'
import { loadDashboard, saveDashboard } from '@/lib/costs/dashboard-store'
export const dynamic='force-dynamic'
export const runtime='nodejs'
const deps={token:process.env.COSTS_INGEST_TOKEN,session:getSessionUser,requireWrite:()=>requireApiWrite(),load:loadDashboard,save:saveDashboard}
export const GET=(request:NextRequest)=>dashboardResponse(request,false,deps)
export const POST=(request:NextRequest)=>dashboardResponse(request,true,deps)
