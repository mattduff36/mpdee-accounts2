import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { WriteAccessError } from '@/lib/auth'
import { CustomRecurringError } from './custom-recurring'
import { dashboardResponse } from './dashboard-api'
const token='synthetic-dashboard-test-token-1234567890'
test('dashboard rejects anonymous, invalid token, readonly and cross-origin writes before mutation',async()=>{
  let writes=0
  const deps={token,session:async()=>null as {id:string;role:string}|null,requireWrite:async()=>{throw new WriteAccessError()},load:async()=>({}) as never,save:async()=>{writes++;return {revision:1}}}
  const req=(headers:Record<string,string>={})=>new NextRequest('https://accounts.test/api/costs/dashboard',{method:'POST',headers,body:'{}'})
  assert.equal((await dashboardResponse(req(),true,deps)).status,401)
  assert.equal((await dashboardResponse(req({authorization:'Bearer wrong'}),true,deps)).status,401)
  const reader={...deps,session:async()=>({id:'reader',role:'readonly'})}
  assert.equal((await dashboardResponse(req({origin:'https://accounts.test'}),true,reader)).status,403)
  const writer={...reader,requireWrite:async()=>({id:'admin'})}
  assert.equal((await dashboardResponse(req({origin:'https://other.test'}),true,writer)).status,403)
  assert.equal(writes,0)
  assert.equal((await dashboardResponse(req({origin:'https://accounts.test'}),true,writer)).status,200)
  assert.equal((await dashboardResponse(req({authorization:'Bearer '+token}),true,deps)).status,200)
  assert.equal(writes,2)
})
test('dashboard preserves optimistic conflicts and rejects invalid query periods',async()=>{
  const deps={token,session:async()=>null,requireWrite:async()=>{},load:async()=>({}) as never,save:async()=>{throw new CustomRecurringError(409,'Reload costs')}}
  const headers={authorization:'Bearer '+token}
  const response=await dashboardResponse(new NextRequest('https://accounts.test/api/costs/dashboard',{method:'POST',headers,body:'{}'}),true,deps)
  assert.equal(response.status,409);assert.equal((await response.json()).error,'Reload costs')
  for(const query of ['?period=wrong','?period=this-month&period=last-month','?extra=yes'])assert.equal((await dashboardResponse(new NextRequest('https://accounts.test/api/costs/dashboard'+query,{headers}),false,deps)).status,400)
})
