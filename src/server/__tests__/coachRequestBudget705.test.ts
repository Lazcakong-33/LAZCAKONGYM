import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCoachBudget } from '../../server/coachRequestBudget.ts';
test('per-user, total, concurrency, cooldown and reset are bounded',()=>{
 let now=0;
 const b=createCoachBudget({perMinute:2,perUserDay:3,totalDay:4,concurrent:1,now:()=>now});
 const one=b.acquire('a'); assert.ok(one.allowed);
 assert.equal(b.acquire('b').allowed,false); if(one.allowed)one.release();
 const two=b.acquire('a'); if(two.allowed)two.release(); assert.ok(two.allowed);
 assert.equal(b.acquire('a').allowed,false);
 now=60_000; const three=b.acquire('a'); assert.ok(three.allowed); if(three.allowed)three.release();
 assert.equal(b.acquire('a').allowed,false);
 const four=b.acquire('b'); assert.ok(four.allowed); if(four.allowed)four.release();
 assert.equal(b.acquire('c').allowed,false);
 now=86_400_000; b.pause(60); assert.equal(b.acquire('c').allowed,false);
 now+=60_000; assert.ok(b.acquire('c').allowed);
});
