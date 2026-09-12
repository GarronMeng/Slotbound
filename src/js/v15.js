// v15.js — v1.5 Counterplay & Evolution Identity
'use strict';

import { Unit, Enemy } from './entities.js';
import { waveInfo } from './waves.js';
import { C, UNITS, roundRect } from './theme.js';
import { FX } from './fx.js';

var INSTALLED = false;

var ENEMY_TRAIT = {
  grunt:  { tag: '',   name: '突击', advice: '' },
  runner: { tag: '速', name: '疾行', advice: '疾行 → 弓手克制' },
  armor:  { tag: '甲', name: '重甲', advice: '重甲 → 重炮 / 法师克制' },
  caster: { tag: '术', name: '术士', advice: '术士 → 剑士 / 棱晶克制' },
  boss:   { tag: '首', name: '首领', advice: 'Boss 70%生命后展开屏障 → 近战破盾' }
};

function baseCounter(u, target) {
  if (!u || !target) return 1;
  var m = 1;
  if (target.type === 'runner') {
    if (u.type === 'bow') m *= 1.45;
    else if (u.type === 'mage') m *= 1.12;
    else if (u.type === 'cannon') m *= 0.82;
  } else if (target.type === 'armor') {
    if (u.type === 'cannon') m *= 1.55;
    else if (u.type === 'mage') m *= 1.28;
    else if (u.type === 'bow') m *= 0.78;
  } else if (target.type === 'caster') {
    if (u.type === 'sword') m *= 1.48;
    else if (u.type === 'prism') m *= 1.32;
    else if (u.type === 'cannon') m *= 0.88;
  }

  // Boss 第二阶段为屏障期：远程明显受抑，近战获得破盾优势。
  if (target.isBoss && target._v15BossPhase === 'shield') {
    m *= u.kind === 'melee' ? 1.42 : 0.58;
  }
  return m;
}

function evolutionMultiplier(u, target) {
  if (!u || !u._evolution || !target) return 1;
  var hpR = u.maxHp > 0 ? u.hp / u.maxHp : 1;
  var thp = target.maxHp > 0 ? target.hp / target.maxHp : 1;
  switch (u._evolution) {
    case 'fortress': return 1;
    case 'paladin': return 1.10;
    case 'berserker': return hpR <= 0.50 ? 1.55 : 1;
    case 'duelist': return (target.type === 'caster' || target.isBoss) ? 1.48 : 1;
    case 'sniper': return thp >= 0.78 ? 1.58 : 1;
    case 'ranger': return target.type === 'runner' ? 1.42 : 1;
    case 'archmage': return target.type === 'armor' ? 1.48 : 1;
    case 'storm': return 1;
    case 'siege': return (target.type === 'armor' || target.isBoss) ? 1.55 : 1;
    case 'barrage': return 1;
    case 'radiant': return target.isBoss ? 1.35 : 1.08;
    case 'void': return 1 + (1 - hpR) * 0.55;
    default: return 1;
  }
}

function matchupMultiplier(u, target) {
  return baseCounter(u, target) * evolutionMultiplier(u, target);
}

