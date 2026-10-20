# Codex-style Worktree (dsh-codex-worktree)

> A "work like Codex" placement choice for DSH sessions: on the new-session hero row, pick **Local** or **New local worktree** (the default) next to the workspace chip; after you send the first message the plugin creates a detached checkout and switches **that session's** cwd into it. No new Workspace, no naming, no branch from the plugin (Git owns branch naming at commit time).

- Version: `0.3.0` (package / plugin id / loader row name: `dsh-codex-worktree`; profile-patch insert row id: `codex-worktree`)
- API namespace: `/api/dsh-codex-worktree`, RPC method prefix `dsh-codex-worktree/`; sidecar: `$DSH_HOME/dsh-codex-worktree/state.json`; disable marker: `.dsh-codex-worktree-off`
- GitHub: <https://github.com/wplct/dsh-codex-worktree>
- Requirements: DSH `0.2.0-rc.2` / `0.2.1-rc.2`, Node.js `>= 22.19.0`, `git` on PATH
- License: MIT

## What changed in 0.3.0 (vs 0.2.x)

| Capability | 0.2.x | 0.3.0 |
| --- | --- | --- |
| When the worktree is created | Automatically for every new session (no choice); a "New Worktree" button could also create one on demand | You choose a placement on the hero row; the worktree is created **after the first message** (`agent/created`) |
| Selector location | A dock button above the composer | The hero workspace row: a pill between `📁 workspace ▼` and `standard mode ▼` |
| Remembered choice | None | **Per workspace**, persisted in the sidecar (`placements`), restart-safe |
| Workspace | The old button called `workspaces.create`, cluttering the sidebar | **Never creates a Workspace**; only the session cwd changes |
| Progress feedback | None | Inline three-step progress card above the composer (projection-driven, minimum 1 s) |
| Sidebar | No marker | Managed sessions show a **read-only** worktree icon (tooltip = checkout path) |
| Settings page | Read-only config | **Editable form**; save writes the active profile patch and applies live (volatile, no restart) |
| State sync | Some RPC reads | Everything is event/projection-driven, **zero polling** |
| RPC | Included `create`, etc. | `status/list/clean/prune/placement/settings`, no `create`/`cancel` |

## 1. What it does

1. On the new-session hero row (the blank state without a session id) the workspace row shows a placement pill: **New local worktree** (default) or **Local**;
2. the choice is written back to the host immediately and persisted **per workspace path** in the sidecar; later sessions in that workspace inherit it, across restarts;
3. you send the first message → DSH creates the Session and fires `agent/created` (before the model starts) → the host decides by that workspace's placement whether to create a checkout;
4. with "New local worktree": a **detached HEAD** checkout is created at `<repo>/.agents/worktrees/wt-<timestamp>` and **this session's** working directory is switched to it; the session stays attached to its original Workspace;
5. creation progress is pushed through the `codexWorktree` session projection and rendered as an inline progress card above the composer (`Prepare workspace → Check out files → Set up environment`); when done the card fades and the header chip plus the sidebar marker appear;
6. with "Local": nothing is created; the session runs in its original Workspace directory;
7. the plugin **never creates branches, never names anything, never merges, never pushes and never deletes your branches**. Git decides the branch name at commit time; use plain `git switch -c` when you want a branch. `mode: branch` makes the plugin create a `<branchPrefix><name>` branch up front (not the default).

## 2. Interaction

### 2.1 New-session hero row: placement selector

Position: the official **`conversation.hero.options`** seat — the compact options area of the New Session row, right-aligned after the workspace and preset controls, rendered only once the blank new Session exists. It sits on the same row as `📁 workspace ▼` and `standard mode ▼`:

```text
📁 shian360 ▼      standard mode ▼        ⑂ New local worktree ▼
┌────────────────────────────────────────────────────┐
│ Describe what you want to build, / for commands…    │
└────────────────────────────────────────────────────┘
```

