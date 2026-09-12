// v17.js — v1.7 Juice Density：更密集的正反馈，不增加常驻 UI
'use strict';

import { SlotMachine } from './slots.js';
import { FX } from './fx.js';
import { C, UNITS } from './theme.js';
import { RNG } from './util.js';

var INSTALLED = false;
var TYPES = ['guard','sword','bow','mage','cannon'];

function activeUnits(game) {
  var out = [];
  for (var i = 0; i < game.units.length; i++) {
    var u = game.units[i];
    if (u && !u.dead) out.push(u);
  }
  return out;
}

function unitMass(u) {
  return u && u._absorbMass !== undefined ? u._absorbMass : Math.pow(2, Math.max(0, (u && u.level ? u.level : 1) - 1));
}

function primaryType(game) {
  var units = activeUnits(game);
  for (var i = 0; i < units.length; i++) if (units[i]._primary) return units[i].type;
  return game._biasType || (units[0] ? units[0].type : 'bow');
}

function allSame(out) {
  if (!out || !out[0] || !out[0].length) return false;
  var t = out[0][0];
  for (var c = 0; c < 3; c++) for (var r = 0; r < 3; r++) if (out[c][r] !== t) return false;
  return true;
}

function prismCount(res) {
  var out = res && res.outcome;
  var n = 0;
  if (!out) return 0;
  for (var c = 0; c < 3; c++) for (var r = 0; r < 3; r++) if (out[c][r] === 'prism') n++;
  return n;
}

function summonCount(res) {
  var n = 0;
  if (!res || !res.summons) return 0;
  for (var k in res.summons) n += res.summons[k] || 0;
  return n;
}

function tier(res) {
  if (!res) return 0;
  if (res.jackpot) return 5;
  var matches = (res.lines ? res.lines.length : 0) + (res.cols ? res.cols.length : 0);
  if (matches >= 2 || (res.score || 0) >= 500) return 4;
  if (matches >= 1 || (res.score || 0) >= 220) return 3;
  if (prismCount(res) >= 2 || summonCount(res) >= 2 || (res.score || 0) >= 90) return 2;
  return 1;
}

function choosePityType(slot) {
  var g = slot.g;
  var prior = slot.result && slot.result.outcome;
  if (slot._v14Locks && prior) {
    for (var c = 0; c < 3; c++) {
      if (!slot._v14Locks[c] || !prior[c]) continue;
      var t = prior[c][1];
      if (t) return t;
    }
  }
  return (g && (g._biasType || primaryType(g))) || TYPES[RNG.int(0, TYPES.length - 1)];
}

function rewriteLine(slot, out, type) {
  var row = 1;
  for (var c = 0; c < 3; c++) out[c][row] = type;
  slot._v17ForceLine = { row: row, type: type };
}

function rewriteJackpot(slot, out, type) {
  for (var c = 0; c < 3; c++) for (var r = 0; r < 3; r++) out[c][r] = type;
  slot._v17ForceJackpot = type;
}

function applyForcedOutcome(slot) {
  var c, r;
  if (slot._v17ForceJackpot) {
    var jt = slot._v17ForceJackpot;
    for (c = 0; c < 3; c++) {
      for (r = 0; r < 3; r++) {
        slot.outcome[c][r] = jt;
        slot.strips[c][24 + r] = jt;
      }
      slot._v14Locks[c] = false;
    }
    slot.stopDelay = [0.30, 0.54, 0.92];
    return;
  }
  if (slot._v17ForceLine) {
    var p = slot._v17ForceLine;
    for (c = 0; c < 3; c++) {
      slot.outcome[c][p.row] = p.type;
      slot.strips[c][24 + p.row] = p.type;
    }
    slot.stopDelay = [0.30, 0.49, 0.76];
    return;
  }
  slot.stopDelay = [0.30, 0.48, 0.66];
}

