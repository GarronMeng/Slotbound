// pack.mjs — 把校验通过的产物打成可上传的小工具 zip
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PKG = join(root, 'dist', 'minitool');
const OUT = join(root, 'dist', 'slotbound-xhs-minitool.zip');

if (!existsSync(join(PKG, 'index.html'))) {
  console.error('找不到 dist/minitool/index.html，请先执行 npm run build');
  process.exit(1);
}

rmSync(OUT, { force: true });

function walk(d) {
  const out = [];
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const files = walk(PKG).map(p => relative(PKG, p)).sort();

// index.html 放在首位，其余按字母序；-X 去掉扩展属性，保证是标准 zip
execFileSync('zip', ['-X', '-q', OUT, ...files], { cwd: PKG });

const buf = readFileSync(OUT);
const sha = createHash('sha256').update(buf).digest('hex');
const listing = execFileSync('unzip', ['-l', OUT], { encoding: 'utf8' });

console.log('\n打包完成');
console.log('──────────────────────────────────────────');
console.log(listing.trim());
console.log('──────────────────────────────────────────');
console.log(`产物路径 : ${relative(root, OUT)}`);
console.log(`绝对路径 : ${OUT}`);
console.log(`大小     : ${(buf.length / 1024).toFixed(1)} KB`);
console.log(`SHA-256  : ${sha}`);
console.log(`文件数   : ${files.length}`);
console.log('上传方式 : 小红书小工具上传页第二步 → 选择该 zip');
console.log('');