- Options (single select, current one ticked):
  - `Local` / `本地` — run directly in the current workspace directory;
  - `New local worktree` / `新建本地工作树` — run in a new checkout (**default**);
  - Grey hint at the bottom of the menu: `Creating a local worktree does not add a Workspace; it only switches this Session’s working directory.`
- Visibility: only on the **blank new-session hero row** (this seat is session-scoped, so it renders once the blank Session exists); hidden for non-Git workspaces (`isGit=false` from the host) and for existing sessions.
- Seat choice: this is the official list seat, **not** the shipped WorkspacePicker's `conversation.hero.workspace` (that seat is `kind: "single"` and owned by the workspace picker; registering there would shadow the shipped workspace switcher). The plugin registers under its own id in `conversation.hero.options` and **never shadows** shipped UI.
- Persistence: the choice is written back immediately through the `placement` RPC and stored per workspace path in the sidecar. The control updates optimistically and rolls back with a message if the write fails; if reading fails it degrades to a read-only display of the default and never blocks sending.
- Relation to config: the selector reads/writes the **per-workspace placement**, not profile config; `defaultPlacement` only decides the value for a workspace that has no stored placement yet. First open shows `placements[path] ?? defaultPlacement`.

### 2.2 Creation after the first message

1. You send the first message;
2. DSH creates the Session and fires `agent/created` (serial event, before the model starts);
3. the host decides by that workspace's placement: `local` → do nothing; `worktree` → run `Prepare workspace` (create the pool directory + self-ignoring `.gitignore`) → `Check out files` (`git worktree add --detach`) → `Set up environment` (canonicalize the path, `workingDirectory.set`, write the sidecar record);
4. every phase is pushed through the session projection, and the client renders an inline progress card above the composer:

```text
┌────────────────────────────────────────────────────┐
│ ⑂ Creating worktree                                │
│   ✓ Prepare workspace                              │
│   ◐ Check out files                                │
│   ○ Set up environment                             │
│                                             Cancel │
└────────────────────────────────────────────────────┘
```

- The card is shown for **at least 1000 ms** (creation is usually < 0.5 s); on completion all three steps are ticked and `Worktree created` fades out after ~400 ms.
- **Only "Cancel" is offered**: it hides the card immediately while creation continues; the plugin does **not** roll back and offers no "don't use a worktree" remedy.
- Failure: the card turns into an error state with the reason, and the session continues in its **original directory** without blocking the conversation. Error codes:

| Error code | Meaning |
| --- | --- |
| `not-git-repository` | The workspace is not a Git repository |
| `no-commit` | The repository has no commit yet |
| `disabled` | `enabled: false`, or `.dsh-codex-worktree-off` exists at the repository root |
| `root-unreachable` | The configured `root` is not writable, or the session sandbox forbids that path |
| `limit-reached` | The repository reached `maxPerRepo` (clean up old checkouts first) |
| other message | git error / timeout etc., shown verbatim |

### 2.3 Session ownership and directory

- The session **always stays with its original Workspace**; the only side effect is `workingDirectory.set` for the current session.
- The plugin never calls `workspaces.create` / `workspaces.rename` / `sessions.create` and never adds a Workspace; acceptance: the number of workspaces in `workspace.json` is unchanged before and after.
- Default `mode: detached`: the plugin **creates no branch**, the checkout stays on a detached HEAD; Git decides the branch name at commit/push time (use `git switch -c` when you want a named branch). `mode: branch` switches to creating `<branchPrefix><name>` up front.

### 2.4 Sidebar marker (read-only)

