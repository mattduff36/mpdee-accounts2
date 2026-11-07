import test from 'node:test'
import assert from 'node:assert/strict'
import { dashboardPeriod, monthlyProjection, expectedTotal, dashboardSettingsSchema, defaultCategoryName, forecastFx } from './dashboard-model'
import { middleware } from '../../../middleware'
import { NextRequest } from 'next/server'

test('presets use London calendar months, previous year boundary and leap February',()=>{
  assert.deepEqual(dashboardPeriod('last-month',new Date('2026-01-05Z')),{from:'2025-12-01',to:'2026-01-01',today:'2026-01-05'})
  assert.equal(dashboardPeriod('this-month',new Date('2026-06-30T23:30Z')).from,'2026-07-01')
  assert.equal(dashboardPeriod('last-month',new Date('2024-03-01Z')).from,'2024-02-01')
  assert.equal(dashboardPeriod('this-quarter',new Date('2026-11-07Z')).to,'2027-01-01')
})
test('monthly forecasts do not multiply by 30 days and prorate partial active dates',()=>{
  assert.equal(monthlyProjection(900,'2026-01-01',null,'2026-11-01','2026-12-01'),900)
  assert.equal(monthlyProjection(900,'2026-11-16',null,'2026-11-01','2026-12-01'),450)
  assert.equal(monthlyProjection(900,'2026-01-01','2026-11-16','2026-11-01','2026-12-01'),450)
  assert.equal(monthlyProjection(900,'2026-12-01',null,'2026-11-01','2026-12-01'),0)
  assert.equal(monthlyProjection(900,'2026-01-01',null,'2026-01-01','2027-01-01'),10800)
})
test('Projected includes Confirmed without adding it twice; missing estimates remain unknown',()=>{
  assert.equal(expectedTotal(12000,15000),15000)
  assert.equal(expectedTotal(18000,15000),18000)
  assert.equal(expectedTotal(18000,null),null)
})
test('related providers share useful default categories',()=>{
  assert.equal(defaultCategoryName('ImageKit'),defaultCategoryName('Cloudinary'))
  assert.equal(defaultCategoryName('openai'),'AI tools')
})
test('forecasts use dated historical FX without borrowing future rates or treating missing conversion as zero',()=>{
  const quotes=[{currency:'USD',date:'2026-10-16',rate:'0.7463',source:'reference'},{currency:'USD',date:'2026-12-01',rate:'0.9',source:'future'}]
  assert.equal(forecastFx(900,'USD','2026-11-07',quotes).pence,672)
  assert.equal(forecastFx(900,'USD','2026-10-01',quotes).pence,null)
  assert.equal(forecastFx(0,'USD','2026-10-01',quotes).pence,0)
  assert.equal(forecastFx(900,'GBP','2026-10-01',[]).pence,900)
})
test('category configuration rejects duplicate identities, dangling categories and invalid bill dates',()=>{
  const base={categories:[{id:'image',name:'Image hosting'}],assignments:{'custom:one':'image'},bills:[]}
  assert.equal(dashboardSettingsSchema.safeParse(base).success,true)
  assert.equal(dashboardSettingsSchema.safeParse({...base,categories:[...base.categories,...base.categories]}).success,false)
  assert.equal(dashboardSettingsSchema.safeParse({...base,assignments:{x:'missing'}}).success,false)
  assert.equal(dashboardSettingsSchema.safeParse({...base,bills:[{id:'b',sourceId:'one',date:'2026-02-30',currency:'GBP',amountMinor:900,reference:'bill'}]}).success,false)
})
test('middleware exposes only exact dashboard GET/POST to handler authentication',()=>{
  for(const method of ['GET','POST'])assert.equal(middleware(new NextRequest('http://localhost/api/costs/dashboard',{method})).headers.get('x-middleware-next'),'1')
  for(const path of ['/api/costs/dashboard/other','/api/costs/dashboard-extra'])assert.equal(middleware(new NextRequest('http://localhost'+path)).status,307)
  assert.equal(middleware(new NextRequest('http://localhost/api/costs/dashboard',{method:'DELETE'})).status,307)
})
