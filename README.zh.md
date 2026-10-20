# Codex 风格 Worktree（dsh-codex-worktree）

> 给 DSH 会话一个「像 Codex 一样」的工作位置选择：新会话首屏在工作区旁边选 **本地** 还是 **新建本地工作树**（默认）；发送第一条消息后自动建一个 detached 检出并把**本次会话**的 cwd 切进去。不新增 Workspace、不需要命名、插件不建分支（分支名由 Git 在提交时决定）。

- 版本：`0.4.0`（2026-10-20；包 / 插件 id / loader row name：`dsh-codex-worktree`；profile patch 里的 insert row id：`codex-worktree`）
- API 命名空间：`/api/dsh-codex-worktree`、RPC 方法前缀 `dsh-codex-worktree/`；侧车：`$DSH_HOME/dsh-codex-worktree/state.json`；禁用标记：`.dsh-codex-worktree-off`
- GitHub：<https://github.com/wplct/dsh-codex-worktree>
- 要求：DSH `0.2.0-rc.2` / `0.2.1-rc.2`、Node.js `>= 22.19.0`、`git` 在 PATH 里
- 许可：MIT

## 0.4.0 与 0.3.0 的差异

| 能力 | 0.3.0 | 0.4.0 |
| --- | --- | --- |
| 清理保护 | 清理直接删除 | 检出目录正被**其它**活跃会话当作 cwd 时拒绝（`worktree-in-use`）；清理本会话自己的检出会先把 cwd 移回工作区；确认后可 `force` 覆盖 |
| 删除前快照 | 仅 autoPrune 对 detached 提交打 ref | 所有删除路径统一：detached 且 `HEAD ≠ baseCommit` 时先写 `refs/dsh-codex-worktree/<时间戳+会话尾号>` 并登记 sidecar |
| 快照恢复 | 只能手动 `git branch` | `/wt-snapshots`、`/wt-restore <ref>`、设置页「可恢复快照」列表 |
| 归档清理 | 会话结束一律保留检出 | 可选 `cleanupOnArchive`（默认关）：归档后 lazy sweep 清理干净且未使用的检出 |
| RPC | 6 个端点 | 7 个（新增 `restore`）；`list` 响应为每个仓库新增 `snapshots` |
| 侧车 | v2 | v3（新增 `snapshots` 映射；v1/v2 读取时内存迁移，不丢数据） |

### 0.3.0 与 0.2.x 的差异（历史）

| 能力 | 0.2.x | 0.3.0 |
| --- | --- | --- |
| 何时建树 | 新会话自动建（无选择）；另有「新建 Worktree」按钮立即建 | 首屏选择工作位置；**发送第一条消息后**（`agent/created`）才建 |
| 选择器位置 | 输入框上方的 dock 按钮 | 新会话工作区行：`📁 工作区 ▼` 与 `标准模式 ▼` 之间的胶囊按钮 |
| 选择记忆 | 无 | **按工作区**长期记住（侧车 `placements`），重启安全 |
| 工作区 | 旧按钮会 `workspaces.create`，侧边栏变乱 | **绝不新增 Workspace**，只切当前会话 cwd |
| 进度反馈 | 无 | 输入框上方内联三步进度卡（投影驱动，最少 1s） |
| 侧边栏 | 无标记 | 托管会话显示**只读**工作树图标（tooltip = 检出路径） |
| 设置页 | 配置只读 | **可编辑表单**，保存写入活动 profile patch 并热生效（volatile，不重启） |
| 状态同步 | 部分 RPC 读取 | 全部事件/投影驱动，**零轮询** |
| RPC | 含 `create` 等 | `status/list/clean/prune/placement/settings`，无 `create`/`cancel` |

## 1. 它做什么

1. 新会话首屏（还没有会话 id 的 blank 状态）在工作区行显示「工作位置」胶囊：**新建本地工作树**（默认）或 **本地**；
2. 选择立即写回宿主，**按工作区路径**持久化到侧车；该工作区以后的新会话都沿用，重启不丢；
3. 你发送第一条消息 → DSH 创建 Session 并触发 `agent/created`（模型尚未开始）→ 宿主按该工作区的 placement 决定是否建树；
4. 选择「新建本地工作树」时：在 `<repo>/.agents/worktrees/wt-<时间戳>` 建一个 **detached HEAD** 检出，把**本次会话**的工作目录切过去；会话仍挂在原来的 Workspace 下；
5. 创建过程通过会话投影 `codexWorktree` 实时推送到输入框上方的内联进度卡（`准备工作空间 → 检出文件 → 设置环境`），完成后卡片淡出，chip 与侧边栏标记出现；
6. 选择「本地」时：不建任何东西，会话就在原 Workspace 目录里跑；
7. 插件**不创建分支、不做命名、不合并、不推送、不删除你的分支**。分支名由 Git 在提交时决定；需要分支时用普通 `git switch -c`。`mode: branch` 可让插件创建时顺手建 `<branchPrefix><名字>` 分支（非默认）。

## 2. 交互

### 2.1 新会话首屏：工作位置选择器

位置：官方 **`conversation.hero.options`** 座位——新会话首屏那一行里、工作区与模式控件之后的紧凑选项区（右对齐），只在 blank 新会话的 Session 存在后渲染。它和 `📁 工作区 ▼`、`标准模式 ▼` 在同一行：

```text
📁 shian360 ▼      标准模式 ▼        ⑂ 新建本地工作树 ▼
┌────────────────────────────────────────────────────┐
│ 描述你想要构建的内容，/ 调用指令，@ 文件或……        │
└────────────────────────────────────────────────────┘
```

