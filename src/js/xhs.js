// xhs.js — 小红书小工具端能力桥接（window.xhs.miniTool）
// 端能力由容器自动注入，无需引入任何 SDK 脚本；未注入时全部走降级路径。
'use strict';

var XHS = {
  /** 是否运行在注入了端能力的小工具容器内 */
  available: function () {
    return !!(typeof window !== 'undefined' && window.xhs && window.xhs.miniTool);
  },

  api: function () {
    return this.available() ? window.xhs.miniTool : null;
  },

  /**
   * 发布战绩笔记。
   * 大图先 writeTempFile 换成 filePath，再带入发布页（避免超长 base64 上行）。
   */
  shareNote: function (opt) {
    var mt = this.api();
    if (!mt) return Promise.reject({ errMsg: 'shareNote:fail no-bridge' });
    var payload = {
      title: String(opt.title || '').slice(0, 20),
      content: String(opt.content || '').slice(0, 1000),
      tags: String(opt.tags || '')
    };

    var finish = function (url) {
      payload.mediaInfo = { image_resources: [{ url: url }] };
      return mt.postNote(payload);
    };

    if (mt.writeTempFile) {
      return mt.writeTempFile({ data: opt.dataUrl })
        .then(function (res) {
          var fp = res && res.filePath;
          return finish(fp || opt.dataUrl);
        })
        .catch(function () { return finish(opt.dataUrl); }); // 降级：直接传 data URI
    }
    return finish(opt.dataUrl);
  },

  /** 保存图片到系统相册（需用户主动触发） */
  saveImage: function (dataUrl) {
    var mt = this.api();
    if (!mt || !mt.saveImageToPhotosAlbum) return Promise.reject({ errMsg: 'saveImageToPhotosAlbum:fail no-bridge' });
    return mt.saveImageToPhotosAlbum({ filePath: dataUrl });
  },

  /** 统一错误文案 */
  errMsg: function (err) {
    if (!err) return '未知错误';
    if (typeof err === 'string') return err;
    return err.errMsg || '未知错误';
  }
};

export { XHS };
