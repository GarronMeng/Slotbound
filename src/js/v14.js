// v14.js — v1.4 Preparation & Slot Control
'use strict';

import { SlotMachine } from './slots.js';
import { Unit } from './entities.js';
import { waveInfo } from './waves.js';
import { UNITS, C, roundRect } from './theme.js';
import { FX } from './fx.js';
import { Sfx } from './audio.js';

var INSTALLED = false;
var ANCHOR = 24;
var BIAS_TYPES = ['guard', 'sword', 'bow', 'mage', 'cannon', 'prism'];
var ENEMY_NAME = { grunt: '突击', runner: '疾行', armor: '重甲', caster: '术士', boss: '首领' };
var LANE_NAME = ['左路', '中路', '右路'];

function activeUnits(game) {
  var out = [];
  for (var i = 0; i < game.units.length; i++) {
    var u = game.units[i];
    if (u && !u.dead) out.push(u);
  }
  return out;
}

function unitMass(u) {
  return u._absorbMass === undefined ? Math.pow(2, Math.max(0, (u.level || 1) - 1)) : u._absorbMass;
}

function boardCap(game) {
  return Math.max(1, Math.min(6, Math.round((game.mods && game.mods.boardCap) || 5)));
}

function pressureLane(n) {
  return (n * 2 + Math.floor(n / 3)) % 3;
}

function wavePreview(n) {
  var info = waveInfo(n);
  var bits = [];
  for (var i = 0; i < info.groups.length; i++) {
    var g = info.groups[i];
    bits.push((ENEMY_NAME[g.type] || g.type) + '×' + g.count);
  }
  return {
    n: n,
    title: '第 ' + n + ' 波 · ' + info.name,
    lane: LANE_NAME[pressureLane(n)] + '高压',
    enemies: bits.join('  '),
    kind: info.kind
  };
}

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('v14-style')) return;
  var st = document.createElement('style');
  st.id = 'v14-style';
  st.textContent = '' +
    '.v14-tools{position:absolute;z-index:58;display:grid;grid-template-columns:repeat(3,1fr);gap:5px;width:190px;pointer-events:auto}' +
    '.v14-tool{min-height:29px;border-radius:9px;border:1px solid rgba(255,255,255,.16);background:rgba(10,6,20,.82);color:#fff;font:800 11px system-ui,-apple-system,sans-serif;padding:4px 6px;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.24)}' +
    '.v14-tool.on{border-color:#ffcf4d;background:rgba(255,207,77,.15);color:#ffe28a}.v14-tool.bias{grid-column:span 2}.v14-tool.gamble{color:#ff91b9;border-color:rgba(255,61,129,.35)}.v14-tool.gamble.on{background:rgba(255,61,129,.16);border-color:#ff3d81;color:#ffc1d7}' +
    '.v14-prep{position:absolute;z-index:72;display:none;width:420px;box-sizing:border-box;border-radius:18px;padding:14px 16px;background:linear-gradient(180deg,rgba(24,13,45,.96),rgba(9,5,20,.96));border:1px solid rgba(255,207,77,.55);box-shadow:0 16px 50px rgba(0,0,0,.48);color:#fff;font-family:system-ui,-apple-system,sans-serif;pointer-events:auto}' +
    '.v14-prep.show{display:block}.v14-prep-top{display:flex;justify-content:space-between;align-items:center;gap:10px}.v14-prep-title{font-size:18px;font-weight:950}.v14-prep-lane{font-size:12px;font-weight:900;color:#ff6da3;border:1px solid rgba(255,61,129,.35);padding:5px 8px;border-radius:999px;background:rgba(255,61,129,.08)}' +
    '.v14-prep-enemy{margin:9px 0 11px;font-size:12px;line-height:1.45;opacity:.78}.v14-prep-hint{font-size:11px;opacity:.55;margin-bottom:10px}.v14-start{width:100%;border:0;border-radius:13px;padding:11px 12px;background:linear-gradient(180deg,#ffe27c,#d99a18);color:#241405;font-weight:950;font-size:14px;box-shadow:0 5px 18px rgba(255,207,77,.22)}' +
    '.unit-primary{width:100%;margin:-6px 0 14px;border:1px solid rgba(255,207,77,.36);background:rgba(255,207,77,.07);color:#fff;border-radius:14px;padding:11px;font-weight:900}.unit-primary.on{background:rgba(255,207,77,.17);border-color:#ffcf4d;color:#ffe28a}';
  document.head.appendChild(st);
}