- 选项（单选，当前项带勾）：
  - `本地` / `Local` —— 在当前工作区目录直接运行；
  - `新建本地工作树` / `New local worktree` —— 在新检出中运行（**默认**）；
  - 菜单底部灰色说明：`新建本地工作树不会新增工作区，只切换本次会话的工作目录。`
- 显示条件：仅 **blank 新会话首屏**（该座位是 session 作用域，Session 创建后才会渲染）；非 Git 工作区隐藏（宿主返回 `isGit=false`）；已有会话不显示。
- 槽位说明：这是官方 list 座位，**不是** shipped WorkspacePicker 的 `conversation.hero.workspace`（那个座位是 `kind: "single"`、由 WorkspacePicker 占用，注册进去会 shadow 官方工作区切换器）。本插件用它自己的 id 注册在 `conversation.hero.options`，**永不 shadow** 官方 UI。
- 持久化：选择立即写回宿主（`placement` RPC），按工作区路径存入侧车；控件乐观更新，写入失败回滚并提示；读取失败时降级为只读展示默认值，不阻塞发消息。
- 与配置的关系：选择器读写的是**按工作区的 placement**，不是 profile 配置；`defaultPlacement` 只决定「某工作区第一次出现、还没有记录时」的默认值。首次打开某工作区显示 `placements[path] ?? defaultPlacement`。

### 2.2 发送第一条消息后创建

1. 你发送第一条消息；
2. DSH 创建 Session 并触发 `agent/created`（串行事件，模型尚未开始）；
3. 宿主按该工作区 placement 决策：`local` → 不建；`worktree` → 依次执行 `准备工作空间`（建池目录 + 自忽略 `.gitignore`）→ `检出文件`（`git worktree add --detach`）→ `设置环境`（规范化路径、`workingDirectory.set`、写侧车记录）；
4. 每个阶段都通过会话投影推送，客户端在输入框上方内联显示进度卡：

```text
┌────────────────────────────────────────────────────┐
│ ⑂ 正在创建工作树                                    │
│   ✓ 准备工作空间                                    │
│   ◐ 检出文件                                        │
│   ○ 设置环境                                        │
│                                            取消     │
└────────────────────────────────────────────────────┘
```

- 卡片**最少显示 1000ms**（创建通常 <0.5s）；完成后三步打勾 + `已创建工作树` 约 400ms 后淡出。
- **只提供「取消」**：立即隐藏卡片，创建继续；插件**不做回滚**，也不提供「不使用工作树」补救功能。
- 失败：卡片变错误态显示原因，会话按**原目录**继续、不阻塞对话。错误码：

| 错误码 | 含义 |
| --- | --- |
| `not-git-repository` | 工作区不是 Git 仓库 |
| `no-commit` | 仓库还没有任何提交 |
| `disabled` | `enabled: false`，或仓库根存在 `.dsh-codex-worktree-off` |
| `root-unreachable` | 配置的 `root` 不可写，或会话沙箱不允许该路径 |
| `limit-reached` | 该仓库已达 `maxPerRepo`（先清理旧检出） |
| 其它 message | git 报错 / 超时等，原文显示 |

### 2.3 会话归属与目录

- 会话**始终属于原来的 Workspace**；唯一副作用是对当前会话执行 `workingDirectory.set`。
- 插件不调用 `workspaces.create` / `workspaces.rename` / `sessions.create`，也不新增 Workspace；验收：操作前后 `workspace.json` 的 workspaces 数量不变。
- 默认 `mode: detached`：插件**不创建分支**，检出始终是 detached HEAD；提交/推送时由 Git 决定分支名（需要具名分支就 `git switch -c`）。`mode: branch` 可改成创建时直接建 `<branchPrefix><名字>` 分支。

### 2.4 侧边栏标记（只读）

- 槽位：`sidebar.session.row.leading`（官方 ambient-marker 座位：会话行首的常驻图标区；组件读取 `sessionId`）。选这个座位是**有意的设计决定**：行尾 action 区是 hover 才出现的按钮条，不适合常驻标记；该座位不属于 shipped workspace picker，不会 shadow 任何官方 UI。
- 托管会话显示一个 14px 的工作树图标（`⑂` 风格 SVG，`currentColor` 弱化色），tooltip 为 `Codex 风格 Worktree · <检出路径>`。
- **不可点击**：点击穿透到整行（保持「打开会话」行为）；不注册悬停卡，不提供跳转。
- 数据来源：宿主注册会话投影 `codexWorktree`；客户端读 `sessions.list.getSnapshot().byId[sessionId].projectionValues?.codexWorktree`，只在 `phase === 'ready'` 时渲染图标，`null`/缺失时隐藏。**零 RPC、零轮询**。
- 创建/清理/剪枝引起的变化由投影推送即时反映。

> 已知限制：从设置页清理一个**非 live 会话**的检出时，宿主无法向该会话 append 投影事件，因此它的侧边栏标记不会立刻消失，而是等该会话下次 `agent/created` 一致性修复时消失。

### 2.5 会话头 chip

- 显示 `Codex 风格 Worktree` + 状态（托管 / 未托管 / 错误）。
- 弹层内容：路径、仓库、基准提交（base commit）、模式、改动数（dirty）、清理动作。
- 基础状态优先取投影值；**打开弹层时**再单次调用 `status` 读取脏文件数等细节（按需，不是轮询）。
- 不提供命名，也不提供「不使用工作树」回滚。

### 2.6 设置页

