import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/preview-worker.mjs';
const request = (path, method='GET') => worker.fetch(new Request('https://preview.invalid'+path,{method}));
test('health is explicitly isolated', async () => {
  const r = await request('/api/health');
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{ok:true,service:'lazcakong-gym-zero-cost-test',mode:'isolated-preview',productionAccess:false,firebaseAccess:false,geminiAccess:false});
  assert.equal(r.headers.get('cache-control'),'no-store');
});
test('root is labeled as test and offers no login', async () => {
  const r = await request('/');
  assert.equal(r.status,200);
  assert.match(await r.text(),/No es la aplicación de producción/);
});
test('auth, coach, storage, OTA and arbitrary writes fail closed', async () => {
  for(const [p,m] of [['/api/auth/session-init','POST'],['/api/coach/chat','POST'],['/api/ota/manifest','GET'],['/api/admin/athletes','GET'],['/api/version','GET'],['/api/health','POST'],['/','POST']]){
    const r=await request(p,m);
    assert.equal(r.status,503);
    assert.equal((await r.json()).code,'PREVIEW_ONLY');
  }
});
