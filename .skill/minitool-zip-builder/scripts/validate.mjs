// validate.mjs — 小红书小工具产物合规校验
//
// 规则来源：《小工具容器能力清单》（https://fe-video-qc.xhscdn.com/fe-platform-file/
// 104101b8324ihuc967a06277180ac7t8006ptl0fm199r4.html）§2.6 资源加载规则、
// §2.2 JS/CSS 兼容基线、§3 端能力 JS API、§4 不可用能力、§5 图形计算边界。
//
// 说明：官方 minitool-zip-builder skill 包（.skill 归档）在本次运行环境中无法下载
// （xhscdn.com 的 TLS 握手被网络层拒绝），因此本校验器依据上述官方能力清单
// 逐条实现同等规则。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const arg = process.argv[2];
const PKG = arg ? (isAbsolute(arg) ? arg : join(root, arg)) : join(root, 'dist', 'minitool');

const ALLOWED_EXT = new Set(['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.woff', '.woff2', '.json']);

const results = [];
function add(level, rule, msg) { results.push({ level, rule, msg }); }
const fail = (r, m) => add('FAIL', r, m);
const warn = (r, m) => add('WARN', r, m);
const pass = (r, m) => add('PASS', r, m);

function walk(d) {
  const out = [];
  if (!existsSync(d)) return out;
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const files = walk(PKG);
const rel = (p) => relative(PKG, p).split('\\').join('/');
const textOf = (p) => readFileSync(p, 'utf8');
const sizeOf = (p) => statSync(p).size;

console.log(`\n校验目标：${PKG}\n`);

if (!files.length) {
  fail('包结构', '产物目录为空');
}

// ============ A. 包结构 ============
const htmls = files.filter(f => extname(f) === '.html');
if (htmls.length === 1) pass('A1 入口唯一', rel(htmls[0]));
else if (htmls.length === 0) fail('A1 入口唯一', '缺少 .html 入口文件');
else fail('A1 入口唯一', `存在 ${htmls.length} 个 .html，必须只有一个入口`);

const entry = htmls.find(f => rel(f) === 'index.html') || htmls[0];
if (entry && rel(entry) === 'index.html') pass('A4 入口位置', 'index.html 位于包根目录');
else if (entry) fail('A4 入口位置', `入口 ${rel(entry)} 不在包根目录`);

const badExt = files.filter(f => !ALLOWED_EXT.has(extname(f).toLowerCase()));
if (badExt.length) fail('A2 文件类型', '存在不支持的类型：' + badExt.map(rel).join(', '));
else pass('A2 文件类型', `全部 ${files.length} 个文件类型受支持`);

// ============ B. 脚本规范 ============
const html = entry ? textOf(entry) : '';

// B1 内联脚本
const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
let inlineScript = 0;
for (const m of scriptTags) {
  const attrs = m[1] || '';
  const body = (m[2] || '').trim();
  if (body.length) { inlineScript++; }
  // B2 src 必须为包内相对路径
  const srcM = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
  if (srcM) {
    const s = srcM[1];
    if (/^(https?:)?\/\//i.test(s) || /^[a-z][a-z0-9+.-]*:/i.test(s)) fail('C1 外链脚本', `<script src="${s}"> 使用了外部/协议地址`);
    else if (!s.startsWith('./') && !s.startsWith('../') && !s.startsWith('/')) warn('C1 外链脚本', `<script src="${s}"> 建议写成 "./${s}" 形式`);
    else {
      const target = join(dirname(entry), s.replace(/^\.\//, ''));
      if (!existsSync(target)) fail('C2 引用存在', `<script src="${s}"> 指向的文件不在包内`);
      else pass('C2 引用存在', `脚本 ${s} 已打包（${(sizeOf(target) / 1024).toFixed(1)} KB）`);
    }
  } else if (!body.length) {
    fail('B2 脚本引用', '<script> 既无 src 也无内容');
  }
  if (/type\s*=\s*["']module["']/i.test(attrs)) fail('B3 脚本类型', '禁止 type="module"，请打包为 classic script');
  if (/type\s*=\s*["']importmap["']/i.test(attrs)) fail('B3 脚本类型', '禁止 importmap');
}
if (inlineScript) fail('B1 内联脚本', `发现 ${inlineScript} 处内联 <script>...</script>，容器 CSP 会拦截`);
else if (scriptTags.length) pass('B1 内联脚本', `全部 ${scriptTags.length} 个 <script> 均为包内外链`);

// B4 行内事件
const inlineHandlers = [...html.matchAll(/\son[a-z]+\s*=\s*["']/gi)];
if (inlineHandlers.length) fail('B4 行内事件', `发现 ${inlineHandlers.length} 处 on* 行内事件属性，请改用 addEventListener`);
else pass('B4 行内事件', '无行内事件处理器');

// B5 javascript: URI
if (/javascript\s*:/i.test(html)) fail('B5 危险 URI', 'HTML 中出现 javascript: URI');
else pass('B5 危险 URI', '无 javascript: URI');

// A3 iframe / object / embed
if (/<(iframe|object|embed)\b/i.test(html)) fail('A3 内嵌禁止', '禁止使用 iframe / object / embed');
else pass('A3 内嵌禁止', '无 iframe / object / embed');

// target=_blank / a[download] / form action
if (/target\s*=\s*["']_blank["']/i.test(html)) fail('D 外链跳转', '禁止 target="_blank"');
else pass('D 外链跳转', '无 target="_blank"');
if (/<a\b[^>]*\bdownload\b/i.test(html)) fail('D 文件下载', '禁止 a[download]，保存图片请用 saveImageToPhotosAlbum');
else pass('D 文件下载', '无 a[download]');
const formM = html.match(/<form\b([^>]*)>/i);
if (formM && !/onsubmit\s*=\s*["']return false/i.test(formM[1] || '')) warn('D 表单跳转', '<form> 提交会跳转，容器已禁用；如仅作布局建议改为 <div>');
else pass('D 表单跳转', '无会跳转的 <form>');

// ============ C. 样式/资源引用 ============
const cssFiles = files.filter(f => extname(f) === '.css');
const stripCssComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const cssAll = stripCssComments(
  cssFiles.map(textOf).join('\n') + '\n' + (html.match(/<style[\s\S]*?<\/style>/gi) || []).join('\n')
);

const urlRefs = [...cssAll.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map(m => m[1].trim());
for (const u of urlRefs) {
  if (/^(data:|blob:)/i.test(u)) continue;                       // 图片允许 data:/blob:
  if (/^(https?:)?\/\//i.test(u)) fail('C1 外链资源', `CSS url(${u}) 指向外部域名，容器不联网`);
  else warn('C1 外链资源', `CSS url(${u}) 请确认为包内资源`);
}
if (!urlRefs.length) pass('C1 外链资源', 'CSS 未引用任何 url()');

// @font-face 外部字体
if (/@font-face/i.test(cssAll) && /src\s*:[^;]*url\(\s*["']?(https?:)?\/\//i.test(cssAll)) fail('C1 外部字体', '@font-face 引用了外部字体');
else pass('C1 外部字体', '无外部 @font-face');

// HTML 内资源标签
for (const tag of html.matchAll(/<(img|source|video|audio|link)\b[^>]*>/gi)) {
  const s = (tag[0].match(/\b(?:src|href)\s*=\s*["']([^"']+)["']/i) || [])[1];
  if (!s) continue;
  if (/^(data:|blob:|#)/i.test(s)) continue;
  if (/^(https?:)?\/\//i.test(s)) fail('C1 外链资源', `<${tag[1]}> 引用外部地址 ${s}`);
  else {
    const t = join(dirname(entry), s.replace(/^\.\//, ''));
    if (!existsSync(t)) fail('C2 引用存在', `<${tag[1]} src="${s}"> 指向的文件不在包内`);
    else pass('C2 引用存在', `资源 ${s} 已打包`);
  }
}

// ============ D. 禁用 Web API（扫描包内 JS） ============
const jsFiles = files.filter(f => extname(f) === '.js');
const jsAll = jsFiles.map(f => ({ f: rel(f), s: textOf(f) }));

const BANNED_API = [
  [/\bfetch\s*\(/, 'fetch() 网络请求'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest 网络请求'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bEventSource\b/, 'EventSource(SSE)'],
  [/\bnew\s+Worker\b|\bnew\s+SharedWorker\b|\bnavigator\.serviceWorker\b|\bimportScripts\b/, 'Worker / ServiceWorker'],
  [/\bnavigator\.geolocation\b/, '地理定位'],
  [/\bnavigator\.clipboard\b|\bexecCommand\s*\(/, '剪贴板'],
  [/\bnavigator\.(bluetooth|usb|hid|serial)\b/, '硬件连接'],
  [/\bRTCPeerConnection\b/, 'WebRTC'],
  [/\brequestFullscreen\b|\bwebkitRequestFullScreen\b/, '全屏 API（由容器统一管理）'],
  [/\bwindow\.open\s*\(/, 'window.open'],
  [/\bwindow\.prompt\s*\(|[^.\w]prompt\s*\(/, 'window.prompt'],
  [/\bSharedArrayBuffer\b/, 'SharedArrayBuffer'],
  [/\bOffscreenCanvas\b/, 'OffscreenCanvas（容器不支持）'],
  [/\bWebAssembly\b/, 'WebAssembly'],
  [/\bdocument\.write\s*\(/, 'document.write'],
  [/\bdevicemotion\b|\bdeviceorientation\b/, '设备运动/朝向传感器'],
  [/\bnavigator\.(getBattery|connection|credentials|locks)\b/, '电池/网络信息/凭据/Web Locks'],
  [/\bnew\s+Function\s*\(/, 'new Function() 动态执行'],
  [/\beval\s*\(/, 'eval() 动态执行'],
  [/\bpostMessage\s*\(/, '直接向 bridge postMessage（须走 window.xhs.miniTool）']
];

let bannedHits = 0;
for (const { f, s } of jsAll) {
  for (const [re, name] of BANNED_API) {
    if (re.test(s)) { fail('D 禁用 API', `${f} 命中「${name}」`); bannedHits++; }
  }
  // 字符串形式的定时器回调
  if (/set(Timeout|Interval)\s*\(\s*["'`]/.test(s)) { fail('D 禁用 API', `${f} 使用字符串形式的 setTimeout/setInterval`); bannedHits++; }
}
if (!bannedHits) pass('D 禁用 API', `${jsFiles.length} 个 JS 文件未命中任何禁用 API`);

// ============ E. JS 兼容基线（Chrome 61 / ES2017） ============
const NEWER = [
  [/\?\.\s*[A-Za-z_$([\]]/, '可选链 ?. (Chrome 80+)'],
  [/\?\?/, '空值合并 ?? (Chrome 80+)'],
  [/\|\|=|&&=|\?\?=/, '逻辑赋值 (Chrome 85+)'],
  [/\b\d_\d/, '数字分隔符 (Chrome 75+)'],
  [/\bglobalThis\b/, 'globalThis (Chrome 71+)'],
  [/Object\.fromEntries/, 'Object.fromEntries (Chrome 73+)'],
  [/\.flat\s*\(|\.flatMap\s*\(/, 'Array.flat/flatMap (Chrome 69+)'],
  [/\.replaceAll\s*\(/, 'String.replaceAll (Chrome 85+)'],
  [/\.at\s*\(\s*-?\d/, '.at() (Chrome 92+)'],
  [/Promise\.(allSettled|any)/, 'Promise.allSettled/any (Chrome 76/85+)'],
  [/\bstructuredClone\b/, 'structuredClone (Chrome 98+)'],
  [/\bfindLast(Index)?\s*\(/, 'findLast (Chrome 97+)'],
  [/\bqueueMicrotask\b/, 'queueMicrotask (Chrome 71+)'],
  [/\bResizeObserver\b/, 'ResizeObserver (Chrome 64+)'],
  [/\bAbortController\b/, 'AbortController (Chrome 66+)'],
  [/\bmatchAll\s*\(/, 'String.matchAll (Chrome 73+)'],
  [/\bBigInt\b|\d+n\b/, 'BigInt (Chrome 67+)'],
  [/\btrimStart\s*\(|\btrimEnd\s*\(/, 'trimStart/trimEnd (Chrome 66+)'],
  [/\bfor\s+await\b/, '异步迭代 (Chrome 63+)'],
  [/\bIntl\.PluralRules\b/, 'Intl.PluralRules (Chrome 63+)'],
  [/\bArray\.prototype\.includes\b|\.includes\s*\(/, null], // includes 是 ES2016，允许
  [/\#\w+\s*=/, '私有类字段 (Chrome 74+)'],
  [/\bimport\s*\(/, '动态 import() (Chrome 63+)'],
  [/\bimport\s+[\w{*]/, 'ESM import 语句（须打包为 classic script）'],
  [/\bexport\s+(default|const|function|class|let|var)/, 'ESM export 语句（须打包为 classic script）']
];

let newerHits = 0;
for (const { f, s } of jsAll) {
  for (const [re, name] of NEWER) {
    if (!name) continue;
    if (re.test(s)) { fail('E JS 基线', `${f} 命中「${name}」`); newerHits++; }
  }
}
if (!newerHits) pass('E JS 基线', 'JS 产物符合 Chrome 61 / ES2017 基线');

// ============ F. CSS 兼容基线 ============
const CSS_NEWER = [
  [/\bgap\s*:/, 'flex/grid gap 简写（flex gap 需 Chrome 84+）'],
  [/aspect-ratio\s*:/, 'aspect-ratio (Chrome 88+)'],
  [/\bclamp\s*\(/, 'clamp() (Chrome 79+)'],
  [/\bmin\s*\(|\bmax\s*\(/, 'min()/max() (Chrome 79+)'],
  [/conic-gradient\s*\(/, 'conic-gradient (Chrome 69+)'],
  [/backdrop-filter\s*:/, 'backdrop-filter (Chrome 76+)'],
  [/\b\d+(\.\d+)?dvh\b|\b\d+(\.\d+)?svh\b|\b\d+(\.\d+)?lvh\b/, 'dvh/svh/lvh (Chrome 108+)'],
  [/:is\s*\(|:where\s*\(|:has\s*\(/, ':is()/:where()/:has() (Chrome 88/88/105+)'],
  [/position\s*:\s*sticky/, 'position:sticky 在旧 WebView 上需前缀'],
  [/\btext-wrap\s*:/, 'text-wrap (Chrome 114+)'],
  [/\binset\s*:/, 'inset 简写 (Chrome 87+)']
];
let cssHits = 0;
for (const [re, name] of CSS_NEWER) {
  if (re.test(cssAll)) {
    // position:sticky 与 gap 在 grid 中可用，降级为 WARN
    if (/sticky|gap/.test(name)) warn('F CSS 基线', `CSS 命中「${name}」，请确认有降级样式`);
    else { fail('F CSS 基线', `CSS 命中「${name}」`); }
    cssHits++;
  }
}
if (!cssHits) pass('F CSS 基线', 'CSS 符合 Chrome 61 基线');

// ============ G. 端能力使用 ============
const xhsUse = jsAll.filter(j => /window\.xhs/.test(j.s));
if (xhsUse.length) {
  let ok = true;
  for (const j of xhsUse) {
    if (!/window\.xhs\s*&&\s*window\.xhs\.miniTool/.test(j.s)) { fail('G 端能力', `${j.f} 调用 window.xhs 前未判空`); ok = false; }
    const calls = [...j.s.matchAll(/miniTool\.(\w+)/g)].map(m => m[1]);
    const allowed = new Set(['postNote', 'saveImageToPhotosAlbum', 'writeTempFile']);
    for (const c of calls) {
      if (!allowed.has(c)) { fail('G 端能力', `${j.f} 调用了未列出的 API miniTool.${c}`); ok = false; }
    }
    if (calls.length) pass('G 端能力', `${j.f} 仅调用 ${[...new Set(calls)].join(' / ')}`);
  }
  if (ok) pass('G 端能力判空', 'window.xhs 调用前均已判空并提供降级路径');
} else {
  pass('G 端能力', '未使用端能力（纯本地运行，符合规范）');
}

// ============ H. 离线自包含 ============
let netHits = 0;
for (const f of files) {
  if (!/\.(html|css|js|json|svg)$/i.test(f)) continue;
  const s = textOf(f);
  for (const m of s.matchAll(/["'`]\s*(https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^"'`\s]*/gi)) {
    const u = m[0].replace(/^["'`]\s*/, '');
    if (/^\/\/www\.w3\.org\//.test(u)) continue;   // SVG/XML 命名空间不是网络请求
    if (/\bschema\b|xmlns/i.test(s.slice(Math.max(0, m.index - 60), m.index))) continue;
    fail('H 离线自包含', `${rel(f)} 出现网络地址 ${u.slice(0, 80)}`);
    netHits++;
  }
}
if (!netHits) pass('H 离线自包含', '产物内无任何网络地址，可完全离线运行');

// ============ 汇总 ============
const nFail = results.filter(r => r.level === 'FAIL').length;
const nWarn = results.filter(r => r.level === 'WARN').length;
const nPass = results.filter(r => r.level === 'PASS').length;

const icon = { PASS: '✓', WARN: '!', FAIL: '✗' };
for (const r of results) {
  if (r.level === 'PASS') continue;
  console.log(`  ${icon[r.level]} [${r.level}] ${r.rule} — ${r.msg}`);
}
console.log('');
for (const r of results) {
  if (r.level !== 'PASS') continue;
  console.log(`  ${icon.PASS} [PASS] ${r.rule} — ${r.msg}`);
}

const totalBytes = files.reduce((a, f) => a + sizeOf(f), 0);
console.log('\n──────────────────────────────────────────');
console.log(`  文件 ${files.length} 个 / ${(totalBytes / 1024).toFixed(1)} KB    通过 ${nPass}    警告 ${nWarn}    失败 ${nFail}`);
console.log('──────────────────────────────────────────');
if (nFail) { console.log('\n校验未通过：请先修复上述 FAIL 项。\n'); process.exit(1); }
console.log('\n校验通过，可以打包上传小红书小工具。\n');
