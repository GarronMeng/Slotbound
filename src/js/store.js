// store.js — 本地存储（高分榜 / 设置），localStorage 在小工具中按小工具隔离
'use strict';

import { nowMs } from './util.js';

var HS_KEY = 'slotbound.scores.v1';
var SET_KEY = 'slotbound.settings.v1';
var MAX_ENTRIES = 10;

var Store = {
  _cache: null,

  _safe: function () {
    try { return typeof localStorage !== 'undefined' && localStorage !== null; } catch (e) { return false; }
  },

  load: function () {
    if (this._cache) return this._cache;
    var list = [];
    if (this._safe()) {
      try {
        var raw = localStorage.getItem(HS_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Object.prototype.toString.call(parsed) === '[object Array]') {
            for (var i = 0; i < parsed.length; i++) {
              var e = parsed[i];
              if (e && typeof e.score === 'number' && isFinite(e.score)) {
                list.push({
                  name: String(e.name || '玩家').slice(0, 8),
                  score: Math.floor(e.score),
                  wave: Math.floor(e.wave || 0),
                  ts: e.ts || nowMs()
                });
              }
            }
          }
        }
      } catch (e2) { list = []; }
    }
    list.sort(function (a, b) { return b.score - a.score; });
    this._cache = list.slice(0, MAX_ENTRIES);
    return this._cache;
  },

  save: function () {
    if (!this._safe() || !this._cache) return false;
    try { localStorage.setItem(HS_KEY, JSON.stringify(this._cache)); return true; }
    catch (e) { return false; }
  },

  /** 返回该成绩可插入的名次（1-based），插不进返回 -1 */
  rankOf: function (score) {
    var l = this.load();
    if (l.length < MAX_ENTRIES) return l.length + 1;
    return score > l[l.length - 1].score ? MAX_ENTRIES : -1;
  },

  best: function () {
    var l = this.load();
    return l.length ? l[0] : null;
  },

  add: function (name, score, wave) {
    var l = this.load();
    l.push({ name: String(name || '玩家').slice(0, 8), score: Math.floor(score), wave: Math.floor(wave), ts: nowMs() });
    l.sort(function (a, b) { return b.score - a.score; });
    this._cache = l.slice(0, MAX_ENTRIES);
    return this.save();
  },

  clear: function () {
    this._cache = [];
    if (this._safe()) { try { localStorage.removeItem(HS_KEY); } catch (e) { /* ignore */ } }
    return true;
  },

  // ---------- 设置 ----------
  settings: function () {
    var s = { muted: false, reduced: false, name: '' };
    if (this._safe()) {
      try {
        var raw = localStorage.getItem(SET_KEY);
        if (raw) {
          var p = JSON.parse(raw);
          if (p && typeof p === 'object') {
            s.muted = !!p.muted;
            s.reduced = !!p.reduced;
            s.name = String(p.name || '').slice(0, 8);
          }
        }
      } catch (e) { /* ignore */ }
    }
    return s;
  },

  saveSettings: function (s) {
    if (!this._safe()) return false;
    try { localStorage.setItem(SET_KEY, JSON.stringify({ muted: !!s.muted, reduced: !!s.reduced, name: String(s.name || '').slice(0, 8) })); return true; }
    catch (e) { return false; }
  }
};

export { Store, MAX_ENTRIES };
