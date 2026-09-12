// safearea.js — 战场与 DOM HUD / 底部老虎机的视觉安全区修复
'use strict';

var INSTALLED = false;

function readHudHeight(game) {
  var fallback = 92;
  try {
    if (game.ui && game.ui.el && game.ui.el.hud) {
      var rect = game.ui.el.hud.getBoundingClientRect();
      if (rect && rect.height > 20) return rect.height;
    }
  } catch (e) {}
  return fallback;
}

function applySafeArea(game) {
  var L = game.L;
  if (!L || !L.fieldBottom) return;

  var scale = Math.max(0.45, game.scale || 1);
  var hudPx = readHudHeight(game);
  var hudBottom = (hudPx + 14) / scale;

  // 至少从 132 逻辑像素以下开始；真机 HUD 更高时按实际高度自适应。
  var desiredTop = Math.max(132, hudBottom);
  // 保证仍有行军空间，不挤进棋盘主体。
  var maxTop = Math.max(112, L.gridY - 54);
  L.fieldTop = Math.min(desiredTop, maxTop);
  L.fieldH = Math.max(1, L.fieldBottom - L.fieldTop);
  L.enemyClipTop = L.fieldTop;
  L.enemyClipBottom = L.fieldBottom - 4;
  L.safeAreaVersion = 3;
}

function safeSpawnY(game, enemy) {
  var L = game.L;
  var radius = enemy.r * L.eScale;
  return L.fieldTop + radius + 12;
}

function syncEntityPositions(game) {
  var L = game.L, i, u, e;
  if (!L) return;
  for (i = 0; i < game.units.length; i++) {
    u = game.units[i];
    if (u && u.sync) u.sync(L);
  }
  if (game.enemies && game.enemies.live) {
    for (i = 0; i < game.enemies.live.length; i++) {
      e = game.enemies.live[i];
      if (!e) continue;
      e.x = L.gridX + (e.lane + 0.5) * L.cellW;
      var minY = safeSpawnY(game, e);
      if (e.y < minY) e.y = minY;
    }
  }
}

function viewportSize(game) {
  var stage = game.ui && game.ui.el && game.ui.el.stage;
  var w = 0, h = 0, rect = null;
  try {
    if (stage) {
      rect = stage.getBoundingClientRect();
      w = (rect && rect.width) || stage.clientWidth || 0;
      h = (rect && rect.height) || stage.clientHeight || 0;
    }
  } catch (e) {}

  // iOS 内置浏览器在覆盖层切换时偶尔会短暂报告一个过窄的 stage；
  // 只有明显异常时才回退到 viewport，避免把正常 letterbox 尺寸误改。
  if (typeof window !== 'undefined') {
    var vw = window.visualViewport && window.visualViewport.width ? window.visualViewport.width : window.innerWidth;
    var vh = window.visualViewport && window.visualViewport.height ? window.visualViewport.height : window.innerHeight;
    if ((!w || w < 240) && vw > w) w = vw;
    if ((!h || h < 420) && vh > h) h = vh;
  }
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

function resyncLayout(game) {
  if (!game || !game.resize) return;
  var size = viewportSize(game);
  var dpr = 1;
  if (typeof window !== 'undefined') dpr = Math.min(window.devicePixelRatio || 1, 2);
  game.resize(size.w, size.h, dpr);
  // resize 会重算 L，但基础实现不会主动把已存在单位搬回新格子坐标。
  syncEntityPositions(game);
  // 防御性修正：Canvas render transform 必须始终与布局 scale 一致。
  game.px = game.scale * game.dpr;
  if (game.ui && game.ui.syncOverlay) game.ui.syncOverlay();
}

function scheduleRewardResync(game) {
  // 先立即恢复一次；再等覆盖层退出后的 1~2 帧各校正一次，兼容 iOS WebView。
  resyncLayout(game);
  if (typeof window === 'undefined') return;
  var raf = window.requestAnimationFrame;
  if (raf) {
    raf(function () {
      resyncLayout(game);
      raf(function () { resyncLayout(game); });
    });
  } else if (window.setTimeout) {
    window.setTimeout(function () { resyncLayout(game); }, 32);
  }
}

export function installSafeAreaFix(Game) {
  if (INSTALLED) return;
  INSTALLED = true;

  var origResize = Game.prototype.resize;
  Game.prototype.resize = function (cw, ch, dpr) {
    origResize.call(this, cw, ch, dpr);
    applySafeArea(this);
    syncEntityPositions(this);
    this.px = this.scale * this.dpr;
  };

  var origSpawnEnemy = Game.prototype.spawnEnemy;
  Game.prototype.spawnEnemy = function () {
    var enemy = origSpawnEnemy.apply(this, arguments);
    if (enemy && this.L) {
      var minY = safeSpawnY(this, enemy);
      if (enemy.y < minY) enemy.y = minY;
    }
    return enemy;
  };

  // 奖励选择页是 iOS 内置浏览器最容易触发布局失配的节点。
  // 选卡完成后强制用真实 stage 尺寸重建 Canvas，并同步 DOM overlay。
  var origPickCard = Game.prototype.pickCard;
  Game.prototype.pickCard = function (idx) {
    var hadCard = !!(this.pendingCards && this.pendingCards[idx]);
    var out = origPickCard.call(this, idx);
    if (hadCard && this.state === 1) scheduleRewardResync(this);
    return out;
  };
}
