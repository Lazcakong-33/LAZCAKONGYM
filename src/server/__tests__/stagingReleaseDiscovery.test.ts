import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { compareStagingVersions, discoverStagingRelease, readStagingRelease } from '../../utils/stagingReleaseDiscovery';
const sum = (s: string) => createHash('sha256').update(s).digest('hex');
const digest = 'a'.repeat(64);
function sample(version='7.0.3') {
 const tag='ota-staging-v'+version;
 const base='https://github.com/Lazcakong-33/LAZCAKONGYM/releases/download/'+tag+'/';
 const zip='lazcakongym-ota-'+version+'.zip';
 const m={ version, buildId:version+'-ota-'+digest.slice(0,8),channel:'staging',url:base+zip,checksum:digest,contentsPolicy:'web_assets_only',requiresApkUpdate:false,minNativeVersionCode:70000,capacitorMajor:8,urgency:'optional',changedScopes:['ui'],releaseNotes:'Test' };
 const json=JSON.stringify(m);
 return {tag_name:tag,prerelease:true,draft:false,body:'<!-- LAZCAKONG_STAGING_MANIFEST_BASE64:'+Buffer.from(json).toString('base64')+' -->',assets:[{name:zip,browser_download_url:base+zip,digest:'sha256:'+digest},{name:'manifest.staging.json',browser_download_url:base+'manifest.staging.json',digest:'sha256:'+sum(json)}]};
}
test('valid staging release and semantic ordering',async()=>{
 assert.ok(compareStagingVersions('7.0.10','7.0.9')>0);
 assert.equal((await readStagingRelease(sample())).version,'7.0.3');
 const fetcher=async()=>new Response(JSON.stringify([sample('7.0.9'),sample('7.0.10'),{...sample('7.0.99'),draft:true}]));
 assert.equal((await discoverStagingRelease('7.0.2',fetcher))?.version,'7.0.10');
 assert.equal(await discoverStagingRelease('7.0.10',fetcher),null);
});
test('reject tampered asset, malformed manifest, production and non-prerelease',async()=>{
 const wrong=sample();wrong.assets[0].digest='sha256:'+'b'.repeat(64);
 await assert.rejects(readStagingRelease(wrong));
 const wrong2=sample();wrong2.assets[1].digest='sha256:'+'b'.repeat(64);
 await assert.rejects(readStagingRelease(wrong2));
 await assert.rejects(readStagingRelease({...sample(),prerelease:false}));
 await assert.rejects(readStagingRelease({...sample(),tag_name:'ota-production-v7.0.3'}));
});
