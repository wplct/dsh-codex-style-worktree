# dsh-auto-worktree

> DSH 会话的「默认就在 worktree 里干活」：新会话自动在仓库内部建一个隔离检出，并把会话工作目录切过去。人不需要起名、不需要点按钮；插件从不创建分支（检出始终是 detached HEAD），分支名完全交给 Git 在提交/推送时决定。

- 包名：`dsh-auto-worktree`（host 半边 + 浏览器半边）
- 兼容：DSH `0.2.0-rc.2` / `0.2.1-rc.2`（见 `package.json` 的 `dsh.compatibility`）
- 许可：MIT

## 1. 它做什么

在 Git 仓库里开一个新会话（顶层 agent）时，插件自动：

1. 以 `baseRef`（默认 `HEAD`）为起点，在仓库内的 `.agents/worktrees/` 池里创建 `wt-YYMMDD-HHMMSS` 形式的检出；
2. 默认用 **detached HEAD** 创建（`mode: detached`，Codex 托管 worktree 的做法）：插件**不创建任何分支**，分支名由 Git 在提交/推送时决定；
3. 把该会话的工作目录（cwd 上下文）切到新检出，模型后续的读写、`bash`、相对路径都发生在里面；
4. 在 `$DSH_HOME/dsh-auto-worktree/state.json` 侧车里记录这次创建，用于 `/wt-status`、`/wt-clean` 和断点恢复（resume）。

零人工命名：

| 环节 | 谁决定 |
| --- | --- |
| 目录名 | 插件自动生成（`namePrefix` + 时间戳，冲突自动加序号） |
| 分支名 | **插件不建分支**：检出始终是 detached HEAD，分支名由 Git 在提交/推送时决定（`git switch -c`、`git commit` 后用 `git branch <name>` 等）；插件不提供命名入口 |
| 建不建 | 插件按规则自动判断（见第 2 节） |

`mode: branch` 可切回「先建分支」：创建时直接 `git worktree add -b <branchPrefix><名字>`（默认 `wt/<名字>`）。

## 2. 工作方式

触发点是 `agent/created`。创建过程失败**不会**影响会话：插件只记一条警告，会话留在原目录继续跑（降级）。

会创建：

- 新会话的 cwd 在一个 Git 仓库里（`git rev-parse --show-toplevel` 可解析）；
- 仓库至少有一个提交；
- cwd 不是池目录内部，也不是另一个 linked worktree；
- 该仓库当前由本插件管理的 worktree 数量 < `maxPerRepo`（默认 32）。

不会创建（跳过原因）：

| 情况 | 原因码 |
| --- | --- |
| `enabled: false` | `disabled` |
| agent 来源是 `clear` / `compaction` | `source` |
| 子代理 / 非顶层 agent，且 `skipChildAgents: true` | `child-agent` |
| 会话 id 命中 `skipSessionIdPatterns`（默认 `^session-taskboard-`） | `session-pattern` |
| 会话 preset 命中 `skipPresets` | `preset` |
| 侧车里已有该会话记录（resume 回到旧会话） | `recorded` |
| cwd 已经不等于会话原始项目目录（已切走过） | `already-moved` |
| 仓库根或 cwd 存在 `disableMarker`（默认 `.dsh-auto-worktree-off`） | `marker` |
| 不是 Git 仓库 | `not-git` |
| cwd 在池目录内部 | `pool-context` |
| `root` 落在会话工作区之外，而会话不是 `danger-full-access` | `root-outside-sandbox` |
| 会话沙箱是 `read-only`，却配了非空 `root` | `read-only-sandbox` |
| cwd 本身就是 linked worktree（避免套娃） | `linked-worktree` |
| 仓库还没有任何提交 | `no-commit` |
| 该仓库已达 `maxPerRepo` | `limit` |
| 名字连续冲突 | `name-collision` |
| git 报错 / 超时 | `error` |

其他行为：

