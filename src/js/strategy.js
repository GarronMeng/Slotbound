// strategy.js — v1.2 自动吸收 / 五人主力 / 高压车道 / 阵型策略
'use strict';

import { Unit, Enemy } from './entities.js';
import { C, UNITS, roundRect } from './theme.js';
import { FX } from './fx.js';
import { Sfx } from './audio.js';

var INSTALLED = false;
var ROW_PREF = { guard: 0, sword: 1, mage: 2, bow: 3, cannon: 3, prism: 2 };
var RANGED = { bow: 1, mage: 1, cannon: 1, prism: 1 };
var LANE_NAME = ['左路', '中路', '右路'];
var MAX_LEVEL = 5;

function roleScore(u) {
  var pref = ROW_PREF[u.type] === undefined ? 2 : ROW_PREF[u.type];
  var rowFit = 10 - Math.abs(u.row - pref) * 2;
  var killFit = Math.min(4, (u.kills || 0) * 0.15);
  var hpFit = u.maxHp > 0 ? (u.hp / u.maxHp) : 0;
  return rowFit + killFit + hpFit;
}

function baseMass(level) {
  return Math.pow(2, Math.max(0, Math.min(MAX_LEVEL, level) - 1));
}

function unitMass(u) {
  var floor = baseMass(u.level || 1);
  if (u._absorbMass === undefined || !isFinite(u._absorbMass) || u._absorbMass < floor) u._absorbMass = floor;
  return u._absorbMass;
}

function levelForMass(mass) {
  var lv = 1;
  while (lv < MAX_LEVEL && mass >= baseMass(lv + 1)) lv++;
  return lv;
}

function activeUnits(game) {
  var out = [];
  for (var i = 0; i < game.units.length; i++) {
    var u = game.units[i];
    if (u && !u.dead) out.push(u);
  }
  return out;
}

function boardCap(game) {
  var n = game.mods && game.mods.boardCap ? game.mods.boardCap : 5;
  return Math.max(1, Math.min(6, Math.round(n)));
}

function removeUnit(game, u) {
  if (!u) return;
  if (game.grid[u.col] && game.grid[u.col][u.row] === u) game.grid[u.col][u.row] = null;
  var i = game.units.indexOf(u);
  if (i >= 0) game.units.splice(i, 1);
  if (game.held === u) game.held = null;
  u.dead = true;
}

function absorbProgress(u) {
  if (u.level >= MAX_LEVEL) return 1;
  var lo = baseMass(u.level);
  var hi = baseMass(u.level + 1);
  return Math.max(0, Math.min(1, (unitMass(u) - lo) / Math.max(1, hi - lo)));
}

function absorptionFx(game, dst, oldLevel, sourceLabel) {
  var L = game.L;
  var leveled = dst.level > oldLevel;
  var p = Math.round(absorbProgress(dst) * 100);
  dst.pop = leveled ? 1.75 : 1.35;
  FX.ring(dst.x, dst.y, L.cellW * (leveled ? 0.95 : 0.72), dst.color, leveled ? 0.45 : 0.3, leveled ? 6 : 4);
  FX.burst(dst.x, dst.y, { count: leveled ? 24 : 12, speed: leveled ? 235 : 145, colors: [dst.color, '#ffffff'], life: 0.5, size: 4, grav: 100 });
  if (leveled) {
    FX.text(dst.x, dst.y - L.cellH * 0.52, '自动吸收 → Lv' + dst.level, { color: C.gold, size: 21, life: 1.0, glow: 1 });
    FX.shake(7, 0.22);
    FX.flash(0.12, '#ffffff');
    Sfx.merge(dst.level);
    game.addScore(40 * dst.level, dst.x, dst.y - L.cellH * 0.8, C.gold);
  } else {
    var txt = dst.level >= MAX_LEVEL ? '已满级' : ('吸收进度 ' + p + '%');
    FX.text(dst.x, dst.y - L.cellH * 0.48, txt, { color: dst.color, size: 16, life: 0.75, glow: 1 });
    Sfx.uiTap();
  }
  if (sourceLabel && game.ui && game.ui.toast) game.ui.toast(sourceLabel + ' → ' + (UNITS[dst.type] ? UNITS[dst.type].name : dst.type));
}

