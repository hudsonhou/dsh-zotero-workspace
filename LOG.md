# dsh-zotero-workspace — LOG

> 按日期倒序。工程不含依赖与构建产物；只读插件，Host 半 + Client 半。

## 2026-11-06 — v0.1.0 发布准备

### 目标
DSH 右侧栏 Zotero 工作台：集合树/条目浏览、侧栏读渲染版 PDF 与解析后 Markdown、一键把文献引用 + 文件路径写进当前对话。

### 关键决策
1. **注册方式**：DSH 原生右栏 tab（`ctx.sidebarRightTabs.register` + `sidebar.right.pane.tab` 正文），以拿到会话级 `inputActions`/`sessionId`；better-sidebar 的 `TabComponentProps` 不含 `inputActions`，所以不做纯 better-sidebar tab。
2. **文件打开**：优先 `ctx.get('betterSidebar').openFile(scope, absPath)`（DSH `sidebar_open` 工具同一条调用链）；兜底为原生 Session 文件地址 `dsh-resource://file/session/<sid>/<绝对路径>`（内核文档确认 document-preview 只认 Session 域）。
3. **MD 权威位置**：Zotero 条目下的 `text/markdown` 附件（`zotero-lit-workflow` 口径），子笔记补充列出。
4. **只读**：仅 Zotero 本地 API（127.0.0.1:23119），不写库、不碰 SQLite、不依赖 MCP。
5. **依赖**：0 运行依赖、无需构建；Client 半为 lazy-CJS factory。

### 验证
- Host 路由实测（Zotero 10.0.6）：`/health` 200、`/tree` 集合树、`/items` 总数/分页、`/items?q=` 服务端检索、`/tags`、`/item` 详情与 PDF/MD 路径、`/file` 字节流、越界路径 403、非 GET 405；
- 离线测试：`test/selftest.mjs`（真实库）、`test/client-wiring.mjs`、`test/client-render.mjs` 全 PASS。

### 已修问题
- 拖动第三块边界时与第二块重叠：列表容器缺裁剪 + 滚动区 min-height 不收缩 → 内容溢出绘制到详情上。修复：容器 `overflow:hidden`/`flex:1 1 0%`、滚动区 `min-height:0`、根/三块均加裁剪兜底。
- 选中条目时列表先展开再回缩（详情弹跳）：详情加载/空态分支未用预留高度。修复：三种状态共用固定高度外壳。
- 拖动条可发现性：边界中心加 26×2px 握把短线。

### 发布状态
- 版本 v0.1.0，MIT；仓库 <https://github.com/hudsonhou/dsh-zotero-workspace>，Release <https://github.com/hudsonhou/dsh-zotero-workspace/releases/tag/v0.1.0>；GitHub topic：`dsh-better-sidebar` / `dsh-plugin` / `zotero` / `deepseek-harness`；
- 安装命令 `cd ~/.dsh && dsh plugin --profile <profile> add "github:hudsonhou/dsh-zotero-workspace#v0.1.0"`；已用 `npm pack github:…#v0.1.0` 验证可解析（15 个文件）；
- 已向上游 `omdsh-dev/DSH-better-sidebar` 提交目录条目 PR #1140（base `dev`）。

### 独立审计后的加固（同批修复）
- 笔记不再走 HTML 注入：服务端把 note HTML 转纯文本，客户端按文本渲染（消除 sanitizer 绕过/存储型 XSS）；
- `/file` 流加 `error` 监听与 `res.close` 销毁（避免文件消失时 unhandled error 杀死 Host 进程）；
- `ctx.slots.inject` 包住 pane 正文注册（槽位重声明/HMR 后可重装，避免空白 tab）；
- 列表/详情请求加序号守卫（快速切换时旧响应不再覆盖新结果）；
- 附件路径先 `existsSync` 校验，缺失文件不再显示可点按钮/写入死路径；
- `/mdtext` 大小上限；剪贴板 await 真实结果；拖动边界改用 body 高度、忽略右键、pointer capture、卸载清理；
- 列表过滤独立笔记（原先 68 条 "(无标题)" 死行）；
- 子项按 `parentItem` 过滤并限 200 条（防 Zotero 异常 key 返回全库）。


### 下一版候选（v0.2）
标签面板（`/tags` 已就绪）、整分类/多选引用、摘录引用、标注/笔记浏览、PDF|MD 并排分屏。
