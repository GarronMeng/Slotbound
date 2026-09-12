// progression.js — v1.3 主力锁定 / 随机词条与印记 / 职业分支进化
'use strict';

import { Unit } from './entities.js';
import { C, UNITS, roundRect } from './theme.js';
import { RNG, clamp } from './util.js';
import { FX } from './fx.js';
import { Sfx } from './audio.js';

var INSTALLED = false;

var TRAITS = [
  { id: 'power', name: '猛攻', short: '攻', desc: '攻击 +18%', dmg: 1.18 },
  { id: 'swift', name: '迅捷', short: '速', desc: '攻速 +15%', rate: 0.85 },
  { id: 'sturdy', name: '坚韧', short: '韧', desc: '生命 +24%', hp: 1.24 },
  { id: 'balanced', name: '精良', short: '良', desc: '攻击 +10% · 攻速 +7%', dmg: 1.10, rate: 0.93 }
];

var IMPRINTS = [
  { id: 'hunter', name: '猎手印记', short: '猎', desc: '每次击杀提高伤害，最多 +30%' },
  { id: 'full', name: '满弦印记', short: '满', desc: '生命高于 85% 时伤害 +22%' },
  { id: 'last', name: '背水印记', short: '背', desc: '生命低于 50% 时伤害 +35%' },
  { id: 'focus', name: '专注印记', short: '锁', desc: '锁定为主力时伤害 +20%' }
];

var EVOLUTIONS = {
  guard: [
    { id: 'fortress', name: '壁垒卫士', short: '壁垒', desc: '生命 +55% · 攻击 +5%', hp: 1.55, dmg: 1.05 },
    { id: 'paladin', name: '圣盾骑士', short: '圣盾', desc: '生命 +25% · 攻击 +25% · 攻速 +10%', hp: 1.25, dmg: 1.25, rate: 0.90 }
  ],
  sword: [
    { id: 'berserker', name: '狂战士', short: '狂战', desc: '攻击 +55% · 生命 -10%', dmg: 1.55, hp: 0.90 },
    { id: 'duelist', name: '决斗者', short: '决斗', desc: '攻击 +25% · 攻速 +28%', dmg: 1.25, rate: 0.72 }
  ],
  bow: [
    { id: 'sniper', name: '神射手', short: '神射', desc: '攻击 +65% · 射程 +15% · 攻速 -12%', dmg: 1.65, range: 1.15, rate: 1.12 },
    { id: 'ranger', name: '游侠', short: '游侠', desc: '攻击 +25% · 攻速 +30%', dmg: 1.25, rate: 0.70 }
  ],
  mage: [
    { id: 'archmage', name: '大法师', short: '奥术', desc: '攻击 +50% · 攻速 +10%', dmg: 1.50, rate: 0.90 },
    { id: 'storm', name: '风暴术士', short: '风暴', desc: '攻击 +25% · 攻速 +28%', dmg: 1.25, rate: 0.72 }
  ],
  cannon: [
    { id: 'siege', name: '攻城炮', short: '攻城', desc: '攻击 +70% · 爆炸范围 +35% · 攻速 -18%', dmg: 1.70, splash: 1.35, rate: 1.18 },
    { id: 'barrage', name: '连发炮', short: '连发', desc: '攻击 +25% · 攻速 +32% · 爆炸范围 +15%', dmg: 1.25, splash: 1.15, rate: 0.68 }
  ],
  prism: [
    { id: 'radiant', name: '辉光棱晶', short: '辉光', desc: '攻击 +40% · 攻速 +22%', dmg: 1.40, rate: 0.78 },
    { id: 'void', name: '虚空棱晶', short: '虚空', desc: '攻击 +75% · 生命 -15%', dmg: 1.75, hp: 0.85 }
  ]
};

function pick(arr) { return arr[RNG.int(0, arr.length - 1)]; }

