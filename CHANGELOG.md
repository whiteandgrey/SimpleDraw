# SimpleDraw Desktop 更新日志

---

## v1.5.5 (2026-06-01)

**从 Obsidian 插件同步 v1.5.5——空内容自动隐藏标签 + 确认按钮简化**

### Bug 修复

| 问题 | 根因 | 修复 |
|------|------|------|
| 删空标签内容后 `labelVisible` 仍为 `true`，Escape/点击画布关闭编辑器时仍显示灰色占位符 | v1.5.4 将 auto-hide 逻辑从 `closeEditors()` 移至 ✓ 确认按钮，但 Escape 和点击别处关闭也走 `closeEditors()`，未执行 auto-hide | 恢复 `closeEditors()` 中自动 `labelVisible = false` 逻辑，三种关闭路径统一处理 |
| ✓ 确认按钮包含与 `closeEditors()` 重复的 auto-hide 逻辑 | v1.5.4 为弥补 auto-hide 缺失而额外添加 | `closeEditors()` 恢复后按钮冗余逻辑删除，简化为 `closeEditors(); requestRender()` |

### 文件变更

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/renderer/canvas-view.ts` | ~8 行 | closeEditors 恢复 auto-hide + 确认按钮简化 |
| `package.json` | +1 行 / -1 行 | 版本号 1.5.4 → 1.5.5 |
| `scripts/installer.nsi` | 4 处 | OutFile/DISPLAYVERSION 等版本号同步为 1.5.5 |

---

## v1.5.4 (2026-06-01)

**从 Obsidian 插件同步 v1.5.4——标签命中检测重构为坐标碰撞 + 逻辑双击 + 删除 insertBefore**

### 核心重构

- **`engine.ts` 新增 `getLabelAt(x, y)` / `isPointInLabel(arrow, x, y)`**：与 `getElementAt` 同思路的坐标碰撞检测，替代 DOM `closest` 查询。标签现在像文本框一样由数据驱动命中检测
- **`handleDefaultMouseDown()` 实现逻辑双击**：首次单击标签选中箭头，第二次单击直接打开标签编辑器，不再依赖浏览器 dblclick 事件
- **`onDblClick()` 改用 `getLabelAt`**：数据驱动的兜底检测
- **`closeEditors()` 移除自动 `labelVisible = false`**，仅 ✓ 确认按钮触发的关闭才隐藏空内容标签

### Bug 修复

| 问题 | 根因 | 修复 |
|------|------|------|
| 双击标签文字无法打开编辑器（浏览器不生成 dblclick） | v1.5.3 引入的 `insertBefore` 在两次单击间迁移标签 DOM 节点，浏览器判定"不同元素"→ 不生成 dblclick 事件 | 删除 `renderArrows()` 中的 `insertBefore` 逻辑，标签 DOM 不再每帧移动；改用逻辑双击（第二次单击已选中标签→开编辑器） |
| `closeEditors` 误隐藏标签（关闭编辑器时空内容自动设 `labelVisible = false`） | 关闭编辑器的任何路径（Escape、点击别处）都触发自动隐藏 | 仅 ✓ 确认按钮才隐藏空内容标签 |

### 文件变更

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/renderer/engine.ts` | +25 行 | 新增 getLabelAt / isPointInLabel 方法 |
| `src/renderer/canvas-view.ts` | ~30 行 | handleDefaultMouseDown 重排（标签检测先于 closeEditors）+ 逻辑双击 + 删除 insertBefore + closeEditors 去 auto-hide + onDblClick 改用 getLabelAt |
| `package.json` | +1 行 / -1 行 | 版本号 1.5.3 → 1.5.4 |

---

## v1.5.3 (2026-05-28)

**从 Obsidian 插件同步 v1.5.3——标签层级修复 + 编辑框 auto-grow 恢复**

### Bug 修复

| 问题 | 根因 | 修复 |
|------|------|------|
| 标签始终在顶层，不跟随线段 Z 轴 | 固定 `z-index: 22` + `appendChild`，标签不受置顶/置底影响 | 删除 CSS 和 inline z-index；改用 `insertBefore` 插入到与箭头 SVG 相同的 DOM 位置（跟随所连最高 z-order 文本框） |
| 编辑框重新打开后 auto-grow 高度归零 | 设置 `textarea.value` 后未立即触发 auto-grow | 在两个编辑器的 value 赋值后增加 `scrollHeight` 立即撑高 |

