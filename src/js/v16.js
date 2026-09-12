// v16.js — v1.6 Focus UX：默认自动，爽感优先
'use strict';

import { SlotMachine } from './slots.js';
import { waveInfo } from './waves.js';
import { UNITS, C, roundRect } from './theme.js';

var INSTALLED = false;
var AUTO_PREP_SECONDS = 1.9;

function activeUnits(game) {
  var out = [];
  for (var i = 0; i < game.units.length; i++) {
    var u = game.units[i];
    if (u && !u.dead) out.push(u);
  }
  return out;
}

function mass(u) {
  return u && u._absorbMass !== undefined ? u._absorbMass : Math.pow(2, Math.max(0, (u && u.level ? u.level : 1) - 1));
}

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('v16-style')) return;
  var st = document.createElement('style');
  st.id = 'v16-style';
  st.textContent = '' +
    '#v14-tools{display:none!important}' +
    '.v14-prep{left:12px!important;top:96px!important;width:calc(100% - 24px)!important;padding:8px 10px!important;border-radius:12px!important;background:rgba(14,8,27,.91)!important;border-color:rgba(255,255,255,.12)!important;box-shadow:0 8px 24px rgba(0,0,0,.25)!important;backdrop-filter:blur(8px)}' +
    '.v14-prep-top{gap:6px!important}.v14-prep-title{font-size:13px!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.v14-prep-lane{font-size:10px!important;padding:3px 6px!important}' +
    '.v14-prep-enemy{margin:3px 0 0!important;font-size:11px!important;line-height:1.3!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.72!important}' +
    '.v14-prep-hint,.v14-start,#v15-advice{display:none!important}' +
    '.unit-primary{display:none!important}';
  document.head.appendChild(st);
}

function waveProfile(n) {
  var info = waveInfo(n);
  var counts = { grunt:0, runner:0, armor:0, caster:0, boss:0 };
  for (var i = 0; i < info.groups.length; i++) {
    var g = info.groups[i];
    counts[g.type] = (counts[g.type] || 0) + g.count;
  }
  var priority = 'grunt';
  if (counts.boss) priority = 'boss';
  else if (counts.armor >= Math.max(counts.runner, counts.caster, 2)) priority = 'armor';
  else if (counts.caster >= Math.max(counts.runner, 2)) priority = 'caster';
  else if (counts.runner >= 2) priority = 'runner';
  return { info: info, counts: counts, priority: priority };
}

function recommendedType(game, n) {
  var p = waveProfile(n);
  if (p.priority === 'armor') return 'cannon';
  if (p.priority === 'caster') return 'sword';
  if (p.priority === 'runner') return 'bow';
  if (p.priority === 'boss') {
    var units = activeUnits(game), best = null;
    for (var i = 0; i < units.length; i++) if (units[i].kind === 'melee' && (!best || mass(units[i]) > mass(best))) best = units[i];
    return best ? best.type : 'sword';
  }
  var primary = activeUnits(game).filter(function (u) { return u._primary; })[0];
  return primary ? primary.type : 'bow';
}

function shortCue(game, n) {
  var p = waveProfile(n), bits = [];
  var names = { grunt:'突击', runner:'疾行', armor:'重甲', caster:'术士', boss:'首领' };
  ['boss','armor','runner','caster','grunt'].forEach(function (k) {
    if (p.counts[k]) bits.push(names[k] + '×' + p.counts[k]);
  });
  var rec = recommendedType(game, n);
  var recName = UNITS[rec] ? UNITS[rec].name : rec;
  return bits.slice(0, 2).join(' · ') + '　推荐 ' + recName;
}

function ensurePrimary(game) {
  var units = activeUnits(game);
  if (!units.length) return null;
  for (var i = 0; i < units.length; i++) if (units[i]._primary) return units[i];
  var best = units[0], bestScore = -1;
  for (var j = 0; j < units.length; j++) {
    var u = units[j];
    var score = mass(u) * 4 + (u.level || 1) * 3 + (u._evolution ? 4 : 0) + Math.min(4, (u.kills || 0) * .15);
    if (u._trait && (u._trait.id === 'power' || u._trait.id === 'balanced')) score += 1.5;
    if (score > bestScore) { bestScore = score; best = u; }
  }
  best._primary = true;
  best._v16AutoPrimary = true;
  return best;
}

