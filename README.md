# SimpleDraw
SimpleDraw 是一款轻量级流程图绘制插件，支持文本框与箭头自由创建、Markdown 渲染、多形状切换、箭头路由避让、PNG 导出、撤销重做及吸附对齐，让笔记中的图表绘制更直观高效。

SimpleDraw is a lightweight flowchart drawing plugin that supports free-form creation of text boxes and arrows, Markdown rendering, multi-shape switching, arrow routing with obstacle avoidance, PNG export, undo/redo, and snap alignment, making diagram creation in notes more intuitive and efficient.

> 流程图绘制桌面应用，基于 Electron。
> A  flowchart drawing desktop app built with Electron.

## 功能 Features

- **文本框 Textboxes**：多形状（矩形/椭圆/菱形）、Markdown 渲染（marked + KaTeX 公式）、图片插入、颜色定制。Multiple shapes, Markdown rendering with KaTeX math, image insertion, color customization.
- **箭头 Arrows**：正交路由智能避让、4 种形状、虚线、首尾显隐、连接点标记。Smart orthogonal routing, 4 shapes, dashed style, start/end visibility, anchor dots.
- **交互 Interaction**：拖拽/缩放吸附、框选、调整大小吸附、撤销/重做（100 步）。Drag/resize snap, box select, 100-step undo/redo.
- **文件 File**：新建/保存/另存为/打开（`.simpledraw`），关闭未保存提醒。New/save/save-as/open (`.simpledraw`), unsaved changes warning on close.
- **导出 Export**：PNG 导出（html-to-image），支持网格/透明背景控制。PNG export via html-to-image with grid and transparent background.
- **设置 Settings**：箭头样式、颜色、字号、快捷键录制、吸附开关。Arrow style, colors, font size, shortcut recording, snap toggle.
- **UI**：标题栏文件名 + 脏标记、状态栏、Toast 通知。Title bar with dirty indicator, status bar, Toast notifications.

## 开发 Development

```bash
npm run dev          # 开发模式 Dev mode
npm run dist:win     # 打包 Windows Windows build
npm run dist:linux   # 打包 Linux Linux build
```

技术栈 Tech Stack：Electron + TypeScript + esbuild + marked + KaTeX + html-to-image。
