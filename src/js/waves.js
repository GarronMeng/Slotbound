// waves.js — 波次表 / 难度曲线
'use strict';

import { RNG } from './util.js';

export var TOTAL_WAVES = 20;

/** 波次种类 */
export function waveKind(n) {
  if (n % 5 === 0) return 'boss';
  if (n === 9 || n === 14 || n === 19) return 'swarm';
  if (n % 5 === 3) return 'elite';
  return 'normal';
}

export var KIND_NAME = {
  normal: '常规突袭',
  elite: '精英压境',
  swarm: '审判狂潮',
  boss: '审判者降临'
};

export function waveInfo(n) {
  var kind = waveKind(n);
  var hpMul = Math.pow(1.165, n - 1);
  var spdMul = 1 + Math.min(0.45, (n - 1) * 0.022);
  var groups = [];
  var base = 4 + Math.floor(n * 0.85);

  if (kind === 'boss') {
    groups.push({ type: 'boss', count: 1, gap: 0, delay: 0.6 });
    var adds = 2 + Math.floor(n / 5);
    groups.push({ type: 'grunt', count: adds, gap: 0.55, delay: 2.2 });
    groups.push({ type: 'runner', count: Math.floor(adds / 2) + 1, gap: 0.7, delay: 4.0 });
  } else if (kind === 'swarm') {
    groups.push({ type: 'grunt', count: Math.round(base * 1.2), gap: 0.34, delay: 0.2 });
    groups.push({ type: 'runner', count: Math.round(base * 0.7), gap: 0.3, delay: 1.4 });
  } else if (kind === 'elite') {
    groups.push({ type: 'armor', count: Math.max(2, Math.round(base * 0.42)), gap: 0.9, delay: 0.3 });
    groups.push({ type: 'caster', count: Math.max(2, Math.round(base * 0.5)), gap: 0.6, delay: 1.2 });
    groups.push({ type: 'grunt', count: Math.round(base * 0.4), gap: 0.4, delay: 2.0 });
  } else {
    groups.push({ type: 'grunt', count: Math.round(base * 0.8), gap: 0.5, delay: 0.2 });
    if (n >= 3) groups.push({ type: 'runner', count: Math.round(base * 0.35), gap: 0.42, delay: 1.0 });
    if (n >= 6) groups.push({ type: 'armor', count: Math.max(1, Math.round(base * 0.2)), gap: 0.95, delay: 1.8 });
    if (n >= 8) groups.push({ type: 'caster', count: Math.max(1, Math.round(base * 0.22)), gap: 0.6, delay: 2.4 });
  }

  var total = 0, i, j;
  for (i = 0; i < groups.length; i++) total += groups[i].count;
  return { kind: kind, name: KIND_NAME[kind], hpMul: hpMul, spdMul: spdMul, groups: groups, total: total };
}

/** 生成具体出生序列（含延迟与车道） */
export function buildSpawnQueue(info, laneCount) {
  var q = [], i, j;
  for (i = 0; i < info.groups.length; i++) {
    var g = info.groups[i];
    for (j = 0; j < g.count; j++) {
      q.push({
        type: g.type,
        lane: RNG.int(0, laneCount - 1),
        t: g.delay + j * g.gap + RNG.range(0, g.gap * 0.35)
      });
    }
  }
  q.sort(function (a, b) { return a.t - b.t; });
  return q;
}

// ---------- 升级卡（核心 / Core） ----------
export var CARD_POOL = [
  { id: 'dmg', name: '锋锐核心', desc: '全体攻击 +20%', icon: '刃', color: '#ffcf4d', apply: function (m) { m.dmg *= 1.2; } },
  { id: 'rate', name: '疾风核心', desc: '全体攻速 +15%', icon: '疾', color: '#29e0ff', apply: function (m) { m.rate *= 1.15; } },
  { id: 'hp', name: '磐石核心', desc: '全体生命 +25%', icon: '生', color: '#57ff9a', apply: function (m) { m.hp *= 1.25; } },
  { id: 'core', name: '堡垒核心', desc: '核心上限 +30 并回满', icon: '堡', color: '#57ff9a', apply: function (m) { m.coreMax += 30; m.coreHeal = 999; } },
  { id: 'energy', name: '涌能核心', desc: '能量上限 +1', icon: '能', color: '#a86bff', apply: function (m) { m.energyMax += 1; m.energyGain = 1; } },
  { id: 'regen', name: '循环核心', desc: '能量回复 +30%', icon: '环', color: '#a86bff', apply: function (m) { m.energyRate *= 1.3; } },
  { id: 'crit', name: '破绽核心', desc: '暴击率 +14%', icon: '暴', color: '#ff3d81', apply: function (m) { m.crit += 0.14; } },
  { id: 'critmul', name: '处决核心', desc: '暴击伤害 +60%', icon: '决', color: '#ff4d5e', apply: function (m) { m.critMul += 0.6; } },
  { id: 'summon', name: '增殖核心', desc: '每次召唤 +1 单位', icon: '增', color: '#ff8a3d', apply: function (m) { m.extraSummon += 1; } },
  { id: 'combo', name: '连锁核心', desc: '连击得分 +50%', icon: '连', color: '#ffcf4d', apply: function (m) { m.comboBonus *= 1.5; } },
  { id: 'regenhp', name: '再生核心', desc: '单位每秒回复 3% 生命', icon: '复', color: '#57ff9a', apply: function (m) { m.unitRegen = 1; } },
  { id: 'luck', name: '命运核心', desc: '棱晶概率 ×3', icon: '命', color: '#ff3d81', apply: function (m) { m.prismBias *= 3; } },
  { id: 'slow', name: '凝滞核心', desc: '敌人移速 -12%', icon: '滞', color: '#29e0ff', apply: function (m) { m.enemySpd *= 0.88; } },
  { id: 'armor', name: '蚀甲核心', desc: '敌人伤害 -18%', icon: '蚀', color: '#6f86c9', apply: function (m) { m.enemyDmg *= 0.82; } }
];

export function defaultMods() {
  return {
    dmg: 1, rate: 1, hp: 1,
    coreMax: 100, coreHeal: 0,
    energyMax: 3, energyRate: 1, energyGain: 0,
    crit: 0.06, critMul: 2.0,
    extraSummon: 0, comboBonus: 1,
    unitRegen: 0, prismBias: 1,
    enemySpd: 1, enemyDmg: 1
  };
}

/** 抽三张不重复的卡 */
export function rollCards(owned) {
  var avail = [], i;
  for (i = 0; i < CARD_POOL.length; i++) {
    var c = CARD_POOL[i];
    if (owned[c.id] && (c.id === 'core' || c.id === 'energy')) continue; // 上限类只给一次
    avail.push(c);
  }
  RNG.shuffle(avail);
  return avail.slice(0, 3);
}