- **根目录与沙箱**：`root` 为空（默认）时池就是仓库内的 `directory`，落在会话工作区内；`root` 非空时检出建在该绝对根下。DSH 的 `workspace-write` 文件沙箱边界是会话的 `header.cwd`，所以外部 root 只在 `danger-full-access` 会话里才创建，否则跳过并记录 `root-outside-sandbox`（`read-only` 会话配非空 root 也会跳过，原因 `read-only-sandbox`；详见第 5 节）。
- **创建前 fetch**：`fetchBeforeCreate: true` 时，创建检出前先在该仓库跑 `git fetch --prune --quiet origin`（更新远端跟踪引用并清理已删除的远端分支）。仓库没有 `origin` remote 时跳过并 warn；fetch 失败只记一条 warning，不阻断创建；命令受 `gitTimeoutMs` 约束。默认 `false` = 不联网。
- **按上限自动清理（后台）**：`autoPrune: true`（默认）时，每次成功创建后插件在后台（延迟约 50ms，不阻塞会话）清理该仓库超出 `autoPruneKeep`（默认 15）条的最旧检出。清理受 `pruneGraceMs`（默认 60000ms）保护——比这更年轻的检出不动；**有未提交改动（或改动状态未知）的检出从不自动删除**；被删的 detached 提交会先建 `refs/dsh-auto-worktree/<名字>` 快照，方便恢复。`maxPerRepo` 仍是硬上限：达到后新会话按 `limit` 跳过，等后台清理（或设置页「立即清理」）腾出空间后才会恢复；`autoPrune: false` 时只跳过、从不自动清理。
- **池目录自忽略**：`poolGitignore: true` 时，插件首次创建池目录会写入内容为 `*` 的 `.gitignore`，避免 worktree 内容出现在主检出的 `git status` 里。
- **git 超时**：每条 git 命令受 `gitTimeoutMs`（默认 20000ms）硬超时约束，超时按失败降级处理，不会挂住会话。
- **默认不联网**：`baseRef` 只做本地解析（`<baseRef>^{commit}`）；只有显式开启 `fetchBeforeCreate` 才会有 fetch。
- **创建提示**：`noticeOnCreate: true` 时会额外排一条用户上下文消息描述新检出（cwd 上下文本身已经能说明位置，默认关闭）。
- **不自动删除会话检出**：`cleanupOnDispose` 仍是预留字段（默认 `false`）；会话结束后检出保留，由你、`/wt-clean`、设置页删除按钮或 `autoPrune` 回收。

## 3. 安装

前置：

- 已安装 DSH（profile 目录存在，例如 `~/.dsh/profiles/desktop/`）；
- `git` 在 PATH 里；
- **先结束正在运行的任务/会话**——安装后会重启 DSH，运行中的会话不会带着旧 cwd 状态迁移。

```sh
cd /Users/wplct/Documents/deepseek-harness/default-workspace/dsh-auto-worktree

node install.mjs --dry-run   # 只打印计划，不写任何文件
node install.mjs             # 安装进默认 profile（desktop）
node install.mjs --profile web
DSH_HOME=/path/to/.dsh node install.mjs --profile desktop
```

脚本做的事：

1. 校验源包（`package.json`、`cordis.patch.yml`、`lib/**`、`client/**` 必须齐；缺一半直接报错退出，错误信息带绝对路径）；
2. 复制 `package.json`、`cordis.patch.yml`、`README*.md`、`lib/**`、`client/**`（递归）到 `<profile>/node_modules/dsh-auto-worktree/`——先写进同盘的临时暂存目录，不直接覆盖线上目录；
3. 对暂存副本里**每一个** `.js` 跑 `node --check`，全部通过才发布；失败则回滚，profile 里不会留下半成品；
4. 把 `<profile>/cordis.patch.yml` 备份为 `.bak-<ISO时间戳>`，再在文件末尾追加带标记的 patch 块（内容 = 包内 `cordis.patch.yml` 去掉 `#` 注释行后的正文）。文件里已存在 `# >>> dsh-auto-worktree >>>` 标记时跳过追加；
5. 打印目标路径、复制的文件数、备份路径、下一步。

安装脚本明确**不会**：

- 修改 profile 的 `package.json`；
- 调用 `pnpm` / `npm` / 安装任何依赖；
- 重启或热加载 DSH（需要你手动重启）。

装完后**完全退出并重开 DSH**（桌面应用重启，不是刷新页面），新 bundle 行才会生效。

## 4. 卸载与回滚

```sh
node uninstall.mjs --dry-run   # 只打印计划
node uninstall.mjs             # 默认 profile
node uninstall.mjs --profile web
```

`uninstall.mjs` 做的事：

