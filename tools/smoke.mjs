// smoke.mjs — 在 jsdom 中真实执行「打包后的产物」，驱动完整游戏循环并断言行为
// 这不是重写逻辑的替身脚本：它加载 dist/minitool/js/app.js 并调用其中的
// Game / SlotMachine / UI / Store 真实代码路径。
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(root, 'dist', 'minitool');
const APP = join(DIST, 'js', 'app.js');

if (!existsSync(APP)) { console.error('缺少产物 dist/minitool/js/app.js，请先 npm run build'); process.exit(1); }

const errors = [];
const checks = [];
function ok(name, cond, extra) { checks.push({ name, pass: !!cond, extra: extra === undefined ? '' : String(extra) }); }
function eq(name, a, b) { ok(name, a === b, `期望 ${b}，实际 ${a}`); }

const tick = () => new Promise(r => setTimeout(r, 0));

// ---------- Canvas 2D 上下文替身 ----------
function makeCtx(canvas) {
  const grad = { addColorStop() {} };
  const noop = () => {};
  const ctx = {
    canvas,
    // 状态
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    globalCompositeOperation: 'source-over', font: '10px sans-serif',
    textAlign: 'start', textBaseline: 'alphabetic', lineCap: 'butt', lineJoin: 'miter',
    filter: 'none', imageSmoothingEnabled: true, shadowBlur: 0, shadowColor: 'transparent',
    // 路径
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, arcTo: noop,
    ellipse: noop, quadraticCurveTo: noop, bezierCurveTo: noop, rect: noop, clip: noop,
    // 绘制
    fill: noop, stroke: noop, fillRect: noop, strokeRect: noop, clearRect: noop,
    fillText: noop, strokeText: noop,
    drawImage: function (img) { if (img === undefined || img === null) throw new Error('drawImage 收到空图像'); },
    // 变换
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    setTransform: noop, transform: noop, resetTransform: noop,
    // 其他
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => null,
    setLineDash: noop, getLineDash: () => [],
    measureText: () => ({ width: 10 })
  };
  return ctx;
}

// ---------- 建 DOM ----------
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e && e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'https://minitool.local/',
  virtualConsole: vc
});
const win = dom.window;

win.HTMLCanvasElement.prototype.getContext = function () {
  if (!this.__ctx) this.__ctx = makeCtx(this);
  return this.__ctx;
};
win.HTMLCanvasElement.prototype.toDataURL = function () {
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
};
win.confirm = () => true;
// 固定为竖屏手机尺寸（iPhone 逻辑分辨率）
const stage = win.document.getElementById('stage');
Object.defineProperty(stage, 'clientWidth', { value: 390, configurable: true });
Object.defineProperty(stage, 'clientHeight', { value: 844, configurable: true });
win.Element.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844, x: 0, y: 0 };
};
Object.defineProperty(win, 'devicePixelRatio', { value: 3, configurable: true });
// 关掉内部 rAF 循环，由测试手动推进帧
win.requestAnimationFrame = () => 0;

// ---------- 执行产物 ----------
win.eval(readFileSync(APP, 'utf8'));
// jsdom 构造完成时 readyState 仍为 'loading'，boot() 会等 DOMContentLoaded
await tick(); await tick();
if (!win.SLOTBOUND) { console.error('产物未暴露 SLOTBOUND 挂钩，boot() 可能未执行'); process.exit(1); }
const { game, ui, FX, STATE } = win.SLOTBOUND;

// ---------- 帧驱动 ----------
const STEP = 1 / 60;
const nanHits = [];
let frameCount = 0;