设置里一节 `Codex 风格 Worktree`，分两块：

1. **配置（可编辑表单）**
   - 保存 → 走宿主 **settings 服务**写入**活动 profile** 的 `cordis.patch.yml`，并**立即热生效**（volatile 配置：不重启、不重挂插件）；
   - DSH 官方「插件」设置页也会通过 `configure({ auto: true })` 自动生成同源表单，两处共享同一 revision，冲突有提示；
   - 「恢复默认」把 21 个用户可见字段写回 schema 默认值；
   - 冲突（修订号过期）→ 提示「配置已在别处修改」并自动刷新表单；
   - 非法值 → 返回错误、保留原值并给出约束提示；
   - settings 服务不可用（headless / 非 profile 组合）→ 降级为只读并保留原提示。
2. **工作树管理**（沿用原 UI）：按仓库分组的检出列表（路径 / 模式 / dirty / 创建时间）、每个仓库下的「可恢复快照」列表（ref / commit / 创建时间 / 已恢复标记 + 「恢复」按钮）、刷新、逐条清理（使用中或脏检出需确认/强制）、立即清理（prune）等。

## 3. 安装与升级

### 3.1 安装

前置：DSH `0.2.0-rc.2` / `0.2.1-rc.2`、Node.js `>= 22.19.0`、`git`；先结束正在运行的任务/会话。

```sh
dsh plugin --profile desktop add github:wplct/dsh-codex-worktree
```

然后**完全退出并重开 DSH 一次**（bundle 层生效；不是刷新页面）。此后**修改配置不需要重启**（volatile 热生效）。

### 3.2 从旧版本升级

**0.3.x → 0.4.0（当前）**：

- 没有破坏性 UI 变更：工作位置选择器、发送后建树、三步进度卡、侧边栏只读标记、chip、投影全部保持；原有 placement / 配置记录继续可用；
- 侧车 `state.json` 从 **v2（或更早的 v1）读取时在内存里迁移到 v3**（补 `snapshots`，更早版本补 `placements`），**不丢数据**，下一次写入以 v3 落盘；
- 设置页新增 `cleanupOnArchive`（默认 `false`），不操作即保持 0.3.0 的「会话结束不删树」行为；
- 新增删除保护：清理正被**其它**活跃会话使用的检出会返回 `worktree-in-use`（本会话自己的检出会先移回原工作区；确认后 `force` 覆盖）；新增 `/wt-snapshots`、`/wt-restore <ref>` 与设置页「可恢复快照」；
- 升级后仍需重启 DSH 一次（bundle 层生效），此后配置修改依旧无需重启。

**0.2.x → 0.3.0（历史）**：

- 升级后**旧「新建 Worktree」按钮消失**，创建只发生在发送第一条消息之后；`create` / `cancel` 端点与 pending/adoption 逻辑已移除；
- 侧车 `state.json` 从 v1 **自动迁移**到 v2（保留 `records`，补空 `placements`，版本号升为 2）；v1 的旧记录继续在 chip / 设置页显示；
- **一次性人工清理**（确认后执行）：0.2.x 旧按钮创建过的工作区（若侧边栏里有多出来的 workspace）、它们对应目录下的 `.agents/worktrees/wt-*` 检出、以及残留的 pending 记录；
- profile 侧确认包依赖 / bundles / `cordis.patch.yml` 没有旧的 `auto-worktree` 残行（0.2.2 已清理）；市场的 disabled 列表不含旧包名；
- 建议升级后重启一次 DSH，确保新 bundle 与客户端产物都刷新；升级到 0.3.x 时完成的一次性清理无需重复。

### 3.3 直接安装（可选的本地/离线方式）

本仓库还带一个不经过包管理器的直接安装脚本，适合本地开发或离线：

```sh
node install.mjs --dry-run   # 只打印计划，不写任何文件
node install.mjs             # 安装进默认 profile（desktop）
node install.mjs --profile web
DSH_HOME=/path/to/.dsh node install.mjs --profile desktop
```

脚本做的事：

1. 校验源包（`package.json`、`cordis.patch.yml`、`lib/**`、`client/**` 必须齐；缺一半直接报错退出，错误信息带绝对路径）；
2. 复制 `package.json`、`cordis.patch.yml`、`README*.md`、`lib/**`、`client/**`（递归）到 `<profile>/node_modules/dsh-codex-worktree/`——先写进同盘的临时暂存目录，不直接覆盖线上目录；
3. 对暂存副本里**每一个** `.js` 跑 `node --check`，全部通过才发布；失败则回滚；
4. 把 `<profile>/cordis.patch.yml` 备份为 `.bak-<ISO时间戳>`，再在文件末尾追加带标记的 patch 块（内容 = 包内 `cordis.patch.yml` 去注释后的正文；当前该文件只有一行不含 config 的 `insert`，默认值来自 `lib/config.js`）。已存在 `# >>> dsh-codex-worktree >>>` 标记时跳过追加；
5. 打印目标路径、文件数、备份路径与下一步。

直接安装脚本明确**不会**：修改 profile 的 `package.json`、调用 `pnpm`/`npm`、重启 DSH。

## 4. 卸载与回滚

用 DSH 插件命令卸载（与安装对称），然后重启 DSH：

```sh
dsh plugin --profile desktop remove dsh-codex-worktree
```

如果是用第 3.3 节的**直接安装**脚本装的，则用 `uninstall.mjs`：

```sh
node uninstall.mjs --dry-run   # 只打印计划
node uninstall.mjs             # 默认 profile
node uninstall.mjs --profile web
```