1. 删除 `<profile>/cordis.patch.yml` 里的 `# >>> dsh-auto-worktree >>>` … `# <<< dsh-auto-worktree <<<` 标记块（含块内内容），**其余行原样保留**（不碰其他插件的配置）；改写前备份为 `.bak-<ISO时间戳>`；
2. 递归删除 `<profile>/node_modules/dsh-auto-worktree/`；
3. 打印每一步动作和备份路径；`--dry-run` 不写文件。

它是幂等的：重复执行只会报告「没有标记 / 未安装」。它也会提示（但不会删除）两类残留：安装时留下的 `.dsh-auto-worktree.previous-<时间戳>` 快照目录，以及 `$DSH_HOME/dsh-auto-worktree/` 侧车记录（里面是已创建 worktree 的台账，确认 worktree 都清掉了再手动删）。

回滚的三种方式：

| 目的 | 操作 |
| --- | --- |
| 完整卸载 | `node uninstall.mjs` 然后重启 DSH |
| 只回滚 profile patch | `cp <profile>/cordis.patch.yml.bak-<时间戳> <profile>/cordis.patch.yml`，再手动删 `node_modules/dsh-auto-worktree/`，重启 |
| 回滚到上一版插件 | 安装时打印的 `.dsh-auto-worktree.previous-<时间戳>` 目录改名回 `node_modules/dsh-auto-worktree`，重启 |

卸载不会删除你的 worktree 和分支：先 `/wt-status` 看清单、`/wt-clean` 清理，或手动 `git worktree remove <path>` / `git branch -d <branch>`。

## 5. 配置

默认值的唯一出处是包内 [`cordis.patch.yml`](./cordis.patch.yml)；安装脚本把它的正文（去掉注释后）追加进 profile patch：

