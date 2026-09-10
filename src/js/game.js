// game.js — 主游戏：布局 / 状态机 / 战斗 / 渲染
'use strict';

import { clamp, RNG, TAU, lerp, Pool, fmtInt, fmtCompact, makeCanvas } from './util.js';
import { C, Atlas, UNITS, UNIT_TYPES, FONT, roundRect, glowCircle } from './theme.js';
import { FX } from './fx.js';
import { Sfx, Music } from './audio.js';
import { Unit, Enemy, makeShot, updateShot, drawShot, glowKey } from './entities.js';
import { SlotMachine } from './slots.js';
import { waveInfo, buildSpawnQueue, TOTAL_WAVES, rollCards, defaultMods } from './waves.js';

export var STATE = { TITLE: 0, PLAY: 1, PAUSE: 2, REWARD: 3, OVER: 4, WIN: 5 };

var GRID_COLS = 3, GRID_ROWS = 4;

// 前排偏好：近战/肉盾靠前，远程靠后
var ROW_PREF = { guard: 0, sword: 1, mage: 2, bow: 3, cannon: 3, prism: 2 };

export function Game(canvas, ui) {
  this.canvas = canvas;
  this.ctx = canvas.getContext('2d');
  this.ui = ui;
  this.font = FONT;
  this.L = {};
  this.state = STATE.TITLE;
  this.paused = false;
  this.dpr = 1;
  this.scale = 1;
  this.ox = 0; this.oy = 0;
  this.t = 0;
  this.stars = [];
  this.bg = null;

  this.enemies = new Pool(function () { return new Enemy('grunt', 0, 0); }, null, 24);
  this.shots = new Pool(makeShot, null, 60);
  this.units = [];
  this.grid = [];
  for (var c = 0; c < GRID_COLS; c++) { this.grid.push([null, null, null, null]); }

  this.mods = defaultMods();
  this.ownedCards = {};
  this.slot = new SlotMachine(this);

  this.held = null;
  this.cursor = { c: 1, r: 3 };
  this.showCursor = false;
  this.resultFlash = 0;
  this.banner = null;
  this.toasts = [];
  this.pending = [];
  this.slowMo = 0;
  this.qualityDropT = 0;
  this.frameAcc = 0; this.frameN = 0; this.fps = 60;

  this.reset();
}

// ================= 布局 =================
Game.prototype.resize = function (cw, ch, dpr) {
  var W = 540;
  var s1 = cw / W;
  var h1 = ch / s1;
  var H, scale, ox = 0, oy = 0;
  if (h1 > 1260) { H = 1260; scale = ch / H; ox = (cw - W * scale) / 2; }
  else if (h1 < 780) { H = 780; scale = ch / H; ox = (cw - W * scale) / 2; }
  else { H = h1; scale = s1; }

  this.dpr = dpr;
  this.scale = scale;
  this.ox = ox; this.oy = oy;
  this.canvas.width = Math.max(1, Math.round(cw * dpr));
  this.canvas.height = Math.max(1, Math.round(ch * dpr));
  this.px = scale * dpr;

  var L = this.L;
  L.W = W; L.H = H;
  L.scale = scale;

  // 底部老虎机面板
  L.slotH = 344;
  L.slotW = W - 24;
  L.slotX = 12;
  L.slotY = H - L.slotH - 10;
  L.slotPad = 16;
  L.slotCX = L.slotX + L.slotW / 2;

  // 滚轮
  L.reelsW = 234;
  L.reelsH = 234;
  L.reelsX = L.slotX + 18;
  L.reelsY = L.slotY + 48;

  // 拉杆按钮（DOM 覆盖层，坐标为逻辑坐标）
  L.spinBtn = { x: L.slotX + L.slotW - 18 - 108, y: L.reelsY + 24, w: 108, h: 108 };

  // 战场（顶部让出 HUD 高度，格子放大、行军区收紧）
  L.fieldTop = 100;
  L.fieldBottom = L.slotY - 12;
  L.fieldH = L.fieldBottom - L.fieldTop;
  L.gridX = 14;
  L.gridW = W - 28;
  L.cellW = L.gridW / GRID_COLS;
  L.cellH = Math.min(L.cellW * 0.82, 122);
  L.gridH = L.cellH * GRID_ROWS;
  L.gridY = L.fieldBottom - L.gridH;
  L.coreY = L.gridY + L.gridH;
  L.unitSize = Math.min(L.cellW * 0.6, L.cellH * 0.88);
  L.eScale = Math.min(L.cellW, L.cellH * 1.22);

  this.buildBackground();
  this.buildGradients();
  if (this.ui && this.ui.syncOverlay) this.ui.syncOverlay();
};

