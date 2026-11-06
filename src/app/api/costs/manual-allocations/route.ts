import { NextRequest } from 'next/server'
import { handleManualAllocations } from './handler'

export const dynamic = 'force-dynamic'
export function GET(request: NextRequest) { return handleManualAllocations(request, 'GET') }
export function POST(request: NextRequest) { return handleManualAllocations(request, 'POST') }