function extraResultFx(game, res) {
  var L = game.L;
  var cx = L.slotCX, cy = L.reelsY + L.reelsH * .5;
  var t = tier(res);

  if (t >= 5) {
    FX.text(cx, cy + 18, '命运暴走', { color: C.gold, size: 24, life: 1.25, glow: 1, vy: -22 });
    FX.ring(cx, cy, L.reelsW * 1.15, C.magenta, .85, 10);
    FX.ring(cx, cy, L.reelsW * .72, '#ffffff', .55, 5);
    FX.coins(cx, cy, 24);
  } else if (t >= 4) {
    FX.text(cx, cy - 8, 'BIG WIN', { color: C.gold, size: 32, life: 1.0, glow: 1, vy: -34 });
    FX.ring(cx, cy, L.reelsW, C.gold, .55, 7);
    FX.flash(.24, '#fff3c7');
    FX.shake(12, .34, 38);
  } else if (t >= 3) {
    FX.text(cx, cy - 12, 'NICE!', { color: C.cyan, size: 22, life: .7, glow: 1, vy: -28 });
    FX.ring(cx, cy, L.reelsW * .72, C.cyan, .32, 4);
  } else if (t === 2 && prismCount(res) >= 2) {
    FX.text(cx, cy - 10, 'PRISM', { color: C.magenta, size: 19, life: .65, glow: 1, vy: -26 });
  }

  if (game._v17WinStreak >= 3 && t >= 2) {
    FX.text(cx, cy + 46, '热手 ×' + game._v17WinStreak, { color: C.magenta, size: 17, life: .72, glow: 1, vy: -22 });
  }
}

function rewardMomentum(game, res) {
  var t = tier(res), refund = 0;
  if (t >= 5) refund = 1.0;
  else if (t >= 4) refund = .60;
  else if (t >= 3) refund = .34;
  else if (t >= 2) refund = .16;
  if (refund > 0) {
    game.energy = Math.min(game.energyMax, game.energy + refund);
    if (t >= 4) FX.text(game.L.slotCX, game.L.slotY - 18, '能量返还 +' + refund.toFixed(1), { color: C.cyan, size: 14, life: .7, vy: -26 });
  }
}

function detectAbsorbDelta(before, units) {
  var out = null;
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (!u || u.dead || before[u.id] === undefined) continue;
    var now = unitMass(u);
    if (now > before[u.id].mass) {
      out = { u: u, oldMass: before[u.id].mass, oldLevel: before[u.id].level, mass: now };
      break;
    }
  }
  return out;
}

function absorbJuice(game, delta) {
  if (!delta || !delta.u) return;
  var u = delta.u;
  var now = game.t || 0;
  if (game._v17LastAbsorbAt === undefined || now - game._v17LastAbsorbAt > .85) game._v17AbsorbChain = 0;
  game._v17LastAbsorbAt = now;
  game._v17AbsorbChain = (game._v17AbsorbChain || 0) + 1;

  if (u.level > delta.oldLevel) {
    var big = u.level >= 4;
    FX.ring(u.x, u.y, game.L.cellW * (big ? 1.25 : .92), C.gold, big ? .68 : .42, big ? 8 : 5);
    FX.burst(u.x, u.y, { count: big ? 32 : 20, speed: big ? 290 : 210, colors: [u.color, C.gold, '#ffffff'], life: .65, size: 5, grav: 100 });
    FX.text(u.x, u.y - game.L.cellH * .64, (u.level >= 5 ? 'MAX · 觉醒' : '突破 · Lv' + u.level), { color: C.gold, size: big ? 25 : 20, life: 1.0, glow: 1, vy: -38 });
    if (big) { FX.shake(10, .3, 34); FX.flash(.18, '#ffffff'); }
  } else if (game._v17AbsorbChain >= 2) {
    FX.text(u.x, u.y - game.L.cellH * .48, '吸收 ×' + game._v17AbsorbChain, { color: u.color, size: 15, life: .55, glow: 1, vy: -28 });
    if (game._v17AbsorbChain % 3 === 0) FX.ring(u.x, u.y, game.L.cellW * .68, u.color, .28, 4);
  }
}

