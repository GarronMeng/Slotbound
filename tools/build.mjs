// build.mjs — 打包为符合小红书小工具规范的产物（dist/minitool/）
// 产物形态：单个 index.html 入口 + 包内 css + 单个包内 js（classic script，非 module）
import { build } from 'esbuild';
import { mkdirSync, rmSync, copyFileSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src');
const OUT = join(root, 'dist', 'minitool');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'js'), { recursive: true });
mkdirSync(join(OUT, 'css'), { recursive: true });

// 1) 打包 JS：IIFE + chrome61 目标（自动降级到 ES2017 基线）
const res = await build({
  entryPoints: [join(SRC, 'js', 'main.js')],
  outfile: join(OUT, 'js', 'app.js'),
  bundle: true,
  format: 'iife',
  target: ['chrome61'],
  minify: true,
  legalComments: 'none',
  charset: 'utf8',
  logLevel: 'warning',
  metafile: true,
  supported: {
    // 显式声明 Chrome 61 不支持的语法，强制 esbuild 降级（而不是静默按更高版本输出）
    // 注：class-static-block / 数字分隔符 等 esbuild 无法降级的特性，会因
    //     target=chrome61 直接在解析期报错，同样不会漏到产物里。
    'optional-chain': false,        // Chrome 80+
    'nullish-coalescing': false,    // Chrome 80+
    'logical-assignment': false,    // Chrome 85+
    'class-field': false,           // Chrome 72+
    'class-private-field': false,   // Chrome 74+
    'top-level-await': false,
    'async-generator': false,       // Chrome 63+
    'for-await': false,             // Chrome 63+
    'dynamic-import': false,        // Chrome 63+
    'import-meta': false,
    'optional-catch-binding': false, // Chrome 66+
    'regexp-named-capture-groups': false, // Chrome 64+
    'object-extensions': false,     // 对象展开/getter 简写等
    'bigint': false,                // Chrome 67+
    'hashbang': false,
    'using': false,
    'decorators': false,
    'nested-rest-binding': false,
    // 以下均为 ES2015/ES2016/ES2017，Chrome 61 原生支持，保持不降级以减小体积
    'arrow': true,
    'template-literal': true,
    'destructuring': true,
    'default-argument': true,
    'rest-argument': true,
    'for-of': true,
    'exponent-operator': true,
    'object-rest-spread': true,     // Chrome 60+
    'async-await': true,            // Chrome 55+
    'generator': true
  }
});

// 2) 复制样式
copyFileSync(join(SRC, 'css', 'style.css'), join(OUT, 'css', 'style.css'));

// 3) 复制入口 HTML（脚本标签已指向包内 ./js/app.js）
let html = readFileSync(join(SRC, 'index.html'), 'utf8');
if (!/<script\s+src="\.\/js\/app\.js"><\/script>/.test(html)) {
  throw new Error('index.html 必须通过 <script src="./js/app.js"></script> 引用包内脚本');
}
writeFileSync(join(OUT, 'index.html'), html);

// 4) 汇总
function walk(d) {
  const out = [];
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const files = walk(OUT);
let total = 0;
for (const f of files) total += statSync(f).size;

const out = Object.keys(res.metafile.outputs).map(k => `${k}  ${(res.metafile.outputs[k].bytes / 1024).toFixed(1)} KB`).join('\n');
console.log('[build] 完成');
console.log(out);
console.log(`[build] 产物目录 dist/minitool：${files.length} 个文件，共 ${(total / 1024).toFixed(1)} KB`);
