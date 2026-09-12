// strategy-smoke.mjs — v1.1 智能合成 / 阵型 / 高压车道 / 安全区运行验证
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(root, 'dist', 'minitool');
const APP = join(DIST, 'js', 'app.js');
if (!existsSync(APP)) throw new Error('请先 npm run build');

function makeCtx(canvas) {
  const grad = { addColorStop() {} };
  const noop = () => {};
  return {
    canvas, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    globalCompositeOperation: 'source-over', font: '10px sans-serif', textAlign: 'start',
    textBaseline: 'alphabetic', lineCap: 'butt', lineJoin: 'miter', filter: 'none',
    imageSmoothingEnabled: true, shadowBlur: 0, shadowColor: 'transparent',
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, arcTo: noop,
    ellipse: noop, quadraticCurveTo: noop, bezierCurveTo: noop, rect: noop, clip: noop,
    fill: noop, stroke: noop, fillRect: noop, strokeRect: noop, clearRect: noop,
    fillText: noop, strokeText: noop, save: noop, restore: noop, translate: noop,
    rotate: noop, scale: noop, setTransform: noop, transform: noop, resetTransform: noop,
    drawImage(img) { if (img === undefined || img === null) throw new Error('drawImage 空图像'); },
    createLinearGradient: () => grad, createRadialGradient: () => grad, createPattern: () => null,
    setLineDash: noop, getLineDash: () => [], measureText: () => ({ width: 10 })
  };
}

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', e => errors.push(String(e && e.message)));
vc.on('error', (...a) => errors.push(a.join(' ')));
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://minitool.local/', virtualConsole: vc });
const win = dom.window;
win.HTMLCanvasElement.prototype.getContext = function () { if (!this.__ctx) this.__ctx = makeCtx(this); return this.__ctx; };
win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
win.confirm = () => true;
win.requestAnimationFrame = () => 0;
const stage = win.document.getElementById('stage');
Object.defineProperty(stage, 'clientWidth', { value: 390, configurable: true });
Object.defineProperty(stage, 'clientHeight', { value: 844, configurable: true });
win.Element.prototype.getBoundingClientRect = function () {
  if (this.id === 'hud') return { left: 0, top: 0, right: 390, bottom: 96, width: 390, height: 96, x: 0, y: 0 };
  return { left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844, x: 0, y: 0 };
};
Object.defineProperty(win, 'devicePixelRatio', { value: 2, configurable: true });

win.eval(readFileSync(APP, 'utf8'));
await new Promise(r => setTimeout(r, 0));
await new Promise(r => setTimeout(r, 0));
if (!win.SLOTBOUND) throw new Error('SLOTBOUND 未启动');
const { game, ui, STATE } = win.SLOTBOUND;
const STEP = 1 / 60;
function assert(name, cond, extra = '') {
  if (!cond) throw new Error('FAIL ' + name + (extra ? ' | ' + extra : ''));
  console.log('PASS', name, extra);
}
function frames(n) { for (let i = 0; i < n; i++) game.update(STEP); }
function clearUnits() {
  game.units.length = 0;
  for (let c = 0; c < game.grid.length; c++) for (let r = 0; r < game.grid[c].length; r++) game.grid[c][r] = null;
}

ui.startGame();
assert('进入 PLAY', game.state === STATE.PLAY);
assert('策略层已安装', Array.isArray(game._laneDoctrine));
assert('安全区 v3 已安装', game.L.safeAreaVersion === 3, game.L.safeAreaVersion);
assert('战场顶部位于 HUD 下方', game.L.fieldTop >= 132, game.L.fieldTop);

const probe = game.spawnEnemy('grunt', 0, game.L.fieldTop - 200, 1, 1);
const probeRadius = probe.r * game.L.eScale;
assert('怪物出生时完整身体位于安全区内', probe.y - probeRadius >= game.L.fieldTop + 10,
  `top=${(probe.y - probeRadius).toFixed(1)} fieldTop=${game.L.fieldTop.toFixed(1)}`);
const probeIdx = game.enemies.live.indexOf(probe);
if (probeIdx >= 0) { game.enemies.live.splice(probeIdx, 1); game.enemies.free.push(probe); }

assert('高压车道已生成', game._pressureLane >= 0 && game._pressureLane <= 2, game._pressureLane);
let pressure = 0;
for (const q of game.queue) if (q.lane === game._pressureLane) pressure++;
assert('高压车道敌人占比明显更高', pressure / Math.max(1, game.queue.length) >= 0.45, pressure + '/' + game.queue.length);