/** 预建可复用渐变（避免逐帧 createLinearGradient） */
Game.prototype.buildGradients = function () {
  var ctx = this.ctx, L = this.L;
  var g = this._grads || (this._grads = {});

  g.slotBody = ctx.createLinearGradient(0, L.slotY - L.slotPad, 0, L.slotY + L.slotH + L.slotPad);
  g.slotBody.addColorStop(0, '#3a2464');
  g.slotBody.addColorStop(0.5, C.bg1);
  g.slotBody.addColorStop(1, '#150c2b');

  function coreGrad(color) {
    var c = ctx.createLinearGradient(0, L.coreY - 10, 0, L.coreY + 8);
    c.addColorStop(0, 'rgba(255,255,255,0)');
    c.addColorStop(0.5, color);
    c.addColorStop(1, 'rgba(255,255,255,0)');
    return c;
  }
  g.core = [
    coreGrad('rgba(87,255,154,0.55)'),
    coreGrad('rgba(255,207,77,0.60)'),
    coreGrad('rgba(255,77,94,0.70)')
  ];
  this._vigCache = {};
};

Game.prototype.buildBackground = function () {
  var L = this.L;
  this.stars.length = 0;
  for (var i = 0; i < 46; i++) {
    this.stars.push({
      x: RNG.range(0, L.W), y: RNG.range(0, L.H),
      r: RNG.range(0.8, 2.4), ph: RNG.range(0, TAU), sp: RNG.range(0.4, 1.4)
    });
  }
  // 预渲染静态底
  var c = makeCanvas(Math.ceil(L.W), Math.ceil(L.H));
  var x = c.getContext('2d');
  var g = x.createLinearGradient(0, 0, 0, L.H);
  g.addColorStop(0, '#150b2b');
  g.addColorStop(0.42, C.bg1);
  g.addColorStop(1, C.bg0);
  x.fillStyle = g;
  x.fillRect(0, 0, L.W, L.H);
  // 顶部光晕
  glowCircle(x, L.W * 0.5, L.H * 0.06, L.W * 0.85, 'rgba(120,60,200,0.30)', 1);
  glowCircle(x, L.W * 0.12, L.H * 0.55, L.W * 0.5, 'rgba(255,61,129,0.10)', 1);
  glowCircle(x, L.W * 0.9, L.H * 0.78, L.W * 0.5, 'rgba(41,224,255,0.09)', 1);
  // 暗角
  var v = x.createRadialGradient(L.W / 2, L.H / 2, L.H * 0.28, L.W / 2, L.H / 2, L.H * 0.78);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  x.fillStyle = v;
  x.fillRect(0, 0, L.W, L.H);
  this.bg = c;
};

// ================= 生命周期 =================
Game.prototype.reset = function () {
  var c, r;
  this.enemies.clear();
  this.shots.clear();
  this.units.length = 0;
  for (c = 0; c < GRID_COLS; c++) for (r = 0; r < GRID_ROWS; r++) this.grid[c][r] = null;
  FX.reset();

  this.mods = defaultMods();
  this.ownedCards = {};
  this.score = 0;
  this.displayScore = 0;
  this.combo = 0;
  this.comboT = 0;
  this.bestCombo = 0;
  this.kills = 0;
  this.spins = 0;
  this.merges = 0;
  this.jackpots = 0;
  this.wave = 0;
  this.coreHp = this.mods.coreMax;
  this.coreMax = this.mods.coreMax;
  this.energy = 3;
  this.energyMax = 3;
  this.energyT = 0;
  this.energyRate = 4.2;
  this.queue = [];
  this.spawnT = 0;
  this.waveEnding = false;
  this.endT = 0;
  this.info = null;
  this.held = null;
  this.resultFlash = 0;
  this.banner = null;
  this.toasts.length = 0;
  this.pending = [];
  this.slowMo = 0;
  this.slot.state = 'idle';
  this.slot.result = null;
  this.slot.flashCells.length = 0;
  this.slot.pos = [0, 0, 0];
  this.maxEnemies = 42;
  this.pendingCards = null;
  this.elapsed = 0;
};

Game.prototype.start = function () {
  this.reset();
  this.state = STATE.PLAY;
  this.paused = false;
  // 开局赠送两个单位，保证前 3 秒就有画面
  this.placeUnit('bow');
  this.placeUnit('sword');
  this.startWave(1);
  this.syncEnergy();
  this.ui.onStateChange(this.state);
};

Game.prototype.startWave = function (n) {
  this.wave = n;
  this.info = waveInfo(n);
  this.queue = buildSpawnQueue(this.info, GRID_COLS);
  this.spawnT = 0;
  this.waveEnding = false;
  this.endT = 0;
  var boss = this.info.kind === 'boss';
  this.banner = {
    text: (boss ? '危险 · ' : '') + '第 ' + n + ' 波',
    sub: this.info.name,
    t: 2.0,
    color: boss ? C.red : (this.info.kind === 'swarm' ? C.magenta : C.gold)
  };
  if (boss) { Sfx.bossWarn(); FX.shake(9, 0.6, 26); this.slowMo = 0.7; }
  else Sfx.wave();
  this.ui.onStateChange(this.state);
};

Game.prototype.canSpin = function () {
  return this.state === STATE.PLAY && !this.paused && this.energy >= 1 && this.slot.state !== 'spinning';
};

Game.prototype.syncEnergy = function () {
  this.energyMax = Math.round(this.mods.energyMax);
  this.energyRate = 4.2 / this.mods.energyRate;
  this.energy = Math.min(this.energy, this.energyMax);
};

Game.prototype.spin = function () {
  if (!this.canSpin()) { Sfx.deny(); return false; }
  this.energy -= 1;
  this.spins++;
  this.slot.spin();
  FX.shake(4, 0.16, 60);
  return true;
};

