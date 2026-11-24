import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const pkg = json('package.json');
const cfg = json('src/firebase-applet-config.json');
const server = readFileSync('server.ts', 'utf8');
const routes = [...server.matchAll(/app\.(get|post|put|delete|patch)\(['"]([^'"]+)['"]/g)]
  .map(m => ({method:m[1].toUpperCase(),path:m[2]})).filter(r => r.path.startsWith('/api/'));
const issues = [];
if (cfg.firestoreDatabaseId && cfg.firestoreDatabaseId !== '(default)')
  issues.push('Named Firestore database: confirm actual Spark eligibility and backup before changing billing.');
if (cfg.storageBucket) issues.push('Storage bucket configured: audit actual usage and Spark compatibility.');
if (routes.length) issues.push('Express API routes must be ported and tested; static hosting alone is not a replacement.');
const assets = { count: 0, over25MiB: [] };
function walk(dir) {
  for (const e of readdirSync(dir, {withFileTypes:true})) {
    const p = join(dir,e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile()) {
      assets.count++;
      if (statSync(p).size > 25*1024*1024) assets.over25MiB.push(p);
    }
  }
}
if (existsSync('dist')) {
  walk('dist');
  if (assets.count > 20000 || assets.over25MiB.length) issues.push('Build exceeds Cloudflare free static asset limits.');
} else issues.push('Build dist not present: run npm ci and npm run build before evaluating asset limits.');
console.log(JSON.stringify({
  mode:'read-only; no network or credentials read', 
  projectId:cfg.projectId, databaseId:cfg.firestoreDatabaseId ?? '(default)',
  dependencies:Object.keys(pkg.dependencies ?? {}), routes, assets,
  geminiNetworkDisabledByFlag:process.env.LAZCAKONG_ZERO_COST_MODE?.trim().toLowerCase()==='true',
  blockers:issues, readyToDisableBilling:false
},null,2));
