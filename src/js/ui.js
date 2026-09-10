// ui.js — DOM 覆盖层：标题 / 暂停 / 结算 / 选卡 / 高分榜 / 分享
'use strict';

import { clamp, fmtInt, fmtCompact, fmtDate, RNG, makeCanvas } from './util.js';
import { C, FONT, roundRect } from './theme.js';
import { Store } from './store.js';
import { XHS } from './xhs.js';
import { Sfx } from './audio.js';
import { TOTAL_WAVES } from './waves.js';

var NICK_A = ['赌神', '欧皇', '非酋', '拉杆王', '幸运星', '梭哈', '锦鲤', '手气', '玄学', '满贯', '天选', '一发'];
var NICK_B = ['小王', '阿星', '大佬', '本皇', '选手', '同学', '先生', '小姐', '战士', '指挥官'];

function $(id) { return document.getElementById(id); }

function randomNick() {
  return RNG.pick(NICK_A) + RNG.pick(NICK_B) + RNG.int(10, 99);
}

export function UI(game) {
  this.g = game;
  this.el = {
    stage: $('stage'),
    canvas: $('game'),
    hud: $('hud'),
    hudWave: $('hud-wave'),
    hudWaveName: $('hud-wavename'),
    hudScore: $('hud-score'),
    hudBest: $('hud-best'),
    hudCore: $('hud-core-fill'),
    hudCoreTxt: $('hud-core-txt'),
    btnPause: $('btn-pause'),
    btnMute: $('btn-mute'),
    spin: $('spin-btn'),
    spinLabel: $('spin-label'),
    title: $('screen-title'),
    titleBest: $('title-best'),
    titleList: $('hs-list'),
    pause: $('screen-pause'),
    over: $('screen-over'),
    overTitle: $('over-title'),
    overStats: $('over-stats'),
    overName: $('over-name'),
    overRank: $('over-rank'),
    overKeys: $('over-keys'),
    overActions: $('over-actions'),
    reward: $('screen-reward'),
    rewardCards: $('reward-cards'),
    toast: $('toast')
  };
  this.name = Store.settings().name || randomNick();
  this.muted = Store.settings().muted;
  this._lastScore = -1;
  this._lastWave = -1;
  this._lastCore = -1;
  this._toastT = 0;
  this._savedThisRun = false;
  this._pendingSummary = null;
  this.buildKeys();
  this.bind();
  this.renderHighScores();
}

// ---------- 绑定 ----------
UI.prototype.bind = function () {
  var self = this, g = this.g;

  this.el.btnPause.addEventListener('click', function (e) {
    e.preventDefault();
    Sfx.uiTap();
    if (g.state === 1 || g.state === 2) g.togglePause();
  });

  this.el.btnMute.addEventListener('click', function (e) {
    e.preventDefault();
    self.setMuted(!self.muted);
  });

  this.el.spin.addEventListener('click', function (e) {
    e.preventDefault();
    g.spin();
  });

  var b;
  b = $('btn-start');
  if (b) b.addEventListener('click', function (e) { e.preventDefault(); self.startGame(); });
  b = $('btn-howto');
  if (b) b.addEventListener('click', function (e) { e.preventDefault(); self.toggleHowto(); });
  b = $('btn-clear-hs');
  if (b) b.addEventListener('click', function (e) { e.preventDefault(); self.clearScores(); });

  b = $('btn-resume');
  if (b) b.addEventListener('click', function (e) { e.preventDefault(); Sfx.uiTap(); g.togglePause(false); });
  b = $('btn-quit');
  if (b) b.addEventListener('click', function (e) { e.preventDefault(); Sfx.uiBack(); g.togglePause(false); g.state = 0; self.showScreen(self.el.title); self.renderHighScores(); });
  b = $('btn-pause-restart');
  if (b) b.addEventListener('click', function (e) { e.preventDefault(); self.startGame(); });

  b = $('btn-restart');
  if (b) b.addEventListener('click', function (e) { e.preventDefault(); self.startGame(); });
  b = $('btn-home');
  if (b) b.addEventListener('click', function (e) {
    e.preventDefault(); Sfx.uiBack();
    g.state = 0; self.showScreen(self.el.title); self.renderHighScores();
  });
  b = $('btn-share');
  if (b) b.addEventListener('click', function (e) { e.preventDefault(); self.share(); });
  b = $('btn-saveimg');
  if (b) b.addEventListener('click', function (e) { e.preventDefault(); self.saveImg(); });
  b = $('btn-randname');
  if (b) b.addEventListener('click', function (e) { e.preventDefault(); self.setName(randomNick()); });
  b = $('btn-key-del');
  if (b) b.addEventListener('click', function (e) { e.preventDefault(); self.setName(self.name.slice(0, -1)); });

  // 选卡（事件委托，避免行内 onclick）
  this.el.rewardCards.addEventListener('click', function (e) {
    var node = e.target;
    while (node && node !== this && !node.getAttribute('data-idx')) node = node.parentNode;
    if (!node || node === this) return;
    var idx = parseInt(node.getAttribute('data-idx'), 10);
    if (!isNaN(idx)) g.pickCard(idx);
  });
};