function findChainTarget(game, primary) {
  if (!game || !primary) return null;
  var list = game.enemies.live, best = null, bestD = 1e9;
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (!e || e.dead || e === primary) continue;
    if (Math.abs(e.lane - primary.lane) > 1) continue;
    var dx = e.x - primary.x, dy = e.y - primary.y;
    var d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function showCounter(game, u, target, mul) {
  if (!game || !u || !target || mul < 1.24) return;
  var now = game.t || 0;
  if (u._v15CounterAt !== undefined && now - u._v15CounterAt < 0.8) return;
  u._v15CounterAt = now;
  FX.text(target.x, target.y - game.L.cellH * 0.46, '克制 ×' + mul.toFixed(1), {
    color: C.cyan, size: 14, life: 0.55, vy: -42, glow: 1
  });
}

function adviceForWave(n) {
  var info = waveInfo(n);
  var present = {}, out = [];
  for (var i = 0; i < info.groups.length; i++) present[info.groups[i].type] = 1;
  var order = ['boss', 'armor', 'runner', 'caster'];
  for (var j = 0; j < order.length; j++) {
    var t = order[j];
    if (present[t] && ENEMY_TRAIT[t] && ENEMY_TRAIT[t].advice) out.push(ENEMY_TRAIT[t].advice);
  }
  if (!out.length) out.push('常规敌群 → 按高压车道调整前后排');
  return out.slice(0, 3).join(' · ');
}

function ensureAdviceUi(game) {
  if (typeof document === 'undefined') return;
  var prep = document.getElementById('v14-prep');
  if (!prep) return;
  var el = document.getElementById('v15-advice');
  if (!el) {
    var st = document.getElementById('v15-style');
    if (!st) {
      st = document.createElement('style');
      st.id = 'v15-style';
      st.textContent = '.v15-advice{margin:-2px 0 10px;padding:8px 10px;border-radius:10px;background:rgba(41,224,255,.07);border:1px solid rgba(41,224,255,.18);color:#b9f6ff;font:800 11px/1.4 system-ui,-apple-system,sans-serif}.v15-advice b{color:#fff}';
      document.head.appendChild(st);
    }
    el = document.createElement('div');
    el.id = 'v15-advice';
    el.className = 'v15-advice';
    var enemy = document.getElementById('v14-prep-enemy');
    if (enemy) enemy.insertAdjacentElement('afterend', el);
    else prep.appendChild(el);
  }
  if (game._prep && game._prepWave) {
    el.innerHTML = '<b>克制建议</b>　' + adviceForWave(game._prepWave);
    el.style.display = 'block';
  } else el.style.display = 'none';
}

function drawEnemyTrait(ctx, enemy, game) {
  if (!enemy || enemy.dead || enemy.type === 'grunt') return;
  var L = game.L;
  var tag = ENEMY_TRAIT[enemy.type] ? ENEMY_TRAIT[enemy.type].tag : '';
  var color = C.cyan;
  if (enemy.isBoss) {
    tag = enemy._v15BossPhase === 'shield' ? '盾' : (enemy._v15BossPhase === 'rage' ? '怒' : '首');
    color = enemy._v15BossPhase === 'rage' ? C.red : C.gold;
  } else if (enemy.type === 'armor') color = C.gold;
  else if (enemy.type === 'caster') color = C.magenta;
  if (!tag) return;

  var rr = enemy.r * L.eScale;
  var w = 24, h = 18;
  var x = enemy.x + rr * 0.48, y = enemy.y - rr * 0.55;
  ctx.save();
  ctx.fillStyle = 'rgba(7,4,16,.84)';
  roundRect(ctx, x - w / 2, y - h / 2, w, h, 6); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 1.2;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, 6); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 11px ' + game.font;
  ctx.fillStyle = color; ctx.fillText(tag, x, y + 1);
  ctx.restore();
}