`uninstall.mjs`：删除 `<profile>/cordis.patch.yml` 里的标记块（含块内内容，其余行原样保留，改写前备份 `.bak-<ISO时间戳>`）、递归删除 `<profile>/node_modules/dsh-codex-worktree/`、打印每步动作与备份路径；幂等，`--dry-run` 不写文件。它也会提示（不删除）安装快照 `.dsh-codex-worktree.previous-*` 与侧车台账。

| 目的 | 操作 |
| --- | --- |
| 完整卸载 | `dsh plugin --profile desktop remove dsh-codex-worktree`（直接安装则 `node uninstall.mjs`），然后重启 DSH |
| 只回滚 profile patch | `cp <profile>/cordis.patch.yml.bak-<时间戳> <profile>/cordis.patch.yml`，再手动删 `node_modules/dsh-codex-worktree/`，重启 |
| 回滚到上一版插件 | 把安装时打印的 `.dsh-codex-worktree.previous-<时间戳>` 改名回 `node_modules/dsh-codex-worktree`，重启 |

卸载不会删除你的 worktree 和分支：先 `/wt-status` 看清单、`/wt-clean` 清理，或手动 `git worktree remove <path>` / `git branch -d <branch>`。删除侧车台账（`$DSH_HOME/dsh-codex-worktree/`）会同时清空 placement 记忆。

## 5. 配置

### 5.1 配置从哪来

- 默认值与校验：`lib/config.js`（`resolveConfig` 是唯一事实来源；`EDITABLE_FIELDS` 决定设置表单的字段与顺序）；
- 包内 `cordis.patch.yml`：**纯 insert 行**（`id: codex-worktree`、`name: dsh-codex-worktree`），不带 config，便于市场热挂载；
- 运行时覆盖：活动 profile 的 `cordis.patch.yml` 里 `- id: codex-worktree` 的 config 行（设置页保存会自动维护它）；
- 用户可见字段全部 **volatile**：保存后立即生效，无需重启或重挂插件。

### 5.2 用户可见字段（设置表单可编辑，21 个）