```yaml
- insert:
    - id: auto-worktree
      name: dsh-auto-worktree
      config:
        enabled: true
        root: ''
        directory: .agents/worktrees
        fetchBeforeCreate: false
        autoPrune: true
        autoPruneKeep: 15
        pruneGraceMs: 60000
        mode: detached
        namePrefix: 'wt-'
        branchPrefix: 'wt/'
        baseRef: HEAD
        poolGitignore: true
        gitTimeoutMs: 20000
        skipChildAgents: true
        skipSessionIdPatterns:
          - '^session-taskboard-'
        skipPresets: []
        disableMarker: .dsh-auto-worktree-off
        maxPerRepo: 32
        cleanupOnDispose: false
        noticeOnCreate: false
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 插件总开关。`false` 时行为与未安装一致（完全不碰 git）。 |
| `root` | `''` | worktree 根目录。空字符串（默认）= 用仓库内的 `directory`；非空必须是绝对路径，检出改到该根下（见下方安全边界）。 |
| `directory` | `.agents/worktrees` | worktree 池目录（`root` 为空时相对仓库根），不能是绝对路径、不能含 `.`/`..` 段。放在仓库内部才能落在 DSH 工作区文件沙箱内。 |
| `fetchBeforeCreate` | `false` | 创建前在该仓库执行 `git fetch --prune --quiet origin`（更新远端跟踪引用并清理已删除的远端分支）。仓库没有 `origin` remote 时跳过并 warn；失败只记 warning，不阻断创建；受 `gitTimeoutMs` 约束。默认关闭 = 不联网。 |
| `autoPrune` | `true` | 每次成功创建后在后台（不阻塞会话）清理该仓库超出 `autoPruneKeep` 的最旧本插件检出，保留最新 `autoPruneKeep` 条。受 `pruneGraceMs` 保护；**有未提交改动（或改动状态未知）的检出永不自动删除**。`maxPerRepo` 仍是硬上限，达到后新会话按 `limit` 跳过。 |
| `autoPruneKeep` | `15` | 自动清理后每个仓库保留的最新检出数量（非负整数）。默认 15 < `maxPerRepo` 32，所以第一次超限会一次性腾出空间。 |
| `pruneGraceMs` | `60000` | 自动清理的冷却时间（非负整数，毫秒）：比这个更「年轻」（按创建时间）的检出永不自动清理，避免刚建好就被回收。 |
| `mode` | `detached` | `detached`：detached HEAD，插件不建分支；`branch`：创建时直接建 `<branchPrefix><名字>` 分支。 |
| `namePrefix` | `wt-` | 自动生成的检出目录名前缀（不能含 `/`、`\`，不能以 `-` 开头）。 |
| `branchPrefix` | `wt/` | `mode: branch` 时的分支名前缀（不能以 `-` 或 `/` 开头）。 |
| `baseRef` | `HEAD` | 新建检出的本地起点（只做本地解析，是否联网取决于 `fetchBeforeCreate`）。 |
| `poolGitignore` | `true` | 首次创建池目录时写入内容为 `*` 的 `.gitignore`，保持主检出 `git status` 干净。 |
| `gitTimeoutMs` | `20000` | 单条 git 命令硬超时（正整数，毫秒）；超时按失败降级。 |
| `skipChildAgents` | `true` | 子代理/子会话不建树，避免一个任务炸出多个检出。 |
| `skipSessionIdPatterns` | `["^session-taskboard-"]` | 会话 id 正则列表，命中即跳过（默认跳过 taskboard 会话，它有自己的 worktree 隔离机制）。 |
| `skipPresets` | `[]` | 额外跳过的 agent preset id 正则列表。 |
| `disableMarker` | `.dsh-auto-worktree-off` | 仓库根或会话 cwd 里存在同名文件时，该仓库/该会话不建树（临时快速关闭用）。 |
| `maxPerRepo` | `32` | 本插件在单个仓库里同时管理的检出数量上限；达到后按 `autoPrune` 处理（`/wt-clean`、设置页删除按钮也可回收）。 |
| `cleanupOnDispose` | `false` | **仍是预留字段**：会话结束/销毁时是否自动删除检出。默认关闭，检出保留（与 Codex 一致）。 |
| `noticeOnCreate` | `false` | 建树后是否额外排一条用户上下文消息描述新检出（cwd 上下文通常已足够）。 |

### `root` 的语义与安全边界

DSH 的 `workspace-write` 文件沙箱边界是**会话的 `header.cwd`（会话工作区根）**，不是整个磁盘。

- `root: ''`（默认）：池 = `<仓库>/<directory>`，检出永远在仓库内，也就是在会话工作区内 → `workspace-write` 可正常读写，最安全，推荐。
- `root: /some/absolute/path`：检出建在该绝对根下。若它**落在会话工作区之外**，`workspace-write` 会话里的写入会被沙箱拒绝，插件因此**跳过创建**并记录原因 `root-outside-sandbox`（与其建一个写不进去的检出，不如留在原目录）；只有 `danger-full-access` 会话才会在外部根创建检出。
- 自动清理/删除同样走沙箱约束：外部 root 的清理需要会话具备相应权限，否则会报错而不是强删。

改配置的两种方式：

1. **改 profile patch（推荐，不改包）**：在 `<profile>/cordis.patch.yml` 里另加一条 id 覆盖行，profile patch 在所有 bundle 层之后应用，优先级更高：

   ```yaml
   - id: auto-worktree
     config:
       mode: branch
       namePrefix: 'dev-'
   ```

   注意 `- id:` 的 `config` 是**整块替换**，不是逐字段合并：覆盖行里没写的字段会回落到 schema 默认值（即本节表中的默认值），所以想保留的自定义项必须在覆盖行里重述一遍。

2. **改包内 `cordis.patch.yml` 后重装**：适合把默认值改成就地生效的发行默认值；重装会覆盖 `node_modules/dsh-auto-worktree/`，并跳过已存在的标记块（旧块内容不会自动更新，需要先 `uninstall` 再 `install`）。

## 6. 用法

### 自动路径（默认）

在 Git 仓库里开新会话 → 什么都不用做，会话已经在 `.agents/worktrees/wt-YYMMDD-HHMMSS` 里干活。第一句话之前就已经切好 cwd。

### 斜杠命令

| 命令 | 作用 |
| --- | --- |
| `/wt-status` | 显示本会话的自动检出：`path`、`repo`、`branch`（detached 时显示 `detached`）、`base`（base commit）、`dirty`（改动数）。 |
| `/wt-clean [--force] [--branch]` | 删除本会话的自动检出。有未提交改动时默认拒绝，`--force` 强制删除；`--branch` 同时删除对应分支（只在 `mode: branch` 时有意义）。 |

典型流程（命名完全交给 Git）：

```text
新会话（自动 wt-251019-190932，detached）
  … 改文件、跑测试 …
  git switch -c fix/cart-order   # 想建分支时用普通 git 命令
  git commit / git push          # 正常提交
