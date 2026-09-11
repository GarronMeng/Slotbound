// util.js — 数学 / 随机 / 缓动 / 对象池
'use strict';

export var TAU = Math.PI * 2;

export function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function invLerp(a, b, v) { return b === a ? 0 : (v - a) / (b - a); }
export function sign(v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); }

/** 帧率无关的指数逼近：rate 越大越快 */
export function approach(cur, target, rate, dt) {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

export function dist2(ax, ay, bx, by) {
  var dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}
export function dist(ax, ay, bx, by) { return Math.sqrt(dist2(ax, ay, bx, by)); }

// ---------- 缓动 ----------
export var Ease = {
  linear: function (t) { return t; },
  outQuad: function (t) { return t * (2 - t); },
  outCubic: function (t) { var u = 1 - t; return 1 - u * u * u; },
  inCubic: function (t) { return t * t * t; },
  outBack: function (t) { var c = 1.70158; var u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; },
  outElastic: function (t) {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t - 0.075) * TAU / 0.3) + 1;
  },
  inOutSine: function (t) { return -0.5 * (Math.cos(Math.PI * t) - 1); }
};

// ---------- 确定性随机（可复现，便于回放/测试） ----------
export function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 游戏运行时随机源（可被测试替换） */
export var RNG = {
  _f: Math.random,
  seed: function (s) { this._f = mulberry32(s); },
  useMath: function () { this._f = Math.random; },
  next: function () { return this._f(); },
  range: function (a, b) { return a + (b - a) * this._f(); },
  int: function (a, b) { return Math.floor(a + (b - a + 1) * this._f()); },
  pick: function (arr) { return arr[Math.floor(this._f() * arr.length)]; },
  chance: function (p) { return this._f() < p; },
  /** 按权重取索引 */
  weighted: function (weights) {
    var total = 0, i;
    for (i = 0; i < weights.length; i++) total += weights[i];
    var r = this._f() * total;
    for (i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
    return weights.length - 1;
  },
  /** 洗牌（原地） */
  shuffle: function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(this._f() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
};

// ---------- 对象池 ----------
export function Pool(factory, reset, initial) {
  this.factory = factory;
  this.reset = reset;
  this.free = [];
  this.live = [];
  var n = initial || 0;
  for (var i = 0; i < n; i++) this.free.push(factory());
}
Pool.prototype.obtain = function () {
  var o = this.free.length ? this.free.pop() : this.factory();
  o.dead = false;
  this.live.push(o);
  return o;
};
Pool.prototype.release = function (o) {
  o.dead = true;
  var i = this.live.indexOf(o);
  if (i >= 0) { this.live.splice(i, 1); this.free.push(o); if (this.reset) this.reset(o); }
};
/** 遍历 live 并回收 dead（倒序，安全删除） */
Pool.prototype.sweep = function () {
  for (var i = this.live.length - 1; i >= 0; i--) {
    var o = this.live[i];
    if (o.dead) { this.live.splice(i, 1); this.free.push(o); if (this.reset) this.reset(o); }
  }
};
Pool.prototype.clear = function () {
  for (var i = 0; i < this.live.length; i++) { this.live[i].dead = true; this.free.push(this.live[i]); }
  this.live.length = 0;
};
Pool.prototype.count = function () { return this.live.length; };

// ---------- 格式化 ----------
export function pad2(n) { return n < 10 ? '0' + n : '' + n; }

export function fmtInt(n) {
  n = Math.floor(n);
  var s = '' + n, out = '', c = 0;
  for (var i = s.length - 1; i >= 0; i--) {
    out = s.charAt(i) + out; c++;
    if (c % 3 === 0 && i > 0) out = ',' + out;
  }
  return out;
}

export function fmtCompact(n) {
  n = Math.floor(n);
  if (n >= 100000000) return (n / 100000000).toFixed(2) + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return fmtInt(n);
}

export function fmtDate(ts) {
  var d = new Date(ts);
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

// ---------- 颜色工具 ----------
/** '#rrggbb' -> 'rgba(r,g,b,a)' */
export function rgba(hex, a) {
  var h = hex.replace('#', '');
  var r = parseInt(h.substring(0, 2), 16);
  var g = parseInt(h.substring(2, 4), 16);
  var b = parseInt(h.substring(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

export function mixHex(h1, h2, t) {
  var a = h1.replace('#', ''), b = h2.replace('#', '');
  var r = Math.round(lerp(parseInt(a.substring(0, 2), 16), parseInt(b.substring(0, 2), 16), t));
  var g = Math.round(lerp(parseInt(a.substring(2, 4), 16), parseInt(b.substring(2, 4), 16), t));
  var bl = Math.round(lerp(parseInt(a.substring(4, 6), 16), parseInt(b.substring(4, 6), 16), t));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
}

/** 生成离屏 canvas（兼容 Chrome 61：不使用 OffscreenCanvas） */
export function makeCanvas(w, h) {
  var c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function nowMs() { return Date.now(); }
