import { NextRequest } from 'next/server'
import { getProjectBilling } from '@/lib/costs/project-billing-response'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest, context: { params: { slug: string } }) {
  return getProjectBilling(request, context)
}