function findEvolution(type, id) {
  var list = EVOLUTIONS[type] || [];
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function ensureProfile(u) {
  if (!u._trait) u._trait = pick(TRAITS);
  if (!u._imprint) u._imprint = pick(IMPRINTS);
  if (u.locked === undefined) u.locked = false;
  if (u._evolution === undefined) u._evolution = null;
  if (u._evoNotified === undefined) u._evoNotified = false;
  if (u._profileBaseRange === undefined) u._profileBaseRange = u.rangeMul;
  if (u._profileBaseSplash === undefined) u._profileBaseSplash = u.splash || 0;
}

function applyProfileStats(u) {
  ensureProfile(u);
  var t = u._trait;
  var e = u._evolution ? findEvolution(u.type, u._evolution) : null;
  var oldRatio = u.maxHp > 0 ? clamp(u.hp / u.maxHp, 0.01, 1) : 1;

  if (t.dmg) u.dmg *= t.dmg;
  if (t.rate) u.rate *= t.rate;
  if (t.hp) u.maxHp *= t.hp;

  u.rangeMul = u._profileBaseRange;
  u.splash = u._profileBaseSplash;
  if (e) {
    if (e.dmg) u.dmg *= e.dmg;
    if (e.rate) u.rate *= e.rate;
    if (e.hp) u.maxHp *= e.hp;
    if (e.range) u.rangeMul *= e.range;
    if (e.splash) u.splash *= e.splash;
  }

  u.hp = clamp(u.maxHp * oldRatio, 1, u.maxHp);
  u._prevMax = u.maxHp;
  // strategy.js 每帧会从这两个基线重新套阵型，因此词条/进化必须写回基线。
  u._strategyBaseDmg = u.dmg;
  u._strategyBaseRate = u.rate;
  u.dps = u.dmg / u.rate;
}

function imprintMultiplier(u) {
  ensureProfile(u);
  var id = u._imprint.id;
  if (id === 'hunter') return 1 + Math.min(0.30, (u.kills || 0) * 0.025);
  if (id === 'full') return (u.maxHp > 0 && u.hp / u.maxHp >= 0.85) ? 1.22 : 1;
  if (id === 'last') return (u.maxHp > 0 && u.hp / u.maxHp <= 0.50) ? 1.35 : 1;
  if (id === 'focus') return u.locked ? 1.20 : 1;
  return 1;
}

function massText(u) {
  if (u.level >= 5) return 'MAX';
  var mass = u._absorbMass === undefined ? Math.pow(2, u.level - 1) : u._absorbMass;
  var next = Math.pow(2, u.level);
  return Math.round(mass) + ' / ' + next;
}

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('unit-progress-style')) return;
  var st = document.createElement('style');
  st.id = 'unit-progress-style';
  st.textContent = '' +
    '.unit-sheet{position:absolute;inset:0;z-index:140;display:none;align-items:flex-end;justify-content:center;background:rgba(5,2,12,.58);backdrop-filter:blur(4px);padding:12px;box-sizing:border-box}' +
    '.unit-sheet.show{display:flex}.unit-card{width:min(430px,100%);max-height:76vh;overflow:auto;border:1px solid rgba(255,207,77,.55);border-radius:22px;background:linear-gradient(180deg,rgba(32,17,58,.98),rgba(12,7,24,.98));box-shadow:0 20px 60px rgba(0,0,0,.55);padding:18px;box-sizing:border-box;color:#fff;font-family:system-ui,-apple-system,sans-serif}' +
    '.unit-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}.unit-name{font-size:22px;font-weight:900}.unit-sub{font-size:12px;opacity:.65;margin-top:3px}.unit-close{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);color:#fff;border-radius:12px;padding:8px 12px;font-weight:800}' +
    '.unit-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}.unit-chip{padding:11px;border-radius:14px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.09)}.unit-chip b{display:block;color:#ffcf4d;margin-bottom:4px}.unit-chip span{font-size:12px;opacity:.76;line-height:1.35}' +
    '.unit-lock{width:100%;margin:4px 0 14px;border:1px solid rgba(41,224,255,.42);background:rgba(41,224,255,.08);color:#fff;border-radius:14px;padding:11px;font-weight:900}.unit-lock.on{border-color:#ffcf4d;background:rgba(255,207,77,.13);color:#ffdf77}' +
    '.evo-title{font-size:13px;font-weight:900;opacity:.72;margin:4px 0 8px}.evo-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.evo-btn{min-height:88px;text-align:left;border-radius:15px;border:1px solid rgba(168,107,255,.45);background:rgba(168,107,255,.08);color:#fff;padding:12px}.evo-btn b{display:block;font-size:15px;margin-bottom:5px;color:#d6b9ff}.evo-btn span{font-size:11px;line-height:1.35;opacity:.75}.evo-btn.chosen{border-color:#ffcf4d;background:rgba(255,207,77,.12)}.evo-wait{padding:12px;border-radius:14px;background:rgba(255,255,255,.045);font-size:12px;opacity:.62;text-align:center}' +
    '.absorb-line{font-size:12px;opacity:.65;margin:8px 0 2px;text-align:right}';
  document.head.appendChild(st);
}