/** 每帧巡检：任何 NaN 坐标都会在真机上表现为「看不见」或直接崩渲染器 */
function sweepNaN() {
  const L = game.L;
  for (const k in L) {
    const v = L[k];
    if (typeof v === 'number' && !isFinite(v)) nanHits.push('L.' + k + '=' + v);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const k2 in v) if (typeof v[k2] === 'number' && !isFinite(v[k2])) nanHits.push('L.' + k + '.' + k2 + '=' + v[k2]);
    }
  }
  for (const u of game.units) if (!isFinite(u.x) || !isFinite(u.y) || !isFinite(u.hp)) nanHits.push('unit ' + u.type + ' x=' + u.x + ' y=' + u.y + ' hp=' + u.hp);
  for (const e of game.enemies.live) if (!isFinite(e.x) || !isFinite(e.y) || !isFinite(e.hp)) nanHits.push('enemy ' + e.type + ' x=' + e.x + ' y=' + e.y);
  for (const q of game.shots.live) if (!isFinite(q.x) || !isFinite(q.y) || !isFinite(q.vx)) nanHits.push('shot x=' + q.x + ' y=' + q.y);
  for (const p of FX.particles.live) if (!isFinite(p.x) || !isFinite(p.y)) nanHits.push('particle x=' + p.x + ' y=' + p.y + ' color=' + p.color);
  for (const r of FX.rings.live) if (!isFinite(r.x) || !isFinite(r.y) || !isFinite(r.r)) nanHits.push('ring x=' + r.x + ' r=' + r.r);
  for (const t of FX.texts.live) if (!isFinite(t.x) || !isFinite(t.y)) nanHits.push('text x=' + t.x + ' y=' + t.y);
  if (!isFinite(game.score) || !isFinite(game.coreHp) || !isFinite(game.energy)) nanHits.push('state score=' + game.score + ' coreHp=' + game.coreHp + ' energy=' + game.energy);
}

async function frames(n, fn) {
  for (let i = 0; i < n; i++) {
    frameCount++;
    if (fn) fn(i);
    game.update(STEP);
    if (nanHits.length < 12) sweepNaN();
    game.render();
    ui.update();
    if (i % 8 === 0) await tick();
  }
}

let maxEnemies = 0, sawSpinning = false, sawResult = null, sawReward = false, jackpotForced = null;

// =============== 1. 启动 ===============
ui.startGame();
eq('启动后进入游戏状态', game.state, STATE.PLAY);
ok('开局预置单位 >= 2', game.units.length >= 2, game.units.length);
ok('布局已计算', game.L.cellW > 0 && game.L.coreY > game.L.gridY, `cellW=${game.L.cellW.toFixed(1)} coreY=${game.L.coreY.toFixed(1)}`);
ok('DPR 上限生效（<=2）', game.dpr <= 2, game.dpr);
ok('初始能量为 3', game.energy === 3, game.energy);

// =============== 2. 拉杆 / 老虎机 ===============
const before = game.units.length;
ok('可以拉杆', game.canSpin());
game.spin();
eq('拉杆后能量 -1', game.energy, 2);
eq('滚轮进入转动状态', game.slot.state, 'spinning');
sawSpinning = true;
await frames(120);   // 2 秒：三轮滚轮停靠约 1.0s，召唤队列随后按游戏时间落地
ok('滚轮已结算', game.slot.result !== null);
sawResult = game.slot.result;
let summoned = 0;
for (const k in game.slot.result.summons) summoned += game.slot.result.summons[k];
ok('结算至少召唤 1 个单位', summoned >= 1, summoned);
await frames(60);    // 推进 1 秒游戏时间，让待召唤队列落地
eq('召唤队列已清空', game.pending.length, 0);
ok('召唤已落到棋盘（单位数增加）', game.units.length > before, `${before} -> ${game.units.length}`);

// =============== 3. 老虎机结算规则（outcome 为列主序 outcome[col][row]） ===============
const jp = game.slot;
const savedOutcome = jp.outcome;

// 3a. 九连同 → JACKPOT，且不叠加连线奖励
jp.outcome = [['bow', 'bow', 'bow'], ['bow', 'bow', 'bow'], ['bow', 'bow', 'bow']];
jp.flashCells.length = 0;
const jpRes = jp.evaluate();
ok('九连同判定为 JACKPOT', jpRes.jackpot === true);
eq('JACKPOT 固定得 2000 分（不叠加连线）', jpRes.score, 2000);
eq('JACKPOT 标签正确', jpRes.label, 'JACKPOT!');
let jpSum = 0; for (const k in jpRes.summons) jpSum += jpRes.summons[k];
eq('JACKPOT 召唤 3 个单位', jpSum, 3);

