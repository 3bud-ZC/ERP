const fs = require('fs');
const path = require('path');

const root = process.cwd();
const standaloneDir = path.join(root, '.next', 'standalone');
const staticSource = path.join(root, '.next', 'static');
const staticTarget = path.join(standaloneDir, '.next', 'static');
const publicSource = path.join(root, 'public');
const publicTarget = path.join(standaloneDir, 'public');
const pdfKitDataSource = path.join(root, 'node_modules', 'pdfkit', 'js', 'data');
const pdfKitTargets = [
  path.join(root, '.next', 'server', 'chunks', 'data'),
  path.join(standaloneDir, '.next', 'server', 'chunks', 'data'),
];

function copyDir(source, target) {
  if (!fs.existsSync(source)) return;
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

if (!fs.existsSync(standaloneDir)) {
  console.log('[standalone-assets] No standalone build found; skipping.');
  process.exit(0);
}

copyDir(staticSource, staticTarget);
copyDir(publicSource, publicTarget);
for (const target of pdfKitTargets) {
  copyDir(pdfKitDataSource, target);
}
console.log('[standalone-assets] Copied .next/static, public, and pdfkit assets into standalone/server outputs.');
