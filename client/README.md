# dsh-codex-worktree — client half (`client/client.js`)

Browser artifact for the DSH Web GUI. Plain CommonJS-shaped source, no build step, no
JSX, and `require('react')` is the only module it loads.

## How it loads

DSH evaluates the browser artifact as a lazy factory whose **id equals the package
name**:

```js
window.__ModuleLoader__.load({
  id: 'dsh-codex-worktree',
  factory: function (require) { /* ... */ return plugin },
})
```

`cordis.patch.yml` inserts the row `{ id: codex-worktree, name: dsh-codex-worktree }`, so
the loader id is `dsh-codex-worktree`. The factory is side-effect free; every resource
(stylesheet, locale dictionaries, slot entries) is installed from `apply(ctx)` through
`ctx.effect(...)`.

## Plugin object

```js
{
  name: 'dsh-codex-worktree',
  inject: ['slots', 'connection', 'locale', 'workspaces', 'sessions'],
  apply(ctx),
}
```

`apply` installs, in order:

1. one `<style data-dsh-codex-worktree-style>` element (`ctx.effect`, disposed with the
   fiber);
2. the locale dictionaries (`ctx.locale.register(LOCALE_NS, { zh, en })` + `bind`,
   with a local dictionary fallback when the service is missing);
3. the session-header chip on `conversation.session.header.utilities`
   (`id: dsh-codex-worktree-chip`, `order: -20`, `locale: dsh-codex-worktree`);
4. the **New Worktree** button on `conversation.input.dock`
   (`id: dsh-codex-worktree-new`, `order: 20`, `locale: dsh-codex-worktree`) — visible
   only for a blank Session whose Workspace is not itself a worktree;
5. the management page on `settings.section`
   (`id: dsh-codex-worktree`, `order: 40`, `locale: dsh-codex-worktree`).

## Slot props this client depends on

Verified against the installed DSH slot contract (`Slots.listSubTree` data embedded in
the app bundle) and against two shipped plugins
(`@cerbur/clutch-dsh-worktree/lib/client.js`, `@xzhi/dsh-simple-worktree-plus/client/client.js`).

| Slot | Kind / scope | Props the components rely on |
| --- | --- | --- |
| `conversation.session.header.utilities` | list, **session** scope | `sessionId: SessionId` (flat prop), `t` (translator bound to the `locale` register option), plus whatever the registration's `inject()` returns — here `{ api }`. The contract also lists `useSession`, `useSessions`, `useWorkspaces`, `useSessionStatus`, … as standard session props. |
| `conversation.input.dock` | list, **session** scope | `session` (`{ blank: true, … }`), the resolved Workspace path (via the `workspaces` controller), `t`, plus `inject()` values — here `{ api, ctx }`. The button renders only when the Session is blank and its Workspace path is not already inside a worktree pool. |
| `settings.section` | list, **root** scope | `close: () => void` (shell affordance), `t`, plus `inject()` values — here `{ api, ctx }`. `label` may be a thunk, re-read on every projection, so the nav entry follows the active locale. |

**How the header component gets the current session:** it reads the flat `sessionId`
prop, not `props.session`. `clutch-dsh-worktree` does exactly this
(`DashboardHeaderAction({ sessionId, ... })`, `WorktreeHeaderContext({ sessionId, ... })`).
This client reads `props.sessionId` and only falls back to `props.session.id` /
`props.session.sessionId` defensively.

For session-scoped slots the registration's `inject` factory is also called with the
`sessionId` (`inject: (sessionId) => ({...})` — see `client-ui-schedule`); this client
ignores the argument because it also receives `sessionId` as a prop.

## Host RPC surface

All host endpoints:

| Endpoint | Request payload | Success value |
| --- | --- | --- |
| `status` | `{ sessionId }` | `{ managed, path, mode, branch\|null, baseCommit, repoRoot, createdAt, dirty\|null }` |
| `clean` | `{ sessionId, force: boolean, deleteBranch: boolean }` | `{ removed: true, path }` |
| `list` | `{}` or `{ workspacePath }` | `{ repos: [{ repoRoot, records: [{ sessionId, path, mode, branch, baseCommit, createdAt, dirty }] }], config: { root, directory, mode, fetchBeforeCreate, autoPrune, autoPruneKeep } }` (a flat `{ records }` body is still accepted) |
| `prune` | `{}` or `{ repoRoot }` | `{ removed: [{ path, sessionId }], snapshots: [{ ref, sessionId }] }` |
| `create` | `{ path }` (session/composer workspace path) | the created checkout record: `{ repoRoot, path, mode, branch\|null, baseCommit, createdAt, pending: true, sessionId }` — used by the *New Worktree* composer button before a session owns it |

Every call is
`connection.rpc.call('/api', 'dsh-codex-worktree/<key>', payload, signal)` — see the note
on the wire form below. Failures arrive as `{ ok: false, error: { code, message, details: { issues } } }`
and are surfaced inline; `details.issues` is appended to the message.

### Wire form (why the channel and the endpoint are passed separately)

`client-connection` implements `rpc.call(channel, endpoint, payload, signal)`; it
validates the channel against `/^\/[A-Za-z0-9._~-]+$/` (one segment) and the endpoint
segment-by-segment, posts to `${channel}/${endpoint}` and sends
`message.method = endpoint`. Since `API_PREFIX === '/api/dsh-codex-worktree'` and
`RPC_NAMESPACE === 'dsh-codex-worktree'`, calling
`rpc.call('/api', 'dsh-codex-worktree/status', …)` addresses
`/api/dsh-codex-worktree/status` and produces
`message.method === 'dsh-codex-worktree/status'` — the host assertion in
`lib/constants.js`.

