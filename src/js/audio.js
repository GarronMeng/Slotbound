// audio.js — 全程序化 WebAudio 音效（零外部资源，符合小工具离线要求）
'use strict';

import { clamp, RNG } from './util.js';

var Sfx = {
  ctx: null,
  master: null,
  musicGain: null,
  ready: false,
  muted: false,
  _noise: null,
  _lastSpin: 0,

  /** 必须由用户手势触发调用 */
  init: function () {
    if (this.ctx) { if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume(); return true; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { this.ctx = new AC(); } catch (e) { return false; }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.22;
    this.musicGain.connect(this.master);
    // 预生成噪声缓冲
    var len = Math.floor(this.ctx.sampleRate * 0.6);
    var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    this.ready = true;
    return true;
  },

  setMuted: function (m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  },

  _t: function () { return this.ctx.currentTime; },

  /** 单音：振荡器 + 包络 */
  tone: function (freq, dur, type, vol, slideTo, delay) {
    if (!this.ready || this.muted) return;
    var t0 = this._t() + (delay || 0);
    var o = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    var v = (vol === undefined ? 0.3 : vol);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },

  /** 噪声爆点 */
  noise: function (dur, vol, filterFreq, q, delay) {
    if (!this.ready || this.muted || !this._noise) return;
    var t0 = this._t() + (delay || 0);
    var s = this.ctx.createBufferSource();
    s.buffer = this._noise;
    s.playbackRate.value = 0.7 + Math.random() * 0.6;
    var f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(filterFreq || 900, t0);
    f.Q.value = q || 1.2;
    var g = this.ctx.createGain();
    var v = (vol === undefined ? 0.3 : vol);
    g.gain.setValueAtTime(v, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t0); s.stop(t0 + dur + 0.02);
  },

  // ---------- 具体音效 ----------
  uiTap: function () { this.tone(660, 0.07, 'triangle', 0.22, 880); },
  uiBack: function () { this.tone(420, 0.1, 'triangle', 0.2, 300); },
  lever: function () {
    this.tone(180, 0.16, 'sawtooth', 0.16, 90);
    this.noise(0.14, 0.16, 500, 0.8);
  },
  /** 滚轮滚动 tick（限速，避免爆音） */
  reelTick: function () {
    var t = Date.now();
    if (t - this._lastSpin < 42) return;
    this._lastSpin = t;
    this.tone(1400 + Math.random() * 500, 0.03, 'square', 0.055);
  },
  reelStop: function (idx) {
    var base = [300, 380, 470][idx % 3];
    this.tone(base, 0.12, 'square', 0.2, base * 0.6);
    this.noise(0.09, 0.2, 260, 1.4);
  },
  match: function (n) {
    var sc = [0, 523, 659, 784, 1046];
    for (var i = 0; i < clamp(n, 1, 4); i++) this.tone(sc[i + 1], 0.16, 'triangle', 0.2, null, i * 0.055);
  },
  jackpot: function () {
    var seq = [523, 659, 784, 1046, 1318, 1568];
    for (var i = 0; i < seq.length; i++) {
      this.tone(seq[i], 0.28, 'triangle', 0.24, null, i * 0.075);
      this.tone(seq[i] * 2, 0.2, 'sine', 0.1, null, i * 0.075);
    }
    this.noise(0.5, 0.14, 3200, 0.7, 0.05);
  },
  summon: function () { this.tone(320, 0.14, 'triangle', 0.2, 720); this.tone(480, 0.18, 'sine', 0.14, 960, 0.03); },
  shoot: function (kind) {
    if (kind === 'bow') this.noise(0.06, 0.1, 2600, 2.2);
    else if (kind === 'cannon') { this.tone(150, 0.16, 'sawtooth', 0.18, 60); this.noise(0.14, 0.16, 320, 0.9); }
    else if (kind === 'mage') this.tone(880, 0.1, 'sine', 0.11, 1500);
    else if (kind === 'prism') this.tone(1200, 0.08, 'triangle', 0.12, 1900);
    else this.tone(520 + Math.random() * 60, 0.05, 'square', 0.07);
  },
  hit: function () { this.noise(0.05, 0.13, 1100 + Math.random() * 500, 1.5); },
  hurt: function () { this.tone(200, 0.12, 'square', 0.14, 110); this.noise(0.1, 0.12, 380, 1.0); },
  kill: function () { this.noise(0.22, 0.22, 260, 0.7); this.tone(300, 0.2, 'sawtooth', 0.13, 80); },
  bossDie: function () {
    this.noise(0.7, 0.32, 180, 0.5);
    this.tone(140, 0.8, 'sawtooth', 0.24, 40);
    this.tone(70, 1.0, 'sine', 0.2, 30, 0.05);
  },
  merge: function (lvl) {
    var f = 400 + lvl * 130;
    this.tone(f, 0.2, 'triangle', 0.22, f * 2.2);
    this.tone(f * 1.5, 0.24, 'sine', 0.14, f * 3, 0.04);
    this.noise(0.16, 0.12, 2400, 1.1);
  },
  wave: function () { this.tone(196, 0.5, 'sawtooth', 0.16, 196); this.tone(294, 0.5, 'triangle', 0.14, 294, 0.02); },
  bossWarn: function () {
    this.tone(110, 0.34, 'sawtooth', 0.22, 92);
    this.tone(110, 0.34, 'sawtooth', 0.22, 92, 0.42);
    this.noise(0.5, 0.1, 200, 0.6, 0.05);
  },
  coreHit: function () { this.tone(120, 0.3, 'sawtooth', 0.28, 55); this.noise(0.3, 0.24, 200, 0.6); },
  combo: function (n) { this.tone(700 + n * 40, 0.09, 'triangle', 0.14, 1100 + n * 50); },
  coin: function () { this.tone(1200, 0.07, 'square', 0.09, 1700); },
  deny: function () { this.tone(180, 0.14, 'square', 0.16, 120); },
  gameOver: function () {
    var seq = [523, 440, 349, 262];
    for (var i = 0; i < seq.length; i++) this.tone(seq[i], 0.5, 'triangle', 0.2, null, i * 0.19);
  },
  victory: function () {
    var seq = [523, 659, 784, 1046, 784, 1046, 1318];
    for (var i = 0; i < seq.length; i++) this.tone(seq[i], 0.34, 'triangle', 0.22, null, i * 0.13);
  },
  cardPick: function () { this.tone(600, 0.16, 'triangle', 0.2, 1000); this.tone(900, 0.2, 'sine', 0.12, 1400, 0.05); }
};

// ---------- 极简背景音乐：琶音循环（程序化，无资源） ----------
var Music = {
  timer: null,
  step: 0,
  on: false,
  scale: [0, 3, 5, 7, 10, 12, 15, 12, 10, 7, 5, 3],
  root: 110,

  start: function () {
    if (this.on) return;
    if (!Sfx.ready) return;
    this.on = true;
    this.step = 0;
    var self = this;
    // 用 setTimeout 驱动（容器无 Worker）
    var tick = function () {
      if (!self.on) return;
      self.play();
      self.timer = setTimeout(tick, 187);
    };
    this.timer = setTimeout(tick, 187);
  },

  stop: function () {
    this.on = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  },

  play: function () {
    if (!Sfx.ready || Sfx.muted) return;
    var ctx = Sfx.ctx;
    var i = this.step % this.scale.length;
    var semi = this.scale[i];
    var f = this.root * Math.pow(2, semi / 12);
    var t0 = ctx.currentTime;

    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = (this.step % 4 === 0) ? 'triangle' : 'sine';
    o.frequency.setValueAtTime(f, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(this.step % 4 === 0 ? 0.16 : 0.075, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.36);
    o.connect(g); g.connect(Sfx.musicGain);
    o.start(t0); o.stop(t0 + 0.4);

    if (this.step % 8 === 0) {
      var b = ctx.createOscillator();
      var bg = ctx.createGain();
      b.type = 'sine';
      b.frequency.setValueAtTime(this.root / 2, t0);
      bg.gain.setValueAtTime(0.0001, t0);
      bg.gain.exponentialRampToValueAtTime(0.2, t0 + 0.03);
      bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      b.connect(bg); bg.connect(Sfx.musicGain);
      b.start(t0); b.stop(t0 + 0.55);
    }
    this.step++;
    // 偶尔换根音，制造推进感
    if (this.step % 32 === 0) this.root = RNG.pick([110, 110, 123.47, 98, 130.81]);
  }
};

export { Sfx, Music };