function ensureUi(game) {
  if (typeof document === 'undefined') return;
  injectStyle();
  var stage = document.getElementById('stage');
  if (!stage) return;

  var tools = document.getElementById('v14-tools');
  if (!tools) {
    tools = document.createElement('div');
    tools.id = 'v14-tools';
    tools.className = 'v14-tools';
    tools.innerHTML = '' +
      '<button class="v14-tool" data-lock="0" type="button">锁Ⅰ</button>' +
      '<button class="v14-tool" data-lock="1" type="button">锁Ⅱ</button>' +
      '<button class="v14-tool" data-lock="2" type="button">锁Ⅲ</button>' +
      '<button class="v14-tool bias" id="v14-bias" type="button">偏置：无</button>' +
      '<button class="v14-tool gamble" id="v14-gamble" type="button">豪赌 -10HP</button>';
    stage.appendChild(tools);
    var locks = tools.querySelectorAll('[data-lock]');
    for (var i = 0; i < locks.length; i++) locks[i].onclick = function () { game.toggleReelLock(parseInt(this.getAttribute('data-lock'), 10)); };
    tools.querySelector('#v14-bias').onclick = function () { game.cycleSlotBias(); };
    tools.querySelector('#v14-gamble').onclick = function () { game.toggleGamble(); };
  }

  var prep = document.getElementById('v14-prep');
  if (!prep) {
    prep = document.createElement('div');
    prep.id = 'v14-prep';
    prep.className = 'v14-prep';
    prep.innerHTML = '<div class="v14-prep-top"><div class="v14-prep-title" id="v14-prep-title">准备阶段</div><div class="v14-prep-lane" id="v14-prep-lane"></div></div><div class="v14-prep-enemy" id="v14-prep-enemy"></div><div class="v14-prep-hint">可继续拉杆、锁轮、偏置、养成与摆阵；准备好后再开战。</div><button id="v14-start" class="v14-start" type="button">开始下一波</button>';
    stage.appendChild(prep);
    prep.querySelector('#v14-start').onclick = function () { game.beginPreparedWave(); };
  }

  if (!game._v14SheetObserver && typeof MutationObserver !== 'undefined') {
    var card = document.getElementById('unit-progress-card');
    if (card) {
      game._v14SheetObserver = new MutationObserver(function () {
        if (game._panelUnit) injectPrimaryButton(game, game._panelUnit);
      });
      game._v14SheetObserver.observe(card, { childList: true, subtree: false });
    }
  }
}

function injectPrimaryButton(game, u) {
  if (typeof document === 'undefined' || !u || u.dead) return;
  var card = document.getElementById('unit-progress-card');
  if (!card) return;
  var existing = card.querySelector('.unit-primary');
  if (existing) {
    existing.className = 'unit-primary' + (u._primary ? ' on' : '');
    existing.textContent = u._primary ? '⭐ 当前主养 · 异种材料优先喂给他' : '设为 ⭐ 主养单位';
    return;
  }
  var lock = card.querySelector('.unit-lock');
  if (!lock) return;
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'unit-primary' + (u._primary ? ' on' : '');
  btn.textContent = u._primary ? '⭐ 当前主养 · 异种材料优先喂给他' : '设为 ⭐ 主养单位';
  btn.onclick = function () {
    var units = activeUnits(game);
    var turnOff = !!u._primary;
    for (var i = 0; i < units.length; i++) units[i]._primary = false;
    u._primary = !turnOff;
    Sfx.uiTap();
    if (game.ui && game.ui.toast) game.ui.toast(u._primary ? '已设为主养单位' : '已取消主养');
    injectPrimaryButton(game, u);
  };
  lock.insertAdjacentElement('afterend', btn);
}