/wt-clean --branch               # 需要时回收检出与分支
```

## 7. GUI 设置页与 RPC 接口

### 设置页（Codex 风格）

插件在 Web GUI 的设置里注册一节 **Worktrees（中文界面：工作树）**：

- **配置（只读）**：展示 `root`（空值时显示「仓库内：`<directory>`」）、`fetchBeforeCreate`、`autoPrune`（连同「保留 N 个」= `autoPruneKeep`）的当前生效值；要改值走第 5 节的 profile patch，设置页不写配置（`pruneGraceMs` 不在页面上展示，改它同样走 profile patch）。
- **立即清理（Prune now）**：按 `autoPrune` 同样的规则（含 `pruneGraceMs` 冷却与脏检出跳过）对所有已知仓库立即执行一次 prune，并显示本次「已清理 N 个工作树、M 个快照」的结果。
- **按仓库分组的 worktree 列表**：每个仓库一段（可展开/折叠），逐行显示 **路径 / mode / dirty / 创建时间**；行内操作：
  - **在此工作树中新建聊天**：在对应检出目录上注册/复用 Workspace 并新开一个会话（人不用再手选目录）；
  - **打开对话**：跳到占用该检出的既有会话；
  - **删除**：清理该检出（有未提交改动时需要确认或强制删除）。
- **已知对话**：每条 worktree 下列出占用它的会话，方便判断哪些检出还在用、哪些可以回收。

### RPC 端点

客户端半边通过这些带鉴权的 `/api` 路由调用（`POST ${API_PREFIX}/<endpoint>`，JSON 请求体）：

| 端点 | 请求 | 响应 |
| --- | --- | --- |
| `status` | `{ sessionId }` | 该会话的检出状态（path / repo / branch / base / dirty） |
| `clean` | `{ sessionId, force?, deleteBranch? }` | 清理结果 |
| `list` | `{ workspacePath? }` | `{ repos: [...], config: { ... } }`——按仓库分组的检出列表 + 设置页要展示的只读配置快照（`root`、`directory`、`mode`、`fetchBeforeCreate`、`autoPrune`、`autoPruneKeep`） |
| `prune` | `{ repoRoot? }` | `{ removed, snapshots }`——被清理的条目与新建的 `refs/dsh-auto-worktree/<name>` 快照；不传 `repoRoot` 时对所有已知仓库执行 |

## 8. 验证清单（12 条验收标准）

| # | 场景 | 期望 |
| --- | --- | --- |
| 1 | 自动建树 | 在 Git 仓库里开新会话，不做任何操作，仓库内出现 `.agents/worktrees/wt-<时间戳>`，且 `git worktree list` 里有它。 |
| 2 | 零输入 | 全程不需要输入 worktree 名、分支名，也不需要点任何按钮。 |
| 3 | cwd 上下文 | 会话工作目录已切到新检出：模型看到的 cwd/相对路径解析都在 `.agents/worktrees/wt-…` 下（`/wt-status` 的 `path` 与之一致）。 |
| 4 | 第二个会话独立 | 同一仓库再开一个会话，得到**另一个** `wt-…` 目录，两个会话互不干扰；池内数量叠加（上限 `maxPerRepo`）。 |
| 5 | 纯 detached、插件不建分支 | 默认 `mode: detached`：`/wt-status` 显示 `branch: detached`，检出内 `git symbolic-ref -q HEAD` 失败；`git branch` 里没有插件创建的分支。想建分支就用普通 `git switch -c`。 |
| 6 | 不该建的都不建 | 非 Git 目录、无提交的仓库、`skipChildAgents: true` 下的子代理、session id 匹配 `^session-taskboard-` 的会话、`enabled: false` 的插件——五类场景都不产生新目录（可用 `/wt-status` 确认「not in an automatic worktree」）。 |
| 7 | 故障注入降级 | 让 git 失败或超时（例如把 `gitTimeoutMs` 调到极小、或 `PATH` 里去掉 git）：会话照常启动，留在原目录，日志出现一条 `automatic worktree … failed` 警告，无未捕获异常。 |
| 8 | resume 保持 | 恢复（resume）已有会话：因为侧车里已有该会话记录，不会重复建树，cwd 仍指向原来的检出。 |
| 9 | 卸载干净 | `node uninstall.mjs` 后：profile patch 里标记块消失且其余行完好、`node_modules/dsh-auto-worktree/` 不存在、重启 DSH 不再加载插件、其他插件配置未被改动。 |
| 10 | `fetchBeforeCreate` 生效且失败不阻断 | 开启后创建前先执行 `git fetch --prune --quiet origin`（可从远端跟踪引用变化或 git 调用日志确认）；把 remote 指到不可达地址或断网后再开新会话：仍然创建成功，只多一条 fetch 失败 warning；没有 `origin` remote 的仓库只 warn 一次并照常创建。 |
| 11 | `autoPrune` 只清最旧、不删脏、detached 留快照 | 把 `maxPerRepo` 调小（如 2）、`autoPruneKeep: 1`、`pruneGraceMs: 0`，连开多个会话：每次成功创建后后台清理该仓库超出的最旧**干净**检出，脏检出保留；被删的 detached 提交出现在 `git for-each-ref refs/dsh-auto-worktree` 里，可用 `git branch <name> dsh-auto-worktree/<name>` 恢复；清理来不及腾空间时新会话按 `limit` 跳过，点设置页「立即清理」可立即回收。 |
| 12 | 外部 `root` + `workspace-write` 被跳过并给出原因 | `root` 设为会话工作区之外的绝对路径、会话为 `workspace-write`：新会话不创建检出，原因码为 `root-outside-sandbox`（日志/状态可见）；`read-only` 会话配非空 root 则为 `read-only-sandbox`；切到 `danger-full-access` 后才在外部根创建。 |

## 9. 限制与风险

- **只创建，不合并**：插件从不 commit、merge、push、rebase，也不删你的分支。合并/推送由你（或模型用普通 git 命令）决定。默认 detached 时，未提交改动没有分支保护——误删检出即丢失，所以 `cleanupOnDispose` 默认 `false`、会话结束后检出保留。
- **detached 误删风险**：`git worktree remove --force`、`rm -rf` 检出目录、或 `git clean -fdx`（会扫到池目录）都可能丢掉未提交的工作。建议短任务尽快提交；不确定就先在检出里 commit（detached 提交仍可由 Git 引用/恢复）。
- **不是沙箱**：worktree 只是「协作约定 + 独立工作目录」，不是安全边界。同一个 OS 用户、同一文件系统、同一仓库对象库，插件本身也不限制你用绝对路径访问别处。DSH 的文件沙箱策略覆盖的是会话的 `header.cwd`：默认 `root` 为空、池在仓库内，所以 `workspace-write` 可写；把 `root` 指到工作区之外需要 `danger-full-access` 会话，否则插件直接跳过创建（`root-outside-sandbox`）。
- **池目录在主检出里**：即使有 `poolGitignore`，仓库级操作仍会看到它（IDE 索引、`git status --ignored`、`find`、打包工具）。别对仓库根跑破坏性的 `git clean -fdx`。
- **与 taskboard 的关系**：`dsh-taskboard` 有自己的一套 per-task worktree 隔离（独立分支、merge 证据）。默认 `skipSessionIdPatterns: ["^session-taskboard-"]` 让两者互不叠加；如果你把该模式删掉，同一次 taskboard 任务可能被建两份检出，需要自己承担冲突与清理成本。
- **base 会变旧**：`baseRef` 只在创建时解析一次（默认不 fetch；开启 `fetchBeforeCreate` 只更新远端跟踪引用，不会更新或 rebase 已有检出）。主检出切分支/rebase 不会同步到已有 worktree；拿旧 detached 检出提交时注意目标分支。
- **上限、自动清理与回收**：`maxPerRepo`（默认 32）是硬上限，达到后新会话按 `limit` 跳过；`autoPrune: true`（默认）会在每次成功创建后于后台清理最旧的**干净**检出、保留最新 `autoPruneKeep`（默认 15）条，脏检出和比 `pruneGraceMs`（默认 60000ms）更年轻的检出不动。被清掉的 detached 提交有 `refs/dsh-auto-worktree/<name>` 快照，可用 `git branch <name> dsh-auto-worktree/<name>` 恢复，但**未提交的改动无法恢复**。想完全不自动清理就设 `autoPrune: false`，回收交给 `/wt-clean`、设置页的「立即清理」/「删除」或手动 `git worktree remove`；侧车台账不会被卸载脚本删除。

## 10. 故障排查

| 现象 | 处理 |
| --- | --- |
| 启动报 `Cannot find package 'dsh-auto-worktree'` | 重新 `node install.mjs`，确认 `<profile>/node_modules/dsh-auto-worktree/lib/index.js` 存在，然后重启 DSH。 |
| 新会话没有建树 | 依次确认：`enabled: true`；cwd 在 Git 仓库且有提交；仓库根没有 `.dsh-auto-worktree-off`；不是子代理；session id 不匹配 `skipSessionIdPatterns`；该仓库未达 `maxPerRepo`；看日志里的原因码（见第 2 节表）。 |
| `/wt-status` 显示 `not in an automatic worktree` | 该会话没被管理（被跳过、插件关闭、或非 git）。用第 2 节的原因码逐条排除。 |
| 日志出现 `automatic worktree … failed` | git 报错或超时：检查 `git` 是否在 PATH、仓库是否损坏；需要时调大 `gitTimeoutMs`。会话本身不受影响。 |
| 期望 detached，却出现 `wt/...` 分支 | `mode` 被改成 `branch` 了：改回 `detached`（profile patch 覆盖行优先级最高）。 |
| `git status` 里出现一堆池内文件 | 池目录被加进版本控制前就已存在、或缺 `.gitignore`：确认 `poolGitignore: true`，必要时手动在池目录放内容为 `*` 的 `.gitignore`。 |
| 安装时 `node --check` 失败 | 源包（`lib/**`、`client/**`）本身有语法错误；安装已回滚，profile 未被改动。修好包再装。 |
| 安装报 `missing source directory: …/client` | 源包缺半边（host/client 未齐）。补齐 `client/` 后再安装。 |
| 新会话没有建树，原因 `root-outside-sandbox` / `read-only-sandbox` | `root` 落在会话工作区之外，或会话沙箱是 `read-only`：改回默认空 `root`（池在仓库内），或改用 `danger-full-access` / 可写会话。 |
| 期望创建前 fetch，但没有任何联网动作 | `fetchBeforeCreate` 默认 `false`，要显式开启；fetch 只针对 `origin`（没有该 remote 时跳过并 warn），失败只会 warning，不会阻断。 |
| 旧检出被自动删除 | `autoPrune: true` 且达到 `maxPerRepo`：只会删除超过最新 `autoPruneKeep` 条、且已过 `pruneGraceMs` 冷却的干净检出。detached 提交在 `refs/dsh-auto-worktree/<name>`，用 `git branch <name> dsh-auto-worktree/<name>` 恢复；不想被自动清理就设 `autoPrune: false` 或调大 `autoPruneKeep`。 |
| 已达上限却没有自动清理 | 后台清理在每次成功创建后运行，赶不上连续创建时新会话会按 `limit` 跳过：在设置页点「立即清理」，或调大 `maxPerRepo`。超出 `autoPruneKeep` 的条目若全是脏检出或仍在 `pruneGraceMs` 冷却期内，插件也不会强删。 |
| 卸载后插件仍在加载 | 重启 DSH；再确认 profile patch 无标记块、目录已删除。 |

## 11. 目录结构

```text
dsh-auto-worktree/
├── install.mjs          # 安装：复制到 profile + 追加标记块（支持 --dry-run / --profile）
├── uninstall.mjs        # 卸载：删标记块 + 删目录（幂等，支持 --dry-run）
├── package.json         # exports "." (host) / "./client" (web)，以及 dsh.bundle.patch
├── cordis.patch.yml     # 配置默认值的唯一出处；安装时去注释后追加进 profile
├── lib/                 # host 半边：agent/created 钩子、git 封装、池规则、自动清理（prune/快照）、侧车、工具/命令/路由
├── client/              # 浏览器半边：设置页（只读配置 + 立即清理 + 按仓库分组的检出列表/已知对话）、/wt-* 的 GUI 呈现与本地化
├── README.zh.md         # 本文（主）
└── README.md            # 英文对应版本
```

安装到 `<profile>/node_modules/dsh-auto-worktree/` 后，runtime 解析依赖的方式与其他 profile 插件一致（不额外安装 node_modules）。