Game.prototype.onSpinResult = function (res) {
  this.resultFlash = 1.6;
  var L = this.L;
  var cx = L.slotCX, cy = L.reelsY + L.reelsH * 0.5;
  if (res.jackpot) {
    this.jackpots++;
    Sfx.jackpot();
    FX.shake(20, 0.75, 34);
    FX.flash(0.85, '#ffe9a8');
    FX.stop(0.12);
    FX.ring(cx, cy, L.W * 0.9, C.gold, 0.8, 9);
    FX.coins(cx, cy, 34);
    FX.text(cx, cy - 40, 'JACKPOT', { color: C.magenta, size: 44, life: 1.5, glow: 1 });
    Music.root = 130.81;
  } else if (res.lines.length || res.cols.length) {
    Sfx.match(Math.min(4, res.lines.length + res.cols.length));
    FX.shake(9, 0.3);
    FX.flash(0.3, '#ffffff');
    FX.ring(cx, cy, L.reelsW * 0.85, C.gold, 0.5, 6);
    FX.coins(cx, cy, 16);
  } else {
    Sfx.match(1);
    FX.shake(3.5, 0.14);
    FX.burst(cx, cy, { count: 12, speed: 190, color: C.gold, life: 0.5, size: 4 });
  }
  this.addScore(res.score, cx, cy - 60, res.jackpot ? C.magenta : C.gold, true);

  // 召唤
  var k, list = [];
  for (k in res.summons) {
    var n = res.summons[k];
    for (var i = 0; i < n; i++) list.push(k);
  }
  var extra = this.mods.extraSummon;
  for (var e = 0; e < extra; e++) list.push(RNG.pick(UNIT_TYPES.slice(0, 5)));

  // 用「游戏时间」排队召唤：暂停 / 掉帧 / 后台都不会让召唤与画面脱节
  for (var si = 0; si < list.length; si++) {
    this.pending.push({ t: 0.10 + si * 0.11, type: list[si] });
  }
};

// ================= 放置 / 合成 =================
Game.prototype.emptyCells = function () {
  var out = [], c, r;
  for (c = 0; c < GRID_COLS; c++) for (r = 0; r < GRID_ROWS; r++) if (!this.grid[c][r]) out.push({ c: c, r: r });
  return out;
};

Game.prototype.placeUnit = function (type, withFx) {
  var L = this.L;
  var empty = this.emptyCells();
  if (empty.length) {
    var pref = ROW_PREF[type] === undefined ? 2 : ROW_PREF[type];
    empty.sort(function (a, b) {
      var da = Math.abs(a.r - pref) + RNG.next() * 0.8;
      var db = Math.abs(b.r - pref) + RNG.next() * 0.8;
      return da - db;
    });
    var cell = empty[0];
    var u = new Unit(type, cell.c, cell.r);
    u.applyLevel(this.mods);
    u.fullHeal();
    if (this.mods.unitRegen) u._regen = 1;
    u.sync(L);
    this.grid[cell.c][cell.r] = u;
    this.units.push(u);
    if (withFx) {
      FX.ring(u.x, u.y, L.cellW * 0.62, u.color, 0.35, 4);
      FX.burst(u.x, u.y, { count: 14, speed: 150, color: u.color, life: 0.45, size: 4 });
      FX.text(u.x, u.y - L.cellH * 0.4, UNITS[type].name, { color: u.color, size: 16, life: 0.7, vy: -50 });
      Sfx.summon();
    }
    return u;
  }
  // 满场：自动吸收同种最低级单位
  var cand = null;
  for (var i = 0; i < this.units.length; i++) {
    var x = this.units[i];
    if (x.type === type && x.level < 5) { if (!cand || x.level < cand.level) cand = x; }
  }
  if (cand) { this.doMerge(cand, cand, true); return cand; }
  this.addScore(120, L.slotCX, L.gridY - 30, C.cyan);
  this.toast('战场已满，转化为分数 +120');
  return null;
};

Game.prototype.doMerge = function (src, dst, auto) {
  var L = this.L;
  if (src === dst) return false;
  if (dst.level >= 5) { Sfx.deny(); this.toast('已达 Lv5 上限'); return false; }
  dst.level++;
  dst.applyLevel(this.mods);
  dst.fullHeal();
  if (this.mods.unitRegen) dst._regen = 1;
  dst.pop = 1.7;
  this.merges++;

  // 移除源
  if (src !== dst) {
    this.grid[src.col][src.row] = null;
    var i = this.units.indexOf(src);
    if (i >= 0) this.units.splice(i, 1);
    if (this.held === src) this.held = null;
    FX.burst(src.x, src.y, { count: 16, speed: 200, color: src.color, life: 0.5, size: 4 });
  }
  // 吸收光束
  FX.ring(dst.x, dst.y, L.cellW * 0.95, dst.color, 0.45, 6);
  FX.ring(dst.x, dst.y, L.cellW * 0.6, '#ffffff', 0.3, 3);
  FX.burst(dst.x, dst.y, { count: 22, speed: 230, colors: [dst.color, '#ffffff'], life: 0.6, size: 5, grav: 120 });
  FX.text(dst.x, dst.y - L.cellH * 0.5, 'Lv' + dst.level + ' ' + dst.name, { color: C.gold, size: 22, life: 1.0, glow: 1 });
  FX.shake(8, 0.25);
  FX.flash(0.16, '#ffffff');
  Sfx.merge(dst.level);
  this.addScore(40 * dst.level, dst.x, dst.y - L.cellH * 0.8, C.gold);
  return true;
};