UI.prototype.setMuted = function (m) {
  this.muted = m;
  Sfx.setMuted(m);
  var s = Store.settings(); s.muted = m; Store.saveSettings(s);
  this.el.btnMute.textContent = m ? '已静音' : '静音';
  this.el.btnMute.setAttribute('aria-pressed', m ? 'true' : 'false');
  if (!m) Sfx.uiTap();
};

UI.prototype.startGame = function () {
  Sfx.init();
  Sfx.uiTap();
  this.hideAllScreens();
  this._savedThisRun = false;
  this.g.start();
  this.onStateChange(this.g.state);
};

// ---------- 屏幕切换 ----------
UI.prototype.hideAllScreens = function () {
  var list = [this.el.title, this.el.pause, this.el.over, this.el.reward], i;
  for (i = 0; i < list.length; i++) if (list[i]) list[i].classList.remove('show');
};

UI.prototype.showScreen = function (el) {
  this.hideAllScreens();
  if (el) el.classList.add('show');
};

UI.prototype.toggleHowto = function () {
  var h = $('howto');
  if (h) h.classList.toggle('open');
  Sfx.uiTap();
};

// ---------- HUD ----------
UI.prototype.onStateChange = function (state) {
  var playing = (state === 1 || state === 2);
  this.el.hud.classList.toggle('active', playing);
  this.el.spin.classList.toggle('active', state === 1);
  this.el.btnPause.classList.toggle('active', playing);
  this.el.btnMute.classList.toggle('active', playing || state === 0);
  if (state === 0) { this.el.btnMute.classList.add('active'); }
};

UI.prototype.update = function () {
  var g = this.g;
  var sc = Math.floor(g.displayScore || 0);
  if (sc !== this._lastScore) {
    this.el.hudScore.textContent = fmtInt(sc);
    this._lastScore = sc;
  }
  if (g.wave !== this._lastWave) {
    this.el.hudWave.textContent = '第 ' + g.wave + ' / ' + TOTAL_WAVES + ' 波';
    this.el.hudWaveName.textContent = g.info ? g.info.name : '';
    this.el.hudWaveName.className = 'wavename kind-' + (g.info ? g.info.kind : 'normal');
    this._lastWave = g.wave;
  }
  var pct = Math.round(clamp(g.coreHp / g.coreMax, 0, 1) * 100);
  if (pct !== this._lastCore) {
    this.el.hudCore.style.width = pct + '%';
    this.el.hudCoreTxt.textContent = Math.max(0, Math.ceil(g.coreHp)) + ' / ' + g.coreMax;
    this.el.hudCore.parentNode.className = 'corebar' + (pct <= 25 ? ' low' : (pct <= 55 ? ' mid' : ''));
    this._lastCore = pct;
  }
  var can = g.canSpin();
  this.el.spin.classList.toggle('ready', can);
  this.el.spin.classList.toggle('spinning', g.slot.state === 'spinning');
  var en = g.getEnergy();
  this.el.spinLabel.textContent = g.slot.state === 'spinning' ? '转动中' : (can ? '拉杆' : '充能 ' + Math.ceil((1 - en.frac) * g.energyRate) + 's');
};

UI.prototype.onCoreHit = function () {
  var self = this;
  this.el.hud.classList.add('hit');
  setTimeout(function () { self.el.hud.classList.remove('hit'); }, 260);
};

