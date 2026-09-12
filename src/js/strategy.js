// strategy.js — v1.1 智能合成 / 高压车道 / 阵型策略 / 战场安全区
'use strict';

import { Unit, Enemy } from './entities.js';
import { C, UNITS, roundRect } from './theme.js';
import { FX } from './fx.js';
import { Sfx } from './audio.js';

var INSTALLED = false;
var ROW_PREF = { guard: 0, sword: 1, mage: 2, bow: 3, cannon: 3, prism: 2 };
var RANGED = { bow: 1, mage: 1, cannon: 1, prism: 1 };
var LANE_NAME = ['左路', '中路', '右路'];

function roleScore(u) {
  var pref = ROW_PREF[u.type] === undefined ? 2 : ROW_PREF[u.type];
  var rowFit = 10 - Math.abs(u.row - pref) * 2;
  var killFit = Math.min(4, (u.kills || 0) * 0.15);
  var hpFit = u.maxHp > 0 ? (u.hp / u.maxHp) : 0;
  return rowFit + killFit + hpFit;
}

function groupPairs(game, type) {
  var groups = {}, i, u, key;
  for (i = 0; i < game.units.length; i++) {
    u = game.units[i];
    if (!u || u.dead || u.held || u.level >= 5) continue;
    if (type && u.type !== type) continue;
    key = u.type + ':' + u.level;
    if (!groups[key]) groups[key] = [];
    groups[key].push(u);
  }
  var best = null, k, list, a, b, score;
  for (k in groups) {
    list = groups[k];
    if (list.length < 2) continue;
    list.sort(function (x, y) { return roleScore(y) - roleScore(x); });
    a = list[0];
    b = list[1];
    score = a.level * 100 + roleScore(a);
    if (!best || score > best.score) best = { src: b, dst: a, score: score };
  }
  return best;
}

function swapUnits(game, a, b) {
  var ac = a.col, ar = a.row;
  game.grid[a.col][a.row] = b;
  game.grid[b.col][b.row] = a;
  a.col = b.col; a.row = b.row;
  b.col = ac; b.row = ar;
  a.sync(game.L); b.sync(game.L);
  a.pop = 1.22; b.pop = 1.22;
  Sfx.uiTap();
}

function promoteIncoming(game, dst) {
  if (!dst || dst.level >= 5) return false;
  dst.level++;
  dst.applyLevel(game.mods);
  dst.fullHeal();
  if (game.mods.unitRegen) dst._regen = 1;
  dst.pop = 1.75;
  game.merges++;
  var L = game.L;
  FX.ring(dst.x, dst.y, L.cellW * 0.95, dst.color, 0.45, 6);
  FX.ring(dst.x, dst.y, L.cellW * 0.6, '#ffffff', 0.3, 3);
  FX.burst(dst.x, dst.y, { count: 24, speed: 235, colors: [dst.color, '#ffffff'], life: 0.6, size: 5, grav: 120 });
  FX.text(dst.x, dst.y - L.cellH * 0.5, '自动合成 · Lv' + dst.level, { color: C.gold, size: 21, life: 1.0, glow: 1 });
  FX.shake(8, 0.25);
  FX.flash(0.16, '#ffffff');
  Sfx.merge(dst.level);
  game.addScore(40 * dst.level, dst.x, dst.y - L.cellH * 0.8, C.gold);
  game._smartMergeT = 0.14;
  return true;
}

function laneDoctrine(game, c) {
  var lane = [], r, u, front = null, ranged = 0, rear = 0;
  for (r = 0; r < game.grid[c].length; r++) {
    u = game.grid[c][r];
    if (!u || u.dead) continue;
    lane.push(u);
    if (!front) front = u;
    if (RANGED[u.type]) { ranged++; rear++; }
  }
  if (!lane.length) return null;

  if (front && front.type === 'guard' && ranged >= 1) {
    return { id: 'wall', name: '盾阵', color: C.green, desc: '前排减伤 · 后排攻速', units: lane };
  }
  if (ranged >= 3) {
    return { id: 'fire', name: '火力网', color: C.cyan, desc: '本路远程伤害 +20%', units: lane };
  }
  if (front && front.type === 'sword' && ranged >= 2) {
    return { id: 'rush', name: '突击线', color: C.gold, desc: '剑士爆发 · 后排增伤', units: lane };
  }
  return null;
}

