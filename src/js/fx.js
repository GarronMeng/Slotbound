// fx.js — 粒子 / 冲击波 / 漂浮文字 / 屏幕震动 / 顿帧（全部对象池化，无逐帧分配）
'use strict';

import { Pool, TAU, clamp, RNG, rgba } from './util.js';
import { Atlas } from './theme.js';

// ---------- 粒子 ----------
function makeParticle() {
  return {
    dead: true, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1,
    size: 4, sizeEnd: 0, rot: 0, vr: 0, color: '#ffffff',
    grav: 0, drag: 0.98, glow: false, shape: 0, alpha: 1, fade: 1
  };
}
function resetParticle(p) { p.vx = p.vy = 0; p.grav = 0; p.glow = false; p.shape = 0; p.alpha = 1; p.fade = 1; p.vr = 0; p.rot = 0; }

// ---------- 冲击波环 ----------
function makeRing() {
  return { dead: true, x: 0, y: 0, r: 0, rEnd: 60, life: 0, max: 0.4, w: 4, color: '#ffffff', alpha: 1, spin: 0 };
}

// ---------- 漂浮文字 ----------
function makeText() {
  return { dead: true, x: 0, y: 0, vy: -40, life: 0, max: 1, str: '', color: '#fff', size: 22, scale: 1, bold: true, glow: 0 };
}

// ---------- 闪光（全屏/区域白闪） ----------
var Flash = { a: 0, color: '#ffffff', decay: 3.2 };

