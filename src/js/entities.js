// entities.js — 单位 / 敌人 / 弹体
'use strict';

import { clamp, RNG, TAU, lerp } from './util.js';
import { UNITS, ENEMIES, Atlas } from './theme.js';
import { FX } from './fx.js';
import { Sfx } from './audio.js';

var _eid = 1;

// ================= 我方单位 =================
export function Unit(type, col, row) {
  var d = UNITS[type];
  this.id = _eid++;
  this.type = type;
  this.col = col;
  this.row = row;
  this.level = 1;
  this.kind = d.kind;
  this.rangeMul = d.range;
  this.splash = d.splash || 0;
  this.color = d.color;
  this.name = d.name;
  this.x = 0; this.y = 0;
  this.hp = d.hp; this.maxHp = d.hp;
  this.dmg = d.dmg;
  this.rate = d.rate;
  this.timer = RNG.range(0, 0.25);
  this.flash = 0;
  this.spawn = 0;          // 出场动画 0->1
  this.pop = 1;            // 受击/合成缩放
  this.recoil = 0;
  this.bob = RNG.range(0, TAU);
  this.muzzle = 0;
  this.kills = 0;
  this.dead = false;
  this.held = false;
  this.dps = 0;
}

Unit.prototype.applyLevel = function (mods) {
  var d = UNITS[this.type];
  var l = this.level;
  var dmgMul = Math.pow(1.75, l - 1) * (mods ? mods.dmg : 1);
  var hpMul = Math.pow(1.6, l - 1);
  var rateMul = Math.pow(0.92, l - 1) / (mods ? mods.rate : 1);
  this.dmg = d.dmg * dmgMul;
  this.maxHp = d.hp * hpMul * (mods ? mods.hp : 1);
  this.rate = d.rate * rateMul;
  var ratio = this.hp / (this._prevMax || this.maxHp);
  this._prevMax = this.maxHp;
  this.hp = clamp(this.maxHp * (isFinite(ratio) && ratio > 0 ? ratio : 1), 1, this.maxHp);
  this.dps = this.dmg / this.rate;
};

Unit.prototype.fullHeal = function () { this.hp = this.maxHp; };

Unit.prototype.sync = function (L) {
  this.x = L.gridX + (this.col + 0.5) * L.cellW;
  this.y = L.gridY + (this.row + 0.5) * L.cellH;
};

Unit.prototype.rangePx = function (L) {
  if (this.rangeMul > 5) return L.fieldH + L.cellH * 2;
  return L.cellH * this.rangeMul * 1.15;
};

Unit.prototype.update = function (dt, G) {
  this.spawn = clamp(this.spawn + dt * 4.5, 0, 1);
  this.bob += dt * 2.2;
  if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 6);
  if (this.pop !== 1) this.pop = lerp(this.pop, 1, 1 - Math.exp(-14 * dt));
  if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 7);
  if (this.muzzle > 0) this.muzzle = Math.max(0, this.muzzle - dt * 9);
  if (this.hp <= 0) return;
  if (this._regen) { this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.03 * dt); }

  this.timer -= dt * (G.paused ? 0 : 1);
  if (this.timer > 0) return;

  var target = G.findTarget(this);
  if (!target) { this.timer = Math.min(this.timer + dt, 0.05); return; }

  this.timer = this.rate;
  this.fire(target, G);
};

Unit.prototype.fire = function (target, G) {
  var L = G.L;
  this.recoil = 1;
  this.muzzle = 1;
  this.pop = 1.16;
  var dmg = this.dmg * (RNG.chance(G.mods.crit) ? G.mods.critMul : 1);
  var crit = dmg > this.dmg * 1.01;

  if (this.kind === 'melee') {
    // 近战：直接判定 + 斩击特效
    var dir = Math.atan2(target.y - this.y, target.x - this.x);
    G.damageEnemy(target, dmg, crit, this);
    FX.sparks(target.x, target.y + target.r * L.cellH * 0.4, dir + Math.PI, this.color, 9);
    FX.ring(target.x, target.y, L.cellW * 0.34, this.color, 0.2, 3);
    Sfx.shoot('melee');
    return;
  }

  var shot = G.shots.obtain();
  shot.x = this.x;
  shot.y = this.y - L.cellH * 0.28;
  shot.ownerType = this.type;
  shot.dmg = dmg;
  shot.crit = crit;
  shot.color = this.color;
  shot.splash = this.splash;
  shot.pierce = this.kind === 'pierce' ? 3 : 0;
  shot.hits = 0;
  shot.life = 2.4;
  shot.hitIds.length = 0;

  var dx = target.x - shot.x, dy = target.y - shot.y;
  var d = Math.sqrt(dx * dx + dy * dy) || 1;
  var spd = this.type === 'cannon' ? 420 : (this.type === 'bow' ? 620 : (this.type === 'prism' ? 760 : 520));
  shot.vx = dx / d * spd;
  shot.vy = dy / d * spd;
  shot.rot = Math.atan2(dy, dx);
  if (this.type === 'bow') { shot.img = 'p_arrow'; shot.w = 30; shot.h = 11; }
  else if (this.type === 'mage') { shot.img = 'p_bolt'; shot.w = 20; shot.h = 20; }
  else if (this.type === 'cannon') { shot.img = 'p_shell'; shot.w = 22; shot.h = 22; }
  else { shot.img = 'p_prism'; shot.w = 18; shot.h = 18; }

  FX.burst(shot.x, shot.y, { count: 4, speed: 90, spread: 0.8, dir: Math.atan2(dy, dx), color: this.color, life: 0.2, size: 3, glow: true });
  Sfx.shoot(this.type);
};

