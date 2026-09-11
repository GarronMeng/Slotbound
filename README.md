# Slotbound · 命运老虎机（中文竖屏版）

一款把 **3×3 老虎机** 与 **竖屏塔防自走棋** 融合的街机小游戏：拉动拉杆，用滚轮的连线
召唤单位；把同类单位拖到一起吸收升级；在敌人冲到核心之前，把它们全部消灭。

- 纯 Web（HTML / CSS / JS），单 Canvas 渲染，**60 FPS**，移动端优先。
- 全程序化资源：精灵、粒子、音效全部由代码生成，零外部请求 —— 天然符合小红书小工具的
  「完全离线自包含」要求。
- 已按《小工具容器能力清单》校验并打包为可上传的 zip。

---

## 玩法

| 操作 | 触摸 | 键盘 |
| --- | --- | --- |
| 拉杆（转动老虎机） | 点击右下「拉杆」按钮 | `空格` |
| 拾起 / 放下 / 吸收 | 拖拽单位 | `方向键` 移动光标 + `Enter` |
| 选核心（奖励界面） | 点卡片 | `1 / 2 / 3` |
| 暂停 / 恢复 | 右上「暂停」 | `P` 或 `Esc` |
| 立即重开 | 「再来一局」 | `R` |
| 静音 | 右上「静音」 | `M` |

- **召唤**：每次拉杆转动 3×3 滚轮。横排 / 竖排三连召唤 2 个单位；成对召唤 1 个；
  九连同触发 **JACKPOT**（★ 是通配符，但不能把任意盘判成九连）。
- **吸收**：同类单位拖到一起 → 等级 +1（最高 Lv5），攻击 / 生命指数增长。
- **布阵**：盾卫 / 剑士放前排挡线，弓手 / 法师 / 重炮放后排输出。
- **核心**：敌人冲到最底部会攻击核心，核心归零即失败。撑过第 20 波（含 4 个 BOSS）通关。
- **核心（升级）**：每 3 波从三张卡里选一枚，构筑你的流派（暴击 / 攻速 / 能量 / 召唤…）。
- **连击**：连续击杀提高得分倍率，最高 ×6。

## 目录

```
src/            源码（index.html / css / js 模块）
tools/          build.mjs 构建 · smoke.mjs 运行时测试 · screenshot.mjs 视觉自检
.skill/         minitool-zip-builder 校验器 + 打包器 + SKILL.md
dist/minitool/  构建产物（index.html + css/style.css + js/app.js）
dist/*.zip      可上传小红书小工具的成品包
dist/shots/     视觉自检截图
```

## 开发与验证

```
npm run build   # esbuild → dist/minitool（IIFE，target=chrome61）
npm test        # jsdom + 真实产物：92 项断言 + 1.8 万帧 NaN 巡检
npm run check   # 小红书小工具规范校验（19 项规则）
npm run pack    # 打成 dist/slotbound-xhs-minitool.zip
npm run all     # build + test + check + pack 一条龙
```

### 质量保障是怎么做的

- **运行时冒烟测试**（`tools/smoke.mjs`）：直接 `eval` 打包后的 `app.js`，驱动真实
  `Game / SlotMachine / UI / Store`，覆盖启动、拉杆结算、JACKPOT、吸收、暂停、结算、
  高分持久化、键盘 / 指针输入、20 波构建与通关路径，共 92 项断言。
- **NaN 巡检**：逐帧扫描全部单位 / 敌人 / 弹体 / 粒子 / 布局字段，杜绝「坐标变成 NaN
  导致整块画面看不见或崩渲染器」这类问题（已实际抓到并修复过一例）。
- **概率自检**：对拉杆结算跑 4 万次统计，确认 JACKPOT ≈1.8%、连线 25–55%、空奖 <5%。
- **合规负向测试**：给校验器喂一个预置 37 处违规的坏包，确认全部命中、退出码 1。
- **视觉自检**（`tools/screenshot.mjs`）：用 `@napi-rs/canvas` 真实渲染画面导出 PNG。

## 发布到小红书小工具

1. `npm run all`（构建 → 测试 → 校验 → 打包）。
2. 确认 `npm run check` 输出「失败 0」。
3. 在小工具上传页第二步选择 `dist/slotbound-xhs-minitool.zip`。

> 游戏内已接入端能力：结算页「发布战绩」调用 `window.xhs.miniTool.postNote` 带入战绩卡片图，
> 「保存战绩图」调用 `saveImageToPhotosAlbum`；未注入端能力的环境会优雅降级为提示。

## 已知限制

- 官方 `minitool-zip-builder-1.6.0.skill` 包在本沙箱内无法下载，`.skill/` 目录为按官方
  能力清单等价重建的实现（见 `.skill/minitool-zip-builder/SKILL.md`）。
