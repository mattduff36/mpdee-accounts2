import { NextRequest,NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireApiWrite } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { validIngestToken } from '@/lib/costs/machine-auth'
import { collectorStatusSchema } from '@/lib/costs/collector-status'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest){
 let userId:string|undefined
 if(!validIngestToken(request.headers.get('authorization'),process.env.COSTS_INGEST_TOKEN)){
  try{userId=(await requireApiWrite()).id}catch{return NextResponse.json({error:'Write access required'},{status:403})}
  if(request.headers.get('origin')!==request.nextUrl.origin)return NextResponse.json({error:'Invalid origin'},{status:403})
 }
 const reader=request.body?.getReader();if(!reader)return NextResponse.json({error:'Missing report'},{status:400})
 const chunks:Uint8Array[]=[];let bytes=0
 while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>16384){await reader.cancel();return NextResponse.json({error:'Report too large'},{status:413})}chunks.push(part.value)}
 try{
  const report=collectorStatusSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  if(Date.parse(report.finishedAt)>Date.now()+300000)return NextResponse.json({error:'Report date is in the future'},{status:400})
  await prisma.auditLog.create({data:{userId,action:'costs.collector.status',entityType:'CostCollector',entityId:'cursor-four-accounts',details:JSON.stringify(report)}})
  revalidatePath('/costs');return NextResponse.json({saved:true})
 }catch{return NextResponse.json({error:'Invalid collector report'},{status:400})}
}