function syncUi(game) {
  if (typeof document === 'undefined' || !game.L) return;
  ensureUi(game);
  var L = game.L, s = game.scale || 1, ox = game.ox || 0, oy = game.oy || 0;
  var tools = document.getElementById('v14-tools');
  if (tools) {
    var x = ox + (L.reelsX + L.reelsW + 10) * s;
    var y = oy + (L.reelsY + 146) * s;
    tools.style.left = x + 'px';
    tools.style.top = y + 'px';
    tools.style.width = Math.max(124, 190 * s) + 'px';
    tools.style.transformOrigin = 'top left';
    tools.style.transform = 'scale(' + Math.max(.72, Math.min(1, s)) + ')';
    tools.style.display = (game.state === 1 || game._prep) ? 'grid' : 'none';
    var buttons = tools.querySelectorAll('[data-lock]');
    for (var i = 0; i < buttons.length; i++) buttons[i].className = 'v14-tool' + (game.slot._v14Locks && game.slot._v14Locks[i] ? ' on' : '');
    var bias = tools.querySelector('#v14-bias');
    if (bias) {
      var nm = game._biasType && UNITS[game._biasType] ? UNITS[game._biasType].name : '无';
      bias.textContent = '偏置：' + nm + (game._biasSpins > 0 ? '×' + game._biasSpins : '');
      bias.className = 'v14-tool bias' + (game._biasSpins > 0 ? ' on' : '');
    }
    var gamble = tools.querySelector('#v14-gamble');
    if (gamble) gamble.className = 'v14-tool gamble' + (game._gambleQueued ? ' on' : '');
  }

  var prep = document.getElementById('v14-prep');
  if (prep) {
    if (game._prep && game._prepWave) {
      var p = wavePreview(game._prepWave);
      prep.classList.add('show');
      prep.querySelector('#v14-prep-title').textContent = '准备阶段 · ' + p.title;
      prep.querySelector('#v14-prep-lane').textContent = p.lane;
      prep.querySelector('#v14-prep-enemy').textContent = '敌情：' + p.enemies;
      prep.querySelector('#v14-start').textContent = '开始第 ' + p.n + ' 波';
      prep.style.left = (ox + (L.W - 420) * .5 * s) + 'px';
      prep.style.top = (oy + (L.fieldTop + 48) * s) + 'px';
      prep.style.width = (420 * s) + 'px';
    } else prep.classList.remove('show');
  }
}

function drawPrimaryBadge(ctx, game, u) {
  if (!u || !u._primary || u.dead) return;
  var L = game.L;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  var r = Math.max(10, L.cellW * .09);
  var x = u.x + L.cellW * .26, y = u.y - L.cellH * .34;
  ctx.fillStyle = 'rgba(13,8,24,.9)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = C.gold; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.fillStyle = C.gold; ctx.font = '900 ' + Math.round(r * 1.15) + 'px ' + game.font; ctx.fillText('★', x, y + 1);
  ctx.restore();
}