// 自动链式合成：4 个 Lv1 cannon -> 最终应出现 1 个 Lv3 cannon。
clearUnits();
for (let i = 0; i < 4; i++) game.placeUnit('cannon');
assert('4 个单位已落位', game.units.length === 4, game.units.length);
frames(45);
const cannons = game.units.filter(u => u.type === 'cannon');
assert('自动链式合成收敛', cannons.length === 1, cannons.map(u => u.level).join(','));
assert('4×Lv1 合成到 Lv3', cannons[0].level === 3, cannons[0].level);

// 不允许跨级吞并：Lv1 拖向 Lv2 应交换，而不是升级。
clearUnits();
const a = game.placeUnit('bow');
const b = game.placeUnit('bow');
game.doMerge(a, b, true);
const lv2 = b;
const lv1 = game.placeUnit('bow');
const lv1Level = lv1.level, lv2Level = lv2.level;
const lv1Cell = { c: lv1.col, r: lv1.row }, lv2Cell = { c: lv2.col, r: lv2.row };
game.tryDrop(lv1, lv2Cell.c, lv2Cell.r);
assert('跨级不会吞并 Lv1', lv1.level === lv1Level, lv1.level);
assert('跨级不会升级 Lv2', lv2.level === lv2Level, lv2.level);
assert('跨级操作改为交换', game.grid[lv2Cell.c][lv2Cell.r] === lv1 && game.grid[lv1Cell.c][lv1Cell.r] === lv2);

// 盾阵：盾卫前排 + 远程后排，盾卫获得减伤、远程获得攻速。
clearUnits();
const guard = game.placeUnit('guard');
const bow = game.placeUnit('bow');
if (guard.col !== 1 || guard.row !== 0) game.tryDrop(guard, 1, 0);
if (bow.col !== 1 || bow.row !== 3) game.tryDrop(bow, 1, 3);
frames(2);
assert('盾阵被识别', game._laneDoctrine[1] && game._laneDoctrine[1].id === 'wall', game._laneDoctrine[1] && game._laneDoctrine[1].id);
assert('盾卫获得减伤', guard._formationTaken < 1, guard._formationTaken);
assert('后排获得攻速', bow.rate < bow._strategyBaseRate, bow.rate + '<' + bow._strategyBaseRate);

// 火力网：同路 3 个远程，伤害获得加成。
clearUnits();
const r1 = game.placeUnit('bow');
const r2 = game.placeUnit('mage');
const r3 = game.placeUnit('cannon');
game.tryDrop(r1, 2, 1);
game.tryDrop(r2, 2, 2);
game.tryDrop(r3, 2, 3);
frames(2);
assert('火力网被识别', game._laneDoctrine[2] && game._laneDoctrine[2].id === 'fire', game._laneDoctrine[2] && game._laneDoctrine[2].id);
assert('火力网提高远程伤害', r1.dmg > r1._strategyBaseDmg, r1.dmg + '>' + r1._strategyBaseDmg);

// iOS WebView 回归：奖励页退出后必须恢复同一套 Canvas / DOM 布局尺度。
const scaleBeforeReward = game.scale;
const expectedCanvasW = 390 * 2;
game.openReward();
assert('奖励页进入 REWARD', game.state === STATE.REWARD);
game.pickCard(0);
assert('选卡后回到 PLAY', game.state === STATE.PLAY);
assert('选卡后 scale 保持手机布局', Math.abs(game.scale - scaleBeforeReward) < 0.001, game.scale + ' vs ' + scaleBeforeReward);
assert('选卡后 px 与 scale×DPR 一致', Math.abs(game.px - game.scale * game.dpr) < 0.001, game.px + ' vs ' + (game.scale * game.dpr));
assert('选卡后 Canvas 恢复完整宽度', game.canvas.width === expectedCanvasW, game.canvas.width + ' vs ' + expectedCanvasW);
for (const u of game.units) {
  const ex = game.L.gridX + (u.col + 0.5) * game.L.cellW;
  const ey = game.L.gridY + (u.row + 0.5) * game.L.cellH;
  assert('选卡后单位格子坐标同步', Math.abs(u.x - ex) < 0.01 && Math.abs(u.y - ey) < 0.01, u.type + ':' + u.x + ',' + u.y);
}

assert('无运行时 console/jsdom 错误', errors.length === 0, errors.join(' | '));
console.log('\nstrategy smoke: all checks passed');