| 字段 | 类型 | 默认 | 控件 | 约束 / 说明 |
| --- | --- | --- | --- | --- |
| `enabled` | boolean | `true` | 开关 | 总开关；关掉后新会话不建树（已有检出不受影响） |
| `defaultPlacement` | `worktree`\|`local` | `worktree` | 下拉 | 工作区还没有 placement 记录时的默认位置 |
| `directory` | string | `.agents/worktrees` | 文本框 | 池目录：相对路径、无 `.`/`..` 段 |
| `root` | string | `""` | 文本框 | 空 = 仓库内；也可填绝对路径或仓库相对路径，无 `..` |
| `mode` | `detached`\|`branch` | `detached` | 下拉 | `detached` 不建分支（默认）；`branch` 创建时建 `<branchPrefix><名字>` |
| `namePrefix` | string | `wt-` | 文本框 | 检出名前缀；不含 `/` `\`，不以 `-` 开头 |
| `branchPrefix` | string | `wt/` | 文本框 | `mode: branch` 的分支前缀；不以 `-` `/` 开头 |
| `baseRef` | string | `HEAD` | 文本框 | 本地基准引用；不以 `-` 开头；只本地解析（是否联网看 `fetchBeforeCreate`） |
| `fetchBeforeCreate` | boolean | `false` | 开关 | 创建前 `git fetch --prune origin`；失败只告警、不阻断；无 `origin` 时跳过 |
| `autoPrune` | boolean | `true` | 开关 | 每次成功创建后在后台清理该仓库最旧检出（保留最新 `autoPruneKeep` 条） |
| `autoPruneKeep` | number | `15` | 数字 | 每个仓库保留的最新检出数；非负整数 |
| `pruneGraceMs` | number | `60000` | 数字 | 比这更「年轻」的检出永不自动清理（毫秒）；非负整数 |
| `cleanupOnArchive` | boolean | `false` | 开关 | 会话归档后由 lazy sweep 删除其**干净**（无未提交改动）且**未被使用**的工作树；默认关闭，保留 Codex 式「会话结束不删树」 |
| `poolGitignore` | boolean | `true` | 开关 | 首次建池时写内容为 `*` 的 `.gitignore`，保持主检出 `git status` 干净 |
| `gitTimeoutMs` | number | `20000` | 数字 | 单条 git 命令硬超时（毫秒）；正整数 |
| `skipChildAgents` | boolean | `true` | 开关 | 子代理 / 子会话不建树 |
| `skipSessionIdPatterns` | string[] | `["^session-taskboard-"]` | 多行文本 | 每行一个正则，命中不建（默认跳过 taskboard 会话） |
| `skipPresets` | string[] | `[]` | 多行文本 | 每行一个正则，agent preset 命中不建 |
| `disableMarker` | string | `.dsh-codex-worktree-off` | 文本框 | 仓库根或会话 cwd 存在同名文件时不建树；纯文件名，无 `/` `\` |
| `maxPerRepo` | number | `32` | 数字 | 单仓库插件托管检出上限；正整数；达到后本次创建报 `limit-reached` |
| `noticeOnCreate` | boolean | `false` | 开关 | 建树后额外排一条用户上下文消息描述新检出 |

隐藏内部字段（不在表单里）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `gitCommand` | `git` | 内部字段：git 可执行文件名/路径 |
| `cleanupOnDispose` | `false` | 预留字段：会话销毁时是否自动删除检出（当前恒为保留） |

### 5.3 `root` 的语义与安全边界

DSH 的 `workspace-write` 文件沙箱边界是**会话的原始工作区目录（`header.cwd`）**，不是整个磁盘。

- `root: ""`（默认）：池 = `<仓库>/<directory>`，检出始终在仓库内（即会话工作区内）→ `workspace-write` 可正常读写，最安全；
- `root` 非空：检出建在该根下（绝对路径，或仓库相对路径）。若它**落在会话工作区之外**，`workspace-write` 会话里写入会被沙箱拒绝，创建会失败并在进度卡显示 `root-unreachable`，会话留在原目录继续；只有 `danger-full-access` 会话才能在外部根创建工作树；
- 自动清理 / 删除同样受沙箱约束：外部 root 的清理需要会话具备相应权限，否则报错而不是强删。

## 6. 工作树管理

斜杠命令（管理专用，命名交给 Git）：

| 命令 | 作用 |
| --- | --- |
| `/wt-status` | 显示本会话的检出：path、repo、branch（detached 时显示 detached）、base、dirty |
| `/wt-clean [--force] [--branch]` | 删除本会话的检出；有未提交改动或正被使用时会拒绝，`--force` 强制删除；`--branch` 同时删除分支（`mode: branch` 时有意义） |
| `/wt-snapshots` | 列出**当前会话所在仓库**的可恢复快照（未托管时列出所有仓库）：ref、commit、创建时间、是否已恢复 |
| `/wt-restore <ref>` | 从快照恢复出一个新的 detached 检出（`wt-restored-…`），输出恢复路径与 commit |

### 6.1 清理入口与「使用中」保护

三种清理入口，规则一致：

| 入口 | 说明 |
| --- | --- |
| `/wt-clean [--force] [--branch]` | 终端式管理命令，作用于本会话的检出 |
| 会话头 chip 弹层 | 就地清理当前会话的检出，脏检出/使用中会给出确认或强制入口 |
| 设置页「工作树管理」逐条删除 | 按仓库列表清理任意托管检出 |

- **使用中保护（`worktree-in-use`）**：如果要删除的检出目录是**其它活跃会话**的当前工作目录，删除会被拒绝并返回 `code=worktree-in-use`（与 Codex 对齐：Codex 在「当前 checkout」上直接拒绝删除）。
- **清理自己的检出不会被拒**：`/wt-clean` 或本会话 chip 清理当前会话自己的检出时，插件会先把该会话 cwd 移回原工作区（响应里带 `movedTo`），再删除——当前会话仍然可用。
- **强制覆盖**：确认后可用 `force`（命令加 `--force`、界面点「强制清理/强制删除」）——被影响的是**其它**活跃会话，它们会失去当前工作目录（cwd 指向已删除目录），检出内未提交改动也会丢失。
- 脏检出仍先按 `worktree-dirty` 规则拒绝；`force` 同时覆盖使用中与脏检查。
- 删除前若满足快照条件（见 6.2），会先打快照 ref 再删，便于之后恢复。

### 6.2 快照与恢复

- **什么时候自动打快照**：删除一个 **detached（无分支）且 `HEAD ≠ baseCommit`** 的检出之前，插件把当前 `HEAD` 写成快照 ref：`refs/dsh-codex-worktree/<时间戳+会话尾号>`，并登记进侧车 `snapshots`。所有删除路径统一适用（`/wt-clean`、chip 清理、设置页删除、`prune`、归档 lazy sweep）。
- `/wt-snapshots`：列出**当前会话所在仓库**的快照（会话未托管时列出所有仓库）：ref、commit、创建时间、是否已恢复。
- `/wt-restore <ref>`：从快照恢复出一个**新的 detached 检出**（命名 `wt-restored-<时间戳>`）并返回 `{ ref, path, commit, repoRoot }`；恢复出的 checkout **不绑定原会话**、**不切换任何会话的 cwd**，只是把数据拿回来。
- **设置页「工作树管理」**：`list` 响应顶层返回 `snapshots` 数组（每项带 `repoRoot`，按创建时间倒序），页面按仓库分组显示「可恢复快照」列表（ref、commit、创建时间、已恢复标记）；点「恢复」即创建新 checkout 并刷新列表。
- 恢复出的 checkout 是**普通 git worktree**（在池目录里、`git worktree list` 可见），但**不写入 sidecar `records`**：它没有 sessionId、不绑定会话，因此不出现在托管列表 / `/wt-clean` 的目标里；不需要时用 `git worktree remove <path>` 手动清理。`refs/dsh-codex-worktree/…` 是普通 Git 引用，`git branch <name> <ref>` 仍然可用。
- 同一个快照可以**重复恢复**（每次创建新检出，并更新该快照的 `restoredAt` / `restoredPath`）。
- 快照失败时的策略：`prune` 与归档 lazy sweep 会**跳过**该条目的删除以免丢提交；显式 `clean`（用户主动）只记一条警告并继续删除。
- 快照只保存**已提交**的 HEAD；未提交改动不在快照里，无法恢复。

### 6.3 归档自动清理（`cleanupOnArchive`，默认关）

- 设置项 `cleanupOnArchive`（boolean，默认 `false`）：会话被**归档**后，删除它的**干净** worktree。
- 实现是**非轮询的 lazy sweep**，在这些时机顺带执行：新会话创建成功后、打开工作树管理页（`list` 请求）、`prune` 请求，以及归档带停止（`workspace` / `session-stop`）后约 1 秒（unref 定时器，不阻塞进程）。
- 只删同时满足条件的：无未提交改动（dirty 跳过）、仍未被活跃会话使用（使用中跳过）；删除前仍按 6.2 的规则打快照。
- 默认关闭的理由：保留 Codex 式「会话结束不删树」的默认行为；需要回收空间时再打开（或手动 `/wt-clean` / prune）。

### 6.4 自动清理与手动 prune

- `autoPrune: true`（默认）时，每次成功创建后在后台清理该仓库超出 `autoPruneKeep` 的最旧检出；脏检出与比 `pruneGraceMs` 更年轻的检出不动。
- 手动 prune（设置页「立即清理」或 `prune` 端点）对指定仓库/所有仓库立即执行，返回被清理条目与新建的快照。
- 被删的 detached 提交会先建 `refs/dsh-codex-worktree/<名字>` 快照（见 6.2），可用 `/wt-restore` 或 `git branch <name> <ref>` 找回；未提交改动无法恢复。

## 7. RPC 与状态同步

### 7.1 RPC 端点

浏览器通过带鉴权的 `/api` 载体调用：`connection.rpc.call('/api', 'dsh-codex-worktree/<endpoint>', payload, signal)`；宿主注册 `/api/dsh-codex-worktree/<endpoint>` 并断言 `message.method === 'dsh-codex-worktree/<endpoint>'`；响应为 `{ok:true,value}` 或 `{ok:false,error:{code,message,details}}`。

| 端点 | 请求 | 响应 value | 错误码 |
| --- | --- | --- | --- |
| `status` | `{ sessionId }` | `{ managed, path?, workspaceRoot?, repoRoot?, mode?, branch?, baseCommit?, createdAt?, dirty? }` | `bad-request` |
| `list` | `{ workspacePath? }` | `{ repos: [{ repoRoot, records: [...] }], snapshots: [...], config }`（设置页管理列表用；`snapshots` 是**顶层**数组，每项带 `repoRoot`，按创建时间倒序） | `bad-request` |
| `clean` | `{ sessionId, force?, deleteBranch? }` | `{ removed, path, branchDeleted, snapshots, movedTo? }`（`movedTo` 表示本会话 cwd 被移回原工作区；检出已不存在时返回 `{ removed, path, alreadyGone: true, snapshots }`） | `worktree-dirty`、`worktree-in-use`、`not-managed` |
| `prune` | `{ repoRoot? }` | `{ removed, snapshots }` | `bad-request` |
| `placement` | 读 `{ workspacePath }`；写 `{ workspacePath, mode }` | `{ workspacePath, mode, defaultMode, isGit }` | `bad-request`、`not-git-repository` |
| `settings` | `{action:'get'}` / `{action:'set', patch, revision}` / `{action:'reset'}` | `{ ns, revision, writable, values, defaults, fields: [...] }` | `settings-unavailable`、`conflict`、`invalid-config` |
| `restore` | `{ ref }`（快照 ref，必填） | 恢复出的新检出：`{ ref, path, commit, repoRoot }`（不绑定原会话，不切换 cwd，不写入 records） | `bad-request`、`snapshot-not-found`（其它失败为 `operation-failed`） |

- **没有 `create`、没有 `cancel`**：创建只由 `agent/created` 触发；进度卡「取消」只是客户端隐藏卡片。
- 投影数据不走 RPC；`status` 仅供 chip 弹层与设置页按需读取。

### 7.2 会话投影（零轮询）

- 宿主注册投影单元 `codexWorktree`（`stateVersion: 1`），每次变化 append 事件 `codex-worktree/state`，`data.state` 携带**完整后置状态**；
- 状态：`{ phase: 'creating'|'ready'|'error', step?: 'prepare'|'checkout'|'finalize', path?: string|null, repoRoot, workspaceRoot, placement?: 'worktree'|'local', mode, branch?: string|null, baseCommit?: string|null, error?, updatedAt }` 或 `null`；
- 客户端订阅 `sessions.list` 快照的 `byId[sessionId].projectionValues.codexWorktree`（`useSyncExternalStore`），用于进度卡、侧边栏标记、chip 基础状态；
- 全程**无 `setInterval` / 无轮询**；
- 投影事件会进入会话日志（每个新会话约 4 条小事件）——这是 DSH 原生状态同步方式，换来零轮询；
- 清理：live 会话 → 宿主 append `null`，标记立即消失；非 live 会话 → 下次 `agent/created` 一致性修复时补 `null`（见 §2.4 已知限制）。

### 7.3 侧车数据（`$DSH_HOME/dsh-codex-worktree/state.json`）v3

```jsonc
{
  "schemaVersion": 3,
  "records": {
    "session-…": {
      "sessionId": "session-…",
      "repoRoot": "/abs/repo",
      "workspaceRoot": "/abs/repo",
      "path": "/abs/repo/.agents/worktrees/wt-…",
      "poolRoot": "/abs/repo/.agents/worktrees",
      "repoLabel": "repo-<hash8>",
      "mode": "detached",
      "branch": null,
      "baseCommit": "<sha>",
      "source": "startup",
      "createdAt": "ISO"
    }
  },
  "placements": {
    "/abs/repo": { "mode": "worktree", "updatedAt": "ISO" }
  },
  "snapshots": {
    "refs/dsh-codex-worktree/…": {
      "ref": "refs/dsh-codex-worktree/…",
      "repoRoot": "/abs/repo",
      "commit": "<sha>",
      "sessionId": "session-…",
      "createdAt": "ISO"
    }
  }
}
```

- v1 / v2 → v3 迁移：读取时在内存里补齐缺失段（v1 补 `records` 之外的 `placements`，v2 补 `snapshots`），**不丢数据**；下一次写入时以 v3 落盘；
- 写入原子 tmp+rename；损坏文件改名备份后按空状态继续；
- 过期 placement 惰性清理：路径不存在时忽略，超过 90 天未用会清理；
- `snapshots` 是恢复列表（`list` 响应里的顶层 `snapshots`、设置页「可恢复快照」）的后端台账；每次恢复会给该行追加 `restoredAt` 与 `restoredPath`，仍可重复恢复。

## 8. 兼容性、限制与风险

- **DSH 版本**：`0.2.0-rc.2` / `0.2.1-rc.2`；依赖 base bundle 的 `sessionProjections`、`settings`、`configEditor`——缺失时自动降级：无投影 → 侧边栏标记 / 进度卡不可用；无 settings → 配置只读；
- **Node.js ≥ 22.19.0**（客户端用 React 18+ 的 `useSyncExternalStore`）；
- **创建只发生在 `agent/created`**，只对 `source === 'startup'` 的顶层新会话生效；resume / clear / compaction / 子代理 / taskboard 会话 / preset 命中 / 禁用标记 / `enabled: false` / 已有记录 / placement=local 一律不建；
- **不新建 Workspace**：会话仍挂原工作区，只切 cwd；
- **不命名、不建分支**（默认 detached）；`mode: branch` 可选；插件不合并、不推送、不删用户分支；
- **非 Git 工作区**：选择器隐藏，不建树；
- **只读沙箱 / `workspace-write` 越界 / 无提交 / 达到上限**：结构化错误，不阻塞会话；
- 单仓库并发创建由 `createKeyedMutex` 串行化；`agent/created` 内任何异常都会被吞掉并 warn，绝不阻止会话启动；
- 投影事件进入会话日志（约 4 条/新会话），这是零轮询的代价；如在意日志体积，后续可改 ephemeral 通道（不在本期）；
- **已知限制**：从设置页清理非 live 会话的检出时，侧边栏标记不会立刻消失，需等该会话下次 `agent/created` 一致性修复（见 §2.4）；
- **座位选择（不是限制，是设计）**：位置选择器注册在官方 `conversation.hero.options` list 座位，**不是** shipped WorkspacePicker 占用的单值座位 `conversation.hero.workspace`（那个座位 `kind: "single"`、`replaceRisk: "shadows-shipped-ui"`），所以**永不 shadow** 官方工作区切换器；侧边栏标记用官方 ambient-marker 座位 `sidebar.session.row.leading`，不是 hover-only 的行尾 action 条；
- 侧边栏标记只是标记：不可点击、无悬停卡、无跳转；
- 「不使用工作树」回滚功能**明确不做**；进度卡「取消」只隐藏卡片。

- **强制清理的代价**：`worktree-in-use` 被 `force` 覆盖后，**其它**活跃会话会失去当前工作目录（cwd 指向已删除的检出），检出内未提交改动一并丢失；清理本会话自己的检出不会拒绝，cwd 会被移回原工作区。
- **恢复出的检出不受插件托管**：它不写入 sidecar records、不绑定会话，需要手动 `git worktree remove` 清理；快照只保存删除前的已提交 HEAD。
- **快照只含已提交内容**：快照 ref 指向删除前的 `HEAD`，未提交改动不会进入快照；恢复出来的检出也不绑定原会话。
- **归档清理是 lazy sweep**：`cleanupOnArchive` 不是即时清理，只会在 §6.3 列出的时机运行；归档会话若仍有活跃会话占用其检出，则跳过。

不在范围：云端 / 关联 Codex Web / 多工作位置；自动合并、PR、环境安装；按会话（而非按工作区）记忆 placement；已有会话中途切换到工作树。

## 9. 验收标准（AC）

| 编号 | 验收项 | 验证方式 |
| --- | --- | --- |
| AC-1 | 工作位置选择器出现在「工作区」与「标准模式」之间 | 手工 GUI + smoke-client 渲染断言 |
| AC-2 | 选择按工作区记住：切「本地」后新会话在原目录运行、无 `.agents/worktrees` 产物；重启后仍为「本地」 | 手工 + live-host RPC + 侧车断言 |
| AC-3 | 默认 worktree：新工作区首次新会话发送后建树并切换 cwd | 集成测试（fake ctx + 真 git） |
| AC-4 | 发送后输入框上方出现三步进度卡（投影驱动，零轮询），最少 1s，完成后 chip / 标记出现 | 手工 + smoke-client 状态机断言 |
| AC-5 | 点「取消」只隐藏卡片、创建继续；未提供「不使用工作树」 | smoke-client + 代码 grep |
| AC-6 | 操作前后 `workspace.json` 工作区数量不变，会话仍挂原工作区 | live-host 断言 + 手工 |
| AC-7 | 侧边栏托管会话显示只读图标（不可点、tooltip 带路径）；清理后立即消失（投影推送，无轮询） | 手工 + smoke-client |
| AC-8 | 设置页可改：关闭「自动创建」后新会话不建树（不重启）；值写入 profile patch；官方「插件」页也出现自动表单 | 手工 + live-host RPC + 读 patch 断言 |
| AC-9 | 设置页冲突 / 非法值有明确提示且不破坏当前配置 | 单元测试（revision / validation） |
| AC-10 | 旧按钮、`create` / `cancel` 端点、pending 逻辑不存在；旧记录仍可显示 / 清理 | 代码 grep + 测试 |
| AC-11 | 单测、host / client smoke 全绿 | 本地脚本 |
| AC-12 | 真实 DSH 宿主：路由注册、placement 读写、投影推送、settings get/set、客户端 bundle 分发 | 临时 profile 启动 + curl RPC |

## 10. 故障排查

| 现象 | 处理 |
| --- | --- |
| 新会话首屏没有工作位置选择器 | 只有 blank 新会话且工作区是 Git 仓库才显示；已有会话、非 Git 工作区都会隐藏（用 `placement` RPC 的 `isGit` 确认）。 |
| 明明选了「新建本地工作树」却没建 | 确认该工作区 placement 仍为 `worktree`（按工作区记忆，可能上次被改成 `local`）；看会话日志里 `agent/created` 的跳过原因；确认 `enabled: true`、仓库有提交、未达 `maxPerRepo`、无禁用标记。 |
| 选了「本地」但以前的会话还在 worktree 里 | placement 只影响**之后**的新会话；已有会话保持原 cwd，可在设置页清理其检出。 |
| 进度卡显示错误 | 按错误码处理：`not-git-repository` / `no-commit` / `disabled` / `root-unreachable` / `limit-reached`；会话会在原目录继续，不阻塞对话。 |
| 进度卡一直停在「检出文件」 | git 命令可能卡住/超时：检查 `git` 是否在 PATH、仓库是否健康；必要时调大 `gitTimeoutMs`。 |
| 设置页保存报「配置已在别处修改」 | revision 冲突：表单已自动刷新，确认后重新保存；两处表单（插件页 / 本页）同源。 |
| 设置页保存报 `settings-unavailable` | 当前组合没有 settings 服务（headless / 非 profile）：配置降级为只读，请直接改活动 profile 的 `cordis.patch.yml`（`- id: codex-worktree`）后重启。 |
| 侧边栏托管会话没有图标 | 只有投影 `phase === 'ready'` 才显示；非 live 会话清理后需下次 `agent/created` 才消失；确认客户端与服务端都已重启到 0.4.0。 |
| 清理报 `worktree-in-use` | 该检出目录正被**其它**活跃会话当作 cwd（与 Codex 一致直接拒绝）：在该会话里用 `/wt-clean` 清理（会把 cwd 移回原工作区），或确认那个会话不再需要该目录后用 `force` /「强制清理」覆盖；注意会丢失那个会话的工作目录与未提交改动。 |
| 找不到恢复入口 / 快照列表为空 | 快照只对「detached 且 HEAD ≠ baseCommit」的删除生成（见 §6.2）；用 `/wt-snapshots` 确认当前会话所在仓库（未托管时所有仓库）是否有快照；设置页需打开「工作树管理」区块。 |
| 恢复后找不到新检出 / 托管列表里没有它 | 恢复出的是普通 git worktree（`wt-restored-…`），不写入 sidecar records，所以不在托管列表里；用 `/wt-restore` 返回的路径或 `git worktree list` 找到它，用 `git worktree remove` 清理。 |
| 开了 `cleanupOnArchive` 但归档后树还在 | lazy sweep 只在 §6.3 的时机运行（新会话创建、list、prune、归档带停止后）；脏检出或被活跃会话占用的检出会跳过。 |
| chip 显示「未托管」但会话在 worktree 里 | 该会话不是本插件托管（旧版本创建、手动 `git worktree add`、或 placement=local）；旧记录可继续在设置页看到并清理。 |
| 0.2.x 的「新建 Worktree」按钮不见了 | 0.3.0 已移除；创建改为发送第一条消息后自动触发。 |
| 升级后旧工作区/旧检出还在 | 0.2.x 旧按钮可能创建过工作区与检出：确认侧边栏多出的 workspace、对应 `.agents/worktrees/wt-*` 与 pending 记录后人工清理（见 §3.2）。 |
| 启动报 `Cannot find package 'dsh-codex-worktree'` | 重新 `dsh plugin --profile desktop add github:wplct/dsh-codex-worktree`（直接安装则 `node install.mjs`），确认 `<profile>/node_modules/dsh-codex-worktree/lib/index.js` 存在，然后重启。 |

## 11. 目录结构

```text
dsh-codex-worktree/
├── install.mjs          # 直接安装：复制到 profile + 追加标记块（--dry-run / --profile）
├── uninstall.mjs        # 直接卸载：删标记块 + 删目录（幂等，--dry-run）
├── package.json         # 0.4.0；exports "." (host) / "./client" (web)；engines node >=22.19
├── cordis.patch.yml     # 纯 insert 行（id: codex-worktree，不含 config）
├── lib/                 # host 半边：config 默认值/校验、volatile 热配置、agent/created 建树、
│                        # git 封装、池规则、清理保护（worktree-in-use）、快照/恢复、归档 lazy sweep、
│                        # 侧车 v3（records + placements + snapshots）、会话投影、
│                        # RPC 路由（placement/settings/status/list/clean/prune/restore）、命令
├── client/client.js     # 浏览器半边：5 个槽位（选择器/进度卡/侧边栏标记/设置页/chip）
│   └── README.md        # client 半边的槽位、投影、RPC、零轮询说明
├── scripts/             # smoke-host.mjs / smoke-client.mjs
├── test/                # node --test 单元/集成测试
├── README.zh.md         # 本文（主）
├── README.md            # 英文对应版本
└── LICENSE              # MIT
```

本地开发与自检：

```sh
npm test                 # 单元 / 集成测试（node --test）
npm run smoke            # host + client smoke
npm run verify           # 以上 + node --check client/client.js
npm run install:dry      # 直接安装 dry-run
```