export var FX = {
  particles: new Pool(makeParticle, resetParticle, 320),
  rings: new Pool(makeRing, null, 40),
  texts: new Pool(makeText, null, 48),
  shakeAmp: 0,
  shakeDur: 0,
  shakeTime: 0,
  shakeFreq: 42,
  shakeX: 0,
  shakeY: 0,
  hitStop: 0,
  quality: 1,          // 1 = 满，0.5 = 低画质
  maxParticles: 460,
  _sx: 0, _sy: 0,

  setQuality: function (q) {
    this.quality = q;
    this.maxParticles = Math.round(460 * q);
  },

  reset: function () {
    this.particles.clear();
    this.rings.clear();
    this.texts.clear();
    this.shakeAmp = 0; this.shakeTime = 0; this.shakeX = 0; this.shakeY = 0;
    this.hitStop = 0; Flash.a = 0;
  },

  // ---------- 触发器 ----------
  shake: function (amp, dur, freq) {
    if (amp > this.shakeAmp) { this.shakeAmp = amp; this.shakeDur = dur || 0.3; this.shakeTime = 0; }
    if (freq) this.shakeFreq = freq;
  },

  stop: function (t) { this.hitStop = Math.max(this.hitStop, t); },

  flash: function (a, color) { Flash.a = Math.max(Flash.a, a); if (color) Flash.color = color; },

  burst: function (x, y, opt) {
    opt = opt || {};
    var n = Math.round((opt.count || 12) * this.quality);
    if (this.particles.count() > this.maxParticles) n = Math.round(n * 0.35);
    var spd = opt.speed || 160;
    var spread = opt.spread === undefined ? TAU : opt.spread;
    var dir = opt.dir === undefined ? 0 : opt.dir;
    var life = opt.life || 0.55;
    var col = opt.color || '#ffffff';
    var cols = opt.colors || null;
    for (var i = 0; i < n; i++) {
      var p = this.particles.obtain();
      var a = dir + (spread === TAU ? RNG.range(0, TAU) : RNG.range(-spread, spread));
      var v = spd * RNG.range(0.35, 1);
      p.x = x + (opt.jitter ? RNG.range(-opt.jitter, opt.jitter) : 0);
      p.y = y + (opt.jitter ? RNG.range(-opt.jitter, opt.jitter) : 0);
      p.vx = Math.cos(a) * v + (opt.vx || 0);
      p.vy = Math.sin(a) * v + (opt.vy || 0);
      p.max = life * RNG.range(0.7, 1.3);
      p.life = p.max;
      p.size = (opt.size || 5) * RNG.range(0.6, 1.3);
      p.sizeEnd = opt.sizeEnd === undefined ? 0 : opt.sizeEnd;
      p.grav = opt.grav || 0;
      p.drag = opt.drag === undefined ? 0.94 : opt.drag;
      p.color = cols ? cols[Math.floor(RNG.next() * cols.length)] : col;
      p.glow = opt.glow !== false;
      p.shape = opt.shape || 0;
      p.rot = RNG.range(0, TAU);
      p.vr = opt.spin ? RNG.range(-opt.spin, opt.spin) : 0;
      p.alpha = 1;
      p.fade = opt.fade === undefined ? 1 : opt.fade;
    }
  },

  /** 定向火花（用于挥砍、撞击） */
  sparks: function (x, y, dir, color, count) {
    this.burst(x, y, { count: count || 8, speed: 220, spread: 0.9, dir: dir, color: color, life: 0.32, size: 3.4, grav: 260, drag: 0.9 });
  },

  /** 金币/碎片飞溅 */
  coins: function (x, y, n, color) {
    this.burst(x, y, {
      count: n || 10, speed: 210, spread: Math.PI, dir: -Math.PI / 2,
      colors: ['#ffcf4d', '#fff2b0', '#f0a500', color || '#ffffff'],
      life: 0.85, size: 5, grav: 620, drag: 0.99, shape: 1, spin: 12, sizeEnd: 2
    });
  },

  smoke: function (x, y, n, color) {
    this.burst(x, y, { count: n || 6, speed: 60, color: color || '#6b5a8f', life: 0.7, size: 12, sizeEnd: 26, grav: -30, drag: 0.9, glow: false, fade: 1 });
  },

  ring: function (x, y, rEnd, color, dur, w) {
    var r = this.rings.obtain();
    r.x = x; r.y = y; r.r = rEnd * 0.12; r.rEnd = rEnd;
    r.max = dur || 0.35; r.life = r.max;
    r.color = color || '#ffffff'; r.w = w || 5; r.alpha = 1;
  },

  text: function (x, y, str, opt) {
    opt = opt || {};
    if (this.texts.count() > 40 && this.quality < 1) return;
    var t = this.texts.obtain();
    t.x = x; t.y = y; t.str = str;
    t.color = opt.color || '#ffffff';
    t.size = opt.size || 22;
    t.max = opt.life || 0.9;
    t.life = t.max;
    t.vy = opt.vy === undefined ? -62 : opt.vy;
    t.bold = opt.bold !== false;
    t.glow = opt.glow || 0;
    t.scale = opt.scale || 1;
  },

  // ---------- 更新 ----------
  update: function (dt) {
    // 震动
    if (this.shakeAmp > 0.05) {
      this.shakeTime += dt;
      var k = 1 - this.shakeTime / this.shakeDur;
      if (k <= 0) { this.shakeAmp = 0; this.shakeX = 0; this.shakeY = 0; }
      else {
        var amp = this.shakeAmp * k * k;
        var t = this.shakeTime * this.shakeFreq;
        this.shakeX = Math.sin(t * 1.7) * amp + Math.sin(t * 3.1) * amp * 0.4;
        this.shakeY = Math.cos(t * 2.3) * amp + Math.cos(t * 4.7) * amp * 0.3;
      }
    } else { this.shakeAmp = 0; this.shakeX = 0; this.shakeY = 0; }

    // 闪白
    if (Flash.a > 0) { Flash.a = Math.max(0, Flash.a - Flash.decay * dt); }

    if (this.hitStop > 0) { this.hitStop -= dt; return; }

    var i, o;
    for (i = this.particles.live.length - 1; i >= 0; i--) {
      o = this.particles.live[i];
      o.life -= dt;
      if (o.life <= 0) { o.dead = true; continue; }
      o.vy += o.grav * dt;
      var d = Math.pow(o.drag, dt * 60);
      o.vx *= d; o.vy *= d;
      o.x += o.vx * dt; o.y += o.vy * dt;
      o.rot += o.vr * dt;
      o.alpha = o.fade ? clamp(o.life / o.max, 0, 1) : 1;
    }
    this.particles.sweep();

    for (i = this.rings.live.length - 1; i >= 0; i--) {
      o = this.rings.live[i];
      o.life -= dt;
      if (o.life <= 0) { o.dead = true; continue; }
      var tt = 1 - o.life / o.max;
      o.r = o.rEnd * (0.12 + 0.88 * (1 - Math.pow(1 - tt, 3)));
      o.alpha = 1 - tt * tt;
    }
    this.rings.sweep();

    for (i = this.texts.live.length - 1; i >= 0; i--) {
      o = this.texts.live[i];
      o.life -= dt;
      if (o.life <= 0) { o.dead = true; continue; }
      o.y += o.vy * dt;
      o.vy *= Math.pow(0.94, dt * 60);
    }
    this.texts.sweep();
  },

  // ---------- 渲染 ----------
  drawParticles: function (ctx, layer) {
    var spark = Atlas.img.spark;
    var list = this.particles.live, i, p;
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < list.length; i++) {
      p = list[i];
      var glowy = p.glow && layer === 0;
      var sz = p.sizeEnd ? p.size + (p.sizeEnd - p.size) * (1 - p.life / p.max) : p.size;
      var a = p.alpha * (glowy ? 0.85 : 1);
      if (a <= 0.01) continue;
      if (p.shape === 1) {
        // 方块碎片
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-sz * 0.5, -sz * 0.5, sz, sz);
        ctx.restore();
      } else if (glowy) {
        ctx.globalAlpha = a * 0.7;
        ctx.fillStyle = p.color;
        var r = sz * 1.5;
        ctx.drawImage(spark, p.x - r, p.y - r, r * 2, r * 2);
        ctx.globalAlpha = a;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(p.x, p.y, sz * 0.5, 0, TAU); ctx.fill();
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, sz * 0.5, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  },

  drawRings: function (ctx) {
    var list = this.rings.live, i, r;
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < list.length; i++) {
      r = list[i];
      ctx.globalAlpha = clamp(r.alpha, 0, 1) * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.w * (0.3 + r.alpha * 0.9);
      ctx.beginPath();
      ctx.arc(r.x, r.y, Math.max(0.5, r.r), 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  },

  drawTexts: function (ctx, font) {
    var list = this.texts.live, i, t, k;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (i = 0; i < list.length; i++) {
      t = list[i];
      k = 1 - t.life / t.max;
      var pop = k < 0.18 ? 0.6 + 2.2 * k : (k < 0.3 ? 1 : 1);
      var a = t.life / t.max;
      a = a > 0.6 ? 1 : a / 0.6;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.font = (t.bold ? '900 ' : '700 ') + Math.round(t.size * pop * t.scale) + 'px ' + font;
      if (t.glow) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = t.color;
        ctx.globalAlpha = clamp(a, 0, 1) * 0.35;
        ctx.fillText(t.str, t.x, t.y + 1);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = clamp(a, 0, 1);
      }
      ctx.lineWidth = Math.max(2, t.size * 0.14);
      ctx.strokeStyle = 'rgba(8,5,15,0.85)';
      ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  },

  drawFlash: function (ctx, w, h) {
    if (Flash.a <= 0.005) return;
    ctx.globalAlpha = clamp(Flash.a, 0, 1) * 0.55;
    ctx.fillStyle = Flash.color;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  },

  get flashAlpha() { return Flash.a; },
  get flashColor() { return Flash.color; }
};

export { rgba };
