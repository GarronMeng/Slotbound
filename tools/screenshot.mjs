// screenshot.mjs — 用 @napi-rs/canvas 真实渲染游戏画面并导出 PNG（视觉自检）
// 加载的是 dist/minitool/js/app.js 打包产物，走的是线上同一份代码。
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCanvas } from '@napi-rs/canvas';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(root, 'dist', 'minitool');
const OUTDIR = join(root, 'dist', 'shots');
mkdirSync(OUTDIR, { recursive: true });

const W = 390, H = 844, DPR = 2;
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const app = readFileSync(join(DIST, 'js', 'app.js'), 'utf8');

const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', e => errors.push(String(e && e.message)));
vc.on('error', (...a) => errors.push(a.join(' ')));

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://minitool.local/', virtualConsole: vc });
const win = dom.window;

// 主画布：接一块真实的 napi canvas
const gameEl = win.document.getElementById('game');
let real = null;
let _w = 300, _h = 150;
Object.defineProperty(gameEl, 'getContext', {
  configurable: true,
  value: () => { if (!real) real = createCanvas(_w, _h); return real.getContext('2d'); }
});
Object.defineProperty(gameEl, 'width', { configurable: true, get: () => _w, set: v => { _w = v; if (real) real.width = v; } });
Object.defineProperty(gameEl, 'height', { configurable: true, get: () => _h, set: v => { _h = v; if (real) real.height = v; } });
gameEl.toDataURL = () => real.toDataURL('image/png');

// 离屏画布（图集 / 分享图）：直接用 napi Canvas
const origCreate = win.document.createElement.bind(win.document);
win.document.createElement = function (tag) {
  if (String(tag).toLowerCase() === 'canvas') return createCanvas(300, 150);
  return origCreate(tag);
};
win.confirm = () => true;
const stage = win.document.getElementById('stage');
Object.defineProperty(stage, 'clientWidth', { value: W, configurable: true });
Object.defineProperty(stage, 'clientHeight', { value: H, configurable: true });
win.Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: W, bottom: H, width: W, height: H, x: 0, y: 0 });
Object.defineProperty(win, 'devicePixelRatio', { value: DPR, configurable: true });
win.requestAnimationFrame = () => 0;

win.eval(app);
const tick = () => new Promise(r => setTimeout(r, 0));
await tick(); await tick();
const { game, ui, STATE } = win.SLOTBOUND;

const STEP = 1 / 60;
async function frames(n, fn) {
  for (let i = 0; i < n; i++) { if (fn) fn(i); game.update(STEP); game.render(); if (i % 8 === 0) await tick(); }
}
function shot(name) {
  const buf = real.toBuffer('image/png');
  const p = join(OUTDIR, name);
  writeFileSync(p, buf);
  console.log(`  ${name}  ${gameEl.width}x${gameEl.height}  ${(buf.length / 1024).toFixed(0)} KB`);
}

// 1) 开局瞬间
ui.startGame();
await frames(30);
shot('01-start.png');

// 2) 拉杆中（滚轮模糊）
game.energy = 3;
game.spin();
await frames(22);
shot('02-spinning.png');

// 3) 战斗 12 秒后
let sp = 0;
await frames(60 * 12, () => { if (game.canSpin() && sp < 40) { game.spin(); sp++; } if (game.state === STATE.REWARD) game.pickCard(0); });
shot('03-battle.png');

// 4) 强行造一次 JACKPOT 画面
game.energy = 3;
game.slot.outcome = [['prism', 'prism', 'prism'], ['prism', 'prism', 'prism'], ['prism', 'prism', 'prism']];
game.slot.strips = game.slot.strips.map(() => new Array(30).fill('prism'));
game.slot.pos = [24, 24, 24];
game.slot.state = 'done';
game.slot.result = game.slot.evaluate();
game.onSpinResult(game.slot.result);
await frames(14);
shot('04-jackpot.png');

// 5) 中期（第 8 波左右）+ 满场
ui.startGame();
let sp2 = 0;
await frames(60 * 75, () => { if (game.canSpin() && sp2 < 200) { game.spin(); sp2++; } if (game.state === STATE.REWARD) game.pickCard(0); });
shot('05-midgame.png');
console.log(`  · 中期状态：第 ${game.wave} 波 / ${game.score} 分 / 单位 ${game.units.length} / 敌人 ${game.enemies.count()} / 击杀 ${game.kills}`);

if (errors.length) { console.log('渲染期异常：'); errors.slice(0, 10).forEach(e => console.log('  ! ' + e)); process.exit(1); }
console.log('视觉自检完成，无渲染异常。');