- Slot: `sidebar.session.row.leading` (the official ambient-marker seat: a persistent leading icon area of the session row; the component reads `sessionId`). This is a **deliberate design decision**: the row's action strip is a hover-only button strip and is unsuitable for a permanent marker; the seat does not belong to the shipped workspace picker and never shadows shipped UI.
- Managed sessions show a 14 px worktree icon (`⑂`-style SVG, `currentColor`, muted), with the tooltip `Codex-style Worktree · <checkout path>`.
- **Not clickable**: clicks fall through to the row (keeping "open session"); no hover card and no navigation.
- Data source: the host registers the `codexWorktree` session projection; the client reads `sessions.list.getSnapshot().byId[sessionId].projectionValues?.codexWorktree` and renders the icon only when `phase === 'ready'`, hiding it for `null`/missing. **Zero RPC, zero polling.**
- Creation, cleanup and pruning changes appear immediately via projection pushes.

> Known limitation: when you clean a **non-live session's** checkout from the settings page, the host cannot append a projection event for that session, so its sidebar marker disappears only on that session's next `agent/created` consistency repair.

### 2.5 Session header chip

- Shows `Codex-style Worktree` plus status (managed / not managed / error).
- Popover: path, repository, base commit, mode, change count (dirty), cleanup action.
- The basic state comes from the projection first; **when you open the popover** it makes one `status` call for details such as the dirty count (on demand, not polling).
- No naming, and no "don't use a worktree" rollback.

### 2.6 Settings page

One `Codex-style Worktree` section with two blocks:

1. **Configuration (editable form)**
   - Save → goes through the host **settings service**, writes the **active profile's** `cordis.patch.yml`, and takes effect immediately (**volatile** config: no restart, no re-mount);
   - the official DSH "Plugins" settings page also gets an auto-generated form via `configure({ auto: true })`; both share one revision and conflicts are surfaced;
   - "Restore defaults" writes the 20 user-visible fields back to their schema defaults;
   - conflict (stale revision) → "The configuration was changed elsewhere" and the form refreshes automatically;
   - invalid value → an error is returned, the previous value is kept and the constraint is shown;
   - settings service unavailable (headless / non-profile composition) → degrade to read-only and keep the original hint.
2. **Worktree management** (the existing UI): checkouts grouped by repository (path / mode / dirty / created), refresh, per-row cleanup and prune now (the existing management UI).

## 3. Install and upgrade

### 3.1 Install

Prerequisites: DSH `0.2.0-rc.2` / `0.2.1-rc.2`, Node.js `>= 22.19.0`, `git`; finish or stop running tasks/sessions first.

```sh
dsh plugin --profile desktop add github:wplct/dsh-codex-worktree
```

Then **quit and reopen DSH once** (the bundle layer takes effect; this is not a page refresh). Afterwards **configuration changes need no restart** (volatile, live).

### 3.2 Upgrading 0.2.x → 0.3.0

- The old **"New Worktree" button is gone**; creation only happens after the first message. The `create` / `cancel` endpoints and the pending/adoption logic were removed;
- the sidecar `state.json` **migrates automatically** from v1 to v2 (keeps `records`, adds an empty `placements` map, bumps the version); old v1 records keep showing in the chip and settings page;
- **one-time manual cleanup** (after confirming): workspaces the old button created (if the sidebar has extras), the corresponding `.agents/worktrees/wt-*` checkouts and leftover pending records;
- verify the profile has no leftover `auto-worktree` rows in its dependencies / bundles / `cordis.patch.yml` (0.2.2 already cleaned those) and that the market's disabled list has no old package name;
- restart DSH once after upgrading so both the new bundle and the client artifact are refreshed.

### 3.3 Direct install (optional local/offline path)

The repository also ships a direct-install script that bypasses the package manager, for local development or offline use:

```sh
node install.mjs --dry-run   # print the plan only, write nothing
node install.mjs             # install into the default profile (desktop)
node install.mjs --profile web
DSH_HOME=/path/to/.dsh node install.mjs --profile desktop
```

What the script does:

1. validates the source package (`package.json`, `cordis.patch.yml`, `lib/**`, `client/**` must all be there; a missing half aborts with an absolute path in the error);
2. copies `package.json`, `cordis.patch.yml`, `README*.md`, `lib/**` and `client/**` (recursively) into `<profile>/node_modules/dsh-codex-worktree/` — staged first in a temporary directory on the same volume, never overwriting the live directory in place;
3. runs `node --check` on **every** `.js` file in the staged copy and publishes only if all of them pass; a failure rolls back;
4. backs up `<profile>/cordis.patch.yml` to `.bak-<ISO timestamp>` and appends the marked patch block (the package's `cordis.patch.yml` minus `#` comment lines; that file currently holds only the config-less `insert` row, defaults come from `lib/config.js`). If the file already contains `# >>> dsh-codex-worktree >>>`, the append is skipped;
5. prints target path, file count, backup paths and next steps.

The direct installer explicitly does **not**: modify the profile's `package.json`, run `pnpm`/`npm`, or restart DSH.

## 4. Uninstall and rollback

Uninstall with the symmetric DSH plugin command, then restart DSH:

```sh
dsh plugin --profile desktop remove dsh-codex-worktree
```

If the package was installed with the **direct-install** script from section 3.3, use `uninstall.mjs` instead:

```sh
node uninstall.mjs --dry-run   # print the plan only
node uninstall.mjs             # default profile
node uninstall.mjs --profile web
```

`uninstall.mjs` removes the marked block (markers and everything between them, other lines preserved, file backed up to `.bak-<ISO timestamp>` first) from `<profile>/cordis.patch.yml`, deletes `<profile>/node_modules/dsh-codex-worktree/` recursively, and prints every action and backup path; it is idempotent and `--dry-run` writes nothing. It also reports (without deleting) install snapshots `.dsh-codex-worktree.previous-*` and the sidecar ledger.

| Goal | Action |
| --- | --- |
| Full uninstall | `dsh plugin --profile desktop remove dsh-codex-worktree` (direct install: `node uninstall.mjs`), then restart DSH |
| Revert the profile patch only | `cp <profile>/cordis.patch.yml.bak-<timestamp> <profile>/cordis.patch.yml`, delete `node_modules/dsh-codex-worktree/` manually, restart |
| Roll back to the previous package | rename the printed `.dsh-codex-worktree.previous-<timestamp>` directory back to `node_modules/dsh-codex-worktree`, restart |

Uninstall never deletes your worktrees or branches: check `/wt-status`, clean up with `/wt-clean`, or run `git worktree remove <path>` / `git branch -d <branch>` yourself. Deleting the sidecar ledger (`$DSH_HOME/dsh-codex-worktree/`) also clears the remembered placements.

## 5. Configuration

### 5.1 Where configuration lives

- Defaults and validation: `lib/config.js` (`resolveConfig` is the single source of truth; `EDITABLE_FIELDS` defines the settings form fields and their order);
- package `cordis.patch.yml`: a **plain insert row** (`id: codex-worktree`, `name: dsh-codex-worktree`) with no config, so the market can hot-mount it;
- runtime override: the `- id: codex-worktree` config row in the active profile's `cordis.patch.yml` (the settings page maintains it automatically);
- every user-visible field is **volatile**: saving applies immediately, no restart or re-mount required.

### 5.2 User-visible fields (editable in settings, 20)

| Field | Type | Default | Control | Constraints / notes |
| --- | --- | --- | --- | --- |
| `enabled` | boolean | `true` | switch | Master switch; when off, new sessions get no worktree (existing checkouts are untouched) |
| `defaultPlacement` | `worktree`\|`local` | `worktree` | select | Placement for a workspace with no stored record yet |
| `directory` | string | `.agents/worktrees` | text | Pool directory: relative, no `.`/`..` segments |
| `root` | string | `""` | text | Empty = inside the repository; may be absolute or repository-relative, no `..` |
| `mode` | `detached`\|`branch` | `detached` | select | `detached` creates no branch (default); `branch` creates `<branchPrefix><name>` up front |
| `namePrefix` | string | `wt-` | text | Checkout name prefix; no `/` `\`, must not start with `-` |
| `branchPrefix` | string | `wt/` | text | Branch prefix for `mode: branch`; must not start with `-` or `/` |
| `baseRef` | string | `HEAD` | text | Local base revision; must not start with `-`; resolved locally (network only via `fetchBeforeCreate`) |
| `fetchBeforeCreate` | boolean | `false` | switch | Run `git fetch --prune origin` before creation; failures only warn and never block; skipped without `origin` |
| `autoPrune` | boolean | `true` | switch | After each successful creation, prune the repository's oldest checkouts in the background (keep the newest `autoPruneKeep`) |
| `autoPruneKeep` | number | `15` | number | Newest checkouts kept per repository; non-negative integer |
| `pruneGraceMs` | number | `60000` | number | Checkouts younger than this are never auto-pruned (milliseconds); non-negative integer |
| `poolGitignore` | boolean | `true` | switch | Write a self-ignoring `.gitignore` when the pool is created, keeping the main checkout's `git status` clean |
| `gitTimeoutMs` | number | `20000` | number | Hard timeout for one git command (milliseconds); positive integer |
| `skipChildAgents` | boolean | `true` | switch | Never create a worktree for subagents/child sessions |
| `skipSessionIdPatterns` | string[] | `["^session-taskboard-"]` | multiline text | One regular expression per line; matches are skipped (taskboard sessions by default) |
| `skipPresets` | string[] | `[]` | multiline text | One regular expression per line; matching agent presets are skipped |
| `disableMarker` | string | `.dsh-codex-worktree-off` | text | A file with this name at the repo root or in the session cwd disables creation; plain file name, no `/` `\` |
| `maxPerRepo` | number | `32` | number | Upper bound of plugin-managed checkouts per repository; positive integer; hitting it reports `limit-reached` |
| `noticeOnCreate` | boolean | `false` | switch | Queue one extra user-context message describing the new checkout |

Hidden internals (not in the form):

| Field | Default | Notes |
| --- | --- | --- |
| `gitCommand` | `git` | Internal: git executable name/path |
| `cleanupOnDispose` | `false` | Reserved: delete the checkout on session dispose (currently always kept) |

### 5.3 `root` semantics and the safety boundary

The DSH `workspace-write` file sandbox is bounded by **the session's original workspace directory (`header.cwd`)**, not the whole disk.

- `root: ""` (default): the pool is `<repo>/<directory>`, so checkouts always live inside the repository (that is, inside the session workspace) → `workspace-write` can read and write them. Safest;
- non-empty `root`: checkouts are created under that root (absolute, or repository-relative). If it lies **outside the session workspace**, writes from a `workspace-write` session would be rejected by the sandbox; creation fails with `root-unreachable` in the progress card and the session continues in its original directory. Only `danger-full-access` sessions can create worktrees under an external root;
- automatic pruning/deletion is subject to the same sandbox constraints: cleaning an external root requires the session to have the matching permissions; otherwise it fails loudly instead of force-deleting.

## 6. Worktree management

- **Settings page "worktree management"**: list all managed checkouts grouped by repository (path / mode / dirty / created), refresh, per-row cleanup (dirty checkouts need confirmation/force) and **Prune now** (prune every repository, showing removed / snapshots); this is the existing management UI.
- **slash commands** (management only; naming belongs to Git):

| Command | Purpose |
| --- | --- |
| `/wt-status` | Show this session's checkout: path, repo, branch (`detached` when detached), base, dirty |
| `/wt-clean [--force] [--branch]` | Remove this session's checkout; refuses uncommitted work unless `--force`; `--branch` also deletes the branch (meaningful with `mode: branch`) |

- **Automatic pruning**: with `autoPrune: true`, every successful creation prunes the repository's oldest checkouts beyond `autoPruneKeep` in the background; dirty checkouts and anything younger than `pruneGraceMs` are left alone; a pruned detached commit gets a `refs/dsh-codex-worktree/<name>` snapshot first, recoverable with `git branch <name> dsh-codex-worktree/<name>` (uncommitted changes cannot be recovered).
- A manual prune returns the removed entries and created snapshots (see `prune` in section 7).

## 7. RPC and state sync

### 7.1 RPC endpoints

The browser calls through the authenticated `/api` carrier: `connection.rpc.call('/api', 'dsh-codex-worktree/<endpoint>', payload, signal)`; the host registers `/api/dsh-codex-worktree/<endpoint>` and asserts `message.method === 'dsh-codex-worktree/<endpoint>'`; responses are `{ok:true,value}` or `{ok:false,error:{code,message,details}}`.

| Endpoint | Request | Response value | Error codes |
| --- | --- | --- | --- |
| `status` | `{ sessionId }` | `{ managed, path?, workspaceRoot?, repoRoot?, mode?, branch?, baseCommit?, createdAt?, dirty? }` | `bad-request` |
| `list` | `{ workspacePath? }` | `{ repos: [{ repoRoot, records: [...] }], config }` (settings-page management list) | `bad-request` |
| `clean` | `{ sessionId, force?, deleteBranch? }` | `{ removed, path, branchDeleted }` | `worktree-dirty`, `not-managed` |
| `prune` | `{ repoRoot? }` | `{ removed, snapshots }` | `bad-request` |
| `placement` | read `{ workspacePath }`; write `{ workspacePath, mode }` | `{ workspacePath, mode, defaultMode, isGit }` | `bad-request`, `not-git-repository` |
| `settings` | `{action:'get'}` / `{action:'set', patch, revision}` / `{action:'reset'}` | `{ ns, revision, writable, values, defaults, fields: [...] }` | `settings-unavailable`, `conflict`, `invalid-config` |

- **There is no `create` and no `cancel`**: creation is triggered only by `agent/created`; the progress card's "Cancel" merely hides the card on the client.
- Projection data never goes through RPC; `status` is only used on demand by the chip popover and the settings page.

### 7.2 Session projection (zero polling)

- The host registers the projection unit `codexWorktree` (`stateVersion: 1`); every change appends the event `codex-worktree/state`, whose `data.state` carries the **complete post-change state**;
- state: `{ phase: 'creating'|'ready'|'error', step?: 'prepare'|'checkout'|'finalize', path?: string|null, repoRoot, workspaceRoot, placement?: 'worktree'|'local', mode, branch?: string|null, baseCommit?: string|null, error?, updatedAt }` or `null`;
- the client subscribes to `sessions.list` snapshot entries at `byId[sessionId].projectionValues.codexWorktree` (`useSyncExternalStore`) for the progress card, sidebar marker and chip base state;
- **no `setInterval` / no polling anywhere**;
- projection events go into the session log (~4 small events per new session) — that is DSH's native state-sync mechanism and the price of zero polling;
- cleanup: live session → the host appends `null`, the marker disappears immediately; non-live session → `null` is appended on the next `agent/created` consistency repair (see the known limitation in 2.4).

### 7.3 Sidecar data (`$DSH_HOME/dsh-codex-worktree/state.json`) v2

```jsonc
{
  "schemaVersion": 2,
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
  }
}
```

- v1 → v2 migration: keep `records`, add an empty `placements`, bump the version;
- writes are atomic (tmp + rename); a corrupt file is renamed to a backup and the store continues from an empty state;
- stale placements are cleaned lazily: nonexistent paths are ignored, entries unused for more than 90 days are dropped.

## 8. Compatibility, limitations and risks

- **DSH versions**: `0.2.0-rc.2` / `0.2.1-rc.2`; depends on the base bundle's `sessionProjections`, `settings` and `configEditor` — missing ones degrade gracefully: no projections → sidebar marker / progress card unavailable; no settings → read-only config;
- **Node.js >= 22.19.0** (the client uses React 18+ `useSyncExternalStore`);
- **Creation happens only in `agent/created`** and only for top-level new sessions with `source === 'startup'`; resume / clear / compaction / subagents / taskboard sessions / matching presets / disable marker / `enabled: false` / existing record / placement=local never create one;
- **No new Workspace**: sessions stay in their original workspace; only the cwd changes;
- **No naming, no branch** (detached by default); `mode: branch` is opt-in; the plugin never merges, pushes or deletes user branches;
- **Non-Git workspaces**: the selector is hidden and nothing is created;
- **Read-only sandbox / workspace-write boundary / no commit / limit**: structured errors that never block the session;
- concurrent creation in one repository is serialized by `createKeyedMutex`; any exception inside `agent/created` is swallowed and warned about, so the plugin can never prevent a session from starting;
- projection events enter the session log (~4 per new session), the cost of zero polling; an ephemeral channel could replace them later (out of scope for this release);
- **known limitation**: cleaning a non-live session's checkout from the settings page leaves its sidebar marker until that session's next `agent/created` consistency repair (see 2.4);
- **seat choice (by design, not a limitation)**: the placement pill registers in the official `conversation.hero.options` list seat, **not** the single-value `conversation.hero.workspace` seat owned by the shipped WorkspacePicker (that seat is `kind: "single"` with `replaceRisk: "shadows-shipped-ui"`), so the shipped workspace switcher is **never shadowed**; the sidebar marker uses the official ambient-marker seat `sidebar.session.row.leading`, not the hover-only row action strip;
- the sidebar marker is only a marker: not clickable, no hover card, no navigation;
- the "don't use a worktree" rollback feature is **explicitly out of scope**; the progress card's "Cancel" only hides the card.

Out of scope: cloud / Codex Web integration / multiple placements; automatic merge, PRs, environment installation; remembering placement per session (instead of per workspace); switching an existing session into a worktree mid-conversation.

## 9. Acceptance criteria (AC)

| # | Item | Verification |
| --- | --- | --- |
| AC-1 | The placement selector appears between "workspace" and "standard mode" | Manual GUI + smoke-client render assertions |
| AC-2 | The choice is remembered per workspace: switching to "Local" makes new sessions run in the original directory with no `.agents/worktrees` output; it survives restart | Manual + live-host RPC + sidecar assertions |
| AC-3 | Default worktree: the first new session in a new workspace creates a worktree after sending and switches cwd | Integration test (fake ctx + real git) |
| AC-4 | After sending, a three-step progress card appears above the composer (projection-driven, zero polling), for at least 1 s; the chip/marker appear when done | Manual + smoke-client state-machine assertions |
| AC-5 | "Cancel" only hides the card and creation continues; no "don't use a worktree" offered | smoke-client + code grep |
| AC-6 | The number of workspaces in `workspace.json` is unchanged and the session stays in its original workspace | live-host assertions + manual |
| AC-7 | Managed sessions show a read-only icon in the sidebar (not clickable, tooltip with path); it disappears immediately after cleanup (projection push, no polling) | Manual + smoke-client |
| AC-8 | Editable settings: disabling "auto-create" stops new worktrees without a restart; values are written to the profile patch; the official Plugins page also shows an auto form | Manual + live-host RPC + patch assertions |
| AC-9 | Conflicts/invalid values in settings produce clear messages and do not corrupt the current config | Unit tests (revision / validation) |
| AC-10 | The old button, `create`/`cancel` endpoints and pending logic are gone; old records can still be displayed/cleaned | Code grep + tests |
| AC-11 | Unit tests and host/client smoke are all green | Local scripts |
| AC-12 | A real DSH host: routes registered, placement read/write, projection pushes, settings get/set, client bundle served | Temporary profile + curl RPC |

## 10. Troubleshooting

| Symptom | Action |
| --- | --- |
| No placement selector on the new-session hero row | It only shows for a blank new session whose workspace is a Git repository; existing sessions and non-Git workspaces hide it (check `isGit` from the `placement` RPC). |
| Selected "New local worktree" but nothing was created | Confirm the workspace's placement is still `worktree` (it is remembered per workspace and may have been switched to `local`); look for the `agent/created` skip reason in the session log; confirm `enabled: true`, the repository has a commit, `maxPerRepo` is not reached and there is no disable marker. |
| Chose "Local" but an earlier session still runs in a worktree | Placement only affects **future** sessions; existing sessions keep their cwd. Clean their checkouts from the settings page if needed. |
| The progress card shows an error | Follow the error code: `not-git-repository` / `no-commit` / `disabled` / `root-unreachable` / `limit-reached`; the session continues in its original directory and the conversation is not blocked. |
| The progress card is stuck on "Check out files" | git may be hanging or timing out: check that `git` is on PATH and the repository is healthy; raise `gitTimeoutMs` if needed. |
| Settings save reports "configuration was changed elsewhere" | Revision conflict: the form refreshed automatically, confirm and save again; both forms (Plugins page / this page) share one revision. |
| Settings save reports `settings-unavailable` | This composition has no settings service (headless / non-profile): config degrades to read-only; edit the active profile's `cordis.patch.yml` (`- id: codex-worktree`) and restart. |
| Managed sessions have no sidebar icon | The icon only shows when the projection is `phase === 'ready'`; after cleaning a non-live session it clears on the next `agent/created`. Confirm both server and client restarted on 0.3.0. |
| The chip says "not managed" although the session is in a worktree | The session is not managed by this plugin (created by an older version, manually via `git worktree add`, or placement=local); old records still appear in the settings page and can be cleaned. |
| The 0.2.x "New Worktree" button is gone | Removed in 0.3.0; creation now happens automatically after the first message. |
| Old workspaces/checkouts remain after upgrading | The 0.2.x button may have created workspaces and checkouts: confirm the extra sidebar workspaces, the corresponding `.agents/worktrees/wt-*` directories and pending records, then clean them manually (see 3.2). |
| Startup error `Cannot find package 'dsh-codex-worktree'` | Re-run `dsh plugin --profile desktop add github:wplct/dsh-codex-worktree` (direct install: `node install.mjs`), confirm `<profile>/node_modules/dsh-codex-worktree/lib/index.js` exists, restart DSH. |

## 11. Layout

```text
dsh-codex-worktree/
├── install.mjs          # direct install: copy into the profile + append the marked block (--dry-run / --profile)
├── uninstall.mjs        # direct uninstall: drop the marked block + remove the directory (idempotent, --dry-run)
├── package.json         # 0.3.0; exports "." (host) / "./client" (web); engines node >=22.19
├── cordis.patch.yml     # plain insert row (id: codex-worktree, no config)
├── lib/                 # host half: config defaults/validation, volatile live config, agent/created creation,
│                        # git wrapper, pool rules, auto-prune (snapshots), sidecar v2 + placements,
│                        # session projection, RPC routes (placement/settings/status/list/clean/prune), commands
├── client/client.js     # browser half: 5 slots (placement selector / progress card / sidebar marker / settings page / chip)
│   └── README.md        # client-half slots, projection, RPC, zero-polling notes
├── scripts/             # smoke-host.mjs / smoke-client.mjs
├── test/                # node --test unit/integration tests
├── README.zh.md         # Chinese primary README
├── README.md            # this English counterpart
└── LICENSE              # MIT
```

Local development and checks:

```sh
npm test                 # unit / integration tests (node --test)
npm run smoke            # host + client smoke
npm run verify           # the above + node --check client/client.js
npm run install:dry      # direct-install dry run
```