`lib/constants.js` documents the same rule: a single-string channel carrying slashes is
rejected by `assertTarget`. Verified against the shipped `dsh-client-connection` bundle:
`call(channel, endpoint, payload, signal)`.

## Client controllers used (management actions)

| Action | API | Notes |
| --- | --- | --- |
| Find a registered Workspace | `ctx.workspaces.list.getSnapshot().items` (`{ workspaceId, path, title, sessionIds }`) | snapshot is also read through `byId` if a build only exposes that. |
| Create a Workspace | `await ctx.workspaces.create({ path })` → `{ workspaceId }` | same call as `dsh-simple-worktree-plus` and `clutch-dsh-worktree`. |
| Create a Session | `await ctx.sessions.create({ workspaceId })` | returns the Session id (a string, or an object with `sessionId`/`id`). |
| Open a Session | `ctx.uiWorkspace.openSession(sessionId)` first, then `ctx.sessions.open(sessionId)` | DSH 1.7 navigates through the Workspace controller; older builds expose `sessions.open` (`openWorktreeSession` in `clutch-dsh-worktree`). |
| Resolve a conversation title | `ctx.sessions.list.getSnapshot()` | the snapshot exposes `ids` + `byId`, **not** `items`; the title field is `displayTitle` (falling back to `title`/`name`, then the first 8 characters of the id). This client accepts `items`, `ids` and `byId`. |

The plugin object's `inject` array includes `workspaces` and `sessions` because the page's
management actions call them directly; `workspaces` / `sessions` / `uiWorkspace` are still
resolved defensively with `ctx.get(name)` (and the property fallback) at the moment an
action runs. Every failure is rendered inline on the affected row; nothing is thrown out
of a handler or a render.

## Behaviour

* **Chip** — `wt:<name>` (a leading directory prefix such as `wt-` is folded into
  `wt:`) or the branch name; three states: managed (with a dirty count badge), not
  managed, loading/error. Clicking opens a popover with path, repository, mode, base
  commit, changed files and creation time, plus a cleanup action (`clean` with
  `force: false`; a dirty-worktree error offers the `force: true` retry). Branch names
  are deliberately absent: the checkout is always detached, so naming belongs to Git
  at commit time.
* **Management page** — read-only configuration card (root, `fetchBeforeCreate`,
  `autoPrune` + `autoPruneKeep`) with the "change it in the profile's
  cordis.patch.yml" hint and a *Prune now* button (`prune`, then a count of removed
  worktrees and snapshots, then a refresh); repository groups (collapsible, expanded by
  default) with a per-worktree row showing path, mode (dashed badge when detached),
  dirty badge and creation time; per row *New chat here* (register/lookup Workspace →
  create Session → open) and *Delete* (`clean` with `force: false, deleteBranch: true`,
  escalated to a force confirmation when the worktree is dirty); a "known conversations"
  link that opens the recorded Session.
* **New Worktree button** — on `conversation.input.dock`, above the composer, visible only
  for a blank Session whose Workspace is not itself a worktree; calls `create` with the
  Session's Workspace path, registers/looks up a Workspace for the returned checkout and
  starts a session there (the same machinery as the management page's *New chat here*).
  Inline error labels map the host codes (`not-git-repository`, `no-commit`, `disabled`,
  `limit-reached`, `root-unreachable`).
* **Styles** — one `@layer dsh-codex-worktree` block with plugin-prefixed class names,
  only `--dsw-alias-*` / `--dsw-specific-*` / `--dsw-shadow-*` tokens, so light and dark
  themes both come from the host.
* **Failure isolation** — each slot entry is wrapped in a small error boundary class so
  a render error degrades to an inline label instead of blanking the slot entry, and all
  async effects abort on unmount.

## Open uncertainties

* `clean`'s dirty error is not a dedicated code: the host half throws
  `worktree has N uncommitted change(s); pass --force to remove it anyway` and
  `routes.js` wraps it as `{ ok: false, error: { code: 'operation-failed', message } }`.
  The client therefore detects it from `code`/`message`/`details.issues` with a text
  heuristic (`dirty|uncommitted|not clean|has changes|modified files`). A dedicated code
  (for example `worktree-dirty`) would make the force-retry decision exact.
* `config.mode` is accepted by the normalizer but not displayed (the requested layout
  lists three configuration rows); the per-record `mode` is what the rows show.
* `workspaces` / `sessions` are part of the plugin's `inject` list (alongside
  `slots`/`connection`/`locale`), so the controllers are available when the page mounts;
  the lazy `ctx.get` fallback is kept for builds that expose only the property form. The
  page shows an explicit inline message if they are absent.
* Cross-checked against the landed host half (`lib/routes.js`, `lib/session-worktree.js`):
  route `${API_PREFIX}/${endpoint}`, `message.method === 'dsh-codex-worktree/<key>'`,
  `list → { repos, config }`, `prune → { removed, snapshots }`, `status` returning bare
  `{ managed: false }` for an unmanaged Session, and record fields
  `sessionId/repoRoot/path/mode/branch/baseCommit/createdAt/dirty` all match this client.
  `lib/constants.js` lists `status`, `clean`, `list`, `prune` and `create` in
  `ENDPOINTS`; the client mirrors that list locally because the client half cannot
  import the frozen contract file.