function chooseEvolution(game, u, n) {
  if (!u || u.dead || u.level < 4 || u._evolution || !game.evolveUnit) return false;
  var p = waveProfile(n || Math.max(1, game.wave + 1));
  var id = null;
  if (u.type === 'guard') id = (p.priority === 'boss' || p.priority === 'armor') ? 'fortress' : 'paladin';
  else if (u.type === 'sword') id = (p.priority === 'caster' || p.priority === 'boss') ? 'duelist' : 'berserker';
  else if (u.type === 'bow') id = p.priority === 'runner' ? 'ranger' : 'sniper';
  else if (u.type === 'mage') id = p.priority === 'armor' ? 'archmage' : 'storm';
  else if (u.type === 'cannon') id = (p.priority === 'armor' || p.priority === 'boss') ? 'siege' : 'barrage';
  else if (u.type === 'prism') id = game.coreHp < game.coreMax * .65 ? 'radiant' : 'void';
  if (!id) return false;
  return game.evolveUnit(u, id);
}

function autoTune(game, n) {
  ensurePrimary(game);
  var type = recommendedType(game, n);
  game._biasType = type;
  game._biasSpins = 2;
  game._biasIndex = -1;
  var units = activeUnits(game);
  for (var i = 0; i < units.length; i++) chooseEvolution(game, units[i], n);
}

function updateCompactPrep(game) {
  if (typeof document === 'undefined') return;
  injectStyle();
  var prep = document.getElementById('v14-prep');
  if (!prep || !game._prep || !game._prepWave) return;
  var title = document.getElementById('v14-prep-title');
  var lane = document.getElementById('v14-prep-lane');
  var enemy = document.getElementById('v14-prep-enemy');
  if (title) title.textContent = '下一波 · 第 ' + game._prepWave + ' 波';
  if (lane) lane.textContent = '自动开战 ' + Math.max(0, game._v16PrepTimer || 0).toFixed(1) + 's';
  if (enemy) enemy.textContent = shortCue(game, game._prepWave);
}

function smartLock(game) {
  var slot = game.slot;
  if (!slot || !slot.result || !slot.result.outcome) return;
  if (!slot._v14Locks) slot._v14Locks = [false,false,false];

  // 尊重玩家手动锁定；只有没有手动锁时才使用一次性智能锁。
  if (game._v16ManualLock) return;
  for (var c = 0; c < 3; c++) slot._v14Locks[c] = false;

  var out = slot.result.outcome;
  var target = game._biasType || (ensurePrimary(game) || {}).type;
  var best = -1, bestScore = 0;
  for (var i = 0; i < 3; i++) {
    var score = 0;
    for (var r = 0; r < 3; r++) {
      if (out[i][r] === 'prism') score += 3;
      else if (target && out[i][r] === target) score += 2;
    }
    if (score > bestScore) { bestScore = score; best = i; }
  }
  if (best >= 0 && bestScore >= 4) {
    slot._v14Locks[best] = true;
    slot._v16SmartLocked = best;
  } else slot._v16SmartLocked = -1;
}

function drawSmartLocks(ctx, slot, game) {
  if (!slot._v14Locks) return;
  var L = game.L;
  var cw = L.reelsW / 3;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (var c = 0; c < 3; c++) {
    if (!slot._v14Locks[c]) continue;
    var x = L.reelsX + (c + .5) * cw;
    var y = L.reelsY + 13;
    ctx.fillStyle = 'rgba(8,5,15,.82)';
    roundRect(ctx, x - 17, y - 9, 34, 18, 8); ctx.fill();
    ctx.strokeStyle = C.gold; ctx.lineWidth = 1.1;
    roundRect(ctx, x - 17, y - 9, 34, 18, 8); ctx.stroke();
    ctx.fillStyle = C.gold; ctx.font = '900 10px ' + game.font; ctx.fillText('锁定', x, y + .5);
  }
  ctx.restore();
}

