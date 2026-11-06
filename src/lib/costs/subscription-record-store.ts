import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { saveSubscriptionRecord } from './subscription-record'

export async function importSubscriptionRecord(raw:unknown) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(739201682)`
    return saveSubscriptionRecord(raw,{
      find: r => tx.costSubscriptionInvoice.findUnique({where:{provider_accountRef_invoiceNumber:{provider:r.provider,accountRef:r.accountRef,invoiceNumber:r.invoiceNumber}}}),
      create: async ({record:r,checksum}) => tx.costSubscriptionInvoice.create({data:{
        id:`sub_${randomUUID()}`,provider:r.provider,accountRef:r.accountRef,invoiceNumber:r.invoiceNumber,checksum,
        currency:r.currency,netMinor:r.netMinor,taxMinor:r.taxMinor,grossMinor:r.grossMinor,
        invoiceDate:new Date(r.invoiceDate),paymentDate:new Date(r.paymentDate),periodStart:new Date(r.periodStart),periodEnd:new Date(r.periodEnd),
        gbpEstimatePence:r.gbpEstimatePence,fxRate:r.fxRate,fxDate:new Date(r.fxDate),fxSource:r.fxSource,
        allocationStatus:'unallocated',evidence:{...r.evidence,product:r.product,paymentStatus:r.paymentStatus,gbpStatus:'reference_estimate',periodEndExclusive:true},
      }}),
    })
  },{timeout:15000,maxWait:10000})
}