Game.prototype.tryDrop = function (u, c, r) {
  if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) return false;
  var target = this.grid[c][r];
  if (!target) {
    this.grid[u.col][u.row] = null;
    u.col = c; u.row = r;
    this.grid[c][r] = u;
    u.sync(this.L);
    u.pop = 1.2;
    Sfx.uiTap();
    FX.burst(u.x, u.y, { count: 6, speed: 90, color: u.color, life: 0.3, size: 3 });
    return true;
  }
  if (target === u) return false;
  if (target.type === u.type && target.level < 5) {
    this.doMerge(u, target);
    return true;
  }
  // 交换位置
  this.grid[u.col][u.row] = target;
  this.grid[c][r] = u;
  var tc = target.col, tr = target.row;
  target.col = u.col; target.row = u.row;
  u.col = c; u.row = r;
  target.sync(this.L); u.sync(this.L);
  target.pop = 1.25; u.pop = 1.25;
  Sfx.uiTap();
  return true;
};

Game.prototype.cellAt = function (x, y) {
  var L = this.L;
  if (x < L.gridX || x > L.gridX + L.gridW || y < L.gridY || y > L.gridY + L.gridH) return null;
  var c = Math.floor((x - L.gridX) / L.cellW);
  var r = Math.floor((y - L.gridY) / L.cellH);
  if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) return null;
  return { c: c, r: r };
};

Game.prototype.pickAt = function (x, y) {
  var cell = this.cellAt(x, y);
  if (!cell) return null;
  this.cursor.c = cell.c; this.cursor.r = cell.r; this.showCursor = true;
  var u = this.grid[cell.c][cell.r];
  if (u) { this.held = u; u.held = true; Sfx.uiTap(); }
  return u;
};

Game.prototype.releaseAt = function (x, y) {
  if (!this.held) return;
  var u = this.held;
  u.held = false;
  this.held = null;
  var cell = this.cellAt(x, y);
  if (!cell) { u.sync(this.L); return; }
  if (!this.tryDrop(u, cell.c, cell.r)) u.sync(this.L);
};

Game.prototype.cancelHold = function () {
  if (!this.held) return;
  this.held.held = false;
  this.held.sync(this.L);
  this.held = null;
};

// ================= 战斗 =================
Game.prototype.frontUnit = function (lane) {
  for (var r = 0; r < GRID_ROWS; r++) {
    var u = this.grid[lane][r];
    if (u && !u.held && u.hp > 0) return u;
  }
  return null;
};

Game.prototype.findTarget = function (u) {
  var L = this.L;
  var list = this.enemies.live, i, e;
  var range = u.rangePx(L);
  var best = null, bestY = -1e9;
  // 本车道
  for (i = 0; i < list.length; i++) {
    e = list[i];
    if (e.dead) continue;
    if (e.lane !== u.col) continue;
    if (e.y > u.y - L.cellH * 0.2) continue;
    if (u.y - e.y > range) continue;
    if (e.y > bestY) { bestY = e.y; best = e; }
  }
  if (best) return best;
  // 远程可支援相邻车道
  if (u.kind === 'melee') return null;
  best = null; bestY = -1e9;
  for (i = 0; i < list.length; i++) {
    e = list[i];
    if (e.dead) continue;
    if (Math.abs(e.lane - u.col) > 1) continue;
    if (e.y > u.y - L.cellH * 0.2) continue;
    if (u.y - e.y > range * 0.85) continue;
    if (e.y > bestY) { bestY = e.y; best = e; }
  }
  return best;
};

Game.prototype.spawnEnemy = function (type, lane, y, hpMul, spdMul) {
  var e = this.enemies.obtain();
  Enemy.call(e, type, lane, y === undefined ? this.L.fieldTop - 40 : y);
  e.scale(hpMul === undefined ? 1 : hpMul, (spdMul === undefined ? 1 : spdMul) * this.mods.enemySpd);
  e.x = this.L.gridX + (lane + 0.5) * this.L.cellW;
  if (e.isBoss) {
    FX.ring(e.x, e.y, this.L.W * 0.6, C.red, 0.7, 8);
    FX.shake(12, 0.5, 28);
    FX.text(e.x, e.y - 40, e.name, { color: C.red, size: 30, life: 1.6, glow: 1 });
  }
  return e;
};

Game.prototype.damageEnemy = function (e, dmg, crit, src) {
  if (e.dead) return;
  var wasBoss = e.isBoss;
  e.hurt(dmg, crit, this);
  if (e.dead && src) {
    src.kills++;
    if (wasBoss) { FX.stop(0.2); }
  }
};

Game.prototype.comboMul = function () {
  var m = 1 + Math.floor(this.combo / 4) * 0.25;
  return Math.min(6, 1 + (m - 1) * this.mods.comboBonus);
};