function quietToast(msg) {
  if (!msg) return false;
  return msg.indexOf('自动吸收') >= 0 || msg.indexOf('材料自动吸收') >= 0 || msg.indexOf('溢出材料') >= 0 || msg.indexOf('敌情已公布') >= 0;
}

export function installV16(Game) {
  if (INSTALLED) return;
  INSTALLED = true;

  injectStyle();

  var priorReset = Game.prototype.reset;
  Game.prototype.reset = function () {
    var out = priorReset.call(this);
    this._v16PrepTimer = 0;
    this._v16WasPrep = false;
    this._v16ManualLock = false;
    return out;
  };

  var priorEnter = Game.prototype.enterPreparation;
  if (priorEnter) Game.prototype.enterPreparation = function (n) {
    var out = priorEnter.call(this, n);
    this._v16PrepTimer = AUTO_PREP_SECONDS;
    this._v16WasPrep = true;
    autoTune(this, n);
    updateCompactPrep(this);
    return out;
  };

  // 日常提示收敛到战场特效，只有关键升级/Boss/失败信息才弹 Toast。
  var priorToast = Game.prototype.toast;
  Game.prototype.toast = function (msg) {
    if (quietToast(msg)) return;
    return priorToast.call(this, msg);
  };

  // 玩家主动拖阵型时给准备阶段多一点时间，不会和自动开战抢操作。
  var priorPick = Game.prototype.pickAt;
  Game.prototype.pickAt = function (x, y) {
    var u = priorPick.call(this, x, y);
    if (u && this._prep) this._v16PrepTimer = Math.max(this._v16PrepTimer || 0, 2.8);
    return u;
  };

  var priorToggleLock = Game.prototype.toggleReelLock;
  if (priorToggleLock) Game.prototype.toggleReelLock = function (idx) {
    this._v16ManualLock = true;
    var out = priorToggleLock.call(this, idx);
    if (this._prep) this._v16PrepTimer = Math.max(this._v16PrepTimer || 0, 2.4);
    return out;
  };

  // 每次 Spin 前自动识别“值得保留”的一列；玩家手动锁轮时则完全尊重玩家。
  var priorSpin = Game.prototype.spin;
  Game.prototype.spin = function () {
    if (this.slot && this.slot.state !== 'spinning') smartLock(this);
    return priorSpin.call(this);
  };

  // 锁轮反馈直接画在滚轮上，不再需要常驻控制面板。
  var priorSlotDraw = SlotMachine.prototype.draw;
  SlotMachine.prototype.draw = function (ctx, game) {
    var out = priorSlotDraw.call(this, ctx, game);
    drawSmartLocks(ctx, this, game);
    return out;
  };

  // 隐藏阵型名称牌，只保留实际 Buff 和高压车道，减少战场中文字。
  var priorDrawField = Game.prototype.drawField;
  Game.prototype.drawField = function (ctx) {
    var saved = this._laneDoctrine;
    if (saved) this._laneDoctrine = [null,null,null];
    try { return priorDrawField.call(this, ctx); }
    finally { if (saved) this._laneDoctrine = saved; }
  };

  var priorUpdate = Game.prototype.update;
  Game.prototype.update = function (dt) {
    var out = priorUpdate.call(this, dt);
    ensurePrimary(this);

    if (this._prep && this._prepWave) {
      var busy = this.paused || this.held || this._panelUnit || (this.slot && this.slot.state === 'spinning') || (this.pending && this.pending.length);
      if (!busy) this._v16PrepTimer = Math.max(0, (this._v16PrepTimer || AUTO_PREP_SECONDS) - dt);
      updateCompactPrep(this);
      if (!busy && this._v16PrepTimer <= 0 && this.beginPreparedWave) this.beginPreparedWave();
    } else {
      this._v16PrepTimer = 0;
      this._v16WasPrep = false;
    }
    return out;
  };

  var priorResize = Game.prototype.resize;
  Game.prototype.resize = function (w, h, dpr) {
    var out = priorResize.call(this, w, h, dpr);
    injectStyle();
    updateCompactPrep(this);
    return out;
  };
}
