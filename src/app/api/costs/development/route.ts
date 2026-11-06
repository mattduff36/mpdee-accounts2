import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { loadDevelopmentReport } from '@/lib/costs/development-load'
import { developmentResponse } from '@/lib/costs/development-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function GET(request: NextRequest) {
  return developmentResponse(request, { token: process.env.COSTS_INGEST_TOKEN, sessionUser: getSessionUser, load: loadDevelopmentReport })
}