Game.prototype.onEnemyKilled = function (e) {
  this.kills++;
  this.combo++;
  this.comboT = 2.6;
  if (this.combo > this.bestCombo) this.bestCombo = this.combo;
  var mul = this.comboMul();
  var gain = Math.round(e.score * mul);
  this.addScore(gain, e.x, e.y - 10, mul >= 2 ? C.gold : '#ffffff');
  if (this.combo > 0 && this.combo % 10 === 0) {
    Sfx.combo(this.combo);
    FX.text(this.L.W / 2, this.L.gridY - 60, this.combo + ' 连击 x' + mul.toFixed(2), { color: C.magenta, size: 28, life: 1.1, glow: 1 });
    FX.shake(6, 0.22);
  }
  if (RNG.chance(0.07)) {
    this.energy = Math.min(this.energyMax, this.energy + 1);
    FX.text(this.L.slotCX, this.L.slotY - 6, '能量 +1', { color: C.cyan, size: 16, life: 0.8 });
    Sfx.coin();
  }
  var i = this.enemies.live.indexOf(e);
  if (i >= 0) { this.enemies.live.splice(i, 1); this.enemies.free.push(e); }
};

Game.prototype.hitCore = function (dmg) {
  this.coreHp -= dmg;
  FX.shake(12, 0.35, 30);
  FX.flash(0.4, '#ff4d5e');
  FX.burst(this.L.W / 2, this.L.coreY, { count: 14, speed: 220, spread: Math.PI, dir: -Math.PI / 2, color: C.red, life: 0.5, size: 5, grav: 300 });
  Sfx.coreHit();
  this.ui.onCoreHit();
  if (this.coreHp <= 0) { this.coreHp = 0; this.gameOver(); }
};

Game.prototype.addScore = function (n, x, y, color, big) {
  this.score += n;
  FX.text(x, y, '+' + fmtInt(n), { color: color || '#ffffff', size: big ? 30 : 18, life: big ? 1.2 : 0.75, glow: big ? 1 : 0 });
};

Game.prototype.toast = function (msg) {
  this.toasts.push({ msg: msg, t: 2.2 });
  if (this.toasts.length > 3) this.toasts.shift();
  this.ui.toast(msg);
};

// ================= 更新 =================
Game.prototype.update = function (dt) {
  this.t += dt;
  this.frameAcc += dt; this.frameN++;
  if (this.frameAcc >= 0.5) {
    this.fps = this.frameN / this.frameAcc;
    this.frameAcc = 0; this.frameN = 0;
    if (this.fps < 46 && FX.quality > 0.55) { FX.setQuality(FX.quality - 0.25); this.qualityDropT = 1; }
  }

  FX.update(dt);
  if (this.resultFlash > 0) this.resultFlash = Math.max(0, this.resultFlash - dt * 0.85);
  if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
  for (var ti = this.toasts.length - 1; ti >= 0; ti--) { this.toasts[ti].t -= dt; if (this.toasts[ti].t <= 0) this.toasts.splice(ti, 1); }
  if (this.slowMo > 0) this.slowMo -= dt;
  this.displayScore = lerp(this.displayScore, this.score, 1 - Math.exp(-12 * dt));

  if (this.state !== STATE.PLAY || this.paused) return;
  this.elapsed += dt;

  // 能量回复
  if (this.energy < this.energyMax) {
    this.energyT += dt;
    if (this.energyT >= this.energyRate) { this.energyT = 0; this.energy = Math.min(this.energyMax, this.energy + 1); }
  } else this.energyT = 0;
  this.energy = Math.min(this.energyMax, this.energy + 0);
  if (this.energy < this.energyMax) this.energy += 0; // 占位，保持可读
  var frac = this.energyMax > 0 ? (this.energyT / this.energyRate) : 0;
  this._energyFrac = frac;

  // 连击衰减
  if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }

  this.slot.update(dt);

  // 待召唤队列（游戏时间）
  if (this.pending.length) {
    for (var pi = this.pending.length - 1; pi >= 0; pi--) {
      this.pending[pi].t -= dt;
      if (this.pending[pi].t <= 0) {
        this.placeUnit(this.pending[pi].type, true);
        this.pending.splice(pi, 1);
      }
    }
  }

  // 出怪
  this.spawnT += dt;
  while (this.queue.length && this.queue[0].t <= this.spawnT) {
    var q = this.queue.shift();
    if (this.enemies.count() < this.maxEnemies) {
      this.spawnEnemy(q.type, q.lane, this.L.fieldTop - 40, this.info.hpMul, this.info.spdMul);
    }
  }

  // 单位
  var i, u;
  for (i = this.units.length - 1; i >= 0; i--) {
    u = this.units[i];
    if (u.dead) { this.units.splice(i, 1); continue; }
    if (u.held) continue;
    u.update(dt, this);
  }

  // 敌人
  var list = this.enemies.live;
  for (i = list.length - 1; i >= 0; i--) {
    var e = list[i];
    if (e.dead) continue;
    e.update(dt, this);
  }
  this.enemies.sweep();

  // 弹体
  var sl = this.shots.live;
  for (i = sl.length - 1; i >= 0; i--) {
    if (sl[i].dead) continue;
    updateShot(sl[i], dt, this);
  }
  this.shots.sweep();

  // 波次结束
  if (!this.waveEnding && this.queue.length === 0 && this.enemies.count() === 0 && this.wave > 0) {
    this.waveEnding = true;
    this.endT = 1.5;
    this.banner = { text: '第 ' + this.wave + ' 波 肃清', sub: '+' + fmtInt(this.wave * 60) + ' 分', t: 1.5, color: C.green };
    Sfx.match(3);
    FX.flash(0.2, '#a8ffb0');
  }
  if (this.waveEnding) {
    this.endT -= dt;
    if (this.endT <= 0) this.onWaveClear();
  }
};