function addMass(game, dst, amount, sourceLabel) {
  if (!dst || dst.dead || amount <= 0) return false;
  var oldLevel = dst.level;
  var maxMass = baseMass(MAX_LEVEL);
  var before = unitMass(dst);
  if (before >= maxMass) return false;
  dst._absorbMass = Math.min(maxMass, before + amount);
  dst.level = levelForMass(dst._absorbMass);
  dst.applyLevel(game.mods);
  if (dst.level > oldLevel) dst.fullHeal();
  else dst.hp = Math.min(dst.maxHp, dst.hp + dst.maxHp * 0.08);
  if (game.mods.unitRegen) dst._regen = 1;
  game.merges++;
  absorptionFx(game, dst, oldLevel, sourceLabel);
  game._smartMergeT = 0.10;
  return true;
}

function absorbUnit(game, src, dst, auto) {
  if (!src || !dst || src === dst || src.dead || dst.dead) return false;
  if (src.type !== dst.type) {
    if (!auto) game.toast('不同兵种只能交换位置');
    return false;
  }
  if (unitMass(dst) >= baseMass(MAX_LEVEL)) {
    if (!auto) game.toast('目标已满级');
    return false;
  }
  var amount = unitMass(src);
  var label = (UNITS[src.type] ? UNITS[src.type].name : src.type) + '自动吸收';
  FX.burst(src.x, src.y, { count: 14, speed: 175, color: src.color, life: 0.45, size: 4 });
  removeUnit(game, src);
  return addMass(game, dst, amount, label);
}

function sameTypeUnits(game, type) {
  return activeUnits(game).filter(function (u) { return u.type === type; });
}

function sameTypeCarry(game, type) {
  var list = sameTypeUnits(game, type).filter(function (u) { return unitMass(u) < baseMass(MAX_LEVEL); });
  if (!list.length) return null;
  list.sort(function (a, b) {
    var dm = unitMass(b) - unitMass(a);
    return dm || (roleScore(b) - roleScore(a));
  });
  return list[0];
}

function weakestFeedTarget(game) {
  var list = activeUnits(game).filter(function (u) { return unitMass(u) < baseMass(MAX_LEVEL); });
  if (!list.length) return null;
  list.sort(function (a, b) {
    var dm = unitMass(a) - unitMass(b);
    return dm || (roleScore(a) - roleScore(b));
  });
  return list[0];
}

