import { NextRequest, NextResponse } from 'next/server'
import { requireApiWrite } from '@/lib/auth'
import { validIngestToken } from '@/lib/costs/machine-auth'
import { importSubscriptionRecord } from '@/lib/costs/subscription-record-store'
import { SubscriptionConflict } from '@/lib/costs/subscription-record'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest) {
  if(!validIngestToken(request.headers.get('authorization'),process.env.COSTS_INGEST_TOKEN)) {
    try { await requireApiWrite() } catch { return NextResponse.json({error:'Write access required'},{status:403}) }
    if(request.headers.get('origin')!==request.nextUrl.origin)return NextResponse.json({error:'Invalid origin'},{status:403})
  }
  const reader=request.body?.getReader()
  if(!reader)return NextResponse.json({error:'Missing body'},{status:400})
  const chunks:Uint8Array[]=[];let length=0
  try {
    while(true){const part=await reader.read();if(part.done)break;length+=part.value.length
      if(length>16384){await reader.cancel();return NextResponse.json({error:'Record too large'},{status:413})}chunks.push(part.value)}
    return NextResponse.json(await importSubscriptionRecord(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
  } catch(error) {
    return NextResponse.json({error:error instanceof SubscriptionConflict?'Conflicting invoice evidence requires review':'Subscription import failed; no partial record saved'}, {status:error instanceof SubscriptionConflict?409:400})
  }
}