export function installV17(Game) {
  if (INSTALLED) return;
  INSTALLED = true;

  var priorReset = Game.prototype.reset;
  Game.prototype.reset = function () {
    var out = priorReset.call(this);
    this._v17DrySpins = 0;
    this._v17JackpotDry = 0;
    this._v17WinStreak = 0;
    this._v17FeverSpins = 0;
    this._v17AbsorbChain = 0;
    this._v17LastAbsorbAt = -99;
    return out;
  };

  // 隐藏保底：不做进度条。连续平淡后逐步抬高结果质量；JACKPOT 也有软保底。
  var priorRoll = SlotMachine.prototype.rollOutcome;
  SlotMachine.prototype.rollOutcome = function () {
    this._v17ForceLine = null;
    this._v17ForceJackpot = null;
    var out = priorRoll.call(this);
    var g = this.g;
    if (!g || allSame(out)) return out;

    var pityType = choosePityType(this);
    var jd = g._v17JackpotDry || 0;
    var jackpotP = jd < 10 ? 0 : Math.min(.72, .08 + (jd - 10) * .09);
    if (jd >= 16 || (jd >= 10 && RNG.chance(jackpotP))) {
      rewriteJackpot(this, out, pityType);
      return out;
    }

    var dry = g._v17DrySpins || 0;
    if (dry >= 6 || (dry >= 4 && RNG.chance(.55))) rewriteLine(this, out, pityType);

    // JACKPOT 后短暂进入 FEVER，两次结果更容易出现棱晶，但不增加按钮。
    if (g._v17FeverSpins > 0) {
      for (var c = 0; c < 3; c++) for (var r = 0; r < 3; r++) if (RNG.chance(.13)) out[c][r] = 'prism';
    }
    return out;
  };

  var priorSlotSpin = SlotMachine.prototype.spin;
  SlotMachine.prototype.spin = function () {
    var ok = priorSlotSpin.call(this);
    if (!ok) return ok;
    applyForcedOutcome(this);
    return true;
  };

  var priorGameSpin = Game.prototype.spin;
  Game.prototype.spin = function () {
    var fever = this._v17FeverSpins || 0;
    var ok = priorGameSpin.call(this);
    if (ok && fever > 0) {
      FX.text(this.L.slotCX, this.L.reelsY - 14, 'FEVER ×' + fever, { color: C.magenta, size: 16, life: .6, glow: 1, vy: -20 });
      this._v17FeverSpins = Math.max(0, fever - 1);
    }
    return ok;
  };

  var priorResult = Game.prototype.onSpinResult;
  Game.prototype.onSpinResult = function (res) {
    var t = tier(res);
    var out = priorResult.call(this, res);

    if (t >= 2) {
      this._v17WinStreak = (this._v17WinStreak || 0) + 1;
      this._v17DrySpins = 0;
    } else {
      this._v17WinStreak = 0;
      this._v17DrySpins = (this._v17DrySpins || 0) + 1;
    }
    if (res && res.jackpot) {
      this._v17JackpotDry = 0;
      this._v17FeverSpins = 2;
    } else this._v17JackpotDry = (this._v17JackpotDry || 0) + 1;

    rewardMomentum(this, res);
    extraResultFx(this, res);
    return out;
  };

  // 自动吸收仍然全自动，但连续喂养和关键突破有更强的视觉反馈。
  var priorPlace = Game.prototype.placeUnit;
  Game.prototype.placeUnit = function (type, withFx) {
    var before = {};
    var units = activeUnits(this);
    for (var i = 0; i < units.length; i++) before[units[i].id] = { mass: unitMass(units[i]), level: units[i].level };
    var out = priorPlace.call(this, type, withFx);
    var delta = detectAbsorbDelta(before, activeUnits(this));
    absorbJuice(this, delta);
    return out;
  };
}