function duplicatePair(game) {
  var groups = {}, i, u;
  var units = activeUnits(game);
  for (i = 0; i < units.length; i++) {
    u = units[i];
    if (u.held) continue;
    if (!groups[u.type]) groups[u.type] = [];
    groups[u.type].push(u);
  }
  var best = null, type, list, dst, src, score;
  for (type in groups) {
    list = groups[type];
    if (list.length < 2) continue;
    list.sort(function (a, b) {
      var dm = unitMass(b) - unitMass(a);
      return dm || (roleScore(b) - roleScore(a));
    });
    dst = list[0];
    src = list[list.length - 1];
    if (unitMass(dst) >= baseMass(MAX_LEVEL)) {
      if (list.length < 3) continue;
      dst = list[1]; src = list[list.length - 1];
    }
    score = unitMass(src) + unitMass(dst) * 10;
    if (!best || score > best.score) best = { src: src, dst: dst, score: score };
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

function laneDoctrine(game, c) {
  var lane = [], r, u, front = null, ranged = 0;
  for (r = 0; r < game.grid[c].length; r++) {
    u = game.grid[c][r];
    if (!u || u.dead) continue;
    lane.push(u);
    if (!front) front = u;
    if (RANGED[u.type]) ranged++;
  }
  if (!lane.length) return null;
  if (front && front.type === 'guard' && ranged >= 1) return { id: 'wall', name: '盾阵', color: C.green, desc: '前排减伤 · 后排攻速', units: lane };
  if (ranged >= 3) return { id: 'fire', name: '火力网', color: C.cyan, desc: '本路远程伤害 +20%', units: lane };
  if (front && front.type === 'sword' && ranged >= 2) return { id: 'rush', name: '突击线', color: C.gold, desc: '剑士爆发 · 后排增伤', units: lane };
  return null;
}

function refreshFormations(game) {
  var i, u, c, doc;
  for (i = 0; i < game.units.length; i++) {
    u = game.units[i];
    if (!u || u.dead) continue;
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
  var pair = duplicatePair(game);
  if (!pair) { game._smartMergeT = -1; return false; }
  if (absorbUnit(game, pair.src, pair.dst, true)) {
    refreshFormations(game);
    game._smartMergeT = 0.10;
    return true;
  }
  game._smartMergeT = -1;
  return false;
}

function applyBattlefieldSafeArea(game) {
  var L = game.L;
  if (!L || !L.fieldBottom) return;
  var hudSafe = Math.max(124, 84 / Math.max(0.45, game.scale || 1));
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

  var alive = activeUnits(game).length;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = '800 12px ' + game.font;
  ctx.fillStyle = 'rgba(255,255,255,0.58)';
  ctx.fillText('主力 ' + alive + '/' + boardCap(game), L.gridX + 4, L.fieldBottom - 16);

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

  Game.prototype.doMerge = function (src, dst, auto) {
    var ok = absorbUnit(this, src, dst, auto);
    if (ok) refreshFormations(this);
    return ok;
  };

  var origPlaceUnit = Game.prototype.placeUnit;
  Game.prototype.placeUnit = function (type, withFx) {
    var same = sameTypeUnits(this, type);
    var carry = sameTypeCarry(this, type);

    // 场上已有同兵种：永远作为材料处理，避免重复兵种重新占格。
    if (same.length) {
      if (carry) {
        addMass(this, carry, 1, (UNITS[type] ? UNITS[type].name : type) + '新兵自动吸收');
        refreshFormations(this);
        return carry;
      }
      // 同兵种主力已满级，材料转喂其他未满级主力；全满级则转分数。
      var overflowTarget = weakestFeedTarget(this);
      if (overflowTarget) {
        addMass(this, overflowTarget, 1, (UNITS[type] ? UNITS[type].name : type) + '溢出材料');
        refreshFormations(this);
        return overflowTarget;
      }
      this.addScore(180, this.L.slotCX, this.L.gridY - 30, C.cyan);
      this.toast('主力全员满级 · 多余召唤 +180');
      return null;
    }

    var alive = activeUnits(this);
    if (alive.length < boardCap(this)) {
      var placed = origPlaceUnit.call(this, type, withFx);
      if (placed) {
        placed._absorbMass = baseMass(placed.level);
        this._smartMergeT = 0.08;
      }
      refreshFormations(this);
      return placed;
    }

    var target = weakestFeedTarget(this);
    if (target) {
      addMass(this, target, 1, (UNITS[type] ? UNITS[type].name : type) + '材料自动吸收');
      refreshFormations(this);
      return target;
    }

    this.addScore(180, this.L.slotCX, this.L.gridY - 30, C.cyan);
    this.toast('主力全员满级 · 多余召唤 +180');
    return null;
  };

  var origTryDrop = Game.prototype.tryDrop;
  Game.prototype.tryDrop = function (u, c, r) {
    if (c < 0 || c >= this.grid.length || r < 0 || r >= this.grid[c].length) return false;
    var target = this.grid[c][r];
    if (target && target !== u && target.type === u.type) {
      var src = unitMass(u) <= unitMass(target) ? u : target;
      var dst = src === u ? target : u;
      if (unitMass(dst) < baseMass(MAX_LEVEL)) {
        var okAbsorb = absorbUnit(this, src, dst, false);
        if (okAbsorb) refreshFormations(this);
        return okAbsorb;
      }
      this.toast('目标已满级');
      return false;
    }
    var ok = origTryDrop.call(this, u, c, r);
    if (ok) refreshFormations(this);
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

  var origDrawEnemies = Game.prototype.drawEnemies;
  Game.prototype.drawEnemies = function (ctx) {
    var self = this;
    clipBattlefield(this, ctx, function () { origDrawEnemies.call(self, ctx); });
  };
}