export function installV15(Game) {
  if (INSTALLED) return;
  INSTALLED = true;

  Game.prototype.v15MatchupMultiplier = function (u, target) { return matchupMultiplier(u, target); };
  Game.prototype.v15WaveAdvice = function (n) { return adviceForWave(n); };

  // 让每个职业分支改变打法，而不仅是面板里的数值百分比。
  var priorFire = Unit.prototype.fire;
  Unit.prototype.fire = function (target, game) {
    var baseDmg = this.dmg;
    var baseSplash = this.splash;
    var mul = matchupMultiplier(this, target);
    var evo = this._evolution;
    this._v15AttackCount = (this._v15AttackCount || 0) + 1;

    this.dmg = baseDmg * mul;
    if (evo === 'siege') this.splash = baseSplash * 1.18;
    showCounter(game, this, target, mul);

    var out;
    try { out = priorFire.call(this, target, game); }
    finally { this.dmg = baseDmg; this.splash = baseSplash; }

    // 连发炮：每第3次攻击追加一发55%威力炮弹。
    if (evo === 'barrage' && this._v15AttackCount % 3 === 0 && target && !target.dead) {
      this.dmg = baseDmg * 0.55;
      try { priorFire.call(this, target, game); }
      finally { this.dmg = baseDmg; }
      FX.text(this.x, this.y - game.L.cellH * 0.42, '连发', { color: this.color, size: 12, life: .45, vy: -32 });
    }

    // 游侠：每第4次攻击追射一次，对疾行目标尤其有效。
    if (evo === 'ranger' && this._v15AttackCount % 4 === 0 && target && !target.dead) {
      this.dmg = baseDmg * 0.48;
      try { priorFire.call(this, target, game); }
      finally { this.dmg = baseDmg; }
    }

    // 风暴术士：每第3次攻击链到相邻目标。
    if (evo === 'storm' && this._v15AttackCount % 3 === 0) {
      var chain = findChainTarget(game, target);
      if (chain) {
        game.damageEnemy(chain, baseDmg * 0.42, false, this);
        FX.ring(chain.x, chain.y, game.L.cellW * .28, C.cyan, .22, 3);
        FX.text(chain.x, chain.y - game.L.cellH * .35, '连锁', { color: C.cyan, size: 12, life: .45, vy: -32 });
      }
    }

    // 圣盾骑士：每次攻击小幅自愈，强化“能扛能打”的身份。
    if (evo === 'paladin' && this.hp > 0 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.025);
    }

    // 辉光棱晶：每第4次攻击修复1点核心生命。
    if (evo === 'radiant' && this._v15AttackCount % 4 === 0 && game.coreHp < game.coreMax) {
      game.coreHp = Math.min(game.coreMax, game.coreHp + 1);
      FX.text(this.x, this.y - game.L.cellH * .45, '核心 +1', { color: C.green, size: 12, life: .5, vy: -34 });
    }
    return out;
  };

  // 壁垒卫士是真正的减伤分支。
  var priorHurt = Unit.prototype.hurt;
  Unit.prototype.hurt = function (dmg, game) {
    if (this._evolution === 'fortress') dmg *= 0.68;
    return priorHurt.call(this, dmg, game);
  };

  // Boss 70%进入屏障期；38%进入狂暴期。屏障期逼玩家使用近战破盾。
  var priorEnemyUpdate = Enemy.prototype.update;
  Enemy.prototype.update = function (dt, game) {
    var out = priorEnemyUpdate.call(this, dt, game);
    if (!this.isBoss || this.dead) return out;
    var ratio = this.maxHp > 0 ? this.hp / this.maxHp : 0;
    if (!this._v15BossPhase && ratio <= 0.70) {
      this._v15BossPhase = 'shield';
      FX.ring(this.x, this.y, game.L.cellW * 1.05, C.cyan, .55, 6);
      if (game.ui && game.ui.toast) game.ui.toast('首领展开屏障 · 远程减伤，近战破盾');
      game.banner = { text: '首领屏障', sub: '近战单位获得破盾优势', t: 1.8, color: C.cyan };
    }
    if (ratio <= 0.38 && this._v15BossPhase !== 'rage') {
      this._v15BossPhase = 'rage';
      this.dmg *= 1.35;
      this.spd *= 1.15;
      this.summonCd = Math.min(this.summonCd, 1.5);
      FX.ring(this.x, this.y, game.L.cellW * 1.15, C.red, .65, 7);
      FX.shake(9, .35, 28);
      if (game.ui && game.ui.toast) game.ui.toast('首领狂暴 · 攻击与召唤加速');
      game.banner = { text: '首领狂暴', sub: '屏障解除 · 尽快集火', t: 1.8, color: C.red };
    }
    if (this._v15BossPhase === 'rage' && this.summonCd > 1.8) this.summonCd -= dt * .65;
    return out;
  };

  var priorEnemyDraw = Enemy.prototype.draw;
  Enemy.prototype.draw = function (ctx, game) {
    priorEnemyDraw.call(this, ctx, game);
    drawEnemyTrait(ctx, this, game);
  };

  var priorUpdate = Game.prototype.update;
  Game.prototype.update = function (dt) {
    var out = priorUpdate.call(this, dt);
    ensureAdviceUi(this);
    return out;
  };

  var priorResize = Game.prototype.resize;
  Game.prototype.resize = function (w, h, dpr) {
    var out = priorResize.call(this, w, h, dpr);
    ensureAdviceUi(this);
    return out;
  };
}
