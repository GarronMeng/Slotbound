// strategy-smoke.mjs — v1.2 自动吸收 / 五人主力 / 阵型 / 高压车道 / 安全区运行验证
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
function mass(u) { return u._absorbMass === undefined ? Math.pow(2, u.level - 1) : u._absorbMass; }
function active() { return game.units.filter(u => u && !u.dead); }

ui.startGame();
assert('进入 PLAY', game.state === STATE.PLAY);
assert('策略层已安装', Array.isArray(game._laneDoctrine));
assert('五人主力上限默认生效', game.mods.boardCap === 5, game.mods.boardCap);
assert('安全区 v3 已安装', game.L.safeAreaVersion === 3, game.L.safeAreaVersion);
assert('战场顶部位于 HUD 下方', game.L.fieldTop >= 132, game.L.fieldTop);

const probe = game.spawnEnemy('grunt', 0, game.L.fieldTop - 200, 1, 1);
const probeRadius = probe.r * game.L.eScale;
assert('怪物出生时完整身体位于安全区内', probe.y - probeRadius >= game.L.fieldTop + 10,
  `top=${(probe.y - probeRadius).toFixed(1)} fieldTop=${game.L.fieldTop.toFixed(1)}`);
const probeIdx = game.enemies.live.indexOf(probe);
if (probeIdx >= 0) { game.enemies.live.splice(probeIdx, 1); game.enemies.free.push(probe); }

game.startWave(7);
assert('高压车道已生成', game._pressureLane >= 0 && game._pressureLane <= 2, game._pressureLane);
let pressure = 0;
for (const q of game.queue) if (q.lane === game._pressureLane) pressure++;
assert('高压车道敌人占比明显更高', pressure / Math.max(1, game.queue.length) >= 0.45, pressure + '/' + game.queue.length);

// 同兵种新兵不再占格：4 个 Lv1 炮手直接收敛成 1 个 Lv3。
clearUnits();
for (let i = 0; i < 4; i++) game.placeUnit('cannon');
const cannons = active().filter(u => u.type === 'cannon');
assert('重复兵种立即自动吸收', cannons.length === 1, cannons.length);
assert('4×Lv1 质量守恒到 Lv3', cannons[0].level === 3 && mass(cannons[0]) === 4,
  `lv=${cannons[0].level} mass=${mass(cannons[0])}`);

// 不同等级也能吸收且保留进度：再来 2 个 Lv1，只会把 Lv3 的质量从4推到6，不会粗暴跳级。
game.placeUnit('cannon');
game.placeUnit('cannon');
assert('跨等级自动吸收不新增格子', active().length === 1, active().length);
assert('跨等级吸收保留部分进度', cannons[0].level === 3 && mass(cannons[0]) === 6,
  `lv=${cannons[0].level} mass=${mass(cannons[0])}`);

// 五人满编后，第六种兵种作为材料，而不是占满第六格。
clearUnits();
const five = ['guard', 'sword', 'bow', 'mage', 'cannon'];
for (const t of five) game.placeUnit(t);
assert('五种主力组成 5/5', active().length === 5, active().length);
const totalBefore = active().reduce((s, u) => s + mass(u), 0);
game.placeUnit('prism');
const totalAfter = active().reduce((s, u) => s + mass(u), 0);
assert('满编后新兵不再占格', active().length === 5, active().length);
assert('满编材料完整转为成长质量', totalAfter === totalBefore + 1, `${totalBefore}->${totalAfter}`);

// 同兵种在满编时优先喂对应主力。
const guard = active().find(u => u.type === 'guard');
const guardBefore = mass(guard);
game.placeUnit('guard');
assert('同兵种材料优先喂对应主力', mass(guard) === guardBefore + 1, `${guardBefore}->${mass(guard)}`);
assert('自动吸收后仍保持 5 人', active().length === 5, active().length);

// 扩编核心把上限提高到6；随后缺失的棱晶可以真正入场。
game.mods.boardCap = 6;
game.placeUnit('prism');
assert('扩编后允许第6名主力', active().length === 6, active().length);
assert('第6名可为新兵种', active().some(u => u.type === 'prism'));

// 阵型仍可用：盾卫前排 + 远程后排。
clearUnits();
game.mods.boardCap = 5;
const g = game.placeUnit('guard');
const b = game.placeUnit('bow');
if (g.col !== 1 || g.row !== 0) game.tryDrop(g, 1, 0);
if (b.col !== 1 || b.row !== 3) game.tryDrop(b, 1, 3);
frames(2);
assert('盾阵被识别', game._laneDoctrine[1] && game._laneDoctrine[1].id === 'wall', game._laneDoctrine[1] && game._laneDoctrine[1].id);
assert('盾卫获得减伤', g._formationTaken < 1, g._formationTaken);
assert('后排获得攻速', b.rate < b._strategyBaseRate, b.rate + '<' + b._strategyBaseRate);

// 火力网仍由不同远程兵种组成，不依赖重复单位。
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

// 奖励页退出后继续验证 iOS 布局恢复。
const scaleBeforeReward = game.scale;
const expectedCanvasW = 390 * 2;
game.openReward();
assert('奖励页进入 REWARD', game.state === STATE.REWARD);
game.pickCard(0);
assert('选卡后回到 PLAY', game.state === STATE.PLAY);
assert('选卡后 scale 保持手机布局', Math.abs(game.scale - scaleBeforeReward) < 0.001, game.scale + ' vs ' + scaleBeforeReward);
assert('选卡后 px 与 scale×DPR 一致', Math.abs(game.px - game.scale * game.dpr) < 0.001, game.px + ' vs ' + (game.scale * game.dpr));
assert('选卡后 Canvas 恢复完整宽度', game.canvas.width === expectedCanvasW, game.canvas.width + ' vs ' + expectedCanvasW);
for (const u of active()) {
  const ex = game.L.gridX + (u.col + 0.5) * game.L.cellW;
  const ey = game.L.gridY + (u.row + 0.5) * game.L.cellH;
  assert('选卡后单位格子坐标同步', Math.abs(u.x - ex) < 0.01 && Math.abs(u.y - ey) < 0.01, u.type + ':' + u.x + ',' + u.y);
}

assert('无运行时 console/jsdom 错误', errors.length === 0, errors.join(' | '));
console.log('\nstrategy smoke: all checks passed');
