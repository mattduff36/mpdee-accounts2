import { NextRequest } from 'next/server'
import { handleProviderObservations } from './handler'

export const dynamic = 'force-dynamic'
export function GET(request: NextRequest) { return handleProviderObservations(request, 'GET') }
export function POST(request: NextRequest) { return handleProviderObservations(request, 'POST') }