### 文件变更

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/renderer/styles.css` | -1 行 | 移除 `.simpledraw-arrow-label { z-index: 22 }` |
| `src/renderer/canvas-view.ts` | ~20 行 | 移除 inline zIndex + insertBefore DOM 定位 + 两处 auto-grow 即时触发 |
| `package.json` | +1 行 / -1 行 | 版本号 1.5.2 → 1.5.3 |

---

## v1.5.2 (2026-05-28)

**从 Obsidian 插件同步 v1.5.2 全部更新**

### 新增功能

- **ArrowData 新增 3 个字段**：`labelPosition`（重叠/上移/下移）、`labelWidth`、`labelHeight`（标签框显式宽高），兼容旧文件
- **`engine.ts` 新增 `getLabelOffset()`**：按箭头中点处路径段的法向量方向计算位置偏移（15px）
- **标签位置切换按钮**：标签编辑器工具栏新增 ⊥（重叠）/ ↑（上方）/ ↓（下方）三个按钮，高亮当前选中项
- **标签 resize 手柄**：选中箭头时标签四角显示 8×8 手柄，拖拽实现对称缩放（中心固定在路径中点）
- **点击标签文字选中箭头**：单击标签文字直接选中箭头并显示手柄，无需先点线段

### Bug 修复

| 问题 | 根因 | 修复 |
|------|------|------|
| 字号按钮改动编辑器 textarea 大小 | `updateSizeDisplay()` 同时设置 `textarea.style.fontSize` | 只更新 `sizeDisplay.textContent` |
| `onMouseDown` 过滤条件拦截所有标签交互 | `target.closest('.simpledraw-arrow-label')` 捕获标签内所有元素 | 替换为白名单 `!target.closest('.simpledraw-label-resize-handle') && !target.closest('[data-arrow-label-id]')` |
| 标签 resize 跳变 | 绝对坐标公式不依赖初始尺寸 | 改为 DOM 测量 + delta 增量 `origW + 2*dx` |
| 椭圆填充仍为矩形 | 仅 `container` 有 `borderRadius: 50%`，`wrapper` 无 | 增加 `wrapper.style.borderRadius = '50%'` |
| 编辑框太小 | textarea 无 auto-grow；容器 maxWidth 仅 350px | input 事件 auto-grow（`scrollHeight`）；maxWidth 改为 500px |
| 编辑框 resize 只能上下拖 | `resize: 'vertical'` 限制 | 改为 `resize: 'both'`（两编辑器通用） |
| 普通文本框编辑器无 auto-grow | 仅标签编辑器有 | 在 textbox 编辑器的 input 事件中也增加 auto-grow |
| 标签 resize 手柄不可见 | `var(--accent)` 未在 CSS 中定义，解析为透明 | 改为 `var(--accent-color)`，与文本框手柄一致 |

### 文件变更

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/renderer/types.ts` | +3 行 | ArrowData 新增 labelPosition/labelWidth/labelHeight |
| `src/renderer/engine.ts` | +40 行 | dragging 类型扩展 + getLabelOffset() 方法 |
| `src/renderer/locale.ts` | +6 行 | 3 个新翻译键（中英各 3） |
| `src/renderer/canvas-view.ts` | ~120 行 | 字号修复 + 位置按钮 + resize 手柄 + 鼠标事件 + 渲染 + onMouseDown 过滤 + Delete guard + resize:both + auto-grow + 椭圆填充 |

---

## v1.5.1 (2026-05-28)

**线段文字标签功能（从 Obsidian 插件迁移）**

### 新增功能

- **ArrowData 新增 4 个字段**：`labelContent`（标签文本）、`labelVisible`（显隐）、`labelFontSize`（字号）、`labelWritingMode`（书写方向），全部可选兼容旧文件
- **`engine.ts` 新增 `getArrowMidpoint()`**：按路径总长度 50% 计算箭头中点位置，适用于 L 形、Z 形等多段线路径
- **箭头编辑器新增「T」按钮**：切换标签显隐，首次开启自动弹出标签编辑器
- **标签渲染**：每帧在箭头路径中点渲染 Markdown 标签内容，空内容时显示灰色占位提示
- **标签编辑器**：精简版 textarea（含字号按钮 A- / A+ / R + 确认按钮），双击可见标签直接进入编辑
- **标签跟随**：标签位置随箭头路径和连接文本框自动更新，无需额外事件

### Bug 修复
- 修复点击画板后标签内容消失的 bug（`renderArrows()` 中 `contentEl.remove()` 每次帧渲染都执行，但重建仅当 `data-rendered` 变化时触发 → 内容被删但没重建）
- 编辑标签时 Ctrl+C/V 正常在 textarea 中工作，不被画布快捷键拦截
- 空内容提交后自动隐藏标签（`labelVisible: false`）
- 标签区域点击跳过画布拖拽操作
- 修复标签编辑器按钮代码丢失导致字号按钮不显示的问题

### 样式

- 新增 `.simpledraw-arrow-label`、`.simpledraw-arrow-label-content`、`.simpledraw-arrow-label-placeholder`、`.simpledraw-arrow-label-editor` 样式

---

## v1.4.6 (2026-05-19)

**线段文字标签功能 + 交互修复（从 Obsidian 插件迁移）**

### 新增功能