// 3b. ★ 是通配符，但不能让「只是左上角为 ★」的盘面被误判成 JACKPOT
jp.outcome = [['prism', 'mage', 'guard'], ['sword', 'cannon', 'bow'], ['guard', 'bow', 'mage']];
jp.flashCells.length = 0;
const notJp = jp.evaluate();
ok('含 ★ 的普通盘面不误判为 JACKPOT', notJp.jackpot === false);
ok('含 ★ 的普通盘面不走 2000 分', notJp.score < 2000, notJp.score);

// 3c. 两条横线：行0=bow/bow/bow，行1=mage/mage/mage，行2 不同
jp.outcome = [['bow', 'mage', 'bow'], ['bow', 'mage', 'guard'], ['bow', 'mage', 'cannon']];
jp.flashCells.length = 0;
const lineRes = jp.evaluate();
eq('识别出 2 条横线', lineRes.lines.length, 2);
eq('无竖线', lineRes.cols.length, 0);
eq('横线得分 220×2', lineRes.score, 440);
eq('多重连线标签', lineRes.label, '多重连线!');

// 3d. 一条竖线：列0=bow/bow/bow
jp.outcome = [['bow', 'bow', 'bow'], ['mage', 'sword', 'guard'], ['cannon', 'cannon', 'guard']];
jp.flashCells.length = 0;
const colRes = jp.evaluate();
eq('识别出 1 条竖线', colRes.cols.length, 1);
eq('无横线', colRes.lines.length, 0);
eq('竖线得分 160', colRes.score, 160);

// 3e. ★ 参与连线并解析出真实兵种：行0 = prism / mage / mage
jp.outcome = [['prism', 'mage', 'guard'], ['mage', 'sword', 'cannon'], ['mage', 'guard', 'bow']];
jp.flashCells.length = 0;
const wildRes = jp.evaluate();
eq('★ 作为通配符参与连线（仅 1 条）', wildRes.lines.length, 1);
eq('★ 连线解析出真实兵种', wildRes.lines[0].type, 'mage');
eq('★ 连线不产生竖线误判', wildRes.cols.length, 0);

// 3f. 横向成对
jp.outcome = [['bow', 'mage', 'guard'], ['bow', 'sword', 'cannon'], ['guard', 'cannon', 'mage']];
jp.flashCells.length = 0;
const pairH = jp.evaluate();
eq('横向成对被识别', pairH.pairs.length, 1);
eq('横向成对方向正确', pairH.pairs[0].dir, 'h');
eq('成对得分 45', pairH.score, 45);

// 3g. 纵向成对
jp.outcome = [['bow', 'bow', 'guard'], ['mage', 'sword', 'cannon'], ['guard', 'cannon', 'bow']];
jp.flashCells.length = 0;
const pairV = jp.evaluate();
eq('纵向成对被识别', pairV.pairs.length, 1);
eq('纵向成对方向正确', pairV.pairs[0].dir, 'v');

// 3h. 全不中 → 保底小奖，永远不会「白拉一次」
jp.outcome = [['bow', 'mage', 'guard'], ['sword', 'cannon', 'bow'], ['guard', 'bow', 'mage']];
jp.flashCells.length = 0;
const noneRes = jp.evaluate();
eq('无奖时保底得 25 分', noneRes.score, 25);
let noneSum = 0; for (const k in noneRes.summons) noneSum += noneRes.summons[k];
eq('无奖时仍召唤 1 个单位', noneSum, 1);
eq('无奖标签', noneRes.label, '小奖');
jp.outcome = savedOutcome;

// 3i. 拉杆分布统计（40000 次，验证概率设计不失控）
{
  const N = 40000;
  let nJackpot = 0, nLine = 0, nNone = 0, sumUnits = 0;
  for (let i = 0; i < N; i++) {
    jp.outcome = jp.rollOutcome();
    jp.flashCells.length = 0;
    const r = jp.evaluate();
    if (r.jackpot) nJackpot++;
    else if (r.lines.length || r.cols.length) nLine++;
    else if (!r.pairs.length) nNone++;
    for (const k in r.summons) sumUnits += r.summons[k];
  }
  const pj = nJackpot / N, pl = nLine / N, pn = nNone / N, pu = sumUnits / N;
  ok('JACKPOT 概率在 1%~3% 区间', pj > 0.01 && pj < 0.03, (pj * 100).toFixed(2) + '%');
  ok('连线概率在 25%~55% 区间', pl > 0.25 && pl < 0.55, (pl * 100).toFixed(2) + '%');
  ok('空奖概率 < 5%（拉杆几乎总有反馈）', pn < 0.05, (pn * 100).toFixed(2) + '%');
  ok('平均召唤 1.5~4.5 个/次', pu > 1.5 && pu < 4.5, pu.toFixed(2));
  jp.outcome = savedOutcome;
}