UI.prototype.toast = function (msg) {
  var el = this.el.toast;
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  var self = this;
  clearTimeout(this._toastTimer);
  this._toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1900);
};

// ---------- 覆盖层定位 ----------
UI.prototype.syncOverlay = function () {
  var g = this.g, L = g.L;
  var st = this.el.stage;
  if (!st || !L.spinBtn) return;
  var box = g.canvas.getBoundingClientRect();
  var host = st.getBoundingClientRect();
  var left = box.left - host.left, top = box.top - host.top;
  var s = g.scale;
  var b = L.spinBtn;
  var el = this.el.spin;
  el.style.left = (left + (g.ox + b.x) * s) + 'px';
  el.style.top = (top + (g.oy + b.y) * s) + 'px';
  el.style.width = (b.w * s) + 'px';
  el.style.height = (b.h * s) + 'px';
  el.style.fontSize = Math.round(15 * s) + 'px';
  // HUD 宽度对齐画布
  this.el.hud.style.left = left + 'px';
  this.el.hud.style.top = top + 'px';
  this.el.hud.style.width = (box.width) + 'px';
};

// ---------- 暂停 ----------
UI.prototype.showPause = function () {
  var g = this.g;
  var s = $('pause-stats');
  if (s) {
    s.innerHTML = '';
    s.appendChild(this.statRow('分数', fmtInt(g.score)));
    s.appendChild(this.statRow('波次', g.wave + ' / ' + TOTAL_WAVES));
    s.appendChild(this.statRow('击杀', g.kills));
    s.appendChild(this.statRow('单位', g.units.length));
  }
  this.showScreen(this.el.pause);
  this.onStateChange(2);
};
UI.prototype.hidePause = function () {
  if (this.el.pause.classList.contains('show')) this.el.pause.classList.remove('show');
};

UI.prototype.statRow = function (k, v) {
  var d = document.createElement('div');
  d.className = 'stat-row';
  var a = document.createElement('span'); a.textContent = k;
  var b = document.createElement('b'); b.textContent = v;
  d.appendChild(a); d.appendChild(b);
  return d;
};

// ---------- 选卡 ----------
UI.prototype.showReward = function (cards) {
  var wrap = this.el.rewardCards;
  wrap.innerHTML = '';
  var title = $('reward-title');
  if (title) title.textContent = '第 ' + this.g.wave + ' 波完成 · 选择一枚核心';
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var btn = document.createElement('button');
    btn.className = 'card';
    btn.setAttribute('data-idx', '' + i);
    btn.setAttribute('type', 'button');
    btn.style.setProperty('--cc', c.color);
    var ic = document.createElement('div'); ic.className = 'card-ic'; ic.textContent = c.icon;
    var nm = document.createElement('div'); nm.className = 'card-name'; nm.textContent = c.name;
    var ds = document.createElement('div'); ds.className = 'card-desc'; ds.textContent = c.desc;
    var hint = document.createElement('div'); hint.className = 'card-key'; hint.textContent = '按 ' + (i + 1);
    btn.appendChild(ic); btn.appendChild(nm); btn.appendChild(ds); btn.appendChild(hint);
    wrap.appendChild(btn);
  }
  this.showScreen(this.el.reward);
};
UI.prototype.hideReward = function () { this.el.reward.classList.remove('show'); };