function refreshFormations(game) {
  var i, u, c, doc;
  for (i = 0; i < game.units.length; i++) {
    u = game.units[i];
    if (u._strategyBaseDmg === undefined) u._strategyBaseDmg = u.dmg;
    if (u._strategyBaseRate === undefined) u._strategyBaseRate = u.rate;
    u.dmg = u._strategyBaseDmg;
    u.rate = u._strategyBaseRate;
    u._formationTaken = 1;
    u._doctrine = null;
  }
  game._laneDoctrine = [null, null, null];
  for (c = 0; c < game.grid.length; c++) {
    doc = laneDoctrine(game, c);
    game._laneDoctrine[c] = doc;
    if (!doc) continue;
    for (i = 0; i < doc.units.length; i++) {
      u = doc.units[i];
      u._doctrine = doc.id;
      if (doc.id === 'wall') {
        if (i === 0) u._formationTaken = 0.76;
        else if (RANGED[u.type]) u.rate = u._strategyBaseRate / 1.16;
      } else if (doc.id === 'fire') {
        if (RANGED[u.type]) u.dmg = u._strategyBaseDmg * 1.20;
      } else if (doc.id === 'rush') {
        if (u.type === 'sword') u.dmg = u._strategyBaseDmg * 1.32;
        else if (RANGED[u.type]) u.dmg = u._strategyBaseDmg * 1.10;
      }
    }
  }
}

function smartMergeStep(game) {
  if (game.held) return false;
  var pair = groupPairs(game);
  if (!pair) { game._smartMergeT = -1; return false; }
  if (game.doMerge(pair.src, pair.dst, true)) {
    game._smartMergeT = 0.14;
    return true;
  }
  game._smartMergeT = -1;
  return false;
}

function applyBattlefieldSafeArea(game) {
  var L = game.L;
  if (!L || !L.fieldBottom) return;

  // HUD 是 DOM 覆盖层，CSS 像素不会跟着 Canvas 逻辑坐标缩放。
  // 84px 对应 HUD + 核心血条的实际高度，再留一段呼吸空间。
  var hudSafe = Math.max(124, 84 / Math.max(0.45, game.scale || 1));
  // 不侵占棋盘主体；极端矮屏至少保留一小段出生行军区。
  var maxTop = Math.max(104, L.gridY - 44);
  L.fieldTop = Math.min(hudSafe, maxTop);
  L.fieldH = Math.max(1, L.fieldBottom - L.fieldTop);
  L.enemyClipTop = L.fieldTop;
  L.enemyClipBottom = L.fieldBottom - 2;
}

function clipBattlefield(game, ctx, draw) {
  var L = game.L;
  ctx.save();
  ctx.beginPath();
  ctx.rect(L.gridX - 8, L.enemyClipTop || L.fieldTop, L.gridW + 16,
    Math.max(1, (L.enemyClipBottom || L.fieldBottom) - (L.enemyClipTop || L.fieldTop)));
  ctx.clip();
  draw();
  ctx.restore();
}

function drawStrategyOverlay(game, ctx) {
  var L = game.L, c, doc, x, y, w, laneW;
  laneW = L.cellW - 14;
  y = L.gridY + 8;

  if (game._pressureLane !== undefined && game._pressureLane >= 0) {
    x = L.gridX + game._pressureLane * L.cellW;
    ctx.fillStyle = 'rgba(255,61,129,0.055)';
    ctx.fillRect(x + 2, L.fieldTop, L.cellW - 4, L.fieldBottom - L.fieldTop);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 13px ' + game.font;
    ctx.fillStyle = C.magenta;
    ctx.fillText('高压', x + L.cellW / 2, L.fieldTop + 15);
  }

  for (c = 0; c < 3; c++) {
    doc = game._laneDoctrine && game._laneDoctrine[c];
    if (!doc) continue;
    x = L.gridX + c * L.cellW + 7;
    w = laneW;
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = 'rgba(8,5,15,0.72)';
    roundRect(ctx, x, y, w, 24, 8); ctx.fill();
    ctx.strokeStyle = doc.color; ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, 24, 8); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 13px ' + game.font;
    ctx.fillStyle = doc.color;
    ctx.fillText(doc.name, x + w / 2, y + 12);
    ctx.globalAlpha = 1;
  }
}

