// main.js — 启动 / 输入 / 主循环
'use strict';

import { clamp } from './util.js';
import { Atlas } from './theme.js';
import { FX } from './fx.js';
import { Sfx, Music } from './audio.js';
import { Game, STATE } from './game.js';
import { UI } from './ui.js';
import { Store } from './store.js';
import { installStrategyLayer } from './strategy.js';
import { installSafeAreaFix } from './safearea.js';
import { installProgression } from './progression.js';
import { installV14 } from './v14.js';

installStrategyLayer(Game);
installSafeAreaFix(Game);
installProgression(Game);
installV14(Game);

var STEP = 1 / 60;
var MAX_SUB = 4;

function boot() {
  Atlas.build();

  var canvas = document.getElementById('game');
  var game = new Game(canvas, null);
  var ui = new UI(game);
  game.ui = ui;

  var set = Store.settings();
  ui.setMuted(!!set.muted);

  function resize() {
    var host = document.getElementById('stage');
    var w = host.clientWidth || window.innerWidth;
    var h = host.clientHeight || window.innerHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w < 1 || h < 1) return;
    game.resize(w, h, dpr);
  }
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 120); });

  function toLogical(cx, cy) {
    var r = canvas.getBoundingClientRect();
    var s = game.scale || 1;
    return {
      x: (cx - r.left) / s - game.ox,
      y: (cy - r.top) / s - game.oy
    };
  }

  // 轻点单位 = 查看/锁定/主养/进化；拖动 = 调整阵型。
  var pointerDown = false;
  var pointerStartX = 0, pointerStartY = 0;
  var pointerMoved = false;
  var pointerUnit = null;

  function onDown(cx, cy) {
    Sfx.init();
    if (game.state !== STATE.PLAY || game.paused) return;
    var p = toLogical(cx, cy);
    var u = game.pickAt(p.x, p.y);
    pointerStartX = p.x; pointerStartY = p.y;
    pointerMoved = false;
    pointerUnit = u || null;
    if (u) {
      game._holdX = p.x; game._holdY = p.y;
      u.sync(game.L);
    }
    pointerDown = true;
  }
  function onMove(cx, cy) {
    if (!pointerDown) return;
    var p = toLogical(cx, cy);
    var dx = p.x - pointerStartX, dy = p.y - pointerStartY;
    if (dx * dx + dy * dy > 100) pointerMoved = true;
    if (!game.held) return;
    game._holdX = p.x; game._holdY = p.y;
    var cell = game.cellAt(p.x, p.y);
    if (cell) { game.cursor.c = cell.c; game.cursor.r = cell.r; }
  }
  function onUp(cx, cy) {
    if (!pointerDown) return;
    pointerDown = false;
    if (!game.held) { pointerUnit = null; return; }
    var p = toLogical(cx, cy);
    var held = game.held;

    if (!pointerMoved && pointerUnit === held && game.openUnitPanel) {
      held.held = false;
      game.held = null;
      held.sync(game.L);
      game._holdX = undefined; game._holdY = undefined;
      pointerUnit = null;
      game.openUnitPanel(held);
      return;
    }

    game.releaseAt(p.x, p.y);
    game._holdX = undefined; game._holdY = undefined;
    pointerUnit = null;
  }

  var hasPointer = typeof window.PointerEvent !== 'undefined';
  if (hasPointer) {
    canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      onDown(e.clientX, e.clientY);
    });
    window.addEventListener('pointermove', function (e) { onMove(e.clientX, e.clientY); });
    window.addEventListener('pointerup', function (e) { onUp(e.clientX, e.clientY); });
    window.addEventListener('pointercancel', function () { pointerDown = false; pointerUnit = null; game.cancelHold(); });
  } else {
    canvas.addEventListener('touchstart', function (e) {
      e.preventDefault();
      var t = e.changedTouches[0];
      onDown(t.clientX, t.clientY);
    }, { passive: false });
    canvas.addEventListener('touchmove', function (e) {
      e.preventDefault();
      var t = e.changedTouches[0];
      onMove(t.clientX, t.clientY);
    }, { passive: false });
    canvas.addEventListener('touchend', function (e) {
      e.preventDefault();
      var t = e.changedTouches[0];
      onUp(t.clientX, t.clientY);
    }, { passive: false });
    canvas.addEventListener('touchcancel', function () { pointerDown = false; pointerUnit = null; game.cancelHold(); });
    canvas.addEventListener('mousedown', function (e) { e.preventDefault(); onDown(e.clientX, e.clientY); });
    window.addEventListener('mousemove', function (e) { onMove(e.clientX, e.clientY); });
    window.addEventListener('mouseup', function (e) { onUp(e.clientX, e.clientY); });
  }

  window.addEventListener('keydown', function (e) {
    var k = e.key;
    var code = e.keyCode;
    var handled = true;

    if (k === ' ' || code === 32) {
      Sfx.init();
      if (game.state === STATE.TITLE) ui.startGame();
      else if (game.state === STATE.OVER || game.state === STATE.WIN) ui.startGame();
      else if (game.state === STATE.PLAY) game.spin();
    } else if (k === 'Enter') {
      if (game.state === STATE.TITLE || game.state === STATE.OVER || game.state === STATE.WIN) ui.startGame();
      else if (game.state === STATE.PLAY && game._prep) game.beginPreparedWave();
      else if (game.state === STATE.PLAY) toggleHold();
    } else if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
      moveCursor(-1, 0);
    } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
      moveCursor(1, 0);
    } else if (k === 'ArrowUp' || k === 'w' || k === 'W') {
      moveCursor(0, -1);
    } else if (k === 'ArrowDown' || k === 's' || k === 'S') {
      moveCursor(0, 1);
    } else if (k === 'e' || k === 'E') {
      toggleHold();
    } else if (k === 'i' || k === 'I') {
      if (game.state === STATE.PLAY && game.openUnitPanel) {
        var inspect = game.grid[game.cursor.c][game.cursor.r];
        if (inspect) game.openUnitPanel(inspect);
      }
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      if (game.state === STATE.PLAY || game.state === STATE.PAUSE) game.togglePause();
    } else if (k === 'r' || k === 'R') {
      ui.startGame();
    } else if (k === 'm' || k === 'M') {
      ui.setMuted(!ui.muted);
    } else if (k === '1' || k === '2' || k === '3') {
      if (game.state === STATE.REWARD) game.pickCard(parseInt(k, 10) - 1);
    } else {
      handled = false;
    }
    if (handled) e.preventDefault();
  });

  function moveCursor(dc, dr) {
    game.showCursor = true;
    game.cursor.c = clamp(game.cursor.c + dc, 0, 2);
    game.cursor.r = clamp(game.cursor.r + dr, 0, 3);
  }
  function toggleHold() {
    if (game.state !== STATE.PLAY) return;
    if (game.held) {
      var held = game.held;
      game.held = null;
      held.held = false;
      game.tryDrop(held, game.cursor.c, game.cursor.r);
      if (game.units.indexOf(held) >= 0) held.sync(game.L);
    } else {
      var u = game.grid[game.cursor.c][game.cursor.r];
      if (u) { game.held = u; u.held = true; game._holdX = u.x; game._holdY = u.y; Sfx.uiTap(); }
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && game.state === STATE.PLAY && !game._prep) game.togglePause(true);
  });
  window.addEventListener('blur', function () {
    if (game.state === STATE.PLAY && !game._prep) game.togglePause(true);
  });

  function firstGesture() {
    if (Sfx.init() && !ui.muted && game.state === STATE.PLAY) Music.start();
    window.removeEventListener('touchstart', firstGesture);
    window.removeEventListener('mousedown', firstGesture);
  }
  window.addEventListener('touchstart', firstGesture);
  window.addEventListener('mousedown', firstGesture);

  var origStart = ui.startGame.bind(ui);
  ui.startGame = function () {
    origStart();
    if (!ui.muted) Music.start();
  };

  var last = 0, acc = 0;
  function frame(ts) {
    window.requestAnimationFrame(frame);
    if (!last) last = ts;
    var dt = (ts - last) / 1000;
    last = ts;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    var n = 0;
    while (acc >= STEP && n < MAX_SUB) {
      game.update(STEP);
      acc -= STEP;
      n++;
    }
    if (acc > STEP * MAX_SUB) acc = 0;
    game.render();
    ui.update();
  }
  window.requestAnimationFrame(frame);

  window.SLOTBOUND = { game: game, ui: ui, FX: FX, Sfx: Sfx, STATE: STATE };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