function sheetFor(game) {
  injectStyle();
  var el = document.getElementById('unit-progress-sheet');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'unit-progress-sheet';
  el.className = 'unit-sheet';
  el.innerHTML = '<div class="unit-card" id="unit-progress-card"></div>';
  var stage = document.getElementById('stage') || document.body;
  stage.appendChild(el);
  el.addEventListener('click', function (e) { if (e.target === el) game.closeUnitPanel(); });
  return el;
}

function renderPanel(game, u) {
  if (!u || u.dead) return;
  ensureProfile(u);
  var sheet = sheetFor(game);
  var card = sheet.querySelector('#unit-progress-card');
  var evo = u._evolution ? findEvolution(u.type, u._evolution) : null;
  var opts = EVOLUTIONS[u.type] || [];
  var canEvolve = u.level >= 4 && !u._evolution;
  var html = '';
  html += '<div class="unit-head"><div><div class="unit-name">' + (UNITS[u.type] ? UNITS[u.type].name : u.type) + ' · Lv' + u.level + '</div>';
  html += '<div class="unit-sub">吸收成长 ' + massText(u) + (evo ? ' · ' + evo.name : '') + '</div></div><button class="unit-close" type="button">关闭</button></div>';
  html += '<div class="unit-row"><div class="unit-chip"><b>随机属性 · ' + u._trait.name + '</b><span>' + u._trait.desc + '</span></div>';
  html += '<div class="unit-chip"><b>' + u._imprint.name + '</b><span>' + u._imprint.desc + '</span></div></div>';
  html += '<button class="unit-lock' + (u.locked ? ' on' : '') + '" type="button">' + (u.locked ? '🔒 已锁定主力 · 点击解锁' : '锁定为主力 · 防止被吸收') + '</button>';
  html += '<div class="evo-title">职业分支</div>';
  if (evo) {
    html += '<div class="evo-wait">已进化为 <b>' + evo.name + '</b> · ' + evo.desc + '</div>';
  } else if (canEvolve && opts.length) {
    html += '<div class="evo-grid">';
    for (var i = 0; i < opts.length; i++) html += '<button class="evo-btn" data-evo="' + opts[i].id + '" type="button"><b>' + opts[i].name + '</b><span>' + opts[i].desc + '</span></button>';
    html += '</div>';
  } else {
    html += '<div class="evo-wait">Lv4 解锁职业进化；达到后点击单位选择分支</div>';
  }
  html += '<div class="absorb-line">点击单位查看 · 拖动单位调整阵型</div>';
  card.innerHTML = html;
  card.querySelector('.unit-close').onclick = function () { game.closeUnitPanel(); };
  card.querySelector('.unit-lock').onclick = function () {
    u.locked = !u.locked;
    Sfx.uiTap();
    if (game.ui && game.ui.toast) game.ui.toast(u.locked ? '已锁定主力' : '已解锁主力');
    renderPanel(game, u);
  };
  var buttons = card.querySelectorAll('[data-evo]');
  for (var j = 0; j < buttons.length; j++) buttons[j].onclick = function () {
    game.evolveUnit(u, this.getAttribute('data-evo'));
    renderPanel(game, u);
  };
}

function drawBadge(ctx, G, u) {
  ensureProfile(u);
  var L = G.L;
  var size = Math.max(14, L.cellW * 0.14);
  var x = u.x - L.cellW * 0.27;
  var y = u.y - L.cellH * 0.34;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (u.locked) {
    ctx.fillStyle = 'rgba(9,6,18,.86)';
    roundRect(ctx, x - size * 0.55, y - size * 0.48, size * 1.1, size * 0.96, 5); ctx.fill();
    ctx.strokeStyle = C.gold; ctx.lineWidth = 1.2; roundRect(ctx, x - size * 0.55, y - size * 0.48, size * 1.1, size * 0.96, 5); ctx.stroke();
    ctx.font = '900 ' + Math.round(size * 0.58) + 'px ' + G.font;
    ctx.fillStyle = C.gold; ctx.fillText('锁', x, y + 1);
  }
  if (u._evolution) {
    var e = findEvolution(u.type, u._evolution);
    if (e) {
      ctx.font = '900 ' + Math.round(Math.max(9, size * 0.52)) + 'px ' + G.font;
      ctx.fillStyle = '#d8c0ff';
      ctx.globalAlpha = 0.9;
      ctx.fillText(e.short, u.x, u.y + L.cellH * 0.34);
    }
  }
  ctx.restore();
}

