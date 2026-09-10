// slots.js — 3×3 老虎机（滚轮动画 + 结果结算）
'use strict';

import { RNG, clamp, TAU, lerp } from './util.js';
import { Atlas, SYMBOL_LIST, SYMBOL_WEIGHT_ARR, C, roundRect, UNITS } from './theme.js';
import { FX } from './fx.js';
import { Sfx } from './audio.js';

var REEL_LEN = 30;      // 每条滚轮的符号环长度
var ANCHOR = 24;        // 结果列锚定位置（strip[24..26] 即中奖列）
var SPIN_SPEED = 17;    // 转动阶段速度（格/秒）
var STOP_DUR = 0.34;    // 单轮减速停靠时长（秒）

/** 停靠缓动：末段轻微过冲回弹，模拟真实滚轮的“咔哒” */
function easeOutBackSmall(t) {
  var c = 1.32, u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

function sameType(a, b) { return a === b || a === 'prism' || b === 'prism'; }
function realType(a, b) { return a === 'prism' ? b : a; }

export function SlotMachine(game) {
  this.g = game;
  this.cols = 3;
  this.rows = 3;
  this.strips = [[], [], []];
  this.pos = [0, 0, 0];
  this.vel = [0, 0, 0];
  this.target = [0, 0, 0];
  this.state = 'idle';        // idle | spinning | done
  this.stopped = [false, false, false];
  this.phase = ['spin', 'spin', 'spin'];
  this.stopFrom = [0, 0, 0];
  this.stopT = [0, 0, 0];
  this.timer = 0;
  this.stopDelay = [0.30, 0.48, 0.66];
  this.outcome = null;
  this.result = null;
  this.flashCells = [];       // [{c,r,t}]
  this.leverT = 0;
  this.glowT = 0;
  this.spinCount = 0;
  this.buildStrips();
}

SlotMachine.prototype.buildStrips = function () {
  for (var c = 0; c < 3; c++) {
    this.strips[c] = [];
    for (var i = 0; i < REEL_LEN; i++) {
      this.strips[c].push(SYMBOL_LIST[RNG.weighted(SYMBOL_WEIGHT_ARR)]);
    }
  }
};

/** 先决定结果，再反向填充滚轮，保证视觉与结算完全一致 */
SlotMachine.prototype.rollOutcome = function () {
  var out = [[], [], []], r, c;
  var bias = this.g.mods.prismBias;
  var weights = SYMBOL_WEIGHT_ARR.slice();
  weights[5] = weights[5] * bias;   // prism 权重受“命运核心”影响

  if (RNG.chance(0.018 * bias)) {
    // JACKPOT：九连同
    var t = RNG.chance(0.12) ? 'prism' : SYMBOL_LIST[RNG.int(0, 4)];
    for (c = 0; c < 3; c++) for (r = 0; r < 3; r++) out[c][r] = t;
  } else if (RNG.chance(0.13)) {
    // 保底一条连线
    var row = RNG.int(0, 2);
    var tt = SYMBOL_LIST[RNG.weighted(weights)];
    for (c = 0; c < 3; c++) out[c][row] = tt;
    for (c = 0; c < 3; c++) {
      for (r = 0; r < 3; r++) {
        if (out[c][r] === undefined) out[c][r] = SYMBOL_LIST[RNG.weighted(weights)];
      }
    }
  } else {
    for (c = 0; c < 3; c++) for (r = 0; r < 3; r++) out[c][r] = SYMBOL_LIST[RNG.weighted(weights)];
  }
  return out;
};

SlotMachine.prototype.spin = function () {
  if (this.state === 'spinning') return false;
  this.spinCount++;
  this.outcome = this.rollOutcome();
  for (var c = 0; c < 3; c++) {
    // 写入结果列到锚点
    for (var r = 0; r < 3; r++) this.strips[c][ANCHOR + r] = this.outcome[c][r];
    // 其余随机
    for (var i = 0; i < REEL_LEN; i++) {
      if (i >= ANCHOR && i < ANCHOR + 3) continue;
      this.strips[c][i] = SYMBOL_LIST[RNG.weighted(SYMBOL_WEIGHT_ARR)];
    }
    this.pos[c] = ((this.pos[c] % REEL_LEN) + REEL_LEN) % REEL_LEN;
    this.phase[c] = 'spin';
    this.stopT[c] = 0;
    this.stopFrom[c] = 0;
    this.target[c] = 0;
    this.vel[c] = SPIN_SPEED;
    this.stopped[c] = false;
  }
  this.state = 'spinning';
  this.timer = 0;
  this.result = null;
  this.flashCells.length = 0;
  this.leverT = 1;
  this.glowT = 0;
  Sfx.lever();
  return true;
};

SlotMachine.prototype.update = function (dt) {
  var i;
  if (this.leverT > 0) this.leverT = Math.max(0, this.leverT - dt * 3.2);

  if (this.state !== 'spinning') {
    this.glowT += dt;
    for (i = this.flashCells.length - 1; i >= 0; i--) {
      this.flashCells[i].t -= dt;
      if (this.flashCells[i].t <= 0) this.flashCells.splice(i, 1);
    }
    return;
  }

  this.timer += dt;
  var allDone = true;
  for (i = 0; i < 3; i++) {
    if (this.stopped[i]) { continue; }
    allDone = false;
    var prev = this.pos[i];

    if (this.phase[i] === 'spin') {
      if (this.timer >= this.stopDelay[i]) {
        // 进入停靠阶段：目标 = 下一个「锚点对齐」的整格位置
        this.phase[i] = 'stop';
        this.stopFrom[i] = this.pos[i];
        this.stopT[i] = 0;
        var base = Math.ceil(this.pos[i] + 2);
        var cur = ((base % REEL_LEN) + REEL_LEN) % REEL_LEN;
        var delta = ((ANCHOR - cur) % REEL_LEN + REEL_LEN) % REEL_LEN;
        this.target[i] = base + delta;
      } else {
        this.pos[i] += SPIN_SPEED * dt;
        Sfx.reelTick();
      }
    }

    if (this.phase[i] === 'stop') {
      this.stopT[i] += dt;
      var k = clamp(this.stopT[i] / STOP_DUR, 0, 1);
      var span = this.target[i] - this.stopFrom[i];
      this.pos[i] = this.stopFrom[i] + span * easeOutBackSmall(k);
      if (k >= 1) {
        this.pos[i] = this.target[i];
        this.stopped[i] = true;
        this.vel[i] = 0;
        this.onReelStop(i);
      } else {
        Sfx.reelTick();
      }
    }

    if (dt > 0) this.vel[i] = Math.abs(this.pos[i] - prev) / dt;
  }
  if (allDone) {
    this.state = 'done';
    this.result = this.evaluate();
    this.g.onSpinResult(this.result);
  }
};

SlotMachine.prototype.onReelStop = function (i) {
  this.pos[i] = ((this.pos[i] % REEL_LEN) + REEL_LEN) % REEL_LEN;
  Sfx.reelStop(i);
  FX.shake(2.4, 0.09, 70);
  var L = this.g.L;
  FX.burst(L.reelsX + (i + 0.5) * L.reelsW, L.reelsY + L.reelsH, {
    count: 6, speed: 130, spread: 0.7, dir: -Math.PI / 2, color: C.gold, life: 0.3, size: 3
  });
};

/** 结算 3×3 结果 */
SlotMachine.prototype.evaluate = function () {
  var out = this.outcome, c, r;
  var lines = [], colHits = [], pairs = [], summons = {};
  var jackpot = false, score = 0;

  var addSummon = function (t, n) { summons[t] = (summons[t] || 0) + n; };

  // JACKPOT：九连同必须是「九个完全相同的符号」，★ 不参与通配
  // （否则只要 out[0][0] 是 ★，sameType 会把任意盘面都判成九连同）
  var allSame = true;
  for (c = 0; c < 3 && allSame; c++) {
    for (r = 0; r < 3 && allSame; r++) {
      if (out[c][r] !== out[0][0]) allSame = false;
    }
  }
  if (allSame) {
    // 九连同：直接按 JACKPOT 结算，不再叠加横线/竖线/成对奖励
    jackpot = true;
    score = 2000;
    addSummon(out[0][0] === 'prism' ? 'prism' : out[0][0], 3);
    for (c = 0; c < 3; c++) for (r = 0; r < 3; r++) this.flashCells.push({ c: c, r: r, t: 1.6 });
    return {
      jackpot: true, lines: [], cols: [], pairs: [],
      summons: summons, score: score, label: 'JACKPOT!', outcome: out
    };
  }

  // 横向连线
  for (r = 0; r < 3; r++) {
    if (sameType(out[0][r], out[1][r]) && sameType(out[1][r], out[2][r])) {
      var t = realType(out[0][r], out[1][r]);
      t = realType(t, out[2][r]);
      lines.push({ r: r, type: t });
      score += 220;
      addSummon(t, 2);
      if (!jackpot) for (c = 0; c < 3; c++) this.flashCells.push({ c: c, r: r, t: 1.1 });
    }
  }

  // 纵向连线
  for (c = 0; c < 3; c++) {
    if (sameType(out[c][0], out[c][1]) && sameType(out[c][1], out[c][2])) {
      var t2 = realType(realType(out[c][0], out[c][1]), out[c][2]);
      colHits.push({ c: c, type: t2 });
      score += 160;
      addSummon(t2, 2);
      if (!jackpot) for (r = 0; r < 3; r++) this.flashCells.push({ c: c, r: r, t: 1.1 });
    }
  }

  // 成对（横向 + 纵向对称判定，避免出现「明明有两个一样却什么都没有」）
  if (lines.length === 0 && colHits.length === 0) {
    var pc, pr, q1, q2, tp;
    // 横向
    for (r = 0; r < 3; r++) {
      for (c = 0; c < 3; c++) {
        q1 = (c + 1) % 3; q2 = (c + 2) % 3;
        if (sameType(out[c][r], out[q1][r]) && !sameType(out[c][r], out[q2][r])) {
          tp = realType(out[c][r], out[q1][r]);
          pairs.push({ c: c, r: r, dir: 'h', type: tp });
          score += 45;
          addSummon(tp, 1);
          this.flashCells.push({ c: c, r: r, t: 0.8 });
          this.flashCells.push({ c: q1, r: r, t: 0.8 });
          break;
        }
      }
    }
    // 纵向
    for (c = 0; c < 3; c++) {
      for (r = 0; r < 3; r++) {
        q1 = (r + 1) % 3; q2 = (r + 2) % 3;
        if (sameType(out[c][r], out[c][q1]) && !sameType(out[c][r], out[c][q2])) {
          tp = realType(out[c][r], out[c][q1]);
          pairs.push({ c: c, r: r, dir: 'v', type: tp });
          score += 45;
          addSummon(tp, 1);
          this.flashCells.push({ c: c, r: r, t: 0.8 });
          this.flashCells.push({ c: c, r: q1, t: 0.8 });
          break;
        }
      }
    }
  }

  // 空奖保底
  var totalSummon = 0, k;
  for (k in summons) totalSummon += summons[k];
  if (totalSummon === 0) {
    var fallback = SYMBOL_LIST[RNG.weighted(SYMBOL_WEIGHT_ARR)];
    addSummon(fallback, 1);
    score += 25;
  }

  var label = jackpot ? 'JACKPOT!' :
    (lines.length + colHits.length >= 2 ? '多重连线!' :
      (lines.length ? '横向连线!' :
        (colHits.length ? '纵向连线!' :
          (pairs.length ? '成对!' : '小奖'))));

  return {
    jackpot: jackpot, lines: lines, cols: colHits, pairs: pairs,
    summons: summons, score: score, label: label, outcome: out
  };
};

// ---------- 渲染 ----------
SlotMachine.prototype.draw = function (ctx, G) {
  var L = G.L, i, c, r;
  var px = L.reelsX, py = L.reelsY, pw = L.reelsW, ph = L.reelsH;
  var cellW = pw / 3, cellH = ph / 3;

  // 机身
  ctx.fillStyle = G._grads ? G._grads.slotBody : '#241647';
  roundRect(ctx, L.slotX, L.slotY, L.slotW, L.slotH, 22);
  ctx.fill();

  // 金色描边
  ctx.strokeStyle = C.goldDeep;
  ctx.lineWidth = 3;
  roundRect(ctx, L.slotX + 1.5, L.slotY + 1.5, L.slotW - 3, L.slotH - 3, 20);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,207,77,0.45)';
  ctx.lineWidth = 1;
  roundRect(ctx, L.slotX + 6, L.slotY + 6, L.slotW - 12, L.slotH - 12, 16);
  ctx.stroke();

  // 顶部跑马灯
  this.drawMarquee(ctx, G);

  // 滚轮窗
  ctx.fillStyle = '#0a0614';
  roundRect(ctx, px - 8, py - 8, pw + 16, ph + 16, 14);
  ctx.fill();

  ctx.save();
  roundRect(ctx, px, py, pw, ph, 8);
  ctx.clip();

  for (c = 0; c < 3; c++) {
    var strip = this.strips[c];
    var pos = this.pos[c];
    var base = Math.floor(pos);
    var frac = pos - base;
    var blur = clamp(this.vel[c] > 0 && this.state === 'spinning' ? (this.stopped[c] ? 0 : Math.min(1, this.vel[c] / 12)) : 0, 0, 1);
    var cx = px + c * cellW;

    for (var k = -1; k <= 3; k++) {
      var idx = (((base + k) % REEL_LEN) + REEL_LEN) % REEL_LEN;
      var type = strip[idx];
      var y = py + (k - frac) * cellH;
      if (y + cellH < py - 4 || y > py + ph + 4) continue;
      var img = Atlas.img['sym_' + type];
      if (!img) continue;
      var pad = cellW * 0.05;
      if (blur > 0.05) {
        // 运动模糊：多次半透明叠加
        ctx.globalAlpha = 0.28;
        var steps = 3;
        for (var s = 0; s < steps; s++) {
          var oy = (s - 1) * cellH * 0.16 * blur;
          ctx.drawImage(img, cx + pad, y + pad + oy, cellW - pad * 2, cellH - pad * 2);
        }
        ctx.globalAlpha = 1;
      } else {
        ctx.drawImage(img, cx + pad, y + pad, cellW - pad * 2, cellH - pad * 2);
      }
    }
  }

  // 中奖格高亮
  for (i = 0; i < this.flashCells.length; i++) {
    var f = this.flashCells[i];
    var a = clamp(f.t, 0, 1);
    var pulse = 0.35 + 0.35 * Math.sin(this.glowT * 12 + i);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a * (0.3 + pulse * 0.4);
    ctx.fillStyle = C.gold;
    ctx.fillRect(px + f.c * cellW + 3, py + f.r * cellH + 3, cellW - 6, cellH - 6);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = a;
    roundRect(ctx, px + f.c * cellW + 3, py + f.r * cellH + 3, cellW - 6, cellH - 6, 8);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // 滚轮分隔条
  ctx.strokeStyle = 'rgba(255,207,77,0.35)';
  ctx.lineWidth = 2;
  for (c = 1; c < 3; c++) {
    ctx.beginPath();
    ctx.moveTo(px + c * cellW, py - 6);
    ctx.lineTo(px + c * cellW, py + ph + 6);
    ctx.stroke();
  }
  // 中线（中奖线）
  ctx.strokeStyle = 'rgba(255,61,129,0.5)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(px - 8, py + ph / 2);
  ctx.lineTo(px + pw + 8, py + ph / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // 窗框
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 3;
  roundRect(ctx, px - 8, py - 8, pw + 16, ph + 16, 14);
  ctx.stroke();

  // 能量条
  this.drawEnergy(ctx, G);

  // 结果文字
  if (this.result && this.g.resultFlash > 0) {
    var al = clamp(this.g.resultFlash, 0, 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var fs = Math.round(L.slotW * 0.082 * (1 + (1 - al) * 0.15));
    ctx.font = '900 ' + fs + 'px ' + G.font;
    var ty2 = L.slotY - 14;
    ctx.globalAlpha = al;
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(8,5,15,0.9)';
    ctx.strokeText(this.result.label, L.slotCX, ty2);
    ctx.fillStyle = this.result.jackpot ? C.magenta : C.gold;
    ctx.fillText(this.result.label, L.slotCX, ty2);
    ctx.globalAlpha = 1;
  }
};

SlotMachine.prototype.drawMarquee = function (ctx, G) {
  var L = G.L;
  var mx = L.slotX + 14, my = L.slotY + 10, mw = L.slotW - 28, mh = 30;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  roundRect(ctx, mx, my, mw, mh, 8);
  ctx.fill();
  var n = 14, i;
  for (i = 0; i < n; i++) {
    var t = (this.glowT * 2 + i / n) % 1;
    var on = Math.sin((this.glowT * 6 + i * 0.9)) > -0.2;
    var x = mx + 8 + (mw - 16) * (i / (n - 1));
    ctx.globalAlpha = on ? 0.95 : 0.22;
    ctx.fillStyle = i % 2 ? C.magenta : C.gold;
    ctx.beginPath();
    ctx.arc(x, my + mh / 2, 3.2, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 ' + Math.round(mh * 0.62) + 'px ' + G.font;
  ctx.fillStyle = C.gold;
  var title = 'SLOTBOUND';
  ctx.fillText(title, L.slotCX, my + mh / 2 + 1);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 2;
};

SlotMachine.prototype.drawEnergy = function (ctx, G) {
  var L = G.L;
  var y = L.slotY + L.slotH - 34;
  var maxE = G.energyMax;
  var w = L.slotW - 40;
  var x = L.slotX + 20;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '900 14px ' + G.font;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText('能量', x, y + 1);

  var pipW = 26, gap = 6;
  var startX = x + 40;
  for (var i = 0; i < maxE; i++) {
    var pxx = startX + i * (pipW + gap);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(ctx, pxx, y - 8, pipW, 16, 5);
    ctx.fill();
    if (i < Math.floor(G.energy)) {
      ctx.fillStyle = C.cyan;
      roundRect(ctx, pxx + 1.5, y - 6.5, pipW - 3, 13, 4);
      ctx.fill();
    } else if (i === Math.floor(G.energy)) {
      var f = G.energy - Math.floor(G.energy);
      ctx.fillStyle = 'rgba(41,224,255,0.45)';
      roundRect(ctx, pxx + 1.5, y - 6.5, (pipW - 3) * f, 13, 4);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    roundRect(ctx, pxx, y - 8, pipW, 16, 5);
    ctx.stroke();
  }

  // 提示
  ctx.textAlign = 'right';
  ctx.font = '700 13px ' + G.font;
  ctx.fillStyle = G.canSpin() ? C.gold : 'rgba(255,255,255,0.35)';
  ctx.fillText(G.canSpin() ? '按 空格 / 点击 拉杆' : '充能中…', L.slotX + L.slotW - 20, y + 1);
};
