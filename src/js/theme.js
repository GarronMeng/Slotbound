// theme.js — 统一视觉主题 + 预渲染精灵图集（全部程序化绘制，零外部资源）
'use strict';

import { makeCanvas, TAU } from './util.js';

export var C = {
  bg0: '#0b0616',
  bg1: '#170f2e',
  bg2: '#241647',
  bg3: '#2f1c5c',
  ink: '#08050f',
  gold: '#ffcf4d',
  goldDeep: '#c98a12',
  magenta: '#ff3d81',
  cyan: '#29e0ff',
  green: '#57ff9a',
  purple: '#a86bff',
  orange: '#ff8a3d',
  red: '#ff4d5e',
  white: '#ffffff',
  paper: '#f4ecff'
};

export var FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",sans-serif';

// ---------- 兵种定义 ----------
export var UNIT_TYPES = ['sword', 'bow', 'mage', 'guard', 'cannon', 'prism'];

export var UNITS = {
  sword:  { key: 'sword',  name: '剑士', color: C.gold,    hp: 95,  dmg: 17, rate: 0.55, range: 1.05, kind: 'melee',  desc: '近战 · 高爆发' },
  bow:    { key: 'bow',    name: '弓手', color: C.cyan,    hp: 58,  dmg: 13, rate: 0.40, range: 9.9,  kind: 'shot',   desc: '远程 · 高射速' },
  mage:   { key: 'mage',   name: '法师', color: C.purple,  hp: 52,  dmg: 15, rate: 0.92, range: 8.0,  kind: 'splash', splash: 0.55, desc: '范围 · 溅射' },
  guard:  { key: 'guard',  name: '盾卫', color: C.green,   hp: 235, dmg: 9,  rate: 0.95, range: 0.95, kind: 'melee',  desc: '肉盾 · 挡线' },
  cannon: { key: 'cannon', name: '重炮', color: C.orange,  hp: 74,  dmg: 44, rate: 1.55, range: 7.0,  kind: 'splash', splash: 0.72, desc: '超远程 · 重击' },
  prism:  { key: 'prism',  name: '棱晶', color: C.magenta, hp: 165, dmg: 28, rate: 0.34, range: 9.9,  kind: 'pierce', desc: '传说 · 穿透' }
};

// 老虎机符号权重（prism 极稀有）
export var SYMBOL_WEIGHTS = { sword: 26, bow: 26, mage: 20, guard: 18, cannon: 15, prism: 3 };
export var SYMBOL_LIST = ['sword', 'bow', 'mage', 'guard', 'cannon', 'prism'];
export var SYMBOL_WEIGHT_ARR = [26, 26, 20, 18, 15, 3];

// ---------- 敌人定义 ----------
export var ENEMIES = {
  grunt:  { key: 'grunt',  name: '蚀卒', hp: 34,  spd: 23, dmg: 7,  r: 0.30, score: 12, color: '#8f7bd8' },
  runner: { key: 'runner', name: '疾影', hp: 20,  spd: 52, dmg: 5,  r: 0.25, score: 16, color: '#ff6f9c' },
  armor:  { key: 'armor',  name: '铁骸', hp: 105, spd: 15, dmg: 14, r: 0.38, score: 28, color: '#6f86c9' },
  caster: { key: 'caster', name: '咒瞳', hp: 48,  spd: 26, dmg: 9,  r: 0.29, score: 22, color: '#ff9a4d' },
  boss:   { key: 'boss',   name: '审判者', hp: 1150, spd: 11, dmg: 34, r: 0.72, score: 400, color: '#ff4d5e' }
};