export function installProgression(Game) {
  if (INSTALLED) return;
  INSTALLED = true;

  var origApply = Unit.prototype.applyLevel;
  Unit.prototype.applyLevel = function (mods) {
    origApply.call(this, mods);
    applyProfileStats(this);
  };

  var origFire = Unit.prototype.fire;
  Unit.prototype.fire = function (target, game) {
    ensureProfile(this);
    var base = this.dmg;
    this.dmg = base * imprintMultiplier(this);
    try { return origFire.call(this, target, game); }
    finally { this.dmg = base; }
  };

  var origDraw = Unit.prototype.draw;
  Unit.prototype.draw = function (ctx, game) {
    origDraw.call(this, ctx, game);
    drawBadge(ctx, game, this);
  };

  var priorMerge = Game.prototype.doMerge;
  Game.prototype.doMerge = function (src, dst, auto) {
    if (src && src.locked) {
      if (!auto && this.ui && this.ui.toast) this.ui.toast('该单位已锁定，先解锁再吸收');
      return false;
    }
    return priorMerge.call(this, src, dst, auto);
  };

  var priorDrop = Game.prototype.tryDrop;
  Game.prototype.tryDrop = function (u, c, r) {
    var target = this.grid[c] && this.grid[c][r];
    if (target && target !== u && target.type === u.type && (u.locked || target.locked)) {
      if (u.locked && target.locked) {
        if (this.ui && this.ui.toast) this.ui.toast('两个主力都已锁定');
        return false;
      }
      // 锁定单位永远作为吸收后的保留主力。
      if (u.locked) return this.doMerge(target, u, false);
      return this.doMerge(u, target, false);
    }
    return priorDrop.call(this, u, c, r);
  };

  Game.prototype.evolveUnit = function (u, id) {
    if (!u || u.dead || u.level < 4 || u._evolution) return false;
    var evo = findEvolution(u.type, id);
    if (!evo) return false;
    u._evolution = id;
    u.applyLevel(this.mods);
    u.fullHeal();
    u.pop = 1.8;
    FX.ring(u.x, u.y, this.L.cellW * 1.05, C.gold, 0.65, 7);
    FX.burst(u.x, u.y, { count: 28, speed: 250, colors: [u.color, C.gold, '#ffffff'], life: 0.75, size: 5, grav: 90 });
    FX.text(u.x, u.y - this.L.cellH * 0.52, '进化 · ' + evo.name, { color: C.gold, size: 21, life: 1.2, glow: 1 });
    Sfx.merge(5);
    if (this.ui && this.ui.toast) this.ui.toast('职业进化：' + evo.name);
    return true;
  };

  Game.prototype.openUnitPanel = function (u) {
    if (!u || u.dead || typeof document === 'undefined') return;
    ensureProfile(u);
    this._panelUnit = u;
    this._panelWasPaused = !!this.paused;
    this.paused = true;
    var sheet = sheetFor(this);
    renderPanel(this, u);
    sheet.classList.add('show');
  };

  Game.prototype.closeUnitPanel = function () {
    if (typeof document !== 'undefined') {
      var sheet = document.getElementById('unit-progress-sheet');
      if (sheet) sheet.classList.remove('show');
    }
    this.paused = !!this._panelWasPaused;
    this._panelUnit = null;
  };

  var origUpdate = Game.prototype.update;
  Game.prototype.update = function (dt) {
    origUpdate.call(this, dt);
    if (this.state !== 1) return;
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (!u || u.dead) continue;
      ensureProfile(u);
      if (u.level >= 4 && !u._evolution && !u._evoNotified) {
        u._evoNotified = true;
        if (this.ui && this.ui.toast) this.ui.toast((UNITS[u.type] ? UNITS[u.type].name : u.type) + ' 可职业进化 · 点击查看');
      }
    }
  };
}