- **ArrowData 新增 4 个字段**：`labelContent`（标签文本）、`labelVisible`（显隐）、`labelFontSize`（字号）、`labelWritingMode`（书写方向），全部可选兼容旧文件
- **`engine.ts` 新增 `getArrowMidpoint()`**：按路径总长度 50% 计算箭头中点位置，适用于 L 形、Z 形等多段线路径
- **箭头编辑器新增「T」按钮**：切换标签显隐，首次开启自动弹出标签编辑器
- **标签渲染**：每帧在箭头路径中点渲染 Markdown 标签内容，空内容时显示灰色占位提示
- **标签编辑器**：精简版 textarea（含确认按钮），双击可见标签直接进入编辑
- **标签跟随**：标签位置随箭头路径和连接文本框自动更新，无需额外事件

### 交互修复

- 编辑标签时 Ctrl+C/V 正常在 textarea 中工作，不被画布快捷键拦截
- 空内容提交后自动隐藏标签（`labelVisible: false`）
- 标签区域点击跳过画布拖拽操作

### 样式

- 新增 `.simpledraw-arrow-label`、`.simpledraw-arrow-label-content`、`.simpledraw-arrow-label-placeholder`、`.simpledraw-arrow-label-editor` 样式

---

## v1.4.6 (2026-05-19)

**新建窗口行为优化**

- Ctrl+N / 菜单「新建」不再关闭当前窗口，改为独立打开新窗口
- 新增 `app:open-new-window` IPC 处理，主进程创建独立 `BrowserWindow`
- preload 新增 `openNewWindow()` API

---

## v1.4.5 (2026-05-19)

**网格渲染修复**

- 将 `linear-gradient` 替换为 `repeating-linear-gradient`，GPU 驱动对 repeating 模式渲染更一致
- 新增 `backgroundPosition` 计算（基于视口平移取模），使网格线与画布原点对齐
- `.simpledraw-grid` 新增 `image-rendering: pixelated`（防止亚像素模糊）`will-change: transform`（强制独立合成层）
- 修复部分 Windows 电脑上网格显示极淡、打开设置窗口后突然清晰的问题

---

## v1.4.4 (2026-05-19)

**四分点对齐补全**

- 修复拖拽仅有普通锚点的文本框时，未触发其配对四分点对齐吸附的问题
- 新添 Case 2：静态文本框的四分点 → 移动文本框的配对锚点（反向对齐）

---

## v1.4.3 (2026-05-19)

**四分点对齐精准化**

- 新增 `getQuarterPointPairings()` 方法，扫描箭头构建四分点 → 配对锚点的映射
- 四分点只与它所连接的特定锚点对齐，不再与其他锚点产生吸附

---

## v1.4.2 (2026-05-19)

**四分点对齐条件过滤**

- 新增 `getUsedAnchorTypes()` 方法，扫描箭头记录每个文本框已使用的锚点类型
- 方案二下，四分点仅在有箭头连接时才包含在对齐点集中，无连接的额外锚点不参与吸附

---

## v1.4.1 (2026-05-19)

**方案二拖动对齐适配**

- 新增 `getAlignmentPoints()` 方法
- `computeAlignmentPreview` / `applyAlignmentSnap` 改用动态对齐点集
- 方案二下，文本框拖动时蓝色对齐线也会在四分点位置出现

---

## v1.4.0 (2026-05-19)

**双锚点方案 + 可调吸附预览**

- `types.ts`：`AnchorType` 新增 8 个四分点锚点（`top-q1` / `top-q2` 等），新增 `AnchorScheme` 类型
- `settings.ts`：新增 `anchorScheme`（默认 `scheme1`）和 `snapPreviewRadius`（默认 8px）
- 设置窗口新增「吸附功能」区块
  - 锚点方案下拉框（方案一：角点 + 边中点，8 锚点 / 方案二：边中点 + 四分之一点，12 锚点）
  - 吸附预览圆圈大小滑块（4-20px）
- `engine.ts`：`getAnchors()` 按方案返回不同锚点集，`getAnchorPosition` / `getAnchorDirection` / `anchorToEdgeIdx` 适配新锚点类型
- `canvas-view.ts`：吸附预览圆圈半径改为读取 `settings.snapPreviewRadius`

---

## v1.3.3 (2026-05-19)

- 去除文本框右键菜单中编辑项与锁定项之间的分隔线

---

## v1.3.2 (2026-05-19)

**锁定功能**

- `TextBoxData` 新增 `locked` 属性
- 文本框编辑工具栏新增锁定/解锁按钮
- 锁定状态下，文本框无编辑、大小调整、移动、删除、选择和对齐操作
- 锁定文本框在画布上显示锁定图标
- 导出 PNG 时自动去除锁定图标

---

## v1.3.1 (2026-05-18)

- 导出为 PNG 功能
- 设置窗口重构（独立 dialog 实现）
- 文本框插入图片支持
- 多项 UI 改进与 bug 修复
