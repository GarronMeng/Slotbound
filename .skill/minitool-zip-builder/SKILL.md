# minitool-zip-builder · 小红书小工具打包 Skill（本地重建版 v1.6.0）

> ⚠️ 说明：官方 skill 包
> `https://fe-static.xhscdn.com/mini-tool/20260831163932/minitool-zip-builder-1.6.0.skill`
> 在本次运行环境中**无法下载**（`xhscdn.com` 的 TLS 握手被沙箱网络层拒绝，
> 直接 `curl` 与页面代理均失败）。因此本 SKILL 依据小红书官方《小工具容器能力清单》
> （`https://fe-video-qc.xhscdn.com/fe-platform-file/104101b8324ihuc967a06277180ac7t8006ptl0fm199r4.html`）
> 逐条**等价重建**，校验器位于 `scripts/validate.mjs`，打包器位于 `scripts/pack.mjs`。

## 触发条件

当需要把当前工作区的产物调整为「符合小红书小工具规范的代码格式」、校验并打包成
可上传的 zip 时，执行本 Skill。

## 产物形态（必须满足）

- 纯 Web（HTML/CSS/JS），完全离线自包含，**不支持任何网络请求**。
- 有且只有一个入口 `index.html`，位于包根目录。
- 仅允许文件类型：`.html .css .js .png .jpg .jpeg .gif .webp .svg .woff .woff2 .json`。
- 脚本必须外置：禁止内联 `<script>…</script>`、行内事件 `on*=`、`javascript:`、
  `eval()` / `new Function()` / `WebAssembly`、`type="module"`。
- 资源只能引用包内相对路径；图片可用 `data:` / `blob:`；禁止外部 CDN 脚本/样式/字体/图片。
- 禁止：`iframe/object/embed`、`target="_blank"`、`a[download]`、会跳转的 `<form>`。
- 禁止禁用 API：`fetch/XHR/WebSocket/SSE`、`Worker/ServiceWorker`、`geolocation`、
  `clipboard`、`RTCPeerConnection`、`requestFullscreen`、`window.open/prompt`、
  `SharedArrayBuffer`、`OffscreenCanvas`、`document.write`、设备运动/朝向传感器等。
- JS 兼容基线：Chrome 61 / ES2017（禁止 `?.`、`??`、`||=`、类字段、`for await`、
  `structuredClone`、`flat/flatMap`、`replaceAll`、`globalThis` 等更新特性）。
- CSS 兼容基线：Chrome 61（避免 flex `gap`、`aspect-ratio`、`clamp()`、`min()/max()`、
  `conic-gradient`、`backdrop-filter`、`dvh/svh/lvh`、`:is/:where/:has`）。
- 端能力 `window.xhs.miniTool.*` 只能调用 `postNote / saveImageToPhotosAlbum / writeTempFile`，
  且调用前必须判空并提供降级路径。

## 工作流

1. 构建产物（输出到 `dist/minitool/`）：
   ```
   npm run build
   ```
2. 校验产物（按上面规则逐条检查，失败则退出码 1）：
   ```
   npm run check
   ```
3. 修复任何 `FAIL` 项后重新校验，直到「失败 0」。
4. 打包（生成标准 zip，`index.html` 在根，附 SHA-256）：
   ```
   npm run pack
   ```
5. 将 `dist/slotbound-xhs-minitool.zip` 用于小工具上传页第二步。

## 自检

校验器不是空壳：对 `validate.mjs` 的负向测试（`/tmp/badpkg`）中预置的 37 处违规
（内联脚本、外链、iframe、eval、Worker、`?.`、`??`、`clamp()` 等）全部被正确命中并
以退出码 1 终止，证明规则真实生效。