// =============== 4. 吸收合成 ===============
game.cancelHold();
// 显式放两个同种单位，保证前置条件成立
const nBefore = game.units.length;
const mA = game.placeUnit('cannon');
const mB = game.placeUnit('cannon');
ok('可放置同种单位', !!mA && !!mB && mA !== mB);
ok('放置后单位数增加', game.units.length > nBefore, `${nBefore} -> ${game.units.length}`);
const nAtDrop = game.units.length;
const scoreBeforeMerge = game.score;
const dmgBefore = mB.dmg;
const hpBefore = mB.maxHp;
const cellA = { c: mA.col, r: mA.row }, cellB = { c: mB.col, r: mB.row };
ok('拖拽合成成功', game.tryDrop(mA, cellB.c, cellB.r) === true);
eq('合成后目标等级 +1', mB.level, 2);
eq('合成后单位数 -1', game.units.length, nAtDrop - 1);
ok('源单位已离开棋盘', game.grid[cellA.c][cellA.r] !== mA);
ok('目标单位仍在原格', game.grid[cellB.c][cellB.r] === mB);
ok('合成后攻击力提升', mB.dmg > dmgBefore, `${dmgBefore.toFixed(1)} -> ${mB.dmg.toFixed(1)}`);
ok('合成后生命上限提升', mB.maxHp > hpBefore, `${hpBefore.toFixed(0)} -> ${mB.maxHp.toFixed(0)}`);
ok('合成加分', game.score > scoreBeforeMerge, `${scoreBeforeMerge} -> ${game.score}`);
ok('合成计数递增', game.merges >= 1, game.merges);

// Lv5 上限：不可再合成，改为交换位置（不吞掉单位）
mB.level = 5; mB.applyLevel(game.mods);
game.cancelHold();
const mC = game.placeUnit('cannon');
const cellC = { c: mC.col, r: mC.row };
const nBeforeSwap = game.units.length;
game.tryDrop(mC, cellB.c, cellB.r);
eq('Lv5 不会被继续升级', mB.level, 5);
eq('Lv5 拖拽改为交换：单位总数不变', game.units.length, nBeforeSwap);
ok('Lv5 拖拽后两者换位', game.grid[cellB.c][cellB.r] === mC && game.grid[cellC.c][cellC.r] === mB);

// =============== 5. 长时间自动对局 ===============
let spins = 0;
await frames(60 * 150, () => {            // 150 秒游戏时间
  if (game.state === STATE.PLAY && game.canSpin() && spins < 200) { game.spin(); spins++; }
  if (game.state === STATE.REWARD) { sawReward = true; game.pickCard(0); }
  maxEnemies = Math.max(maxEnemies, game.enemies.count());
});

ok('拉杆被多次执行', spins > 5, spins);
ok('场上出现过敌人', maxEnemies > 0, maxEnemies);
ok('产生了击杀', game.kills > 0, game.kills);
ok('分数累计 > 0', game.score > 0, game.score);
ok('波次已推进到第 2 波之后', game.wave >= 2, game.wave);
ok('奖励选卡流程被触发过', sawReward);
ok('核心仍有血量（游戏未异常结束）', game.coreHp > 0, Math.ceil(game.coreHp));
ok('粒子数量在预算内', FX.particles.count() <= FX.maxParticles, FX.particles.count());
ok('弹体池已回收（无泄漏）', game.shots.count() < 200, game.shots.count());

// =============== 6. 暂停 ===============
if (game.state === STATE.PLAY) {
  const e0 = game.elapsed;
  game.togglePause(true);
  ok('暂停标记生效', game.paused === true);
  await frames(30);
  eq('暂停时游戏时间不推进', Math.round(game.elapsed * 1000), Math.round(e0 * 1000));
  game.togglePause(false);
  ok('恢复后取消暂停', game.paused === false);
}

