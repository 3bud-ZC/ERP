const fs = require('fs');
const path = require('path');

const root = process.cwd();
const standaloneDir = path.join(root, '.next', 'standalone');
const staticSource = path.join(root, '.next', 'static');
const staticTarget = path.join(standaloneDir, '.next', 'static');
const publicSource = path.join(root, 'public');
const publicTarget = path.join(standaloneDir, 'public');

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
console.log('[standalone-assets] Copied .next/static and public into .next/standalone.');