// ---------- 绘图小工具 ----------
function roundRect(ctx, x, y, w, h, r) {
  var rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function glowCircle(ctx, cx, cy, r, color, alpha) {
  var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, color);
  g.addColorStop(0.35, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}

/** 把 0..1 归一化坐标下的图形画到 ctx（size×size 画布） */
function iconCanvas(size, draw) {
  var c = makeCanvas(size, size);
  var x = c.getContext('2d');
  x.translate(size / 2, size / 2);
  var s = size * 0.5;
  draw(x, s);
  return c;
}

// ---------- 兵种图标（矢量） ----------
var ICONS = {
  sword: function (x, s, col) {
    x.lineCap = 'round'; x.lineJoin = 'round';
    // 剑刃
    x.fillStyle = col;
    x.beginPath();
    x.moveTo(0, -s * 0.78);
    x.lineTo(s * 0.17, -s * 0.5);
    x.lineTo(s * 0.13, s * 0.24);
    x.lineTo(-s * 0.13, s * 0.24);
    x.lineTo(-s * 0.17, -s * 0.5);
    x.closePath(); x.fill();
    // 高光
    x.fillStyle = 'rgba(255,255,255,0.55)';
    x.beginPath();
    x.moveTo(0, -s * 0.7); x.lineTo(s * 0.05, -s * 0.42); x.lineTo(0, s * 0.18); x.lineTo(-s * 0.05, -s * 0.42);
    x.closePath(); x.fill();
    // 护手
    x.fillStyle = '#6b4a12';
    roundRect(x, -s * 0.42, s * 0.22, s * 0.84, s * 0.14, s * 0.07); x.fill();
    // 柄
    x.fillStyle = '#3a2a0e';
    roundRect(x, -s * 0.09, s * 0.34, s * 0.18, s * 0.32, s * 0.07); x.fill();
    x.fillStyle = col;
    x.beginPath(); x.arc(0, s * 0.72, s * 0.1, 0, TAU); x.fill();
  },
  bow: function (x, s, col) {
    x.strokeStyle = col; x.lineWidth = s * 0.13; x.lineCap = 'round';
    x.beginPath();
    x.arc(s * 0.2, 0, s * 0.72, Math.PI * 0.62, Math.PI * 1.38);
    x.stroke();
    // 弦
    x.strokeStyle = 'rgba(255,255,255,0.85)'; x.lineWidth = s * 0.045;
    x.beginPath();
    x.moveTo(s * 0.2 + Math.cos(Math.PI * 0.62) * s * 0.72, Math.sin(Math.PI * 0.62) * s * 0.72);
    x.lineTo(s * 0.2 + Math.cos(Math.PI * 1.38) * s * 0.72, Math.sin(Math.PI * 1.38) * s * 0.72);
    x.stroke();
    // 箭
    x.strokeStyle = '#e8f6ff'; x.lineWidth = s * 0.08;
    x.beginPath(); x.moveTo(-s * 0.72, 0); x.lineTo(s * 0.34, 0); x.stroke();
    x.fillStyle = col;
    x.beginPath(); x.moveTo(s * 0.62, 0); x.lineTo(s * 0.28, -s * 0.16); x.lineTo(s * 0.28, s * 0.16); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.7)'; x.lineWidth = s * 0.06;
    x.beginPath(); x.moveTo(-s * 0.72, -s * 0.14); x.lineTo(-s * 0.5, 0); x.lineTo(-s * 0.72, s * 0.14); x.stroke();
  },
  mage: function (x, s, col) {
    // 星芒
    x.fillStyle = col;
    var i, spikes = 4;
    for (i = 0; i < spikes; i++) {
      x.save(); x.rotate(i * Math.PI / spikes);
      x.beginPath();
      x.moveTo(0, -s * 0.86); x.lineTo(s * 0.13, 0); x.lineTo(0, s * 0.86); x.lineTo(-s * 0.13, 0);
      x.closePath(); x.fill();
      x.restore();
    }
    x.fillStyle = '#fff';
    x.beginPath(); x.arc(0, 0, s * 0.24, 0, TAU); x.fill();
    x.fillStyle = col;
    x.beginPath(); x.arc(0, 0, s * 0.14, 0, TAU); x.fill();
    // 环绕点
    for (i = 0; i < 3; i++) {
      var a = i * TAU / 3 + 0.5;
      x.fillStyle = 'rgba(255,255,255,0.8)';
      x.beginPath(); x.arc(Math.cos(a) * s * 0.6, Math.sin(a) * s * 0.6, s * 0.07, 0, TAU); x.fill();
    }
  },
  guard: function (x, s, col) {
    x.fillStyle = col;
    x.beginPath();
    x.moveTo(0, -s * 0.82);
    x.lineTo(s * 0.66, -s * 0.52);
    x.lineTo(s * 0.6, s * 0.16);
    x.quadraticCurveTo(s * 0.5, s * 0.62, 0, s * 0.84);
    x.quadraticCurveTo(-s * 0.5, s * 0.62, -s * 0.6, s * 0.16);
    x.lineTo(-s * 0.66, -s * 0.52);
    x.closePath(); x.fill();
    x.fillStyle = 'rgba(0,0,0,0.28)';
    x.beginPath();
    x.moveTo(0, -s * 0.82); x.lineTo(s * 0.66, -s * 0.52); x.lineTo(s * 0.6, s * 0.16);
    x.quadraticCurveTo(s * 0.5, s * 0.62, 0, s * 0.84);
    x.closePath(); x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.75)'; x.lineWidth = s * 0.08; x.lineCap = 'round';
    x.beginPath(); x.moveTo(0, -s * 0.5); x.lineTo(0, s * 0.44); x.stroke();
    x.beginPath(); x.moveTo(-s * 0.34, -s * 0.16); x.lineTo(s * 0.34, -s * 0.16); x.stroke();
  },
  cannon: function (x, s, col) {
    // 底座
    x.fillStyle = '#4a3a6b';
    roundRect(x, -s * 0.62, s * 0.16, s * 1.24, s * 0.42, s * 0.14); x.fill();
    // 炮管
    x.save(); x.rotate(-0.5);
    x.fillStyle = col;
    roundRect(x, -s * 0.2, -s * 0.86, s * 0.4, s * 1.0, s * 0.16); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.4)';
    roundRect(x, -s * 0.07, -s * 0.8, s * 0.1, s * 0.84, s * 0.05); x.fill();
    x.restore();
    // 炮口
    x.fillStyle = '#2a1f3f';
    x.beginPath(); x.arc(0, 0, s * 0.34, 0, TAU); x.fill();
    x.fillStyle = col;
    x.beginPath(); x.arc(0, 0, s * 0.2, 0, TAU); x.fill();
    // 轮
    x.fillStyle = '#2a1f3f';
    x.beginPath(); x.arc(-s * 0.42, s * 0.58, s * 0.17, 0, TAU); x.fill();
    x.beginPath(); x.arc(s * 0.42, s * 0.58, s * 0.17, 0, TAU); x.fill();
  },
  prism: function (x, s, col) {
    x.fillStyle = col;
    x.beginPath();
    x.moveTo(0, -s * 0.9); x.lineTo(s * 0.72, -s * 0.18); x.lineTo(0, s * 0.9); x.lineTo(-s * 0.72, -s * 0.18);
    x.closePath(); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.5)';
    x.beginPath();
    x.moveTo(0, -s * 0.9); x.lineTo(s * 0.72, -s * 0.18); x.lineTo(0, -s * 0.18);
    x.closePath(); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.28)';
    x.beginPath();
    x.moveTo(0, -s * 0.9); x.lineTo(-s * 0.72, -s * 0.18); x.lineTo(0, s * 0.9);
    x.closePath(); x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = s * 0.05;
    x.beginPath(); x.moveTo(-s * 0.72, -s * 0.18); x.lineTo(s * 0.72, -s * 0.18); x.stroke();
    x.fillStyle = '#fff';
    x.beginPath(); x.arc(0, -s * 0.42, s * 0.12, 0, TAU); x.fill();
  }
};