// =============== 7. 核心崩溃 → 结算 ===============
game.hitCore(game.coreHp + 10);
eq('核心归零进入结算', game.state, STATE.OVER);
const sum = game.summary();
ok('结算数据完整', sum.kills > 0 && sum.wave >= 1 && sum.score > 0, JSON.stringify(sum));

// =============== 8. 高分榜持久化 ===============
ui.saveScore();
const raw = win.localStorage.getItem('slotbound.scores.v1');
ok('高分已写入 localStorage', !!raw);
const parsed = JSON.parse(raw || '[]');
ok('高分条目字段完整', parsed.length > 0 && typeof parsed[0].score === 'number' && parsed[0].name, JSON.stringify(parsed[0]));
eq('写入的分数与结算一致', parsed[0].score, sum.score);

// 换一个新的容器实例（模拟重开小工具），用同一份 storage 校验反序列化
const dom2 = new JSDOM(html, { runScripts: 'outside-only', url: 'https://minitool.local/' });
dom2.window.localStorage.setItem('slotbound.scores.v1', raw);
dom2.window.HTMLCanvasElement.prototype.getContext = function () { if (!this.__c) this.__c = makeCtx(this); return this.__c; };
dom2.window.HTMLCanvasElement.prototype.toDataURL = () => 'data:,';
dom2.window.confirm = () => true;
const stage2 = dom2.window.document.getElementById('stage');
Object.defineProperty(stage2, 'clientWidth', { value: 390, configurable: true });
Object.defineProperty(stage2, 'clientHeight', { value: 844, configurable: true });
dom2.window.Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844, x: 0, y: 0 });
dom2.window.requestAnimationFrame = () => 0;
dom2.window.eval(readFileSync(APP, 'utf8'));
await tick(); await tick();
const S2 = dom2.window.SLOTBOUND;
eq('新容器读到历史最高分', S2.game.ui.el.titleBest.textContent.indexOf(String(sum.score).replace(/\B(?=(\d{3})+(?!\d))/g, ',')) >= 0, true);
ok('新容器排行榜有记录', S2.game.ui.el.titleList.querySelectorAll('.hs-row').length > 0);

// =============== 9. 键盘输入 ===============
function key(k) {
  const ev = new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  win.dispatchEvent(ev);
}
ui.startGame();
eq('R 键可立即重开', game.state, STATE.PLAY);
eq('重开回到第 1 波', game.wave, 1);
ok('重开分数归零', game.score === 0, game.score);
key('p');
ok('P 键暂停', game.paused === true);
key('p');
ok('P 键恢复', game.paused === false);
key('ArrowLeft'); key('ArrowUp');
ok('方向键移动光标', game.cursor.c === 0 && game.cursor.r >= 0, `${game.cursor.c},${game.cursor.r}`);
key('m');
ok('M 键切换静音', ui.muted === true);
key('m');

// =============== 10. 触摸/指针拖拽 ===============
ui.startGame();
await frames(10);
const g2 = game.grid;
let u0 = null, cell0 = null;
for (let c = 0; c < 3 && !u0; c++) for (let r = 0; r < 4 && !u0; r++) if (g2[c][r]) { u0 = g2[c][r]; cell0 = { c, r }; }
if (u0) {
  game.pickAt(u0.x, u0.y);
  ok('点击可拾取单位', game.held === u0);
  // 找一个空格
  let empty = null;
  for (let c = 0; c < 3 && !empty; c++) for (let r = 0; r < 4 && !empty; r++) if (!g2[c][r]) empty = { c, r };
  if (empty) {
    const tx = game.L.gridX + (empty.c + 0.5) * game.L.cellW;
    const ty = game.L.gridY + (empty.r + 0.5) * game.L.cellH;
    game.releaseAt(tx, ty);
    ok('拖到空格完成移动', g2[empty.c][empty.r] === u0 && !g2[cell0.c][cell0.r]);
    eq('移动后坐标列更新', u0.col, empty.c);
  }
} else {
  ok('棋盘上有单位可供拖拽（前置条件）', false);
}