Unit.prototype.hurt = function (dmg, G) {
  this.hp -= dmg;
  this.flash = 1;
  this.pop = 1.22;
  if (this.hp <= 0) {
    this.dead = true;
    FX.burst(this.x, this.y, { count: 18, speed: 210, color: this.color, life: 0.6, size: 5, grav: 300 });
    FX.ring(this.x, this.y, G.L.cellW * 0.7, this.color, 0.35, 4);
    FX.smoke(this.x, this.y, 5);
    FX.shake(5, 0.2);
    Sfx.hurt();
    G.grid[this.col][this.row] = null;
  } else {
    FX.sparks(this.x, this.y - G.L.cellH * 0.15, -Math.PI / 2, '#ff8a8a', 5);
  }
};

Unit.prototype.draw = function (ctx, G) {
  var L = G.L;
  var sc = (0.4 + 0.6 * easeOutBack(this.spawn)) * this.pop;
  var size = L.cellW * 0.66 * sc;
  var bobY = Math.sin(this.bob) * 2.2;
  var x = this.x, y = this.y + bobY;

  // 底座光晕
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.32 + this.muzzle * 0.4;
  var gk = glowKey(this.color);
  var gl = Atlas.img['glow_' + gk];
  if (gl) ctx.drawImage(gl, x - size * 0.95, y - size * 0.95, size * 1.9, size * 1.9);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // 等级环
  if (this.level > 1) {
    ctx.strokeStyle = this.color;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(x, y, size * 0.62, -Math.PI / 2, -Math.PI / 2 + TAU * (this.level - 1) / 4);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 本体
  var img = Atlas.img['u_' + this.type];
  if (img) {
    if (this.recoil > 0) {
      ctx.save();
      ctx.translate(x, y);
      ctx.translate(0, this.recoil * 3);
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
      ctx.restore();
    } else {
      ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    }
  }

  // 受击白闪
  if (this.flash > 0.02) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = this.flash * 0.85;
    if (img) ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // 枪口闪光
  if (this.muzzle > 0.05 && this.kind !== 'melee') {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = this.muzzle * 0.8;
    var mr = size * 0.4 * this.muzzle;
    if (gl) ctx.drawImage(gl, x - mr, y - size * 0.42 - mr, mr * 2, mr * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // 血条（受损时）
  if (this.hp < this.maxHp) {
    var bw = L.cellW * 0.56, bh = 5;
    var bx = x - bw / 2, by = y + size * 0.5 + 6;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    var r = clamp(this.hp / this.maxHp, 0, 1);
    ctx.fillStyle = r > 0.5 ? '#57ff9a' : (r > 0.25 ? '#ffcf4d' : '#ff4d5e');
    ctx.fillRect(bx, by, bw * r, bh);
  }

  // 等级数字
  if (this.level > 1) {
    ctx.font = '900 ' + Math.round(L.cellW * 0.19) + 'px ' + G.font;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,5,15,0.9)';
    var tx = x + size * 0.46, ty = y - size * 0.44;
    ctx.strokeText('Lv' + this.level, tx, ty);
    ctx.fillStyle = '#fff';
    ctx.fillText('Lv' + this.level, tx, ty);
  }
};

function easeOutBack(t) {
  var c = 1.70158, u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

function glowKey(hex) {
  var map = {
    '#ffcf4d': 'gold', '#29e0ff': 'cyan', '#a86bff': 'purple',
    '#57ff9a': 'green', '#ff8a3d': 'orange', '#ff3d81': 'magenta', '#ff4d5e': 'red'
  };
  return map[hex] || 'white';
}
export { glowKey };

// ================= 敌人 =================
export function Enemy(type, lane, y) {
  var d = ENEMIES[type];
  this.id = _eid++;
  this.type = type;
  this.lane = lane;
  this.hp = d.hp; this.maxHp = d.hp;
  this.spd = d.spd;
  this.dmg = d.dmg;
  this.r = d.r;              // 相对 cellW 的半径
  this.score = d.score;
  this.color = d.color;
  this.name = d.name;
  this.x = 0; this.y = y;
  this.state = 'march';      // march | fight | core
  this.target = null;
  this.atk = RNG.range(0.2, 0.8);
  this.flash = 0;
  this.pop = 1;
  this.wob = RNG.range(0, TAU);
  this.jit = RNG.range(-0.22, 0.22);
  this.dead = false;
  this.spawnT = 0;
  this.isBoss = type === 'boss';
  this.summonCd = 3.4;
}

Enemy.prototype.scale = function (hpMul, spdMul) {
  this.maxHp = this.hp = this.hp * hpMul;
  this.spd = this.spd * spdMul;
  this.score = Math.round(this.score * Math.max(1, hpMul * 0.55));
};

Enemy.prototype.update = function (dt, G) {
  var L = G.L;
  this.spawnT = clamp(this.spawnT + dt * 3, 0, 1);
  this.wob += dt * (this.type === 'runner' ? 9 : 3.6);
  if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 7);
  if (this.pop !== 1) this.pop = lerp(this.pop, 1, 1 - Math.exp(-13 * dt));

  var laneX = L.gridX + (this.lane + 0.5 + this.jit * 0.4) * L.cellW;
  this.x = lerp(this.x, laneX, 1 - Math.exp(-9 * dt));

  if (this.isBoss) {
    this.summonCd -= dt;
    if (this.summonCd <= 0 && G.enemies.count() < G.maxEnemies) {
      this.summonCd = 3.2;
      G.spawnEnemy(RNG.chance(0.5) ? 'runner' : 'grunt', RNG.int(0, 2), this.y - L.cellH * 0.4, 1, 1);
      FX.ring(this.x, this.y, L.cellW * 0.9, this.color, 0.4, 4);
    }
  }

  if (this.state === 'fight' && this.target) {
    if (this.target.dead || this.target.held) { this.state = 'march'; this.target = null; }
    else {
      this.atk -= dt;
      if (this.atk <= 0) {
        this.atk = 1.05;
        this.target.hurt(this.dmg * G.mods.enemyDmg, G);
        this.pop = 1.25;
        FX.sparks(this.target.x, this.target.y, Math.PI / 2, this.color, 6);
      }
      return;
    }
  }

  if (this.state === 'core') {
    this.atk -= dt;
    if (this.atk <= 0) {
      this.atk = 1.2;
      G.hitCore(this.dmg * G.mods.enemyDmg);
      this.pop = 1.3;
    }
    return;
  }

  // 行军
  var blocker = G.frontUnit(this.lane);
  var stopY;
  if (blocker) {
    stopY = blocker.y - L.cellH * 0.52 - this.r * L.eScale * 0.4;
    if (this.y >= stopY - 1) {
      this.y = stopY;
      this.state = 'fight';
      this.target = blocker;
      this.atk = 0.35;
      return;
    }
  } else {
    stopY = L.coreY - this.r * L.eScale * 0.5;
    if (this.y >= stopY) {
      this.y = stopY;
      this.state = 'core';
      this.atk = 0.2;
      return;
    }
  }
  this.y += this.spd * dt * (G.slowMo > 0 ? 0.45 : 1);
};

Enemy.prototype.hurt = function (dmg, crit, G) {
  this.hp -= dmg;
  this.flash = 1;
  this.pop = 1.14;
  var L = G.L;
  FX.text(this.x + RNG.range(-8, 8), this.y - this.r * L.eScale * 0.7,
    '' + Math.round(dmg),
    { color: crit ? '#ffcf4d' : '#ffffff', size: crit ? 22 : 16, life: 0.6, vy: -70, glow: crit ? 1 : 0 });
  if (crit) FX.sparks(this.x, this.y, -Math.PI / 2, '#ffcf4d', 6);
  if (this.hp <= 0 && !this.dead) this.die(G);
};

Enemy.prototype.die = function (G) {
  if (this.dead) return;
  this.dead = true;
  var L = G.L;
  var rr = this.r * L.eScale;
  FX.burst(this.x, this.y, {
    count: this.isBoss ? 60 : 16, speed: this.isBoss ? 400 : 200,
    colors: [this.color, '#ffffff', '#ffcf4d'], life: this.isBoss ? 1.0 : 0.55,
    size: this.isBoss ? 8 : 5, grav: 260
  });
  FX.ring(this.x, this.y, rr * (this.isBoss ? 7 : 2.6), this.color, this.isBoss ? 0.7 : 0.3, this.isBoss ? 8 : 4);
  FX.smoke(this.x, this.y, this.isBoss ? 14 : 4, this.color);
  if (this.isBoss) {
    FX.shake(22, 0.7, 30);
    FX.stop(0.16);
    FX.flash(0.6, '#fff0f5');
    Sfx.bossDie();
  } else {
    FX.shake(this.type === 'armor' ? 6 : 3.2, 0.16);
    Sfx.kill();
  }
  G.onEnemyKilled(this);
};

Enemy.prototype.draw = function (ctx, G) {
  var L = G.L;
  var size = this.r * L.eScale * 2 * (0.5 + 0.5 * this.spawnT) * this.pop;
  var x = this.x, y = this.y + Math.sin(this.wob) * (this.type === 'runner' ? 3.5 : 2);
  var img = Atlas.img['e_' + this.type];

  // 阴影
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(x, y + size * 0.46, size * 0.4, size * 0.14, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Boss 光晕
  if (this.isBoss) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35 + Math.sin(this.wob * 1.5) * 0.12;
    var gl = Atlas.img.glow_red;
    if (gl) ctx.drawImage(gl, x - size * 1.1, y - size * 1.1, size * 2.2, size * 2.2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  if (img) ctx.drawImage(img, x - size / 2, y - size / 2, size, size);

  if (this.flash > 0.02) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = this.flash * 0.9;
    if (img) ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // 血条
  if (this.hp < this.maxHp) {
    var bw = Math.max(20, size * 0.8), bh = this.isBoss ? 8 : 4.5;
    var bx = x - bw / 2, by = y - size * 0.5 - bh - 4;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    var r = clamp(this.hp / this.maxHp, 0, 1);
    ctx.fillStyle = this.isBoss ? '#ff4d5e' : (r > 0.4 ? '#ff8a3d' : '#ffcf4d');
    ctx.fillRect(bx, by, bw * r, bh);
    if (this.isBoss) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - 1.5, by - 1.5, bw + 3, bh + 3);
    }
  }
};

// ================= 弹体 =================
export function makeShot() {
  return {
    dead: true, x: 0, y: 0, vx: 0, vy: 0, dmg: 0, crit: false,
    color: '#fff', splash: 0, pierce: 0, hits: 0, life: 2,
    ownerType: 'bow', img: 'p_arrow', w: 24, h: 10, rot: 0, hitIds: []
  };
}

export function updateShot(s, dt, G) {
  var L = G.L;
  s.life -= dt;
  if (s.life <= 0) { s.dead = true; return; }
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  s.rot = Math.atan2(s.vy, s.vx);

  if (s.y < L.fieldTop - 30 || s.y > L.H + 30 || s.x < -40 || s.x > L.W + 40) { s.dead = true; return; }

  var list = G.enemies.live, i, e;
  for (i = 0; i < list.length; i++) {
    e = list[i];
    if (e.dead) continue;
    if (s.hitIds.indexOf(e.id) >= 0) continue;
    var rr = e.r * L.eScale * 0.85;
    var dx = e.x - s.x, dy = e.y - s.y;
    if (dx * dx + dy * dy <= rr * rr) {
      s.hitIds.push(e.id);
      G.damageEnemy(e, s.dmg, s.crit, null);
      FX.sparks(s.x, s.y, Math.atan2(-s.vy, -s.vx), s.color, 5);
      if (s.splash > 0) {
        var sr = s.splash * L.cellW;
        FX.ring(s.x, s.y, sr, s.color, 0.28, 4);
        FX.burst(s.x, s.y, { count: 12, speed: 200, colors: [s.color, '#ffffff'], life: 0.4, size: 5, grav: 160 });
        FX.shake(4, 0.14);
        var j, o;
        for (j = 0; j < list.length; j++) {
          o = list[j];
          if (o === e || o.dead) continue;
          var ddx = o.x - s.x, ddy = o.y - s.y;
          if (ddx * ddx + ddy * ddy <= sr * sr) G.damageEnemy(o, s.dmg * 0.6, false, null);
        }
      }
      s.hits++;
      if (s.hits > s.pierce) { s.dead = true; }
      return;
    }
  }
}

export function drawShot(ctx, s, G) {
  var img = Atlas.img[s.img];
  if (!img) return;
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.rot);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.55;
  ctx.drawImage(img, -s.w, -s.h, s.w * 2, s.h * 2);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(img, -s.w / 2, -s.h / 2, s.w, s.h);
  ctx.restore();
}