// ---------- 结算 ----------
UI.prototype.showGameOver = function (sum, win) {
  this._pendingSummary = sum;
  this.el.overTitle.textContent = win ? '通关！' : '核心崩溃';
  this.el.overTitle.className = 'over-title' + (win ? ' win' : '');
  var w = this.el.overStats;
  w.innerHTML = '';
  var big = document.createElement('div');
  big.className = 'over-score';
  big.textContent = fmtInt(sum.score);
  w.appendChild(big);
  w.appendChild(this.statRow('到达波次', sum.wave + ' / ' + TOTAL_WAVES));
  w.appendChild(this.statRow('击杀敌人', fmtInt(sum.kills)));
  w.appendChild(this.statRow('拉杆次数', fmtInt(sum.spins)));
  w.appendChild(this.statRow('吸收合成', fmtInt(sum.merges)));
  w.appendChild(this.statRow('JACKPOT', fmtInt(sum.jackpots)));
  w.appendChild(this.statRow('最高连击', fmtInt(sum.bestCombo)));

  var rank = Store.rankOf(sum.score);
  var rk = this.el.overRank;
  if (rank > 0) {
    rk.textContent = '新纪录！可进入第 ' + rank + ' 名';
    rk.className = 'over-rank good';
    this.el.overName.parentNode.classList.remove('hidden');
  } else {
    var best = Store.best();
    rk.textContent = best ? ('最高纪录 ' + fmtInt(best.score) + ' · ' + best.name) : '暂无纪录';
    rk.className = 'over-rank';
    this.el.overName.parentNode.classList.add('hidden');
  }
  this._savedThisRun = false;
  this.setName(this.name);
  this.showScreen(this.el.over);
  this.onStateChange(4);
};

UI.prototype.buildKeys = function () {
  var wrap = this.el.overKeys;
  if (!wrap) return;
  wrap.innerHTML = '';
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  var self = this;
  for (var i = 0; i < chars.length; i++) {
    (function (ch) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'key';
      b.textContent = ch;
      b.addEventListener('click', function (e) { e.preventDefault(); self.setName((self.name + ch).slice(0, 8)); });
      wrap.appendChild(b);
    })(chars.charAt(i));
  }
};

UI.prototype.setName = function (n) {
  this.name = String(n || '').slice(0, 8);
  if (this.el.overName) this.el.overName.textContent = this.name || '（点击键盘输入）';
  var s = Store.settings(); s.name = this.name; Store.saveSettings(s);
};

UI.prototype.saveScore = function () {
  if (this._savedThisRun || !this._pendingSummary) return;
  var sum = this._pendingSummary;
  if (Store.rankOf(sum.score) < 0) { this.toast('成绩未进入前 10'); return; }
  Store.add(this.name || '玩家', sum.score, sum.wave);
  this._savedThisRun = true;
  this.renderHighScores();
  this.el.overRank.textContent = '已保存到本地排行榜';
  this.el.overRank.className = 'over-rank good';
  this.el.overName.parentNode.classList.add('hidden');
  this.toast('已保存 · ' + fmtInt(sum.score) + ' 分');
  Sfx.coin();
};

UI.prototype.renderHighScores = function () {
  var list = this.el.titleList;
  if (!list) return;
  list.innerHTML = '';
  var data = Store.load();
  var best = this.el.titleBest;
  if (best) best.textContent = data.length ? (fmtInt(data[0].score) + ' · ' + data[0].name) : '还没有纪录，快来第一个上榜';
  if (!data.length) {
    var empty = document.createElement('div');
    empty.className = 'hs-empty';
    empty.textContent = '本地暂无纪录';
    list.appendChild(empty);
    return;
  }
  for (var i = 0; i < data.length; i++) {
    var e = data[i];
    var row = document.createElement('div');
    row.className = 'hs-row' + (i === 0 ? ' top' : '');
    var rk = document.createElement('span'); rk.className = 'hs-rank'; rk.textContent = (i + 1);
    var nm = document.createElement('span'); nm.className = 'hs-name'; nm.textContent = e.name;
    var sc = document.createElement('span'); sc.className = 'hs-score'; sc.textContent = fmtCompact(e.score);
    var wv = document.createElement('span'); wv.className = 'hs-wave'; wv.textContent = 'W' + e.wave;
    row.appendChild(rk); row.appendChild(nm); row.appendChild(sc); row.appendChild(wv);
    list.appendChild(row);
  }
};

UI.prototype.clearScores = function () {
  if (!window.confirm) { Store.clear(); this.renderHighScores(); this.toast('已清空'); return; }
  if (window.confirm('确定清空本地排行榜？此操作不可撤销。')) {
    Store.clear();
    this.renderHighScores();
    this.toast('本地排行榜已清空');
    Sfx.uiBack();
  }
};

