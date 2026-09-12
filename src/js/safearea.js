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
  L.safeAreaVersion = 2;
}

function safeSpawnY(game, enemy) {
  var L = game.L;
  var radius = enemy.r * L.eScale;
  return L.fieldTop + radius + 12;
}

export function installSafeAreaFix(Game) {
  if (INSTALLED) return;
  INSTALLED = true;

  var origResize = Game.prototype.resize;
  Game.prototype.resize = function (cw, ch, dpr) {
    origResize.call(this, cw, ch, dpr);
    applySafeArea(this);
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
}