Game.prototype.onWaveClear = function () {
  this.waveEnding = false;
  this.addScore(this.wave * 60, this.L.W / 2, this.L.gridY - 40, C.green, true);
  this.energy = Math.min(this.energyMax, this.energy + 1 + this.mods.energyGain);
  // 回血
  for (var i = 0; i < this.units.length; i++) {
    this.units[i].hp = Math.min(this.units[i].maxHp, this.units[i].hp + this.units[i].maxHp * 0.3);
  }
  this.coreHp = Math.min(this.coreMax, this.coreHp + 8);
  if (this.wave >= TOTAL_WAVES) { this.win(); return; }
  if (this.wave % 3 === 0) { this.openReward(); return; }
  this.startWave(this.wave + 1);
};

Game.prototype.openReward = function () {
  this.pendingCards = rollCards(this.ownedCards);
  this.state = STATE.REWARD;
  this.ui.showReward(this.pendingCards);
};

Game.prototype.pickCard = function (idx) {
  if (!this.pendingCards || !this.pendingCards[idx]) return;
  var card = this.pendingCards[idx];
  card.apply(this.mods);
  this.ownedCards[card.id] = (this.ownedCards[card.id] || 0) + 1;
  this.coreMax = Math.round(this.mods.coreMax);
  if (this.mods.coreHeal) { this.coreHp = this.coreMax; this.mods.coreHeal = 0; }
  this.syncEnergy();
  for (var i = 0; i < this.units.length; i++) this.units[i].applyLevel(this.mods);
  this.pendingCards = null;
  this.state = STATE.PLAY;
  this.ui.hideReward();
  this.ui.onStateChange(this.state);
  Sfx.cardPick();
  FX.flash(0.35, card.color);
  FX.ring(this.L.W / 2, this.L.H * 0.45, this.L.W, card.color, 0.7, 8);
  this.startWave(this.wave + 1);
};

Game.prototype.togglePause = function (force) {
  if (this.state === STATE.PLAY) {
    this.paused = force === undefined ? !this.paused : force;
    if (this.paused) { Music.stop(); this.ui.showPause(); }
    else { Music.start(); this.ui.hidePause(); }
    this.ui.onStateChange(this.paused ? STATE.PAUSE : STATE.PLAY);
  } else if (this.state === STATE.PAUSE) {
    this.togglePause(false);
  }
};

Game.prototype.gameOver = function () {
  if (this.state === STATE.OVER) return;
  this.state = STATE.OVER;
  this.cancelHold();
  Music.stop();
  Sfx.gameOver();
  FX.shake(24, 0.9, 22);
  FX.flash(0.7, '#ff4d5e');
  FX.stop(0.18);
  this.ui.showGameOver(this.summary());
};

Game.prototype.win = function () {
  if (this.state === STATE.WIN) return;
  this.state = STATE.WIN;
  this.cancelHold();
  Music.stop();
  Sfx.victory();
  FX.flash(0.8, '#fff2b0');
  FX.shake(16, 0.8, 26);
  for (var i = 0; i < 6; i++) FX.coins(this.L.W * (0.2 + i * 0.12), this.L.H * 0.35, 14);
  this.ui.showGameOver(this.summary(), true);
};

Game.prototype.summary = function () {
  return {
    score: Math.floor(this.score),
    wave: this.wave,
    kills: this.kills,
    spins: this.spins,
    merges: this.merges,
    jackpots: this.jackpots,
    bestCombo: this.bestCombo,
    time: this.elapsed,
    win: this.state === STATE.WIN
  };
};

// ================= 渲染 =================
Game.prototype.render = function () {
  var ctx = this.ctx, L = this.L;
  ctx.setTransform(this.px, 0, 0, this.px, this.ox * this.px, this.oy * this.px);
  ctx.clearRect(-this.ox, -this.oy, L.W + this.ox * 2, L.H + this.oy * 2);

  // 背景
  if (this.bg) ctx.drawImage(this.bg, 0, 0, L.W, L.H);
  this.drawStars(ctx);

  ctx.save();
  ctx.translate(FX.shakeX, FX.shakeY);

  this.drawField(ctx);
  this.drawEnemies(ctx);
  this.drawUnits(ctx);
  this.drawShots(ctx);
  FX.drawParticles(ctx, 0);
  FX.drawRings(ctx);
  this.slot.draw(ctx, this);
  FX.drawTexts(ctx, this.font);
  this.drawCombo(ctx);
  this.drawBanner(ctx);

  ctx.restore();

  FX.drawFlash(ctx, L.W, L.H);
  this.drawCoreVignette(ctx);
};