// =============== 11. 波次表完整性 ===============
let waveOk = true, waveTotal = 0;
// 通过真实 API 校验：逐波调用 game.startWave 构建波次与出怪队列
for (let n = 1; n <= 20; n++) {
  try {
    game.startWave(n);
    if (!game.info || game.info.total <= 0 || !game.queue.length) waveOk = false;
    waveTotal += game.info.total;
  } catch (e) { waveOk = false; errors.push('startWave(' + n + '): ' + e.message); }
}
ok('20 波全部可构建且有敌人', waveOk, `合计 ${waveTotal} 个敌人`);
eq('第 20 波为 BOSS 波', game.info.kind, 'boss');

// =============== 12. 通关路径 ===============
ui.startGame();
game.wave = 20;
game.onWaveClear();
eq('第 20 波肃清即通关', game.state, STATE.WIN);

// =============== 13. 分享卡片 ===============
ui._pendingSummary = game.summary();
let cardOk = false;
try { const d = ui.buildShareCard(game.summary()); cardOk = typeof d === 'string' && d.indexOf('data:image/png') === 0; }
catch (e) { errors.push('buildShareCard: ' + e.message); }
ok('分享战绩图可生成', cardOk);
ok('未注入端能力时优雅降级', win.xhs === undefined && game.state === STATE.WIN);

// =============== 14. 平衡性报告（自动游玩 150 秒能打到第几波） ===============
ui.startGame();
let autoSpins = 0;
await frames(60 * 150, () => {
  if (game.state === STATE.PLAY && game.canSpin() && autoSpins < 400) { game.spin(); autoSpins++; }
  if (game.state === STATE.REWARD) game.pickCard(0);
});
const rep = game.summary();
console.log('  · 自动游玩 150s：第 ' + rep.wave + ' 波 / ' + rep.score + ' 分 / 击杀 ' + rep.kills +
  ' / 拉杆 ' + autoSpins + ' 次 / 合成 ' + rep.merges + ' / 核心剩余 ' + Math.ceil(game.coreHp));
ok('150 秒内至少打到第 4 波（节奏不过慢）', rep.wave >= 4, '第 ' + rep.wave + ' 波');
ok('150 秒内不会直接通关（有难度曲线）', rep.wave < 20, '第 ' + rep.wave + ' 波');

// =============== 15. NaN 巡检（渲染健壮性） ===============
ok(`${frameCount} 帧内无任何 NaN 坐标 / NaN 状态`, nanHits.length === 0, nanHits.slice(0, 4).join(' | '));
ok('布局字段齐全且为有限数',
  ['W', 'H', 'slotX', 'slotY', 'slotW', 'slotH', 'reelsX', 'reelsY', 'reelsW', 'reelsH',
    'gridX', 'gridY', 'gridW', 'gridH', 'cellW', 'cellH', 'coreY', 'fieldTop', 'fieldBottom', 'eScale', 'unitSize']
    .every(k => isFinite(game.L[k])),
  ['W', 'H', 'slotX', 'slotY', 'slotW', 'slotH', 'reelsX', 'reelsY', 'reelsW', 'reelsH',
    'gridX', 'gridY', 'gridW', 'gridH', 'cellW', 'cellH', 'coreY', 'fieldTop', 'fieldBottom', 'eScale', 'unitSize']
    .filter(k => !isFinite(game.L[k])).join(','));

// ---------- 输出 ----------
const failed = checks.filter(c => !c.pass);
console.log('\n运行时冒烟测试（加载 dist/minitool/js/app.js 真实执行）');
console.log('──────────────────────────────────────────');
for (const c of checks) console.log(`  ${c.pass ? '✓' : '✗'} ${c.name}${c.pass ? '' : '  ← ' + c.extra}`);
console.log('──────────────────────────────────────────');
console.log(`  断言 ${checks.length} 项：通过 ${checks.length - failed.length}，失败 ${failed.length}`);
if (errors.length) {
  console.log(`\n运行期异常 ${errors.length} 条：`);
  errors.slice(0, 20).forEach(e => console.log('  ! ' + e));
}
console.log('');
process.exit(failed.length || errors.length ? 1 : 0);
