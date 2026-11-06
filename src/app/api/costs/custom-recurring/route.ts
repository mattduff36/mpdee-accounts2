import { NextRequest } from 'next/server'
import { handleCustomRecurring } from './handler'

export const dynamic = 'force-dynamic'
export function GET(request: NextRequest) { return handleCustomRecurring(request, 'GET') }
export function POST(request: NextRequest) { return handleCustomRecurring(request, 'POST') }
export function PATCH(request: NextRequest) { return handleCustomRecurring(request, 'PATCH') }