// ---------- 分享卡片 ----------
UI.prototype.buildShareCard = function (sum) {
  var w = 900, h = 1200;
  var c = makeCanvas(w, h);
  var x = c.getContext('2d');
  var g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2a1650'); g.addColorStop(0.5, C.bg1); g.addColorStop(1, C.bg0);
  x.fillStyle = g; x.fillRect(0, 0, w, h);

  // 装饰光
  var rg = x.createRadialGradient(w / 2, h * 0.12, 20, w / 2, h * 0.12, w * 0.9);
  rg.addColorStop(0, 'rgba(168,107,255,0.45)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = rg; x.fillRect(0, 0, w, h);

  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = C.gold;
  x.font = '900 64px ' + FONT;
  x.fillText('SLOTBOUND', w / 2, 130);
  x.font = '700 34px ' + FONT;
  x.fillStyle = 'rgba(255,255,255,0.75)';
  x.fillText('命运老虎机 · 竖屏塔防', w / 2, 190);

  // 分数卡
  x.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(x, 70, 260, w - 140, 300, 30); x.fill();
  x.strokeStyle = C.gold; x.lineWidth = 3;
  roundRect(x, 70, 260, w - 140, 300, 30); x.stroke();
  x.font = '700 32px ' + FONT;
  x.fillStyle = 'rgba(255,255,255,0.65)';
  x.fillText('最终得分', w / 2, 320);
  x.font = '900 130px ' + FONT;
  x.fillStyle = C.gold;
  x.fillText(fmtInt(sum.score), w / 2, 430);
  x.font = '700 30px ' + FONT;
  x.fillStyle = C.magenta;
  x.fillText((this.name || '玩家') + ' · 第 ' + sum.wave + ' 波', w / 2, 520);

  // 明细
  var rows = [['击杀敌人', fmtInt(sum.kills)], ['JACKPOT', fmtInt(sum.jackpots)], ['吸收合成', fmtInt(sum.merges)], ['最高连击', fmtInt(sum.bestCombo)]];
  var y = 640;
  for (var i = 0; i < rows.length; i++) {
    var yy = y + i * 74;
    x.fillStyle = 'rgba(255,255,255,0.07)';
    roundRect(x, 90, yy, w - 180, 60, 16); x.fill();
    x.textAlign = 'left';
    x.font = '700 28px ' + FONT;
    x.fillStyle = 'rgba(255,255,255,0.8)';
    x.fillText(rows[i][0], 124, yy + 31);
    x.textAlign = 'right';
    x.fillStyle = '#fff';
    x.fillText(rows[i][1], w - 124, yy + 31);
    x.textAlign = 'center';
  }

  x.font = '700 26px ' + FONT;
  x.fillStyle = 'rgba(255,255,255,0.5)';
  x.fillText('小红书小工具 · 离线可玩', w / 2, h - 90);
  x.font = '700 22px ' + FONT;
  x.fillStyle = 'rgba(255,255,255,0.35)';
  x.fillText(fmtDate(Date.now()), w / 2, h - 50);
  return c.toDataURL('image/png');
};

UI.prototype.share = function () {
  var sum = this._pendingSummary || this.g.summary();
  this.saveScore();
  var dataUrl = this.buildShareCard(sum);
  if (!XHS.available()) {
    this.toast('需在小红书小工具内运行才能发布笔记');
    return;
  }
  var self = this;
  this.toast('正在打开发布页…');
  XHS.shareNote({
    title: 'Slotbound 我打了 ' + fmtInt(sum.score) + ' 分',
    content: '在《Slotbound 命运老虎机》里撑到第 ' + sum.wave + ' 波，' +
      '击杀 ' + sum.kills + ' 个敌人，摇出 ' + sum.jackpots + ' 次 JACKPOT！' +
      '拉杆召唤单位、拖拽吸收升级，看看你能撑到第几波？',
    tags: 'Slotbound 小游戏 塔防 老虎机',
    dataUrl: dataUrl
  }).catch(function (err) {
    self.toast('发布失败：' + XHS.errMsg(err));
  });
};

UI.prototype.saveImg = function () {
  var sum = this._pendingSummary || this.g.summary();
  if (!XHS.available()) { this.toast('需在小红书小工具内运行才能保存相册'); return; }
  var self = this;
  var dataUrl = this.buildShareCard(sum);
  XHS.saveImage(dataUrl)
    .then(function () { self.toast('已保存到相册'); })
    .catch(function (err) { self.toast('保存失败：' + XHS.errMsg(err)); });
};
