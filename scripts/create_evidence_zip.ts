import AdmZip from 'adm-zip';
import path from 'node:path';
import fs from 'node:fs';

const rootDir = process.cwd();
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'dev-dist', '.git', '.aistudio']);

function addDirToZip(zip: AdmZip, currentDir: string, zipBase: string) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(currentDir, entry.name);
    const relPath = zipBase ? path.posix.join(zipBase, entry.name) : entry.name;

    if (entry.isDirectory()) {
      addDirToZip(zip, fullPath, relPath);
    } else if (entry.isFile()) {
      // Skip output archives and secret .env files
      if (entry.name.endsWith('.zip') || entry.name === '.env' || entry.name.startsWith('.env.local')) {
        continue;
      }
      zip.addLocalFile(fullPath, zipBase);
    }
  }
}

// 1. Complete updated project ZIP (excluding node_modules, dist, .git, and .zip archives)
const fullZipPath = path.resolve(rootDir, 'LAZCAKONG_GYM_5_0_PREPROD_ACTUALIZADO.zip');
const fullZip = new AdmZip();
addDirToZip(fullZip, rootDir, '');
fullZip.writeZip(fullZipPath);
const fullStat = fs.statSync(fullZipPath);
console.log(`LAZCAKONG_GYM_5_0_PREPROD_ACTUALIZADO.zip created successfully. Size: ${fullStat.size} bytes.`);

// 2. Keep evidence folder ZIP updated if LAZCAKONG_EVIDENCIA_5_0 exists
const evidenceDir = path.resolve(rootDir, 'LAZCAKONG_EVIDENCIA_5_0');
if (fs.existsSync(evidenceDir)) {
  const evidenceZipPath = path.resolve(rootDir, 'LAZCAKONG_EVIDENCIA_5_0.zip');
  const evZip = new AdmZip();
  evZip.addLocalFolder(evidenceDir, 'LAZCAKONG_EVIDENCIA_5_0');
  evZip.writeZip(evidenceZipPath);
  const evStat = fs.statSync(evidenceZipPath);
  console.log(`LAZCAKONG_EVIDENCIA_5_0.zip created successfully. Size: ${evStat.size} bytes.`);
}