export function installV14(Game) {
  if (INSTALLED) return;
  INSTALLED = true;

  var slotCtor = SlotMachine;
  var origSlotSpin = slotCtor.prototype.spin;
  var origRoll = slotCtor.prototype.rollOutcome;

  slotCtor.prototype.rollOutcome = function () {
    var out = origRoll.call(this);
    var g = this.g;
    if (g && g._biasType && g._biasSpins > 0) {
      for (var c = 0; c < 3; c++) for (var r = 0; r < 3; r++) if (Math.random() < .22) out[c][r] = g._biasType;
    }
    if (g && g._gambleActive) {
      for (var c2 = 0; c2 < 3; c2++) for (var r2 = 0; r2 < 3; r2++) if (Math.random() < .10) out[c2][r2] = 'prism';
    }
    return out;
  };

  slotCtor.prototype.spin = function () {
    var prior = this.result && this.result.outcome ? this.result.outcome : this.outcome;
    var priorPos = this.pos.slice();
    if (!this._v14Locks) this._v14Locks = [false, false, false];
    var ok = origSlotSpin.call(this);
    if (!ok) return ok;
    for (var c = 0; c < 3; c++) {
      if (!this._v14Locks[c] || !prior || !prior[c]) continue;
      this.outcome[c] = prior[c].slice();
      for (var r = 0; r < 3; r++) this.strips[c][ANCHOR + r] = prior[c][r];
      this.pos[c] = priorPos[c];
      this.stopped[c] = true;
      this.vel[c] = 0;
      this.phase[c] = 'stop';
    }
    if (this.g && this.g._biasSpins > 0) this.g._biasSpins--;
    return true;
  };

  var origReset = Game.prototype.reset;
  Game.prototype.reset = function () {
    origReset.call(this);
    this._prep = false;
    this._prepWave = 0;
    this._v14ForceWave = false;
    this._biasType = null;
    this._biasSpins = 0;
    this._biasIndex = -1;
    this._gambleQueued = false;
    this._gambleActive = false;
    if (this.slot) this.slot._v14Locks = [false, false, false];
  };

  var origStartWave = Game.prototype.startWave;
  Game.prototype.startWave = function (n) {
    if (!this._v14ForceWave && this.wave > 0 && n === this.wave + 1) {
      return this.enterPreparation(n);
    }
    return origStartWave.call(this, n);
  };

  Game.prototype.enterPreparation = function (n) {
    this._prep = true;
    this._prepWave = n;
    this.waveEnding = true;
    this.endT = 999999;
    this.queue = [];
    this.spawnT = 0;
    this.combo = 0; this.comboT = 0;
    var p = wavePreview(n);
    this.banner = { text: '准备阶段', sub: p.lane + ' · ' + p.enemies, t: 2.4, color: C.gold };
    if (this.ui && this.ui.toast) this.ui.toast('敌情已公布 · 调整阵容后开战');
    syncUi(this);
    return true;
  };

  Game.prototype.beginPreparedWave = function () {
    if (!this._prep || !this._prepWave) return false;
    var n = this._prepWave;
    this._prep = false;
    this._prepWave = 0;
    this.waveEnding = false;
    this.endT = 0;
    this._v14ForceWave = true;
    try { origStartWave.call(this, n); }
    finally { this._v14ForceWave = false; }
    Sfx.wave();
    syncUi(this);
    return true;
  };

  Game.prototype.toggleReelLock = function (idx) {
    if (!this.slot._v14Locks) this.slot._v14Locks = [false, false, false];
    if (!this.slot.result || !this.slot.result.outcome) { if (this.ui) this.ui.toast('先转一次，再锁定想保留的滚轮'); return false; }
    var next = !this.slot._v14Locks[idx];
    if (next) {
      var n = 0; for (var i = 0; i < 3; i++) if (this.slot._v14Locks[i]) n++;
      if (n >= 2) { if (this.ui) this.ui.toast('最多锁定两列'); return false; }
    }
    this.slot._v14Locks[idx] = next;
    Sfx.uiTap(); syncUi(this); return true;
  };

  Game.prototype.cycleSlotBias = function () {
    this._biasIndex = (this._biasIndex + 1) % BIAS_TYPES.length;
    this._biasType = BIAS_TYPES[this._biasIndex];
    this._biasSpins = 3;
    Sfx.uiTap();
    if (this.ui) this.ui.toast('未来3次偏置：' + (UNITS[this._biasType] ? UNITS[this._biasType].name : this._biasType));
    syncUi(this); return this._biasType;
  };

  Game.prototype.toggleGamble = function () {
    if (!this._gambleQueued && this.coreHp <= 10) { Sfx.deny(); if (this.ui) this.ui.toast('核心生命不足，不能豪赌'); return false; }
    this._gambleQueued = !this._gambleQueued;
    Sfx.uiTap();
    if (this.ui) this.ui.toast(this._gambleQueued ? '豪赌已开启：下次 Spin -10HP，得分×2' : '已取消豪赌');
    syncUi(this); return this._gambleQueued;
  };

  var origGameSpin = Game.prototype.spin;
  Game.prototype.spin = function () {
    if (!this.canSpin()) return origGameSpin.call(this);
    if (this._gambleQueued) {
      if (this.coreHp <= 10) { this._gambleQueued = false; Sfx.deny(); if (this.ui) this.ui.toast('核心生命不足，豪赌取消'); return false; }
      this.coreHp -= 10;
      this._gambleQueued = false;
      this._gambleActive = true;
      FX.text(this.L.slotCX, this.L.slotY - 20, '豪赌 · -10HP', { color: C.magenta, size: 19, life: .9, glow: 1 });
    }
    var ok = origGameSpin.call(this);
    syncUi(this);
    return ok;
  };

  var origResult = Game.prototype.onSpinResult;
  Game.prototype.onSpinResult = function (res) {
    if (this._gambleActive && res) {
      res.score = Math.round((res.score || 0) * 2);
      res.label = '豪赌 · ' + (res.label || '命中');
    }
    var out = origResult.call(this, res);
    if (this._gambleActive) {
      this._gambleActive = false;
      if (this.ui) this.ui.toast('豪赌结算 · 得分×2');
    }
    syncUi(this);
    return out;
  };

  // 满编且抽到一个“新兵种”时，异种材料优先喂给 ⭐主养。
  var origPlace = Game.prototype.placeUnit;
  Game.prototype.placeUnit = function (type, withFx) {
    var units = activeUnits(this);
    var primary = null, same = false;
    for (var i = 0; i < units.length; i++) {
      if (units[i]._primary) primary = units[i];
      if (units[i].type === type) same = true;
    }
    if (primary && !same && units.length >= boardCap(this) && unitMass(primary) < 16) {
      var saved = [];
      for (var j = 0; j < units.length; j++) {
        if (units[j] === primary) continue;
        saved.push({ u: units[j], mass: units[j]._absorbMass });
        units[j]._absorbMass = 16;
      }
      var r;
      try { r = origPlace.call(this, type, withFx); }
      finally {
        for (var k = 0; k < saved.length; k++) {
          if (saved[k].mass === undefined) delete saved[k].u._absorbMass;
          else saved[k].u._absorbMass = saved[k].mass;
        }
      }
      return r;
    }
    return origPlace.call(this, type, withFx);
  };

  // 真正实现“轻点单位查看”：短按同格打开面板，拖动仍按原逻辑摆阵。
  var origPickAt = Game.prototype.pickAt;
  Game.prototype.pickAt = function (x, y) {
    var u = origPickAt.call(this, x, y);
    if (u) this._v14Tap = { u: u, x: x, y: y, t: Date.now() };
    return u;
  };
  var origReleaseAt = Game.prototype.releaseAt;
  Game.prototype.releaseAt = function (x, y) {
    var tap = this._v14Tap;
    this._v14Tap = null;
    var d = tap ? Math.hypot(x - tap.x, y - tap.y) : 999;
    var u = tap && tap.u;
    var out = origReleaseAt.call(this, x, y);
    if (u && !u.dead && d < 12 && Date.now() - tap.t < 420 && this.openUnitPanel) this.openUnitPanel(u);
    return out;
  };

  var origOpenPanel = Game.prototype.openUnitPanel;
  if (origOpenPanel) Game.prototype.openUnitPanel = function (u) {
    var out = origOpenPanel.call(this, u);
    ensureUi(this);
    injectPrimaryButton(this, u);
    return out;
  };

  var origUnitDraw = Unit.prototype.draw;
  Unit.prototype.draw = function (ctx, game) {
    origUnitDraw.call(this, ctx, game);
    drawPrimaryBadge(ctx, game, this);
  };

  var origUpdate = Game.prototype.update;
  Game.prototype.update = function (dt) {
    var out = origUpdate.call(this, dt);
    syncUi(this);
    if (this._panelUnit) injectPrimaryButton(this, this._panelUnit);
    return out;
  };

  var origResize = Game.prototype.resize;
  Game.prototype.resize = function (w, h, dpr) {
    var out = origResize.call(this, w, h, dpr);
    syncUi(this);
    return out;
  };
}