Game.prototype.drawStars = function (ctx) {
  var L = this.L, i, s, a;
  ctx.globalCompositeOperation = 'lighter';
  for (i = 0; i < this.stars.length; i++) {
    s = this.stars[i];
    a = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(this.t * s.sp + s.ph));
    if (s.y > L.slotY) continue;
    ctx.globalAlpha = a * 0.7;
    ctx.fillStyle = i % 3 === 0 ? C.cyan : (i % 3 === 1 ? C.magenta : '#ffffff');
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
};

Game.prototype.drawField = function (ctx) {
  var L = this.L, c, r;

  // 行军区
  ctx.fillStyle = 'rgba(10,6,20,0.35)';
  roundRect(ctx, L.gridX - 6, L.fieldTop, L.gridW + 12, L.gridH + 6, 12);
  ctx.fill();

  // 出生门（顶部能量缝）
  ctx.globalCompositeOperation = 'lighter';
  var pg = ctx.createLinearGradient(L.gridX, 0, L.gridX + L.gridW, 0);
  pg.addColorStop(0, 'rgba(255,61,129,0)');
  pg.addColorStop(0.5, 'rgba(255,61,129,0.4)');
  pg.addColorStop(1, 'rgba(255,61,129,0)');
  ctx.fillStyle = pg;
  ctx.fillRect(L.gridX - 6, L.fieldTop - 3, L.gridW + 12, 5);
  ctx.globalCompositeOperation = 'source-over';

  // 行军引导箭头（向下流动）
  var marchH = L.gridY - L.fieldTop;
  if (marchH > 60) {
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (c = 0; c < GRID_COLS; c++) {
      var ccx = L.gridX + (c + 0.5) * L.cellW;
      for (var ck = 0; ck < 3; ck++) {
        var yy = L.fieldTop + 18 + ((this.t * 34 + ck * (marchH / 3)) % marchH);
        var ea = Math.sin(Math.PI * (yy - L.fieldTop) / marchH) * 0.14;
        ctx.strokeStyle = 'rgba(255,255,255,' + ea.toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(ccx - 13, yy - 7);
        ctx.lineTo(ccx, yy + 6);
        ctx.lineTo(ccx + 13, yy - 7);
        ctx.stroke();
      }
    }
  }

  // 车道
  for (c = 0; c < GRID_COLS; c++) {
    var lx = L.gridX + c * L.cellW;
    ctx.fillStyle = c % 2 ? 'rgba(255,255,255,0.022)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(lx, L.fieldTop, L.cellW, L.fieldBottom - L.fieldTop);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lx, L.fieldTop); ctx.lineTo(lx, L.fieldBottom);
    ctx.stroke();
  }

  // 网格
  for (c = 0; c < GRID_COLS; c++) {
    for (r = 0; r < GRID_ROWS; r++) {
      var x = L.gridX + c * L.cellW, y = L.gridY + r * L.cellH;
      var occ = this.grid[c][r];
      ctx.fillStyle = occ ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.028)';
      roundRect(ctx, x + 4, y + 4, L.cellW - 8, L.cellH - 8, 10);
      ctx.fill();
      ctx.strokeStyle = occ ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }

  // 拾取时高亮可合成格
  if (this.held) {
    for (c = 0; c < GRID_COLS; c++) {
      for (r = 0; r < GRID_ROWS; r++) {
        var o = this.grid[c][r];
        if (!o || o === this.held) continue;
        var ok = (o.type === this.held.type && o.level < 5);
        var x2 = L.gridX + c * L.cellW, y2 = L.gridY + r * L.cellH;
        ctx.strokeStyle = ok ? C.gold : 'rgba(255,255,255,0.14)';
        ctx.lineWidth = ok ? 2.6 : 1.2;
        ctx.globalAlpha = ok ? (0.55 + 0.45 * Math.sin(this.t * 8)) : 0.6;
        roundRect(ctx, x2 + 3, y2 + 3, L.cellW - 6, L.cellH - 6, 10);
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (ok) {
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.font = '900 ' + Math.round(L.cellW * 0.16) + 'px ' + this.font;
          ctx.fillStyle = C.gold;
          ctx.fillText('合成', x2 + L.cellW / 2, y2 + L.cellH * 0.86);
        }
      }
    }
  }

  // 键盘光标
  if (this.showCursor && this.state === STATE.PLAY) {
    var cx = L.gridX + this.cursor.c * L.cellW, cy = L.gridY + this.cursor.r * L.cellH;
    ctx.strokeStyle = C.cyan;
    ctx.lineWidth = 2.4;
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.t * 7);
    roundRect(ctx, cx + 2, cy + 2, L.cellW - 4, L.cellH - 4, 11);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 核心防线
  var hpR = clamp(this.coreHp / this.coreMax, 0, 1);
  ctx.fillStyle = this._grads.core[hpR > 0.5 ? 0 : (hpR > 0.25 ? 1 : 2)];
  ctx.fillRect(L.gridX - 6, L.coreY - 10, L.gridW + 12, 18);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(L.gridX - 6, L.coreY);
  ctx.lineTo(L.gridX + L.gridW + 6, L.coreY);
  ctx.stroke();
  // 流动光点
  ctx.globalCompositeOperation = 'lighter';
  for (var k = 0; k < 10; k++) {
    var px = L.gridX + ((this.t * 40 + k * (L.gridW / 10)) % L.gridW);
    ctx.globalAlpha = 0.5 * hpR;
    ctx.fillStyle = hpR > 0.25 ? C.green : C.red;
    ctx.beginPath(); ctx.arc(px, L.coreY, 2.4, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
};

Game.prototype.drawEnemies = function (ctx) {
  var list = this.enemies.live, i;
  for (i = 0; i < list.length; i++) if (!list[i].dead) list[i].draw(ctx, this);
};

Game.prototype.drawUnits = function (ctx) {
  var i, u;
  for (i = 0; i < this.units.length; i++) {
    u = this.units[i];
    if (u.held) continue;
    u.draw(ctx, this);
  }
  if (this.held) {
    ctx.globalAlpha = 0.9;
    var saved = { x: this.held.x, y: this.held.y };
    this.held.x = this._holdX === undefined ? saved.x : this._holdX;
    this.held.y = this._holdY === undefined ? saved.y : this._holdY;
    this.held.pop = 1.25;
    this.held.draw(ctx, this);
    this.held.x = saved.x; this.held.y = saved.y;
    ctx.globalAlpha = 1;
  }
};

Game.prototype.drawShots = function (ctx) {
  var list = this.shots.live, i;
  for (i = 0; i < list.length; i++) if (!list[i].dead) drawShot(ctx, list[i], this);
};

Game.prototype.drawCombo = function (ctx) {
  if (this.combo < 3 || this.state !== STATE.PLAY) return;
  var L = this.L;
  var mul = this.comboMul();
  var pulse = 1 + Math.sin(this.t * 9) * 0.05;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  var y = L.fieldTop + 44;
  ctx.font = '900 ' + Math.round(30 * pulse) + 'px ' + this.font;
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(8,5,15,0.85)';
  ctx.strokeText(this.combo + ' 连击', L.W / 2, y);
  ctx.fillStyle = mul >= 3 ? C.magenta : (mul >= 2 ? C.gold : C.cyan);
  ctx.fillText(this.combo + ' 连击', L.W / 2, y);
  ctx.font = '900 16px ' + this.font;
  ctx.strokeText('得分 x' + mul.toFixed(2), L.W / 2, y + 24);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('得分 x' + mul.toFixed(2), L.W / 2, y + 24);
  // 衰减条
  var w = 90 * clamp(this.comboT / 2.6, 0, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(L.W / 2 - 45, y + 38, 90, 3);
  ctx.fillStyle = C.gold;
  ctx.fillRect(L.W / 2 - 45, y + 38, w, 3);
};

Game.prototype.drawBanner = function (ctx) {
  if (!this.banner) return;
  var L = this.L;
  var k = clamp(this.banner.t / 2.0, 0, 1);
  var inT = clamp((1 - k) * 5, 0, 1);
  var outT = clamp(k * 4, 0, 1);
  var a = Math.min(inT, outT);
  var y = L.fieldTop + L.fieldH * 0.22;
  var slide = (1 - inT) * -60;
  ctx.globalAlpha = a;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(8,5,15,0.55)';
  roundRect(ctx, L.W * 0.14 + slide, y - 34, L.W * 0.72, 72, 14);
  ctx.fill();
  ctx.strokeStyle = this.banner.color;
  ctx.lineWidth = 2;
  roundRect(ctx, L.W * 0.14 + slide, y - 34, L.W * 0.72, 72, 14);
  ctx.stroke();
  ctx.font = '900 30px ' + this.font;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(this.banner.text, L.W / 2 + slide, y - 8);
  ctx.font = '700 18px ' + this.font;
  ctx.fillStyle = this.banner.color;
  ctx.fillText(this.banner.sub, L.W / 2 + slide, y + 20);
  ctx.globalAlpha = 1;
};

Game.prototype.drawCoreVignette = function (ctx) {
  var L = this.L;
  var r = 1 - clamp(this.coreHp / this.coreMax, 0, 1);
  if (r < 0.35) return;
  var a = (r - 0.35) / 0.65 * (0.28 + 0.12 * Math.sin(this.t * 5));
  var key = Math.round(a * 40);           // 量化后复用，避免逐帧建渐变
  var cache = this._vigCache || (this._vigCache = {});
  var g = cache[key];
  if (!g) {
    g = ctx.createRadialGradient(L.W / 2, L.H * 0.5, L.H * 0.2, L.W / 2, L.H * 0.5, L.H * 0.72);
    g.addColorStop(0, 'rgba(255,0,40,0)');
    g.addColorStop(1, 'rgba(255,20,60,' + (key / 40).toFixed(3) + ')');
    cache[key] = g;
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, L.W, L.H);
};

// 供 UI 读取
Game.prototype.getEnergy = function () {
  var base = Math.floor(this.energy);
  var frac = this.energy < this.energyMax ? clamp(this.energyT / this.energyRate, 0, 1) : 1;
  return { whole: base, max: this.energyMax, frac: frac };
};