// ---------- 敌人图标 ----------
var EICONS = {
  grunt: function (x, s, col) {
    x.fillStyle = col;
    x.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = i * TAU / 6 - Math.PI / 2;
      var px = Math.cos(a) * s * 0.82, py = Math.sin(a) * s * 0.82;
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.closePath(); x.fill();
    x.fillStyle = 'rgba(0,0,0,0.3)';
    x.beginPath(); x.arc(0, s * 0.1, s * 0.5, 0, Math.PI); x.fill();
    x.fillStyle = '#fff';
    x.beginPath(); x.arc(-s * 0.24, -s * 0.1, s * 0.16, 0, TAU); x.fill();
    x.beginPath(); x.arc(s * 0.24, -s * 0.1, s * 0.16, 0, TAU); x.fill();
    x.fillStyle = '#1a0b2e';
    x.beginPath(); x.arc(-s * 0.24, -s * 0.06, s * 0.08, 0, TAU); x.fill();
    x.beginPath(); x.arc(s * 0.24, -s * 0.06, s * 0.08, 0, TAU); x.fill();
  },
  runner: function (x, s, col) {
    x.fillStyle = col;
    x.beginPath();
    x.moveTo(0, s * 0.9); x.lineTo(s * 0.62, -s * 0.6); x.lineTo(0, -s * 0.28); x.lineTo(-s * 0.62, -s * 0.6);
    x.closePath(); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.6)';
    x.beginPath();
    x.moveTo(0, s * 0.62); x.lineTo(s * 0.2, -s * 0.34); x.lineTo(0, -s * 0.14); x.lineTo(-s * 0.2, -s * 0.34);
    x.closePath(); x.fill();
    x.fillStyle = '#fff';
    x.beginPath(); x.arc(0, s * 0.1, s * 0.13, 0, TAU); x.fill();
  },
  armor: function (x, s, col) {
    x.fillStyle = col;
    roundRect(x, -s * 0.78, -s * 0.72, s * 1.56, s * 1.5, s * 0.24); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.22)';
    roundRect(x, -s * 0.62, -s * 0.58, s * 1.24, s * 0.4, s * 0.14); x.fill();
    x.fillStyle = '#140b26';
    roundRect(x, -s * 0.5, -s * 0.1, s * 1.0, s * 0.3, s * 0.1); x.fill();
    x.fillStyle = '#ffd9f0';
    x.beginPath(); x.arc(-s * 0.22, s * 0.05, s * 0.09, 0, TAU); x.fill();
    x.beginPath(); x.arc(s * 0.22, s * 0.05, s * 0.09, 0, TAU); x.fill();
    x.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(x, -s * 0.56, s * 0.36, s * 1.12, s * 0.26, s * 0.1); x.fill();
  },
  caster: function (x, s, col) {
    x.fillStyle = col;
    x.beginPath();
    x.moveTo(0, -s * 0.88); x.lineTo(s * 0.82, 0); x.lineTo(0, s * 0.88); x.lineTo(-s * 0.82, 0);
    x.closePath(); x.fill();
    x.fillStyle = 'rgba(0,0,0,0.3)';
    x.beginPath();
    x.moveTo(0, -s * 0.88); x.lineTo(s * 0.82, 0); x.lineTo(0, 0);
    x.closePath(); x.fill();
    // 眼
    x.fillStyle = '#fff';
    x.beginPath(); x.ellipse(0, 0, s * 0.36, s * 0.24, 0, 0, TAU); x.fill();
    x.fillStyle = '#2a0b1e';
    x.beginPath(); x.arc(0, 0, s * 0.14, 0, TAU); x.fill();
  },
  boss: function (x, s, col) {
    x.fillStyle = col;
    x.beginPath();
    x.moveTo(0, -s * 0.95);
    x.lineTo(s * 0.5, -s * 0.5);
    x.lineTo(s * 0.95, -s * 0.2);
    x.lineTo(s * 0.7, s * 0.55);
    x.lineTo(0, s * 0.95);
    x.lineTo(-s * 0.7, s * 0.55);
    x.lineTo(-s * 0.95, -s * 0.2);
    x.lineTo(-s * 0.5, -s * 0.5);
    x.closePath(); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.18)';
    x.beginPath();
    x.moveTo(0, -s * 0.95); x.lineTo(s * 0.95, -s * 0.2); x.lineTo(0, s * 0.95);
    x.closePath(); x.fill();
    // 角
    x.fillStyle = '#2a0812';
    x.beginPath(); x.moveTo(-s * 0.5, -s * 0.5); x.lineTo(-s * 0.78, -s * 0.98); x.lineTo(-s * 0.2, -s * 0.72); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(s * 0.5, -s * 0.5); x.lineTo(s * 0.78, -s * 0.98); x.lineTo(s * 0.2, -s * 0.72); x.closePath(); x.fill();
    // 眼
    x.fillStyle = '#fff2a8';
    x.beginPath(); x.ellipse(-s * 0.26, -s * 0.06, s * 0.19, s * 0.12, -0.2, 0, TAU); x.fill();
    x.beginPath(); x.ellipse(s * 0.26, -s * 0.06, s * 0.19, s * 0.12, 0.2, 0, TAU); x.fill();
    x.fillStyle = '#3a0512';
    x.beginPath(); x.arc(-s * 0.26, -s * 0.04, s * 0.07, 0, TAU); x.fill();
    x.beginPath(); x.arc(s * 0.26, -s * 0.04, s * 0.07, 0, TAU); x.fill();
    // 嘴
    x.fillStyle = '#2a0812';
    x.beginPath(); x.ellipse(0, s * 0.4, s * 0.3, s * 0.14, 0, 0, TAU); x.fill();
  }
};