export function installStrategyLayer(Game) {
  if (INSTALLED) return;
  INSTALLED = true;

  var origResize = Game.prototype.resize;
  Game.prototype.resize = function (cw, ch, dpr) {
    origResize.call(this, cw, ch, dpr);
    applyBattlefieldSafeArea(this);
  };

  var origReset = Game.prototype.reset;
  Game.prototype.reset = function () {
    origReset.call(this);
    this._smartMergeT = -1;
    this._pressureLane = -1;
    this._laneDoctrine = [null, null, null];
  };

  var origApplyLevel = Unit.prototype.applyLevel;
  Unit.prototype.applyLevel = function (mods) {
    origApplyLevel.call(this, mods);
    this._strategyBaseDmg = this.dmg;
    this._strategyBaseRate = this.rate;
  };

  var origHurt = Unit.prototype.hurt;
  Unit.prototype.hurt = function (dmg, game) {
    return origHurt.call(this, dmg * (this._formationTaken || 1), game);
  };

  // 敌人到核心前按完整碰撞体停住，避免大型怪物下半身进入老虎机 UI。
  var origEnemyUpdate = Enemy.prototype.update;
  Enemy.prototype.update = function (dt, game) {
    origEnemyUpdate.call(this, dt, game);
    if (this.state === 'core' && game && game.L) {
      var L = game.L;
      var visualRadius = this.r * L.eScale * Math.max(1, this.pop || 1);
      var safeY = L.fieldBottom - visualRadius - 8;
      if (this.y > safeY) this.y = safeY;
    }
  };

  var origStartWave = Game.prototype.startWave;
  Game.prototype.startWave = function (n) {
    origStartWave.call(this, n);
    this._pressureLane = (n * 2 + Math.floor(n / 3)) % 3;
    for (var i = 0; i < this.queue.length; i++) {
      if (((i * 7 + n * 11) % 20) < 11) this.queue[i].lane = this._pressureLane;
    }
    if (this.banner) this.banner.sub += ' · ' + LANE_NAME[this._pressureLane] + '高压';
  };

  var origDoMerge = Game.prototype.doMerge;
  Game.prototype.doMerge = function (src, dst, auto) {
    if (!src || !dst || src === dst) return false;
    if (src.type !== dst.type) return false;
    if (src.level !== dst.level) {
      if (!auto) this.toast('同兵种同等级才能合成');
      return false;
    }
    if (dst.level >= 5) return false;
    var ok = origDoMerge.call(this, src, dst, auto);
    if (ok) {
      this._smartMergeT = 0.14;
      refreshFormations(this);
    }
    return ok;
  };

  var origPlaceUnit = Game.prototype.placeUnit;
  Game.prototype.placeUnit = function (type, withFx) {
    if (this.emptyCells().length === 0) {
      var existing = groupPairs(this);
      if (existing) this.doMerge(existing.src, existing.dst, true);
    }

    if (this.emptyCells().length === 0) {
      var best = null;
      for (var i = 0; i < this.units.length; i++) {
        var u = this.units[i];
        if (u.type === type && u.level === 1 && !u.dead && !u.held) {
          if (!best || roleScore(u) > roleScore(best)) best = u;
        }
      }
      if (best) {
        promoteIncoming(this, best);
        refreshFormations(this);
        return best;
      }
      this.addScore(120, this.L.slotCX, this.L.gridY - 30, C.cyan);
      this.toast('战场已满 · 无可合成单位 +120');
      return null;
    }

    var placed = origPlaceUnit.call(this, type, withFx);
    if (placed) this._smartMergeT = 0.12;
    refreshFormations(this);
    return placed;
  };

  var origTryDrop = Game.prototype.tryDrop;
  Game.prototype.tryDrop = function (u, c, r) {
    if (c < 0 || c >= this.grid.length || r < 0 || r >= this.grid[c].length) return false;
    var target = this.grid[c][r];
    if (target && target !== u && target.type === u.type && target.level !== u.level) {
      swapUnits(this, u, target);
      refreshFormations(this);
      return true;
    }
    var ok = origTryDrop.call(this, u, c, r);
    if (ok) {
      this._smartMergeT = 0.12;
      refreshFormations(this);
    }
    return ok;
  };

  var origUpdate = Game.prototype.update;
  Game.prototype.update = function (dt) {
    refreshFormations(this);
    origUpdate.call(this, dt);
    if (this.state !== 1 || this.paused) return;
    if (this._smartMergeT >= 0) {
      this._smartMergeT -= dt;
      if (this._smartMergeT <= 0) smartMergeStep(this);
    }
  };

  var origDrawField = Game.prototype.drawField;
  Game.prototype.drawField = function (ctx) {
    origDrawField.call(this, ctx);
    drawStrategyOverlay(this, ctx);
  };

  // 敌人只允许画在战场可视区；出生阶段和核心阶段都不会穿到 DOM HUD / 底部老虎机下面。
  var origDrawEnemies = Game.prototype.drawEnemies;
  Game.prototype.drawEnemies = function (ctx) {
    var self = this;
    clipBattlefield(this, ctx, function () { origDrawEnemies.call(self, ctx); });
  };
}