// ---------- 图集 ----------
export var Atlas = {
  SS: 2,             // 精灵超采样倍率
  img: {},
  built: false,

  _put: function (key, canvas) { this.img[key] = canvas; },

  build: function () {
    if (this.built) return;
    var S = this.SS, i, k, t;

    // 光晕
    var glows = { gold: C.gold, magenta: C.magenta, cyan: C.cyan, green: C.green, purple: C.purple, orange: C.orange, red: C.red, white: '#ffffff' };
    for (k in glows) {
      var gc = makeCanvas(128 * S, 128 * S);
      var gx = gc.getContext('2d');
      glowCircle(gx, 64 * S, 64 * S, 64 * S, glows[k], 1);
      this._put('glow_' + k, gc);
    }

    // 通用柔光点（供粒子使用，白底 + globalCompositeOperation 上色）
    var pc = makeCanvas(32 * S, 32 * S);
    var px2 = pc.getContext('2d');
    glowCircle(px2, 16 * S, 16 * S, 16 * S, '#ffffff', 1);
    this._put('spark', pc);

    // 兵种图标
    for (i = 0; i < UNIT_TYPES.length; i++) {
      t = UNIT_TYPES[i];
      (function (type) {
        var d = UNITS[type];
        var c = iconCanvas(96 * S, function (x, s) { ICONS[type](x, s, d.color); });
        Atlas._put('u_' + type, c);
      })(t);
    }

    // 敌人图标
    var ekeys = ['grunt', 'runner', 'armor', 'caster', 'boss'];
    for (i = 0; i < ekeys.length; i++) {
      (function (ek) {
        var d = ENEMIES[ek];
        var c = iconCanvas(96 * S, function (x, s) { EICONS[ek](x, s, d.color); });
        Atlas._put('e_' + ek, c);
      })(ekeys[i]);
    }

    // 老虎机符号瓦片
    for (i = 0; i < SYMBOL_LIST.length; i++) {
      (function (type) {
        var d = UNITS[type];
        var size = 108 * S;
        var c = makeCanvas(size, size);
        var x = c.getContext('2d');
        var m = size * 0.05;
        // 底
        var g = x.createLinearGradient(0, 0, 0, size);
        g.addColorStop(0, '#2a1a4d');
        g.addColorStop(1, '#150c2b');
        x.fillStyle = g;
        roundRect(x, m, m, size - m * 2, size - m * 2, size * 0.14);
        x.fill();
        // 内发光
        var g2 = x.createRadialGradient(size / 2, size * 0.42, size * 0.05, size / 2, size * 0.5, size * 0.62);
        g2.addColorStop(0, 'rgba(255,255,255,0.20)');
        g2.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g2;
        roundRect(x, m, m, size - m * 2, size - m * 2, size * 0.14);
        x.fill();
        // 图标
        var ic = iconCanvas(96 * S, function (xx, s) { ICONS[type](xx, s, d.color); });
        x.drawImage(ic, m + size * 0.09, m + size * 0.09, size - m * 2 - size * 0.18, size - m * 2 - size * 0.18);
        // 描边
        x.strokeStyle = d.color; x.lineWidth = size * 0.035;
        roundRect(x, m + size * 0.02, m + size * 0.02, size - m * 2 - size * 0.04, size - m * 2 - size * 0.04, size * 0.12);
        x.stroke();
        // 角标
        x.fillStyle = d.color;
        x.beginPath(); x.arc(size * 0.86, size * 0.15, size * 0.05, 0, TAU); x.fill();
        Atlas._put('sym_' + type, c);
      })(SYMBOL_LIST[i]);
    }

    // 弹体
    this._put('p_arrow', (function () {
      var c = makeCanvas(40 * S, 14 * S), x = c.getContext('2d');
      var g = x.createLinearGradient(0, 0, 40 * S, 0);
      g.addColorStop(0, 'rgba(41,224,255,0)'); g.addColorStop(1, '#bff6ff');
      x.fillStyle = g;
      roundRect(x, 0, 5 * S, 34 * S, 4 * S, 2 * S); x.fill();
      x.fillStyle = '#fff';
      x.beginPath(); x.moveTo(40 * S, 7 * S); x.lineTo(31 * S, 1.5 * S); x.lineTo(31 * S, 12.5 * S); x.closePath(); x.fill();
      return c;
    })());

    this._put('p_bolt', (function () {
      var c = makeCanvas(26 * S, 26 * S), x = c.getContext('2d');
      var g = x.createRadialGradient(13 * S, 13 * S, 0, 13 * S, 13 * S, 13 * S);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.4, C.purple); g.addColorStop(1, 'rgba(168,107,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 26 * S, 26 * S);
      return c;
    })());

    this._put('p_shell', (function () {
      var c = makeCanvas(28 * S, 28 * S), x = c.getContext('2d');
      x.fillStyle = '#2a1f3f'; x.beginPath(); x.arc(14 * S, 14 * S, 11 * S, 0, TAU); x.fill();
      x.fillStyle = C.orange; x.beginPath(); x.arc(14 * S, 14 * S, 7.5 * S, 0, TAU); x.fill();
      x.fillStyle = '#fff'; x.beginPath(); x.arc(11 * S, 11 * S, 2.6 * S, 0, TAU); x.fill();
      return c;
    })());

    this._put('p_prism', (function () {
      var c = makeCanvas(26 * S, 26 * S), x = c.getContext('2d');
      x.fillStyle = C.magenta;
      x.beginPath(); x.moveTo(13 * S, 1 * S); x.lineTo(24 * S, 13 * S); x.lineTo(13 * S, 25 * S); x.lineTo(2 * S, 13 * S); x.closePath(); x.fill();
      x.fillStyle = '#fff';
      x.beginPath(); x.moveTo(13 * S, 6 * S); x.lineTo(19 * S, 13 * S); x.lineTo(13 * S, 20 * S); x.lineTo(7 * S, 13 * S); x.closePath(); x.fill();
      return c;
    })());

    // 环形冲击波（白色，绘制时染色）
    this._put('ring', (function () {
      var c = makeCanvas(128 * S, 128 * S), x = c.getContext('2d');
      x.strokeStyle = '#ffffff';
      x.lineWidth = 5 * S;
      x.beginPath(); x.arc(64 * S, 64 * S, 58 * S, 0, TAU); x.stroke();
      x.lineWidth = 2 * S;
      x.globalAlpha = 0.5;
      x.beginPath(); x.arc(64 * S, 64 * S, 46 * S, 0, TAU); x.stroke();
      return c;
    })());

    this.built = true;
  }
};

export { roundRect, glowCircle };
