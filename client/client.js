/**
 * dsh-codex-style-worktree — browser half (DSH Web GUI) for 0.3.0. Display title:
 * "Codex 风格 Worktree" / "Codex-style Worktree".
 *
 * Registers five surfaces:
 *   1. `conversation.hero.options` — the work-location selector
 *      (本地 / 新建本地工作树) on the blank-session hero row. The choice is sticky
 *      per Workspace through the `placement` RPC.
 *   2. `conversation.input.dock` — an inline creation-progress card above the
 *      composer, driven by the `codexWorktree` Session projection (no polling).
 *   3. `sidebar.session.row.leading` — a read-only marker for Sessions whose
 *      projection is `ready` (icon + tooltip; never clickable).
 *   4. `conversation.session.header.utilities` — the Session chip. Its base state
 *      comes from the projection; the popover reads details with one `status` RPC.
 *   5. `settings.section` — editable configuration form (`settings` RPC) plus the
 *      worktree management list (`list` / `clean` / `prune`).
 *
 * All state sync is event-driven: Session projections come from
 * `sessions.list.getSnapshot().byId[id].projectionValues.codexWorktree` and its
 * list subscription. Nothing polls; `setTimeout` is used only for the
 * progress card's minimum display time, its fade-out and transient notes.
 *
 * The browser artifact is a lazy factory whose id equals the package name
 * (`dsh-codex-style-worktree`). React comes from the browser module table, so `react` is
 * the only module this file may require.
 *
 * No build step: plain CommonJS-shaped source using React.createElement.
 */

window.__ModuleLoader__.load({
  id: 'dsh-codex-style-worktree',
  factory: function (require) {
    'use strict'

    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement

    /* ================================================================== *
     * 1. Frozen contract — mirrors lib/constants.js (never redefined there) *
     * ================================================================== */

    /** Loader id / plugin name; must match the `insert.id`/`name` row of cordis.patch.yml. */
    var PLUGIN_NAME = 'dsh-codex-style-worktree'
    /** Locale namespace owned by the client half. */
    var LOCALE_NS = 'dsh-codex-style-worktree'
    /** Base path of the authenticated host route carrier. */
    var API_PREFIX = '/api/dsh-codex-style-worktree'
    /** RPC method prefix the connection layer derives from API_PREFIX. */
    var RPC_NAMESPACE = 'dsh-codex-style-worktree'
    /** Settings namespace the host exposes through the `settings` endpoint. */
    var SETTINGS_NS = 'codex-worktree'
    /**
     * RPC endpoints registered by the host half.
     *
     * There is no `create` and no `cancel`: worktrees are created only by the
     * host on the first message (first-turn `agent/pre-step`), and the progress
     * card's cancel is a client-side hide. Placement and settings back the
     * 0.3.0+ surfaces.
     */
    var ENDPOINTS = ['status', 'clean', 'list', 'prune', 'placement', 'settings', 'restore']

    /**
     * `connection.rpc.call(channel, endpoint, payload, signal)` is the DSH wire
     * surface: the channel is one path segment (`/api`) and the endpoint is
     * `<namespace>/<key>` (its segments are validated individually). Together they
     * address `${API_PREFIX}/${key}` and produce `message.method ===
     * 'dsh-codex-style-worktree/'+key`, which is exactly the host-side contract.
     */
    var RPC_CHANNEL = '/' + String(API_PREFIX).split('/')[1]

    /** Attribute guarding the single injected <style> element. */
    var STYLE_ATTR = 'data-dsh-codex-style-worktree-style'
    var CHIP_ID = 'dsh-codex-style-worktree-chip'
    var SECTION_ID = 'dsh-codex-style-worktree'
    var PLACEMENT_ID = 'dsh-codex-style-worktree-placement'
    var PROGRESS_ID = 'dsh-codex-style-worktree-progress'
    var MARKER_ID = 'dsh-codex-style-worktree-marker'

    /* ================================================================== *
     * 2. Locale                                                           *
     * ================================================================== */

    var DICT_EN = {
      'chip.title': 'Codex-style Worktree',
      'chip.unmanaged': 'No worktree',
      'chip.loading': 'Checking\u2026',
      'chip.error': 'Status unknown',
      'chip.show': 'Show worktree details',
      'popover.title': 'Codex-style Worktree',
      'popover.close': 'Close',
      'popover.refresh': 'Refresh',
      'popover.path': 'Path',
      'popover.repo': 'Repository',
      'popover.mode': 'Mode',
      'popover.mode.detached': 'Detached HEAD',
      'popover.mode.branch': 'Named branch',
      'popover.baseCommit': 'Base commit',
      'popover.dirty': 'Changed files',
      'popover.created': 'Created',
      'popover.none': '\u2014',
      'popover.unmanagedHint': 'This Session is not using an automatic worktree. Start a Session inside a Git repository to get one.',
      'popover.clean.action': 'Clean worktree',
      'popover.clean.confirm': 'Remove this worktree directory? The checkout is deleted from disk.',
      'popover.clean.confirmAction': 'Confirm cleanup',
      'popover.clean.cancel': 'Cancel',
      'popover.clean.force': 'Force cleanup',
      'popover.clean.forceHint': 'The worktree has uncommitted changes. Force cleanup discards them.',
      'popover.clean.deleteBranch': 'Also delete the branch',
      'popover.clean.success': 'Cleaned up {path}',
      'popover.error': 'Operation failed: {message}',
      'settings.title': 'Codex-style Worktree',
      'settings.subtitle': 'Codex-style worktrees created for DSH Sessions on this machine.',
      'settings.refresh': 'Refresh',
      'settings.loading': 'Loading\u2026',
      'settings.retry': 'Retry',
      'settings.empty': 'No recorded worktrees',
      'settings.emptyHint': 'A new Session started inside a Git repository creates one automatically.',
      'settings.count': '{count} worktrees',
      'settings.mode.detached': 'detached',
      'settings.mode.branch': 'branch',
      'settings.cancel': 'Cancel',
      'settings.loadError': 'Failed to load records: {message}',
      'settings.rowError': 'Operation failed: {message}',
      'settings.noSession': 'This record has no Session id, so it cannot be managed from here.',
      'settings.unknown': 'unknown',
      'settings.config.on': 'On',
      'settings.config.off': 'Off',
      'settings.prune.action': 'Prune now',
      'settings.prune.busy': 'Pruning\u2026',
      'settings.prune.result': 'Pruned {removed} worktrees and {snapshots} snapshots.',
      'settings.prune.nothing': 'Nothing to prune.',
      'settings.repo.count': '{count} worktrees',
      'settings.repo.refresh': 'Refresh this list',
      'settings.expand': 'Expand {repo}',
      'settings.collapse': 'Collapse {repo}',
      'settings.dirty': '{count} uncommitted',
      'settings.noDirty': 'clean',
      'settings.created': 'Created {time}',
      'settings.delete': 'Delete',
      'settings.delete.confirm': 'Delete this worktree? Its checkout directory is removed from disk.',
      'settings.delete.confirmAction': 'Confirm delete',
      'settings.delete.forceHint': 'This worktree has uncommitted changes. Force delete discards them.',
      'settings.delete.force': 'Force delete',
      'settings.deleted': 'Deleted {path}',
      'settings.conversations': 'Known conversations',
      'settings.openSession': 'Open conversation',
      'settings.openFailed': 'Could not open the conversation: {message}',
      'settings.rpcUnavailable': 'The host RPC connection is unavailable.',
      'placement.title': 'Work location',
      'placement.worktree': 'New local worktree',
      'placement.local': 'Local',
      'placement.hint': 'Creating a local worktree does not add a Workspace; it only switches this Session\u2019s working directory.',
      'placement.failed': 'Could not save the work location. It may be unavailable right now; sending still works.',
      'progress.title': 'Creating worktree',
      'progress.prepare': 'Prepare workspace',
      'progress.checkout': 'Check out files',
      'progress.finalize': 'Set up environment',
      'progress.done': 'Worktree created',
      'progress.cancel': 'Cancel',
      'progress.failed': 'Could not create the worktree; the Session continues in the original directory.',
      'progress.reason': 'Reason: {reason}',
      'marker.title': 'Codex-style Worktree',
      'marker.tooltip': '{title} \u00b7 {path}',
      'settings.edit.title': 'Configuration',
      'settings.edit.enabled': 'Automatic creation',
      'settings.edit.enabled.desc': 'Create a worktree automatically after the first message.',
      'settings.edit.defaultPlacement': 'Default work location',
      'settings.edit.defaultPlacement.desc': 'Used for a Workspace that has no remembered choice yet.',
      'settings.edit.directory': 'Checkout directory',
      'settings.edit.directory.desc': 'Relative to the repository; no "." or ".." segments.',
      'settings.edit.root': 'Worktree root directory',
      'settings.edit.root.desc': 'Empty uses the in-repository directory; otherwise an absolute or repository-relative path without "..".',
      'settings.edit.mode': 'Mode',
      'settings.edit.mode.desc': 'Detached creates no branch (recommended); branch also creates one.',
      'settings.edit.namePrefix': 'Name prefix',
      'settings.edit.namePrefix.desc': 'Checkout directory prefix; no slashes and must not start with "-".',
      'settings.edit.branchPrefix': 'Branch prefix',
      'settings.edit.branchPrefix.desc': 'Branch name prefix; must not start with "-" or "/".',
      'settings.edit.baseRef': 'Base ref',
      'settings.edit.baseRef.desc': 'Local ref the checkout starts from; must not start with "-".',
      'settings.edit.fetchBeforeCreate': 'Fetch upstream before creating a worktree',
      'settings.edit.fetchBeforeCreate.desc': 'Failures only warn; creation continues with local refs.',
      'settings.edit.autoPrune': 'Automatically delete old worktrees',
      'settings.edit.autoPrune.desc': 'Delete worktrees beyond the keep limit while creating.',
      'settings.edit.autoPruneKeep': 'Keep at most',
      'settings.edit.autoPruneKeep.desc': 'Non-negative integer.',
      'settings.edit.pruneGraceMs': 'Prune grace period (ms)',
      'settings.edit.pruneGraceMs.desc': 'Non-negative integer; recently used worktrees are skipped.',
      'settings.edit.poolGitignore': 'Add the pool directory to .gitignore',
      'settings.edit.poolGitignore.desc': 'Keeps the checkout pool out of git status.',
      'settings.edit.gitTimeoutMs': 'Git timeout (ms)',
      'settings.edit.gitTimeoutMs.desc': 'Positive integer.',
      'settings.edit.skipChildAgents': 'Skip subagents',
      'settings.edit.skipChildAgents.desc': 'Subagent Sessions never get a worktree.',
      'settings.edit.skipSessionIdPatterns': 'Skip Session ids matching',
      'settings.edit.skipSessionIdPatterns.desc': 'One regular expression per line.',
      'settings.edit.skipPresets': 'Skip presets matching',
      'settings.edit.skipPresets.desc': 'One regular expression per line.',
      'settings.edit.disableMarker': 'Disable marker file',
      'settings.edit.disableMarker.desc': 'A plain file name (no slashes) that disables creation in a repository.',
      'settings.edit.maxPerRepo': 'Maximum per repository',
      'settings.edit.maxPerRepo.desc': 'Positive integer; creation is refused above it.',
      'settings.edit.noticeOnCreate': 'Notify after creating',
      'settings.edit.noticeOnCreate.desc': 'Post a short notice in the new Session.',
      'settings.save': 'Save',
      'settings.saving': 'Saving\u2026',
      'settings.reset': 'Restore defaults',
      'settings.saved': 'Saved',
      'settings.dirty': 'Unsaved changes',
      'settings.conflict': 'Configuration changed elsewhere. The form was refreshed with the latest values.',
      'settings.invalid': 'Invalid value: {message}',
      'settings.unavailable': 'Settings service unavailable. Change values in the profile cordis.patch.yml.',
      'settings.readOnly': 'Read-only',
      'settings.management.title': 'Worktree management',
      'settings.snapshots.title': 'Recoverable snapshots',
      'settings.snapshots.count': '{count} snapshots',
      'settings.snapshots.commit': 'Commit',
      'settings.snapshots.created': 'Created {time}',
      'settings.snapshots.restore': 'Restore',
      'settings.snapshots.restoring': 'Restoring\u2026',
      'settings.snapshots.restored': 'Restored to {path}',
      'settings.snapshots.restoreBadge': 'Restored',
      'settings.snapshots.restoredAt': 'Restored {time}',
      'settings.snapshots.restoreFailed': 'Restore failed: {message}',
      'error.worktreeInUse': 'This worktree is the working directory of an active session; force cleanup will leave that session without a working directory.',
      'error.forceCleanupAction': 'Force cleanup anyway',
    }

    var DICT_ZH = {
      'chip.title': 'Codex \u98ce\u683c Worktree',
      'chip.unmanaged': '\u672a\u6258\u7ba1',
      'chip.loading': '\u68c0\u67e5\u4e2d\u2026',
      'chip.error': '\u72b6\u6001\u672a\u77e5',
      'chip.show': '\u67e5\u770b Worktree \u8be6\u60c5',
      'popover.title': 'Codex \u98ce\u683c Worktree',
      'popover.close': '\u5173\u95ed',
      'popover.refresh': '\u5237\u65b0',
      'popover.path': '\u8def\u5f84',
      'popover.repo': '\u4ed3\u5e93',
      'popover.mode': '\u6a21\u5f0f',
      'popover.mode.detached': '\u6e38\u79bb HEAD',
      'popover.mode.branch': '\u547d\u540d\u5206\u652f',
      'popover.baseCommit': '\u57fa\u51c6\u63d0\u4ea4',
      'popover.dirty': '\u6539\u52a8\u6587\u4ef6',
      'popover.created': '\u521b\u5efa\u65f6\u95f4',
      'popover.none': '\u2014',
      'popover.unmanagedHint': '\u5f53\u524d\u4f1a\u8bdd\u672a\u4f7f\u7528\u81ea\u52a8 Worktree\u3002\u5728 Git \u4ed3\u5e93\u4e2d\u65b0\u5efa\u4f1a\u8bdd\u5373\u4f1a\u81ea\u52a8\u521b\u5efa\u3002',
      'popover.clean.action': '\u6e05\u7406 Worktree',
      'popover.clean.confirm': '\u786e\u5b9a\u5220\u9664\u8fd9\u4e2a Worktree \u76ee\u5f55\uff1f\u5de5\u4f5c\u533a\u5c06\u4ece\u78c1\u76d8\u4e0a\u5220\u9664\u3002',
      'popover.clean.confirmAction': '\u786e\u8ba4\u6e05\u7406',
      'popover.clean.cancel': '\u53d6\u6d88',
      'popover.clean.force': '\u5f3a\u5236\u6e05\u7406',
      'popover.clean.forceHint': '\u8be5 Worktree \u6709\u672a\u63d0\u4ea4\u7684\u6539\u52a8\uff0c\u5f3a\u5236\u6e05\u7406\u4f1a\u4e22\u5f03\u5b83\u4eec\u3002',
      'popover.clean.deleteBranch': '\u540c\u65f6\u5220\u9664\u5206\u652f',
      'popover.clean.success': '\u5df2\u6e05\u7406 {path}',
      'popover.error': '\u64cd\u4f5c\u5931\u8d25\uff1a{message}',
      'settings.title': 'Codex \u98ce\u683c Worktree',
      'settings.subtitle': '\u672c\u673a\u4e0a\u4e3a DSH \u4f1a\u8bdd\u81ea\u52a8\u521b\u5efa\u7684 Codex \u98ce\u683c Worktree\u3002',
      'settings.refresh': '\u5237\u65b0',
      'settings.loading': '\u52a0\u8f7d\u4e2d\u2026',
      'settings.retry': '\u91cd\u8bd5',
      'settings.empty': '\u6682\u65e0\u8bb0\u5f55',
      'settings.emptyHint': '\u5728 Git \u4ed3\u5e93\u4e2d\u65b0\u5efa\u4f1a\u8bdd\u65f6\u4f1a\u81ea\u52a8\u521b\u5efa\u3002',
      'settings.count': '{count} \u4e2a\u5de5\u4f5c\u6811',
      'settings.mode.detached': '\u6e38\u79bb',
      'settings.mode.branch': '\u5206\u652f',
      'settings.cancel': '\u53d6\u6d88',
      'settings.loadError': '\u8bfb\u53d6\u8bb0\u5f55\u5931\u8d25\uff1a{message}',
      'settings.rowError': '\u64cd\u4f5c\u5931\u8d25\uff1a{message}',
      'settings.noSession': '\u8be5\u8bb0\u5f55\u7f3a\u5c11\u4f1a\u8bdd ID\uff0c\u65e0\u6cd5\u5728\u6b64\u7ba1\u7406\u3002',
      'settings.unknown': '\u672a\u77e5',
      'settings.config.on': '\u5f00',
      'settings.config.off': '\u5173',
      'settings.prune.action': '\u7acb\u5373\u6e05\u7406',
      'settings.prune.busy': '\u6e05\u7406\u4e2d\u2026',
      'settings.prune.result': '\u5df2\u6e05\u7406 {removed} \u4e2a\u5de5\u4f5c\u6811\u3001{snapshots} \u4e2a\u5feb\u7167\u3002',
      'settings.prune.nothing': '\u6ca1\u6709\u53ef\u6e05\u7406\u7684\u5185\u5bb9\u3002',
      'settings.repo.count': '{count} \u4e2a\u5de5\u4f5c\u6811',
      'settings.repo.refresh': '\u5237\u65b0\u5217\u8868',
      'settings.expand': '\u5c55\u5f00 {repo}',
      'settings.collapse': '\u6298\u53e0 {repo}',
      'settings.dirty': '{count} \u4e2a\u672a\u63d0\u4ea4',
      'settings.noDirty': '\u5e72\u51c0',
      'settings.created': '\u521b\u5efa\u4e8e {time}',
      'settings.delete': '\u5220\u9664',
      'settings.delete.confirm': '\u5220\u9664\u8fd9\u4e2a\u5de5\u4f5c\u6811\uff1f\u5de5\u4f5c\u533a\u76ee\u5f55\u5c06\u4ece\u78c1\u76d8\u4e0a\u79fb\u9664\u3002',
      'settings.delete.confirmAction': '\u786e\u8ba4\u5220\u9664',
      'settings.delete.forceHint': '\u8be5\u5de5\u4f5c\u6811\u6709\u672a\u63d0\u4ea4\u7684\u6539\u52a8\uff0c\u5f3a\u5236\u5220\u9664\u4f1a\u4e22\u5f03\u5b83\u4eec\u3002',
      'settings.delete.force': '\u5f3a\u5236\u5220\u9664',
      'settings.deleted': '\u5df2\u5220\u9664 {path}',
      'settings.conversations': '\u5df2\u77e5\u5bf9\u8bdd',
      'settings.openSession': '\u6253\u5f00\u5bf9\u8bdd',
      'settings.openFailed': '\u65e0\u6cd5\u6253\u5f00\u5bf9\u8bdd\uff1a{message}',
      'settings.rpcUnavailable': '\u4e3b\u673a RPC \u8fde\u63a5\u4e0d\u53ef\u7528\u3002',
      'placement.title': '\u5de5\u4f5c\u4f4d\u7f6e',
      'placement.worktree': '\u65b0\u5efa\u672c\u5730\u5de5\u4f5c\u6811',
      'placement.local': '\u672c\u5730',
      'placement.hint': '\u65b0\u5efa\u672c\u5730\u5de5\u4f5c\u6811\u4e0d\u4f1a\u65b0\u589e\u5de5\u4f5c\u533a\uff0c\u53ea\u5207\u6362\u672c\u6b21\u4f1a\u8bdd\u7684\u5de5\u4f5c\u76ee\u5f55\u3002',
      'placement.failed': '\u65e0\u6cd5\u4fdd\u5b58\u5de5\u4f5c\u4f4d\u7f6e\uff0c\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u4ecd\u53ef\u4ee5\u6b63\u5e38\u53d1\u9001\u6d88\u606f\u3002',
      'progress.title': '\u6b63\u5728\u521b\u5efa\u5de5\u4f5c\u6811',
      'progress.prepare': '\u51c6\u5907\u5de5\u4f5c\u7a7a\u95f4',
      'progress.checkout': '\u68c0\u51fa\u6587\u4ef6',
      'progress.finalize': '\u8bbe\u7f6e\u73af\u5883',
      'progress.done': '\u5df2\u521b\u5efa\u5de5\u4f5c\u6811',
      'progress.cancel': '\u53d6\u6d88',
      'progress.failed': '\u521b\u5efa\u5de5\u4f5c\u6811\u5931\u8d25\uff0c\u4f1a\u8bdd\u7ee7\u7eed\u5728\u539f\u76ee\u5f55\u4e2d\u8fd0\u884c\u3002',
      'progress.reason': '\u539f\u56e0\uff1a{reason}',
      'marker.title': 'Codex \u98ce\u683c Worktree',
      'marker.tooltip': '{title} \u00b7 {path}',
      'settings.edit.title': '\u914d\u7f6e',
      'settings.edit.enabled': '\u81ea\u52a8\u521b\u5efa',
      'settings.edit.enabled.desc': '\u9996\u6761\u6d88\u606f\u540e\u81ea\u52a8\u521b\u5efa\u5de5\u4f5c\u6811\u3002',
      'settings.edit.defaultPlacement': '\u9ed8\u8ba4\u5de5\u4f5c\u4f4d\u7f6e',
      'settings.edit.defaultPlacement.desc': '\u5c1a\u672a\u8bb0\u4f4f\u9009\u62e9\u7684\u5de5\u4f5c\u533a\u4f7f\u7528\u6b64\u503c\u3002',
      'settings.edit.directory': '\u68c0\u51fa\u76ee\u5f55',
      'settings.edit.directory.desc': '\u76f8\u5bf9\u4e8e\u4ed3\u5e93\uff1b\u4e0d\u80fd\u542b "." \u6216 ".." \u6bb5\u3002',
      'settings.edit.root': '\u5de5\u4f5c\u6811\u6839\u76ee\u5f55',
      'settings.edit.root.desc': '\u7a7a\u8868\u793a\u4ed3\u5e93\u5185\u76ee\u5f55\uff1b\u5426\u5219\u4e3a\u7edd\u5bf9\u8def\u5f84\u6216\u4ed3\u5e93\u76f8\u5bf9\u8def\u5f84\uff0c\u4e0d\u80fd\u542b ".."\u3002',
      'settings.edit.mode': '\u6a21\u5f0f',
      'settings.edit.mode.desc': 'detached \u4e0d\u5efa\u5206\u652f\uff08\u63a8\u8350\uff09\uff1bbranch \u540c\u65f6\u521b\u5efa\u5206\u652f\u3002',
      'settings.edit.namePrefix': '\u540d\u79f0\u524d\u7f00',
      'settings.edit.namePrefix.desc': '\u68c0\u51fa\u76ee\u5f55\u540d\u524d\u7f00\uff1b\u4e0d\u80fd\u542b\u659c\u6760\uff0c\u4e0d\u80fd\u4ee5 "-" \u5f00\u5934\u3002',
      'settings.edit.branchPrefix': '\u5206\u652f\u524d\u7f00',
      'settings.edit.branchPrefix.desc': '\u5206\u652f\u540d\u524d\u7f00\uff1b\u4e0d\u80fd\u4ee5 "-" \u6216 "/" \u5f00\u5934\u3002',
      'settings.edit.baseRef': '\u57fa\u51c6\u5f15\u7528',
      'settings.edit.baseRef.desc': '\u68c0\u51fa\u8d77\u59cb\u7684\u672c\u5730\u5f15\u7528\uff1b\u4e0d\u80fd\u4ee5 "-" \u5f00\u5934\u3002',
      'settings.edit.fetchBeforeCreate': '\u521b\u5efa\u5de5\u4f5c\u6811\u524d\u83b7\u53d6\u4e0a\u6e38\u66f4\u65b0',
      'settings.edit.fetchBeforeCreate.desc': '\u5931\u8d25\u4ec5\u544a\u8b66\uff0c\u4f1a\u7ee7\u7eed\u4f7f\u7528\u672c\u5730\u5f15\u7528\u521b\u5efa\u3002',
      'settings.edit.autoPrune': '\u81ea\u52a8\u5220\u9664\u65e7\u5de5\u4f5c\u6811',
      'settings.edit.autoPrune.desc': '\u521b\u5efa\u65f6\u5220\u9664\u8d85\u51fa\u4fdd\u7559\u6570\u7684\u5de5\u4f5c\u6811\u3002',
      'settings.edit.autoPruneKeep': '\u6700\u591a\u4fdd\u7559',
      'settings.edit.autoPruneKeep.desc': '\u975e\u8d1f\u6574\u6570\u3002',
      'settings.edit.pruneGraceMs': '\u6e05\u7406\u5bbd\u9650\u671f (ms)',
      'settings.edit.pruneGraceMs.desc': '\u975e\u8d1f\u6574\u6570\uff1b\u6700\u8fd1\u4f7f\u7528\u8fc7\u7684\u5de5\u4f5c\u6811\u4f1a\u88ab\u8df3\u8fc7\u3002',
      'settings.edit.poolGitignore': '\u5c06\u6c60\u76ee\u5f55\u5199\u5165 .gitignore',
      'settings.edit.poolGitignore.desc': '\u907f\u514d\u68c0\u51fa\u6c60\u51fa\u73b0\u5728 git status \u4e2d\u3002',
      'settings.edit.gitTimeoutMs': 'Git \u8d85\u65f6 (ms)',
      'settings.edit.gitTimeoutMs.desc': '\u6b63\u6574\u6570\u3002',
      'settings.edit.skipChildAgents': '\u8df3\u8fc7\u5b50\u4ee3\u7406',
      'settings.edit.skipChildAgents.desc': '\u5b50\u4ee3\u7406\u4f1a\u8bdd\u4e0d\u521b\u5efa\u5de5\u4f5c\u6811\u3002',
      'settings.edit.skipSessionIdPatterns': '\u8df3\u8fc7\u5339\u914d\u7684\u4f1a\u8bdd ID',
      'settings.edit.skipSessionIdPatterns.desc': '\u6bcf\u884c\u4e00\u4e2a\u6b63\u5219\u8868\u8fbe\u5f0f\u3002',
      'settings.edit.skipPresets': '\u8df3\u8fc7\u5339\u914d\u7684\u9884\u8bbe',
      'settings.edit.skipPresets.desc': '\u6bcf\u884c\u4e00\u4e2a\u6b63\u5219\u8868\u8fbe\u5f0f\u3002',
      'settings.edit.disableMarker': '\u7981\u7528\u6807\u8bb0\u6587\u4ef6',
      'settings.edit.disableMarker.desc': '\u4ed3\u5e93\u5185\u5b58\u5728\u8be5\u6587\u4ef6\u540d\uff08\u4e0d\u542b\u659c\u6760\uff09\u65f6\u4e0d\u521b\u5efa\u5de5\u4f5c\u6811\u3002',
      'settings.edit.maxPerRepo': '\u5355\u4ed3\u5e93\u4e0a\u9650',
      'settings.edit.maxPerRepo.desc': '\u6b63\u6574\u6570\uff1b\u8d85\u8fc7\u540e\u62d2\u7edd\u521b\u5efa\u3002',
      'settings.edit.noticeOnCreate': '\u521b\u5efa\u540e\u63d0\u793a',
      'settings.edit.noticeOnCreate.desc': '\u5728\u65b0\u4f1a\u8bdd\u4e2d\u53d1\u5e03\u4e00\u6761\u7b80\u77ed\u63d0\u793a\u3002',
      'settings.save': '\u4fdd\u5b58',
      'settings.saving': '\u4fdd\u5b58\u4e2d\u2026',
      'settings.reset': '\u6062\u590d\u9ed8\u8ba4',
      'settings.saved': '\u5df2\u4fdd\u5b58',
      'settings.dirty': '\u672a\u4fdd\u5b58',
      'settings.conflict': '\u914d\u7f6e\u5df2\u5728\u522b\u5904\u4fee\u6539\uff0c\u8868\u5355\u5df2\u7528\u6700\u65b0\u503c\u5237\u65b0\u3002',
      'settings.invalid': '\u975e\u6cd5\u503c\uff1a{message}',
      'settings.unavailable': '\u8bbe\u7f6e\u670d\u52a1\u4e0d\u53ef\u7528\uff0c\u8bf7\u5728 profile \u7684 cordis.patch.yml \u4e2d\u4fee\u6539\u3002',
      'settings.readOnly': '\u53ea\u8bfb',
      'settings.management.title': '\u5de5\u4f5c\u6811\u7ba1\u7406',
      'settings.snapshots.title': '\u53ef\u6062\u590d\u5feb\u7167',
      'settings.snapshots.count': '{count} \u4e2a\u5feb\u7167',
      'settings.snapshots.commit': '\u63d0\u4ea4',
      'settings.snapshots.created': '\u521b\u5efa\u4e8e {time}',
      'settings.snapshots.restore': '\u6062\u590d',
      'settings.snapshots.restoring': '\u6062\u590d\u4e2d\u2026',
      'settings.snapshots.restored': '\u5df2\u6062\u590d\u5230 {path}',
      'settings.snapshots.restoreBadge': '\u5df2\u6062\u590d',
      'settings.snapshots.restoredAt': '\u6062\u590d\u4e8e {time}',
      'settings.snapshots.restoreFailed': '\u6062\u590d\u5931\u8d25\uff1a{message}',
      'error.worktreeInUse': '\u8be5\u5de5\u4f5c\u6811\u6b63\u88ab\u6d3b\u8dc3\u4f1a\u8bdd\u4f7f\u7528\uff0c\u5f3a\u5236\u5220\u9664\u4f1a\u8ba9\u90a3\u4e2a\u4f1a\u8bdd\u5931\u53bb\u5de5\u4f5c\u76ee\u5f55\u3002',
      'error.forceCleanupAction': '\u4ecd\u7136\u5f3a\u5236\u6e05\u7406',
    }

    /** Active locale service (or null when the service is unavailable). */
    var localeService = null
    /** Translator bound to LOCALE_NS through the locale service, when available. */
    var boundTranslate = null
    /** Stable empty snapshot for useSyncExternalStore when no locale service exists. */
    var EMPTY_SNAPSHOT = Object.freeze({ active: '', locales: Object.freeze([]), revision: 0 })

    function resolveLocale(ctx) {
      if (!ctx) return null
      try {
        if (typeof ctx.get === 'function') {
          var viaGet = ctx.get('locale')
          if (viaGet) return viaGet
        }
      } catch (error) {
        /* service unavailable through `get`; fall through to the property */
      }
      try {
        return ctx.locale || null
      } catch (error) {
        return null
      }
    }

    /**
     * Register the dictionaries and bind a translator. A missing or partial locale
     * service is not an error: every string then falls back to the local dictionary.
     */
    function installLocale(service) {
      localeService = service || null
      boundTranslate = null
      if (!service || typeof service.register !== 'function' || typeof service.bind !== 'function') {
        return function () {}
      }
      var disposeRegistration
      try {
        disposeRegistration = service.register(LOCALE_NS, { zh: DICT_ZH, en: DICT_EN })
      } catch (error) {
        /* Another instance already owns this namespace; the bind below still works. */
        disposeRegistration = undefined
      }
      try {
        boundTranslate = service.bind(LOCALE_NS)
      } catch (error) {
        boundTranslate = null
      }
      return function () {
        if (typeof disposeRegistration === 'function') {
          try {
            disposeRegistration()
          } catch (error) {
            /* the locale service may already be disposed */
          }
        }
        if (localeService === service) {
          localeService = null
          boundTranslate = null
        }
      }
    }

    function activeLanguage() {
      try {
        if (localeService && typeof localeService.getSnapshot === 'function') {
          var snapshot = localeService.getSnapshot()
          var active = snapshot && typeof snapshot.active === 'string' ? snapshot.active : ''
          if (active) return active.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
        }
      } catch (error) {
        /* ignore and fall through to the browser language */
      }
      try {
        if (typeof navigator !== 'undefined' && navigator && typeof navigator.language === 'string') {
          return navigator.language.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
        }
      } catch (error) {
        /* no navigator in this environment */
      }
      return 'en'
    }

    function formatTemplate(template, params) {
      var text = String(template == null ? '' : template)
      if (!params) return text
      return text.replace(/\{(\w+)\}/g, function (match, name) {
        return params[name] === undefined ? match : String(params[name])
      })
    }

    function localDictionary() {
      return activeLanguage() === 'zh' ? DICT_ZH : DICT_EN
    }

    /** Translate through the locale service when possible, else through the local dictionary. */
    function translate(key, params) {
      if (boundTranslate) {
        try {
          var bound = boundTranslate(key, params)
          if (typeof bound === 'string' && bound !== '' && bound !== key) return bound
        } catch (error) {
          /* fall back to the local dictionary */
        }
      }
      var dictionary = localDictionary()
      var text = dictionary[key]
      if (text === undefined) text = DICT_EN[key]
      if (text === undefined) return String(key)
      return formatTemplate(text, params)
    }

    function subscribeLocale(onChange) {
      var service = localeService
      if (!service || typeof service.subscribe !== 'function') return function () {}
      try {
        var dispose = service.subscribe(onChange)
        return typeof dispose === 'function' ? dispose : function () {}
      } catch (error) {
        return function () {}
      }
    }

    function readLocaleSnapshot() {
      var service = localeService
      if (!service || typeof service.getSnapshot !== 'function') return EMPTY_SNAPSHOT
      try {
        var snapshot = service.getSnapshot()
        return snapshot && typeof snapshot === 'object' ? snapshot : EMPTY_SNAPSHOT
      } catch (error) {
        return EMPTY_SNAPSHOT
      }
    }

    /** Re-render the component when the active locale changes. */
    function useLocaleVersion() {
      if (typeof React.useSyncExternalStore === 'function') {
        React.useSyncExternalStore(subscribeLocale, readLocaleSnapshot, readLocaleSnapshot)
        return
      }
      var pair = React.useState(0)
      var bump = pair[1]
      React.useEffect(function () {
        return subscribeLocale(function () {
          bump(function (value) {
            return value + 1
          })
        })
      }, [bump])
    }

    /** Prefer the translator the slots runtime hands down; fall back to our dictionary. */
    function useTranslator(props) {
      var socketTranslator = props && typeof props.t === 'function' ? props.t : null
      return React.useCallback(
        function (key, params) {
          if (socketTranslator) {
            try {
              var text = socketTranslator(key, params)
              if (typeof text === 'string' && text !== '' && text !== key) return text
            } catch (error) {
              /* fall through to the local dictionary */
            }
          }
          return translate(key, params)
        },
        [socketTranslator],
      )
    }

    /* ================================================================== *
     * 3. Wire: connection.rpc.call                                        *
     * ================================================================== */

    function operationError(code, message, details) {
      var error = new Error(message)
      error.code = code
      if (details !== undefined) error.details = details
      return error
    }

    function toError(value) {
      if (value instanceof Error) return value
      if (value && typeof value === 'object') {
        var message = typeof value.message === 'string' ? value.message : String(value)
        var error = new Error(message)
        if (value.code !== undefined) error.code = value.code
        if (value.details !== undefined) error.details = value.details
        return error
      }
      return new Error(String(value))
    }

    function messageOf(error) {
      var normalized = toError(error)
      return normalized && normalized.message ? normalized.message : String(normalized)
    }

    function issuesOf(error) {
      var details = error && error.details
      if (!details || !Array.isArray(details.issues)) return []
      var issues = []
      for (var index = 0; index < details.issues.length; index += 1) {
        var issue = details.issues[index]
        if (typeof issue === 'string') issues.push(issue)
        else if (issue && typeof issue.message === 'string') issues.push(issue.message)
        else if (issue && typeof issue.path === 'string') issues.push(issue.path)
      }
      return issues
    }

    /** Render a host failure as one inline sentence, including validation issues. */
    function describeError(t, error) {
      var message = messageOf(error)
      var issues = issuesOf(error)
      if (issues.length > 0) message = message + ': ' + issues.join('; ')
      return t('popover.error', { message: message })
    }

    /**
     * Heuristic: the host reports a non-empty worktree on `clean` with some error
     * code/message. Codes are not frozen by lib/constants.js, so match text too.
     */
    function isDirtyError(error) {
      var normalized = toError(error)
      var haystack = [String(normalized.code || ''), String(normalized.message || '')]
        .concat(issuesOf(normalized))
        .join(' ')
        .toLowerCase()
      if (!haystack.trim()) return false
      return /dirty|uncommitted|not clean|worktree-not-clean|has changes|changed files|modified files/.test(haystack)
    }

    /**
     * The host refuses to delete a checkout that is an active Session's working
     * directory (`worktree-in-use`); the only recovery is an explicit force retry.
     */
    function isWorktreeInUseError(error) {
      var normalized = toError(error)
      if (String(normalized.code || '') === 'worktree-in-use') return true
      var haystack = [String(normalized.code || ''), String(normalized.message || '')]
        .concat(issuesOf(normalized))
        .join(' ')
        .toLowerCase()
      return /worktree-in-use|in use by an active session|active session(s?) working directory/.test(haystack)
    }

    function readConnection(ctx) {
      if (!ctx) return null
      try {
        if (ctx.connection) return ctx.connection
      } catch (error) {
        /* fall through to `get` */
      }
      try {
        if (typeof ctx.get === 'function') return ctx.get('connection') || null
      } catch (error) {
        return null
      }
      return null
    }

    /**
     * Create the endpoint surface. Every call:
     *   rpc.call('/api', 'dsh-codex-style-worktree/<key>', payload, signal)
     * which is the wire form of `${API_PREFIX}/${key}` with `method` =
     * `'dsh-codex-style-worktree/<key>'`.
     */
    function createApi(ctx) {
      function invoke(key, payload, signal) {
        if (ENDPOINTS.indexOf(key) === -1) {
          return Promise.reject(operationError('unknown-endpoint', 'dsh-codex-style-worktree: unknown endpoint ' + key))
        }
        var connection = readConnection(ctx)
        var rpc = connection && connection.rpc
        if (!rpc || typeof rpc.call !== 'function') {
          return Promise.reject(operationError('connection-unavailable', 'dsh-codex-style-worktree: connection.rpc.call is unavailable'))
        }
        var method = RPC_NAMESPACE + '/' + key
        var pending
        try {
          pending = rpc.call(RPC_CHANNEL, method, payload, signal)
        } catch (error) {
          return Promise.reject(toError(error))
        }
        return Promise.resolve(pending).then(function (result) {
          return unwrapResult(key, result)
        })
      }

      return {
        endpoints: ENDPOINTS.slice(),
        status: function (sessionId, signal) {
          return invoke('status', { sessionId: sessionId }, signal)
        },
        clean: function (sessionId, options, signal) {
          var settings = options || {}
          return invoke(
            'clean',
            {
              sessionId: sessionId,
              force: settings.force === true,
              deleteBranch: settings.deleteBranch === true,
            },
            signal,
          )
        },
        list: function (workspacePath, signal) {
          var payload = {}
          if (typeof workspacePath === 'string' && workspacePath) payload.workspacePath = workspacePath
          return invoke('list', payload, signal)
        },
        /** Delete stale worktrees and their snapshots for one repo (or every repo). */
        prune: function (repoRoot, signal) {
          var payload = {}
          if (typeof repoRoot === 'string' && repoRoot) payload.repoRoot = repoRoot
          return invoke('prune', payload, signal)
        },
        /** Restore one recoverable snapshot by ref. Value: `{ref, path, commit, repoRoot}`. */
        restore: function (ref, signal) {
          return invoke('restore', { ref: ref }, signal)
        },

        /**
         * Read or write the sticky work location for one Workspace.
         * Read: `placement(workspacePath)`; write: `placement(workspacePath, mode)`.
         * Value: `{ workspacePath, mode, defaultMode, isGit }`.
         */
        placement: function (workspacePath, mode, signal) {
          var payload = { workspacePath: workspacePath }
          if (typeof mode === 'string' && mode) payload.mode = mode
          return invoke('placement', payload, signal)
        },
        /**
         * Read or write the plugin configuration through the host settings service.
         * `payload` is `{action:'get'}` / `{action:'set', patch, revision}` /
         * `{action:'reset', revision}`; the value is the settings form descriptor.
         */
        settings: function (payload, signal) {
          return invoke('settings', payload, signal)
        },
      }
    }

    function unwrapResult(key, result) {
      if (!result || typeof result !== 'object') {
        throw operationError('invalid-response', 'dsh-codex-style-worktree/' + key + ': invalid RPC response')
      }
      if (result.ok === true) return result.value
      var wireError = result.error && typeof result.error === 'object' ? result.error : {}
      throw operationError(
        wireError.code === undefined ? 'rpc-failed' : wireError.code,
        typeof wireError.message === 'string' && wireError.message ? wireError.message : 'dsh-codex-style-worktree/' + key + ' failed',
        wireError.details,
      )
    }

    /* ================================================================== *
     * 4. Shape normalization and formatting helpers                       *
     * ================================================================== */

    var EMPTY_STATUS = Object.freeze({
      managed: false,
      path: '',
      mode: '',
      branch: null,
      baseCommit: '',
      repoRoot: '',
      createdAt: null,
      dirty: null,
    })

    function normalizeStatus(value) {
      if (!value || typeof value !== 'object') return EMPTY_STATUS
      return {
        managed: value.managed === true,
        path: typeof value.path === 'string' ? value.path : '',
        mode: typeof value.mode === 'string' ? value.mode : '',
        branch: typeof value.branch === 'string' && value.branch ? value.branch : null,
        baseCommit: typeof value.baseCommit === 'string' ? value.baseCommit : '',
        repoRoot: typeof value.repoRoot === 'string' ? value.repoRoot : '',
        createdAt: value.createdAt === undefined ? null : value.createdAt,
        dirty: typeof value.dirty === 'number' && isFinite(value.dirty) ? value.dirty : null,
      }
    }

    function normalizeRecord(record, repoRootFallback) {
      if (!record || typeof record !== 'object') return null
      var dirty = null
      if (typeof record.dirty === 'number' && isFinite(record.dirty)) dirty = record.dirty
      else if (typeof record.changedFiles === 'number' && isFinite(record.changedFiles)) dirty = record.changedFiles
      return {
        raw: record,
        sessionId: sessionIdOfRecord(record),
        repoRoot: firstString(record.repoRoot, record.repoPath, record.repo, record.repository) || firstString(repoRootFallback),
        path: firstString(record.path, record.worktreePath, record.directory),
        mode: firstString(record.mode),
        branch: firstString(record.branch, record.branchName),
        baseCommit: firstString(record.baseCommit, record.base, record.commit),
        dirty: dirty,
        createdAt: record.createdAt !== undefined ? record.createdAt : record.created !== undefined ? record.created : record.time,
      }
    }

    /** One recoverable snapshot from the `list` envelope (old hosts send none). */
    function normalizeSnapshot(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') return null
      var ref = firstString(snapshot.ref)
      if (!ref) return null
      return {
        ref: ref,
        repoRoot: firstString(snapshot.repoRoot, snapshot.repo),
        commit: firstString(snapshot.commit, snapshot.baseCommit),
        sessionId: firstString(snapshot.sessionId),
        path: firstString(snapshot.path),
        createdAt: snapshot.createdAt !== undefined ? snapshot.createdAt : snapshot.created,
        restoredAt: snapshot.restoredAt !== undefined ? snapshot.restoredAt : null,
        restoredPath: firstString(snapshot.restoredPath),
      }
    }

    /** Ref tail for display; the `title` attribute keeps the full ref. */
    function shortSnapshotRef(ref) {
      var text = String(ref == null ? '' : ref)
      var segments = text.split('/').filter(function (segment) { return segment !== '' })
      var tail = segments.length > 0 ? segments[segments.length - 1] : text
      if (tail.length > 30) tail = tail.slice(0, 14) + '\u2026' + tail.slice(-10)
      return segments.length > 1 ? '\u2026/' + tail : tail
    }

    /** Snapshots recorded for one repository, in host order. */
    function snapshotsForRepo(snapshots, repoRoot) {
      var key = String(repoRoot == null ? '' : repoRoot).replace(/[\\/]+$/, '')
      var list = []
      if (!Array.isArray(snapshots)) return list
      for (var index = 0; index < snapshots.length; index += 1) {
        var snapshot = snapshots[index]
        if (!snapshot) continue
        var snapshotRoot = String(snapshot.repoRoot == null ? '' : snapshot.repoRoot).replace(/[\\/]+$/, '')
        if (snapshotRoot === key) list.push(snapshot)
      }
      return list
    }

    var EMPTY_CONFIG = Object.freeze({
      root: '',
      directory: '',
      mode: '',
      fetchBeforeCreate: false,
      autoPrune: false,
      autoPruneKeep: null,
    })

    function normalizeConfig(config) {
      if (!config || typeof config !== 'object') return EMPTY_CONFIG
      return {
        root: typeof config.root === 'string' ? config.root : '',
        directory: typeof config.directory === 'string' ? config.directory : '',
        mode: typeof config.mode === 'string' ? config.mode : '',
        fetchBeforeCreate: config.fetchBeforeCreate === true,
        autoPrune: config.autoPrune === true,
        autoPruneKeep: typeof config.autoPruneKeep === 'number' && isFinite(config.autoPruneKeep) ? config.autoPruneKeep : null,
      }
    }

    /**
     * Normalize the `list` envelope into repo groups. Both the extended shape
     * (`{repos:[{repoRoot,records}],config}`) and a flat `{records}` fallback are
     * accepted so the section degrades instead of blanking.
     */
    function normalizeList(value) {
      var config = normalizeConfig(value && value.config)
      var repos = []
      var byRepo = {}
      var rawRepos = value && Array.isArray(value.repos) ? value.repos : null
      if (rawRepos) {
        for (var groupIndex = 0; groupIndex < rawRepos.length; groupIndex += 1) {
          var group = rawRepos[groupIndex]
          if (!group || typeof group !== 'object') continue
          var repoRoot = firstString(group.repoRoot, group.repo, group.repoPath, group.path)
          var records = []
          var rawGroupRecords = Array.isArray(group.records) ? group.records : []
          for (var recordIndex = 0; recordIndex < rawGroupRecords.length; recordIndex += 1) {
            var normalized = normalizeRecord(rawGroupRecords[recordIndex], repoRoot)
            if (normalized) records.push(normalized)
          }
          pushRepo(repos, byRepo, repoRoot, records)
        }
        return { repos: repos, config: config, snapshots: normalizeSnapshots(value) }
      }
      var rawRecords = value && Array.isArray(value.records) ? value.records : Array.isArray(value) ? value : []
      for (var flatIndex = 0; flatIndex < rawRecords.length; flatIndex += 1) {
        var flat = normalizeRecord(rawRecords[flatIndex], '')
        if (!flat) continue
        var key = flat.repoRoot || ''
        if (!byRepo[key]) pushRepo(repos, byRepo, key, [])
        byRepo[key].records.push(flat)
      }
      return { repos: repos, config: config, snapshots: normalizeSnapshots(value) }
    }

    function normalizeSnapshots(value) {
      var raw = value && Array.isArray(value.snapshots) ? value.snapshots : []
      var snapshots = []
      for (var index = 0; index < raw.length; index += 1) {
        var snapshot = normalizeSnapshot(raw[index])
        if (snapshot) snapshots.push(snapshot)
      }
      return snapshots
    }

    function pushRepo(repos, byRepo, repoRoot, records) {
      var key = firstString(repoRoot)
      var existing = byRepo[key]
      if (existing) {
        for (var index = 0; index < records.length; index += 1) existing.records.push(records[index])
        return
      }
      var group = { repoRoot: key, records: records }
      byRepo[key] = group
      repos.push(group)
    }

    function countRecords(repos) {
      var total = 0
      for (var index = 0; index < repos.length; index += 1) {
        total += repos[index].records ? repos[index].records.length : 0
      }
      return total
    }

    function firstString() {
      for (var index = 0; index < arguments.length; index += 1) {
        var candidate = arguments[index]
        if (typeof candidate === 'string' && candidate) return candidate
      }
      return ''
    }

    function sessionIdOfRecord(record) {
      if (!record || typeof record !== 'object') return ''
      var direct = record.sessionId
      if (typeof direct === 'string' && direct) return direct
      if (typeof record.session === 'string' && record.session) return record.session
      if (record.session && typeof record.session === 'object') {
        if (typeof record.session.sessionId === 'string' && record.session.sessionId) return record.session.sessionId
        if (typeof record.session.id === 'string' && record.session.id) return record.session.id
      }
      return firstString(record.id, record.key)
    }

    /* ================================================================== *
     * 4b. Workspace / Session controllers (resolved lazily)               *
     * ================================================================== */

    /** Cordis services are reachable through `get` even without a declared dependency. */
    function readService(ctx, name) {
      if (!ctx) return null
      try {
        if (typeof ctx.get === 'function') {
          var service = ctx.get(name)
          if (service) return service
        }
      } catch (error) {
        /* fall through to the property */
      }
      try {
        return ctx[name] || null
      } catch (error) {
        return null
      }
    }

    /**
     * Open a Session. DSH 1.7 navigates through the Workspace controller; older
     * builds expose `sessions.open`.
     */
    function openSessionById(ctx, sessionId) {
      if (!sessionId) throw operationError('session-unavailable', 'no Session id to open')
      var uiWorkspace = readService(ctx, 'uiWorkspace')
      if (uiWorkspace && typeof uiWorkspace.openSession === 'function') {
        uiWorkspace.openSession(sessionId)
        return
      }
      var sessions = readService(ctx, 'sessions')
      if (sessions && typeof sessions.open === 'function') {
        sessions.open(sessionId)
        return
      }
      throw operationError('navigation-unavailable', 'this Client exposes no Session navigation method')
    }

    function sessionSummaries(sessions) {
      if (!sessions || !sessions.list || typeof sessions.list.getSnapshot !== 'function') return []
      try {
        var snapshot = sessions.list.getSnapshot()
        if (!snapshot) return []
        if (Array.isArray(snapshot.items)) return snapshot.items
        if (Array.isArray(snapshot.ids)) {
          var fromIds = []
          for (var index = 0; index < snapshot.ids.length; index += 1) {
            var id = snapshot.ids[index]
            var summary = snapshot.byId ? snapshot.byId[id] : null
            fromIds.push(summary && typeof summary === 'object' ? Object.assign({ id: id }, summary) : { id: id })
          }
          return fromIds
        }
        if (snapshot.byId && typeof snapshot.byId === 'object') {
          return Object.keys(snapshot.byId).map(function (id) {
            var summary = snapshot.byId[id]
            return summary && typeof summary === 'object' ? Object.assign({ id: id }, summary) : { id: id }
          })
        }
      } catch (error) {
        return []
      }
      return []
    }

    /** Title for a Session id, falling back to its first 8 characters. */
    function sessionTitle(ctx, sessionId) {
      var sessions = readService(ctx, 'sessions')
      var summaries = sessionSummaries(sessions)
      for (var index = 0; index < summaries.length; index += 1) {
        var summary = summaries[index]
        if (!summary) continue
        var id = firstString(summary.id, summary.sessionId)
        if (id !== sessionId) continue
        return firstString(summary.displayTitle, summary.title, summary.name) || shortId(sessionId)
      }
      return shortId(sessionId)
    }

    function shortId(sessionId) {
      var text = String(sessionId == null ? '' : sessionId)
      return text.length > 8 ? text.slice(0, 8) : text
    }

    function baseName(path) {
      var text = String(path == null ? '' : path).replace(/[\\/]+$/, '')
      var index = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
      return index >= 0 ? text.slice(index + 1) : text
    }

    function shortCommit(commit) {
      var text = String(commit == null ? '' : commit)
      return text.length > 8 ? text.slice(0, 8) : text
    }

    function formatDate(value, language) {
      if (value === null || value === undefined || value === '') return ''
      var date
      if (typeof value === 'number') {
        var milliseconds = value < 100000000000 ? value * 1000 : value
        date = new Date(milliseconds)
      } else if (typeof value === 'string') {
        date = new Date(value)
      } else {
        return ''
      }
      if (!date || isNaN(date.getTime())) return typeof value === 'string' ? value : ''
      try {
        return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(date)
      } catch (error) {
        try {
          return date.toISOString().replace('T', ' ').slice(0, 16)
        } catch (nested) {
          return ''
        }
      }
    }

    function readSessionId(props) {
      if (!props || typeof props !== 'object') return ''
      var direct = props.sessionId
      if (typeof direct === 'string' && direct) return direct
      if (direct && typeof direct === 'object') {
        if (typeof direct.id === 'string' && direct.id) return direct.id
      }
      var session = props.session
      if (session && typeof session === 'object') {
        if (typeof session.sessionId === 'string' && session.sessionId) return session.sessionId
        if (typeof session.id === 'string' && session.id) return session.id
      }
      return ''
    }

    /* ================================================================== *
     * 4c. Session projection store — event-driven, no polling             *
     * ================================================================== */

    var PROJECTION_STEPS = ['prepare', 'checkout', 'finalize']

    function normalizeProjection(value) {
      if (!value || typeof value !== 'object') return null
      var phase = value.phase === 'creating' || value.phase === 'ready' || value.phase === 'error' ? value.phase : null
      if (!phase) return null
      return {
        phase: phase,
        step: typeof value.step === 'string' && PROJECTION_STEPS.indexOf(value.step) !== -1 ? value.step : null,
        path: typeof value.path === 'string' && value.path ? value.path : null,
        repoRoot: typeof value.repoRoot === 'string' ? value.repoRoot : '',
        workspaceRoot: typeof value.workspaceRoot === 'string' ? value.workspaceRoot : '',
        mode: typeof value.mode === 'string' ? value.mode : '',
        branch: typeof value.branch === 'string' && value.branch ? value.branch : null,
        baseCommit: typeof value.baseCommit === 'string' && value.baseCommit ? value.baseCommit : null,
        error: typeof value.error === 'string' && value.error ? value.error : null,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
      }
    }

    function sameProjection(left, right) {
      if (left === right) return true
      if (!left || !right) return false
      return (
        left.phase === right.phase &&
        left.step === right.step &&
        left.path === right.path &&
        left.repoRoot === right.repoRoot &&
        left.workspaceRoot === right.workspaceRoot &&
        left.mode === right.mode &&
        left.branch === right.branch &&
        left.baseCommit === right.baseCommit &&
        left.error === right.error &&
        left.updatedAt === right.updatedAt
      )
    }

    var sessionsService = null
    var projectionValues = {}
    var projectionListeners = []
    var projectionVersion = 0

    function sessionListSnapshot() {
      if (!sessionsService || !sessionsService.list || typeof sessionsService.list.getSnapshot !== 'function') return null
      try {
        return sessionsService.list.getSnapshot()
      } catch (error) {
        return null
      }
    }

    function readProjection(sessionId) {
      if (!sessionId) return null
      return Object.prototype.hasOwnProperty.call(projectionValues, sessionId) ? projectionValues[sessionId] : null
    }

    /** Rebuild the per-Session projection map, reusing references for unchanged values. */
    function refreshProjectionStore() {
      var snapshot = sessionListSnapshot()
      if (!snapshot) return
      var byId = snapshot.byId && typeof snapshot.byId === 'object' ? snapshot.byId : null
      var next = {}
      var changed = false
      if (byId) {
        for (var sessionId in byId) {
          if (!Object.prototype.hasOwnProperty.call(byId, sessionId)) continue
          var summary = byId[sessionId]
          var values = summary && typeof summary === 'object' && summary.projectionValues && typeof summary.projectionValues === 'object' ? summary.projectionValues : null
          var nextValue = normalizeProjection(values ? values.codexWorktree : null)
          var had = Object.prototype.hasOwnProperty.call(projectionValues, sessionId)
          if (had && sameProjection(projectionValues[sessionId], nextValue)) {
            next[sessionId] = projectionValues[sessionId]
          } else {
            next[sessionId] = nextValue
            changed = true
          }
        }
      }
      for (var previousId in projectionValues) {
        if (!Object.prototype.hasOwnProperty.call(next, previousId)) changed = true
      }
      if (!changed) return
      projectionValues = next
      projectionVersion += 1
      var listeners = projectionListeners.slice()
      for (var index = 0; index < listeners.length; index += 1) {
        try {
          listeners[index](projectionVersion)
        } catch (error) {
          /* a subscriber must never break the store */
        }
      }
    }

    function installProjectionStore(ctx) {
      var sessions = readService(ctx, 'sessions')
      sessionsService = sessions || null
      refreshProjectionStore()
      if (!sessionsService || !sessionsService.list || typeof sessionsService.list.subscribe !== 'function') {
        return function () {
          sessionsService = null
          projectionValues = {}
        }
      }
      var unsubscribe = sessionsService.list.subscribe(function () {
        refreshProjectionStore()
      })
      return function () {
        try {
          unsubscribe()
        } catch (error) {
          /* the service may already be disposed */
        }
        sessionsService = null
        projectionValues = {}
        projectionVersion += 1
      }
    }

    /** Re-render when the projection of `sessionId` changes; values stay reference-stable. */
    function useProjectionValue(sessionId) {
      var pair = React.useState(function () {
        return readProjection(sessionId)
      })
      var setValue = pair[1]
      React.useEffect(
        function () {
          function sync() {
            setValue(function (previous) {
              var next = readProjection(sessionId)
              return next === previous ? previous : next
            })
          }
          sync()
          projectionListeners.push(sync)
          return function () {
            var index = projectionListeners.indexOf(sync)
            if (index !== -1) projectionListeners.splice(index, 1)
          }
        },
        [sessionId],
      )
      return pair[0]
    }

    /* ================================================================== *
     * 4d. Placement store — sticky per Workspace                          *
     * ================================================================== */

    var PLACEMENT_WORKTREE = 'worktree'
    var PLACEMENT_LOCAL = 'local'

    function normalizePlacement(value) {
      if (!value || typeof value !== 'object') return null
      return {
        workspacePath: typeof value.workspacePath === 'string' ? value.workspacePath : '',
        mode: value.mode === PLACEMENT_LOCAL ? PLACEMENT_LOCAL : PLACEMENT_WORKTREE,
        defaultMode: value.defaultMode === PLACEMENT_LOCAL ? PLACEMENT_LOCAL : PLACEMENT_WORKTREE,
        isGit: value.isGit !== false,
      }
    }

    var placementCache = {}

    function placementKey(path) {
      return String(path == null ? '' : path).replace(/[\\/]+$/, '')
    }

    function readCachedPlacement(path) {
      var key = placementKey(path)
      return key && Object.prototype.hasOwnProperty.call(placementCache, key) ? placementCache[key] : null
    }

    function writeCachedPlacement(path, value) {
      var key = placementKey(path)
      if (!key) return
      if (value) placementCache[key] = value
      else delete placementCache[key]
    }

    /** Stable selector for one Session summary; the returned reference is snapshot-owned. */
    function selectSessionSummary(sessionId) {
      return function (state) {
        return sessionId && state && state.byId ? state.byId[sessionId] : undefined
      }
    }

    function findWorkspaceForSession(sessionId, state) {
      if (!sessionId || !state || !Array.isArray(state.items)) return undefined
      for (var index = 0; index < state.items.length; index += 1) {
        var workspace = state.items[index]
        if (!workspace || !Array.isArray(workspace.sessionIds)) continue
        if (workspace.sessionIds.indexOf(sessionId) !== -1) return workspace
      }
      return undefined
    }

    function sessionSummaryFromService(ctx, sessionId) {
      var sessions = readService(ctx, 'sessions')
      if (!sessions || !sessions.list || typeof sessions.list.getSnapshot !== 'function') return undefined
      try {
        var snapshot = sessions.list.getSnapshot()
        return snapshot && snapshot.byId ? snapshot.byId[sessionId] : undefined
      } catch (error) {
        return undefined
      }
    }

    function workspaceFromService(ctx, sessionId) {
      var workspaces = readService(ctx, 'workspaces')
      if (!workspaces || !workspaces.list || typeof workspaces.list.getSnapshot !== 'function') return undefined
      try {
        return findWorkspaceForSession(sessionId, workspaces.list.getSnapshot())
      } catch (error) {
        return undefined
      }
    }

    /**
     * Resolve the hero Session's work-location context. The checkout path comes from
     * the Session cwd first (authoritative once the host has switched it) and from
     * the Session's Workspace membership second. Only blank Sessions — the hero —
     * render the work-location selector.
     */
    function useHeroSessionInfo(props) {
      var sessionId = readSessionId(props)
      var useSessionsHook = props && typeof props.useSessions === 'function' ? props.useSessions : null
      var useWorkspacesHook = props && typeof props.useWorkspaces === 'function' ? props.useWorkspaces : null
      var summary = useSessionsHook
        ? useSessionsHook(selectSessionSummary(sessionId))
        : sessionSummaryFromService(props && props.ctx, sessionId)
      var workspace = useWorkspacesHook
        ? useWorkspacesHook(function (state) {
            return findWorkspaceForSession(sessionId, state)
          })
        : workspaceFromService(props && props.ctx, sessionId)
      var cwd = summary && typeof summary.cwd === 'string' ? summary.cwd : ''
      var workspacePath = workspace && typeof workspace.path === 'string' ? workspace.path : ''
      return {
        sessionId: sessionId,
        blank: !!(summary && summary.blank === true),
        path: cwd || workspacePath,
      }
    }

    /**
     * Read the sticky placement for `workspacePath` (one GET per path) and expose a
     * writer that updates optimistically, rolls back on failure and shows a note.
     */
    function usePlacementValue(workspacePath, apiRef) {
      var pair = React.useState({ phase: 'idle', value: null, note: '', busy: false })
      var state = pair[0]
      var setState = pair[1]
      var timerRef = React.useRef(null)

      function clearNote() {
        if (timerRef.current && typeof clearTimeout === 'function') {
          try {
            clearTimeout(timerRef.current)
          } catch (error) {
            /* already fired */
          }
          timerRef.current = null
        }
      }

      function showNote(note) {
        clearNote()
        setState(function (previous) {
          return { phase: previous.phase, value: previous.value, note: note, busy: previous.busy }
        })
        if (typeof setTimeout === 'function') {
          timerRef.current = setTimeout(function () {
            timerRef.current = null
            setState(function (previous) {
              return { phase: previous.phase, value: previous.value, note: '', busy: previous.busy }
            })
          }, 6000)
        }
      }

      React.useEffect(
        function () {
          var key = placementKey(workspacePath)
          if (!key) {
            setState({ phase: 'idle', value: null, note: '', busy: false })
            return undefined
          }
          var cached = readCachedPlacement(key)
          setState({ phase: cached ? 'ready' : 'loading', value: cached, note: '', busy: false })
          var api = apiRef.current
          if (!api || typeof api.placement !== 'function') {
            setState({ phase: 'error', value: cached, note: '', busy: false })
            return undefined
          }
          var alive = true
          var controller = typeof AbortController === 'function' ? new AbortController() : null
          var pending
          try {
            pending = api.placement(key, undefined, controller ? controller.signal : undefined)
          } catch (error) {
            pending = Promise.reject(error)
          }
          Promise.resolve(pending).then(
            function (value) {
              if (!alive) return
              var normalized = normalizePlacement(value)
              writeCachedPlacement(key, normalized)
              setState({ phase: 'ready', value: normalized, note: '', busy: false })
            },
            function (error) {
              if (!alive) return
              if (controller && controller.signal && controller.signal.aborted) return
              setState({ phase: 'error', value: cached, note: '', busy: false })
            },
          )
          return function () {
            alive = false
            if (controller) {
              try {
                controller.abort()
              } catch (error) {
                /* already aborted */
              }
            }
          }
        },
        [workspacePath, apiRef],
      )

      React.useEffect(
        function () {
          return function () {
            clearNote()
          }
        },
        [],
      )

      function write(mode) {
        var key = placementKey(workspacePath)
        var api = apiRef.current
        if (!key || !api || typeof api.placement !== 'function') {
          showNote(translate('placement.failed'))
          return Promise.resolve(false)
        }
        var previous = state.value
        var optimistic = {
          workspacePath: key,
          mode: mode,
          defaultMode: previous ? previous.defaultMode : PLACEMENT_WORKTREE,
          isGit: previous ? previous.isGit : true,
        }
        writeCachedPlacement(key, optimistic)
        setState({ phase: 'ready', value: optimistic, note: '', busy: true })
        var pending
        try {
          pending = api.placement(key, mode, undefined)
        } catch (error) {
          pending = Promise.reject(error)
        }
        return Promise.resolve(pending).then(
          function (value) {
            var normalized = normalizePlacement(value) || optimistic
            writeCachedPlacement(key, normalized)
            setState({ phase: 'ready', value: normalized, note: '', busy: false })
            return true
          },
          function (error) {
            writeCachedPlacement(key, previous)
            setState({ phase: previous ? 'ready' : 'error', value: previous, note: '', busy: false })
            showNote(translate('placement.failed'))
            return false
          },
        )
      }

      return { state: state, write: write }
    }

    /* ================================================================== *
     * 5. Small reusable hooks                                             *
     * ================================================================== */

    function useStableRef(value) {
      var ref = React.useRef(value)
      ref.current = value
      return ref
    }

    /** Close a popover on outside pointer-down or Escape; listeners are removed on unmount. */
    function useDismiss(open, close, containerRef) {
      React.useEffect(
        function () {
          if (!open) return undefined
          if (typeof document === 'undefined' || !document.addEventListener) return undefined
          function onPointerDown(event) {
            var container = containerRef.current
            var target = event && event.target
            if (container && target && typeof container.contains === 'function' && container.contains(target)) return
            close()
          }
          function onKeyDown(event) {
            if (event && event.key === 'Escape') close()
          }
          document.addEventListener('pointerdown', onPointerDown, true)
          document.addEventListener('keydown', onKeyDown, true)
          return function () {
            document.removeEventListener('pointerdown', onPointerDown, true)
            document.removeEventListener('keydown', onKeyDown, true)
          }
        },
        [open, close, containerRef],
      )
    }

    /** Read the `list` endpoint; refresh through the returned revision bump. */
    function useWorktreeList(apiRef) {
      var pair = React.useState({ phase: 'loading', repos: [], snapshots: [], config: EMPTY_CONFIG, error: null })
      var state = pair[0]
      var setState = pair[1]
      var revisionPair = React.useState(0)
      var revision = revisionPair[0]
      var bump = revisionPair[1]
      React.useEffect(
        function () {
          var api = apiRef.current
          var alive = true
          var controller = typeof AbortController === 'function' ? new AbortController() : null
          setState(function (previous) {
            return {
              phase: previous && previous.repos && previous.repos.length > 0 ? 'refreshing' : 'loading',
              repos: previous ? previous.repos : [],
              snapshots: previous && previous.snapshots ? previous.snapshots : [],
              config: previous ? previous.config : EMPTY_CONFIG,
              error: null,
            }
          })
          var pending
          try {
            if (!api || typeof api.list !== 'function') {
              throw operationError('connection-unavailable', 'dsh-codex-style-worktree: connection.rpc.call is unavailable')
            }
            pending = api.list(undefined, controller ? controller.signal : undefined)
          } catch (error) {
            pending = Promise.reject(error)
          }
          Promise.resolve(pending).then(
            function (value) {
              if (!alive) return
              var normalized = normalizeList(value)
              setState({ phase: 'ready', repos: normalized.repos, snapshots: normalized.snapshots, config: normalized.config, error: null })
            },
            function (error) {
              if (!alive) return
              if (controller && controller.signal && controller.signal.aborted) return
              setState({ phase: 'error', repos: [], snapshots: [], config: EMPTY_CONFIG, error: toError(error) })
            },
          )
          return function () {
            alive = false
            if (controller) {
              try {
                controller.abort()
              } catch (error) {
                /* already aborted */
              }
            }
          }
        },
        [revision, apiRef, setState],
      )
      return {
        state: state,
        refresh: React.useCallback(function () {
          bump(function (value) {
            return value + 1
          })
        }, [bump]),
      }
    }

    /* ================================================================== *
     * 6. Styles                                                           *
     * ================================================================== */

    var STYLE_TEXT = [
      '@layer dsh-codex-style-worktree {',
      '  .daw-chip-wrap, .daw-popover, .daw-settings, .daw-placement, .daw-progress {',
      '    --daw-text: var(--dsw-alias-label-primary);',
      '    --daw-secondary: var(--dsw-alias-label-secondary);',
      '    --daw-muted: var(--dsw-alias-label-tertiary);',
      '    --daw-line: var(--dsw-alias-border-l2);',
      '    --daw-surface: var(--dsw-alias-bg-layer-1);',
      '    --daw-raised: var(--dsw-alias-bg-layer-2, var(--dsw-specific-menu));',
      '    --daw-soft: var(--dsw-alias-bg-module-platform);',
      '    --daw-hover: var(--dsw-alias-interactive-bg-hover);',
      '    --daw-danger: var(--dsw-alias-state-error-primary);',
      '    --daw-danger-soft: var(--dsw-alias-interactive-bg-hover-danger);',
      '    --daw-success: var(--dsw-alias-state-success-primary);',
      '    --daw-brand: var(--dsw-alias-brand-primary);',
      '    box-sizing: border-box;',
      '    color: var(--daw-text);',
      '    font-family: inherit;',
      '    font-size: 13px;',
      '    line-height: 20px;',
      '  }',
      '  .daw-chip-wrap *, .daw-popover *, .daw-settings *, .daw-placement *, .daw-progress * { box-sizing: border-box; }',
      '  .daw-chip-wrap { position: relative; display: inline-flex; align-items: center; }',
      '  .daw-chip { display: inline-flex; align-items: center; gap: 6px; height: 26px; max-width: 220px; padding: 0 10px; border: 1px solid var(--daw-line); border-radius: 999px; background: transparent; color: inherit; font: inherit; font-size: 12px; line-height: 1; white-space: nowrap; cursor: pointer; transition: background .14s ease, border-color .14s ease, color .14s ease; }',
      '  .daw-chip:hover { background: var(--daw-hover); }',
      '  .daw-chip:focus-visible { outline: 2px solid var(--daw-brand); outline-offset: 2px; }',
      '  .daw-chip-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }',
      '  .daw-chip-label { overflow: hidden; text-overflow: ellipsis; }',
      '  .daw-chip-managed { border-color: color-mix(in srgb, var(--daw-brand) 35%, var(--daw-line)); background: var(--daw-soft); }',
      '  .daw-chip-managed .daw-chip-dot { background: var(--daw-brand); }',
      '  .daw-chip-idle { border-style: dashed; color: var(--daw-secondary); }',
      '  .daw-chip-idle .daw-chip-dot { background: var(--daw-muted); }',
      '  .daw-chip-loading { color: var(--daw-secondary); }',
      '  .daw-chip-loading .daw-chip-dot { animation: daw-pulse 1.1s ease-in-out infinite; }',
      '  .daw-chip-error { border-color: color-mix(in srgb, var(--daw-danger) 40%, var(--daw-line)); color: var(--daw-danger); }',
      '  .daw-chip-error .daw-chip-dot { background: var(--daw-danger); }',
      '  .daw-chip-dirty { flex: none; padding: 0 5px; border-radius: 999px; background: var(--daw-danger-soft); color: var(--daw-danger); font-size: 11px; line-height: 16px; }',
      '  .daw-popover { position: absolute; top: calc(100% + 8px); right: 0; z-index: 80; width: min(340px, calc(100vw - 24px)); max-height: min(540px, calc(100vh - 96px)); overflow: auto; padding: 12px; border: 1px solid var(--daw-line); border-radius: 12px; background: var(--daw-raised); box-shadow: var(--dsw-elevation-prominent, var(--dsw-shadow-lv3)); }',
      '  .daw-popover-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }',
      '  .daw-popover-title { font-size: 13px; font-weight: 500; }',
      '  .daw-badge { flex: none; padding: 1px 7px; border: 1px solid var(--daw-line); border-radius: 999px; color: var(--daw-secondary); font-size: 11px; line-height: 16px; white-space: nowrap; }',
      '  .daw-badge-managed { border-color: color-mix(in srgb, var(--daw-brand) 35%, var(--daw-line)); color: var(--daw-brand); }',
      '  .daw-badge-warn { border-color: color-mix(in srgb, var(--daw-danger) 40%, var(--daw-line)); color: var(--daw-danger); }',
      '  .daw-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 10px; margin: 0; }',
      '  .daw-fact-label { color: var(--daw-muted); font-size: 12px; }',
      '  .daw-fact-value { min-width: 0; font-size: 12px; overflow-wrap: anywhere; }',
      '  .daw-code { display: inline-block; max-width: 100%; padding: 1px 5px; border-radius: 5px; background: var(--daw-soft); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; overflow-wrap: anywhere; }',
      '  .daw-block { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--daw-line); }',
      '  .daw-field { display: flex; gap: 6px; }',
      '  .daw-input { flex: 1; min-width: 0; height: 30px; padding: 0 8px; border: 1px solid var(--daw-line); border-radius: 8px; background: var(--daw-surface); color: var(--daw-text); font: inherit; font-size: 12px; outline: none; }',
      '  .daw-input::placeholder { color: var(--daw-muted); }',
      '  .daw-input:focus-visible { border-color: var(--daw-brand); box-shadow: 0 0 0 2px color-mix(in srgb, var(--daw-brand) 12%, transparent); }',
      '  .daw-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }',
      '  .daw-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; padding: 0 10px; border: 1px solid var(--daw-line); border-radius: 8px; background: transparent; color: var(--daw-text); font: inherit; font-size: 12px; line-height: 1; cursor: pointer; transition: background .14s ease, color .14s ease, border-color .14s ease; }',
      '  .daw-button:hover:not(:disabled) { background: var(--daw-hover); }',
      '  .daw-button:disabled { opacity: .45; cursor: not-allowed; }',
      '  .daw-button:focus-visible { outline: 2px solid var(--daw-brand); outline-offset: 2px; }',
      '  .daw-button-primary { border-color: transparent; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }',
      '  .daw-button-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }',
      '  .daw-button-danger { border-color: transparent; background: var(--daw-danger); color: var(--dsw-static-neutral-00, #ffffff); }',
      '  .daw-button-danger:hover:not(:disabled) { background: var(--dsw-alias-state-error-secondary, var(--daw-danger)); }',
      '  .daw-button-ghost { border-color: transparent; color: var(--daw-secondary); }',
      '  .daw-note { margin: 8px 0 0; color: var(--daw-secondary); font-size: 12px; line-height: 18px; }',
      '  .daw-error { display: flex; align-items: flex-start; gap: 6px; margin-top: 8px; padding: 7px 8px; border-radius: 8px; background: var(--daw-danger-soft); color: var(--daw-danger); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }',
      '  .daw-notice { margin-top: 8px; padding: 7px 8px; border-radius: 8px; background: var(--daw-soft); color: var(--daw-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }',
      '  .daw-confirm { margin-top: 8px; padding: 8px; border: 1px solid var(--daw-line); border-radius: 8px; background: var(--daw-surface); }',
      '  .daw-check { display: flex; align-items: center; gap: 6px; margin-top: 6px; color: var(--daw-secondary); font-size: 12px; }',
      '  .daw-spin { display: inline-block; width: 12px; height: 12px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: daw-spin .9s linear infinite; }',
      '  @keyframes daw-spin { to { transform: rotate(360deg); } }',
      '  @keyframes daw-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }',
      '  @media (prefers-reduced-motion: reduce) { .daw-spin, .daw-chip-loading .daw-chip-dot { animation: none; } }',
      '  .daw-settings { min-width: 0; padding: 2px 0 16px; }',
      '  .daw-settings h2, .daw-settings h3, .daw-settings p, .daw-settings dl, .daw-settings dd, .daw-settings dt { margin: 0; }',
      '  .daw-settings-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; }',
      '  .daw-settings-title { font-size: 16px; font-weight: 500; line-height: 24px; }',
      '  .daw-settings-subtitle { margin-top: 4px; color: var(--daw-secondary); font-size: 13px; line-height: 20px; }',
      '  .daw-toolbar { display: flex; align-items: center; gap: 8px; }',
      '  .daw-meta { color: var(--daw-muted); font-size: 12px; }',
      '  .daw-config { margin-bottom: 18px; padding: 12px; border: 1px solid var(--daw-line); border-radius: 12px; background: var(--daw-soft); }',
      '  .daw-config-title { margin-bottom: 10px; font-size: 13px; font-weight: 500; }',
      '  .daw-config-grid { display: grid; grid-template-columns: minmax(140px, max-content) minmax(0, 1fr); gap: 6px 14px; margin: 0; }',
      '  .daw-groups { display: flex; flex-direction: column; gap: 14px; margin-top: 12px; }',
      '  .daw-repo { border: 1px solid var(--daw-line); border-radius: 12px; background: var(--daw-surface); overflow: hidden; }',
      '  .daw-repo-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-bottom: 1px solid transparent; background: var(--daw-soft); }',
      '  .daw-repo-toggle { display: flex; min-width: 0; flex: 1; align-items: center; gap: 8px; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }',
      '  .daw-repo-toggle:focus-visible, .daw-link:focus-visible, .daw-icon-button:focus-visible { outline: 2px solid var(--daw-brand); outline-offset: 2px; }',
      '  .daw-repo-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '  .daw-chevron { flex: none; color: var(--daw-muted); transition: transform .14s ease; }',
      '  .daw-chevron-open { transform: rotate(90deg); }',
      '  .daw-icon-button { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--daw-secondary); cursor: pointer; }',
      '  .daw-icon-button:hover:not(:disabled) { background: var(--daw-hover); color: var(--daw-text); }',
      '  .daw-icon-button:disabled { opacity: .45; cursor: not-allowed; }',
      '  .daw-wt-list { display: flex; flex-direction: column; }',
      '  .daw-wt { display: flex; align-items: flex-start; gap: 12px; padding: 10px 12px; border-top: 1px solid var(--daw-line); }',
      '  .daw-wt-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }',
      '  .daw-wt-path { align-self: flex-start; }',
      '  .daw-wt-facts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; color: var(--daw-secondary); font-size: 12px; }',
      '  .daw-wt-actions { flex: none; display: flex; align-items: center; gap: 6px; }',
      '  .daw-badge-dashed { border-style: dashed; color: var(--daw-muted); }',
      '  .daw-badge-ok { border-color: color-mix(in srgb, var(--daw-success) 40%, var(--daw-line)); color: var(--daw-success); }',
      '  .daw-conversations { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }',
      '  .daw-link { max-width: 100%; padding: 0; border: 0; background: transparent; color: var(--daw-brand); font: inherit; font-size: 12px; text-align: left; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; overflow-wrap: anywhere; }',
      '  .daw-snapshots { padding: 8px 12px 10px; border-top: 1px dashed var(--daw-line); background: var(--daw-soft); }',
      '  .daw-snapshots-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }',
      '  .daw-snapshots-title { margin: 0; color: var(--daw-secondary); font-size: 12px; font-weight: 500; }',
      '  .daw-snapshot { display: flex; align-items: flex-start; gap: 10px; padding: 6px 0; border-top: 1px solid var(--daw-line); }',
      '  .daw-snapshot:first-of-type { border-top: 0; }',
      '  .daw-snapshot-main { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }',
      '  .daw-snapshot-sha { color: var(--daw-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }',
      '  .daw-empty { margin-top: 16px; padding: 20px; border: 1px dashed var(--daw-line); border-radius: 12px; text-align: center; color: var(--daw-secondary); }',
      '  .daw-empty-hint { margin-top: 4px; color: var(--daw-muted); font-size: 12px; line-height: 18px; }',
      '  .daw-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }',
      '  .daw-placement { position: relative; display: inline-flex; align-items: center; gap: 6px; }',
      '  .daw-placement-pill { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid var(--daw-line); border-radius: 999px; background: transparent; color: var(--daw-secondary); font: inherit; font-size: 12px; line-height: 1; white-space: nowrap; cursor: pointer; transition: background .14s ease, border-color .14s ease, color .14s ease; }',
      '  .daw-placement-pill:hover:not(:disabled) { background: var(--daw-hover); color: var(--daw-text); }',
      '  .daw-placement-pill:focus-visible { outline: 2px solid var(--daw-brand); outline-offset: 2px; }',
      '  .daw-placement-pill:disabled { opacity: .55; cursor: default; }',
      '  .daw-placement-pill-is-local { border-style: dashed; }',
      '  .daw-placement-chevron { flex: none; color: var(--daw-muted); }',
      '  .daw-placement-note { color: var(--daw-danger); font-size: 12px; line-height: 18px; }',
      '  .daw-placement-menu { position: absolute; top: calc(100% + 6px); left: 0; z-index: 90; width: min(300px, calc(100vw - 24px)); padding: 6px; border: 1px solid var(--daw-line); border-radius: 12px; background: var(--daw-raised); box-shadow: var(--dsw-elevation-prominent, var(--dsw-shadow-lv3)); }',
      '  .daw-placement-option { display: flex; width: 100%; align-items: flex-start; gap: 8px; padding: 7px 8px; border: 0; border-radius: 8px; background: transparent; color: var(--daw-text); font: inherit; font-size: 13px; line-height: 18px; text-align: left; cursor: pointer; }',
      '  .daw-placement-option:hover { background: var(--daw-hover); }',
      '  .daw-placement-option:focus-visible { outline: 2px solid var(--daw-brand); outline-offset: 2px; }',
      '  .daw-placement-check { flex: none; width: 14px; color: var(--daw-brand); }',
      '  .daw-placement-option-text { min-width: 0; display: flex; flex-direction: column; gap: 1px; }',
      '  .daw-placement-option-label { font-weight: 500; }',
      '  .daw-placement-hint { margin: 4px 8px 2px; color: var(--daw-muted); font-size: 12px; line-height: 18px; }',
      '  .daw-progress { display: flex; flex-direction: column; gap: 6px; margin: 0 0 8px; padding: 10px 12px; border: 1px solid var(--daw-line); border-radius: 12px; background: var(--daw-surface); transition: opacity .4s ease; }',
      '  .daw-progress-fade { opacity: 0; }',
      '  .daw-progress-head { display: flex; align-items: center; gap: 6px; color: var(--daw-text); font-size: 13px; font-weight: 500; line-height: 20px; }',
      '  .daw-progress-title-icon { flex: none; color: var(--daw-brand); }',
      '  .daw-progress-steps { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }',
      '  .daw-progress-step { display: flex; align-items: center; gap: 8px; color: var(--daw-secondary); font-size: 12px; line-height: 20px; }',
      '  .daw-progress-step-done { color: var(--daw-secondary); }',
      '  .daw-progress-step-current { color: var(--daw-text); }',
      '  .daw-progress-step-pending { color: var(--daw-muted); }',
      '  .daw-progress-mark { flex: none; display: inline-flex; width: 14px; height: 14px; align-items: center; justify-content: center; font-size: 12px; line-height: 14px; }',
      '  .daw-progress-mark-done { color: var(--daw-success); }',
      '  .daw-progress-mark-current { color: var(--daw-brand); }',
      '  .daw-progress-mark-pending { color: var(--daw-muted); }',
      '  .daw-progress-dot { width: 7px; height: 7px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: daw-spin .9s linear infinite; }',
      '  .daw-progress-foot { display: flex; justify-content: flex-end; }',
      '  .daw-progress-cancel { padding: 0; border: 0; background: transparent; color: var(--daw-secondary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }',
      '  .daw-progress-cancel:hover { color: var(--daw-text); }',
      '  .daw-progress-cancel:focus-visible { outline: 2px solid var(--daw-brand); outline-offset: 2px; }',
      '  .daw-progress-error { color: var(--daw-danger); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }',
      '  .daw-progress-done { color: var(--daw-secondary); font-size: 12px; line-height: 18px; }',
      '  .daw-marker { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 14px; height: 14px; color: var(--daw-muted); }',
      '  .daw-marker svg { width: 14px; height: 14px; }',
      '  .daw-form { display: flex; flex-direction: column; gap: 10px; }',
      '  .daw-form-row { display: grid; grid-template-columns: minmax(150px, 220px) minmax(0, 1fr); gap: 4px 14px; align-items: start; }',
      '  .daw-form-label { color: var(--daw-text); font-size: 13px; line-height: 20px; padding-top: 5px; }',
      '  .daw-form-control { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }',
      '  .daw-form-desc { grid-column: 2; color: var(--daw-muted); font-size: 12px; line-height: 18px; }',
      '  .daw-form-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 6px; padding-top: 12px; border-top: 1px solid var(--daw-line); }',
      '  .daw-form-status { font-size: 12px; line-height: 18px; }',
      '  .daw-form-status-saved { color: var(--daw-success); }',
      '  .daw-form-status-dirty { color: var(--daw-secondary); }',
      '  .daw-form-status-conflict { color: var(--daw-danger); }',
      '  .daw-form-status-invalid { color: var(--daw-danger); }',
      '  .daw-form-status-unavailable { color: var(--daw-secondary); }',
      '  .daw-switch { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border: 1px solid var(--daw-line); border-radius: 999px; background: transparent; color: var(--daw-secondary); font: inherit; font-size: 12px; cursor: pointer; }',
      '  .daw-switch[aria-checked="true"] { border-color: var(--daw-brand); color: var(--daw-brand); background: var(--daw-soft); }',
      '  .daw-switch:focus-visible { outline: 2px solid var(--daw-brand); outline-offset: 2px; }',
      '  .daw-switch:disabled { opacity: .5; cursor: not-allowed; }',
      '  .daw-select, .daw-textarea { border: 1px solid var(--daw-line); border-radius: 8px; background: var(--daw-surface); color: var(--daw-text); font: inherit; font-size: 12px; }',
      '  .daw-select { height: 30px; padding: 0 8px; min-width: 140px; }',
      '  .daw-textarea { width: 100%; min-height: 64px; padding: 6px 8px; line-height: 18px; resize: vertical; }',
      '  .daw-select:focus-visible, .daw-textarea:focus-visible { outline: 2px solid var(--daw-brand); outline-offset: 1px; }',
      '  .daw-select:disabled, .daw-textarea:disabled, .daw-form .daw-input:disabled { opacity: .55; }',
      '  .daw-form-row .daw-input { max-width: 320px; }',
      '  .daw-block-title { margin-bottom: 8px; font-size: 13px; font-weight: 500; }',
      '}',
    ].join('\n')

    /** Inject the stylesheet once; the returned disposer removes it with the plugin. */
    function installStyles() {
      if (typeof document === 'undefined' || !document.head || typeof document.createElement !== 'function') {
        return function () {}
      }
      if (document.querySelector('style[' + STYLE_ATTR + ']')) return function () {}
      var element = document.createElement('style')
      element.setAttribute(STYLE_ATTR, '')
      element.textContent = STYLE_TEXT
      document.head.appendChild(element)
      return function () {
        if (element.parentNode) element.parentNode.removeChild(element)
      }
    }

    /* ================================================================== *
     * 7. Error boundary — a render failure must never blank a slot entry  *
     * ================================================================== */

    class SlotErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch() {
        /* The fallback below is the whole handling: keep the slot entry alive. */
      }

      render() {
        if (this.state.failed) return this.props.fallback
        return this.props.children
      }
    }

    function boundary(fallback, child) {
      return h(SlotErrorBoundary, { fallback: fallback }, child)
    }

    /* ================================================================== *
     * 8. Session header chip + popover                                    *
     * ================================================================== */

    /** Base chip state comes from the projection; `status` only adds popover details. */
    function projectionTone(projection) {
      if (!projection) return 'idle'
      if (projection.phase === 'creating') return 'loading'
      if (projection.phase === 'error') return 'error'
      return 'managed'
    }

    function projectionLabel(t, projection) {
      if (!projection) return t('chip.unmanaged')
      if (projection.phase === 'creating') return t('chip.loading')
      if (projection.phase === 'error') return t('chip.error')
      if (projection.branch) return projection.branch
      var name = baseName(projection.path) || 'worktree'
      // The default directory prefix is `wt-`, so display `wt:<name>` without doubling it.
      var stripped = name.replace(/^wt[-_]/i, '')
      return 'wt:' + (stripped || name)
    }

    /**
     * One `status` RPC while the popover is open (and on manual refresh); it is the
     * only detail read and never polls.
     */
    function useStatusDetails(sessionId, apiRef, enabled, revision) {
      var pair = React.useState({ phase: 'idle', value: null, error: null })
      var setState = pair[1]
      React.useEffect(
        function () {
          if (!enabled || !sessionId) {
            setState({ phase: 'idle', value: null, error: null })
            return undefined
          }
          var api = apiRef.current
          if (!api || typeof api.status !== 'function') {
            setState({
              phase: 'error',
              value: null,
              error: operationError('connection-unavailable', 'dsh-codex-style-worktree: connection.rpc.call is unavailable'),
            })
            return undefined
          }
          var alive = true
          var controller = typeof AbortController === 'function' ? new AbortController() : null
          setState({ phase: 'loading', value: null, error: null })
          var pending
          try {
            pending = api.status(sessionId, controller ? controller.signal : undefined)
          } catch (error) {
            pending = Promise.reject(error)
          }
          Promise.resolve(pending).then(
            function (value) {
              if (!alive) return
              setState({ phase: 'ready', value: normalizeStatus(value), error: null })
            },
            function (error) {
              if (!alive) return
              if (controller && controller.signal && controller.signal.aborted) return
              setState({ phase: 'error', value: null, error: toError(error) })
            },
          )
          return function () {
            alive = false
            if (controller) {
              try {
                controller.abort()
              } catch (error) {
                /* already aborted */
              }
            }
          }
        },
        [sessionId, enabled, revision, apiRef, setState],
      )
      return pair[0]
    }

    function WorktreeChip(props) {
      var t = useTranslator(props)
      useLocaleVersion()
      var apiRef = useStableRef(props.api)
      var sessionId = readSessionId(props)
      var projection = useProjectionValue(sessionId)
      var revisionPair = React.useState(0)
      var revision = revisionPair[0]
      var bump = revisionPair[1]
      var refresh = React.useCallback(function () {
        bump(function (value) {
          return value + 1
        })
      }, [bump])
      var openPair = React.useState(false)
      var open = openPair[0]
      var setOpen = openPair[1]
      var wrapRef = React.useRef(null)
      useDismiss(open, React.useCallback(function () {
        setOpen(false)
      }, [setOpen]), wrapRef)

      var tone = projectionTone(projection)
      var status = useStatusDetails(sessionId, apiRef, open && tone !== 'idle', revision)

      if (!sessionId) return null

      var label = projectionLabel(t, projection)
      var dirty = status.value && typeof status.value.dirty === 'number' && status.value.dirty > 0 ? status.value.dirty : 0
      var tooltip = projection && projection.path ? projection.path : t('chip.title')

      var chip = h(
        'button',
        {
          type: 'button',
          className: 'daw-chip daw-chip-' + tone,
          'data-dsh-codex-style-worktree-chip': CHIP_ID,
          'aria-haspopup': 'dialog',
          'aria-expanded': open ? 'true' : 'false',
          title: tooltip,
          'aria-label': t('chip.show'),
          onClick: function () {
            setOpen(!open)
          },
        },
        h('span', { className: 'daw-chip-dot', 'aria-hidden': 'true' }),
        h('span', { className: 'daw-chip-label' }, label),
        dirty > 0 ? h('span', { className: 'daw-chip-dirty' }, String(dirty)) : null,
        tone === 'loading' ? h('span', { className: 'daw-sr-only' }, t('chip.loading')) : null,
      )

      var popover = open
        ? h(WorktreePopover, {
            sessionId: sessionId,
            api: props.api,
            t: t,
            projection: projection,
            status: status,
            onRefresh: refresh,
            onClose: function () {
              setOpen(false)
            },
          })
        : null

      return h('div', { className: 'daw-chip-wrap', ref: wrapRef }, chip, popover)
    }

    function ChipEntry(props) {
      return boundary(
        h('span', { className: 'daw-chip daw-chip-error', title: 'dsh-codex-style-worktree' }, 'dsh-codex-style-worktree'),
        h(WorktreeChip, props),
      )
    }

    function factRow(t, labelKey, valueNode) {
      return h(
        React.Fragment,
        { key: labelKey },
        h('dt', { className: 'daw-fact-label' }, t(labelKey)),
        h('dd', { className: 'daw-fact-value' }, valueNode),
      )
    }

    function WorktreePopover(props) {
      var t = props.t
      var sessionId = props.sessionId
      var apiRef = useStableRef(props.api)
      var onRefresh = props.onRefresh
      var onClose = props.onClose
      var projection = props.projection || null
      var status = props.status || { phase: 'idle', value: null, error: null }
      var details = status.value

      var busyPair = React.useState('')
      var busy = busyPair[0]
      var setBusy = busyPair[1]
      var confirmPair = React.useState(false)
      var confirming = confirmPair[0]
      var setConfirming = confirmPair[1]
      var deletePair = React.useState(false)
      var deleteBranch = deletePair[0]
      var setDeleteBranch = deletePair[1]
      var errorPair = React.useState('')
      var actionError = errorPair[0]
      var setActionError = errorPair[1]
      var noticePair = React.useState('')
      var notice = noticePair[0]
      var setNotice = noticePair[1]
      var dirtyPair = React.useState(false)
      var dirtyBlocked = dirtyPair[0]
      var setDirtyBlocked = dirtyPair[1]
      var inUsePair = React.useState(false)
      var inUseBlocked = inUsePair[0]
      var setInUseBlocked = inUsePair[1]

      var managed = projectionTone(projection) === 'managed' || !!(details && details.managed === true)
      var disabled = busy !== ''
      var path = (details && details.path) || (projection && projection.path) || ''
      var repoRoot = (details && details.repoRoot) || (projection && projection.repoRoot) || ''
      var baseCommit = (details && details.baseCommit) || (projection && projection.baseCommit) || ''
      var mode = (details && details.mode) || (projection && projection.mode) || ''
      var dirty = details && typeof details.dirty === 'number' ? details.dirty : null
      var createdText = details && details.createdAt ? formatDate(details.createdAt, activeLanguage()) : ''
      var loadingDetails = managed && (status.phase === 'idle' || status.phase === 'loading')

      function fail(error) {
        setActionError(describeError(t, error))
      }

      function runClean(force) {
        if (disabled) return
        var api = apiRef.current
        if (!api || typeof api.clean !== 'function') {
          fail(operationError('connection-unavailable', 'dsh-codex-style-worktree: connection.rpc.call is unavailable'))
          return
        }
        setBusy(force ? 'force' : 'clean')
        setActionError('')
        setNotice('')
        var targetPath = path
        var pending
        try {
          pending = api.clean(sessionId, { force: force === true, deleteBranch: deleteBranch === true })
        } catch (error) {
          pending = Promise.reject(error)
        }
        Promise.resolve(pending).then(
          function () {
            setBusy('')
            setConfirming(false)
            setDirtyBlocked(false)
            setInUseBlocked(false)
            setActionError('')
            setNotice(t('popover.clean.success', { path: targetPath || t('popover.none') }))
            onRefresh()
          },
          function (error) {
            setBusy('')
            if (force !== true && isWorktreeInUseError(error)) {
              setDirtyBlocked(false)
              setInUseBlocked(true)
              setActionError('')
              return
            }
            if (force !== true && isDirtyError(error)) setDirtyBlocked(true)
            fail(error)
          },
        )
      }

      var head = h(
        'div',
        { className: 'daw-popover-head' },
        h('span', { className: 'daw-popover-title' }, t('popover.title')),
        h('span', { className: 'daw-actions', style: { marginTop: 0 } },
          h('button', { type: 'button', className: 'daw-button daw-button-ghost', onClick: onRefresh, disabled: status.phase === 'loading' }, t('popover.refresh')),
          h('button', { type: 'button', className: 'daw-button daw-button-ghost', onClick: onClose, 'aria-label': t('popover.close'), title: t('popover.close') }, '\u00d7'),
        ),
      )

      var body
      if (!managed) {
        body = h('p', { className: 'daw-note' }, t('popover.unmanagedHint'))
      } else {
        var dirtyValue = dirty !== null ? String(dirty) : t('popover.none')
        var modeText = mode === 'branch' ? t('popover.mode.branch') : mode === 'detached' ? t('popover.mode.detached') : mode || t('popover.none')
        body = h('div', null,
          h('dl', { className: 'daw-facts' },
            factRow(t, 'popover.path', h('code', { className: 'daw-code', title: path }, path || t('popover.none'))),
            repoRoot ? factRow(t, 'popover.repo', h('code', { className: 'daw-code', title: repoRoot }, repoRoot)) : null,
            factRow(t, 'popover.mode', modeText),
            factRow(t, 'popover.baseCommit', h('code', { className: 'daw-code', title: baseCommit }, shortCommit(baseCommit) || t('popover.none'))),
            factRow(t, 'popover.dirty', dirtyValue),
            createdText ? factRow(t, 'popover.created', createdText) : null,
          ),
          loadingDetails
            ? h('p', { className: 'daw-note' }, h('span', { className: 'daw-spin', 'aria-hidden': 'true' }), ' ', t('settings.loading'))
            : null,
          status.phase === 'error'
            ? h('div', { className: 'daw-error', role: 'alert' }, t('popover.error', { message: messageOf(status.error) }))
            : null,
          h('div', { className: 'daw-block' },
            confirming
              ? h('div', { className: 'daw-confirm' },
                  h('p', { className: 'daw-note', style: { marginTop: 0 } }, t('popover.clean.confirm')),
                  h('label', { className: 'daw-check' },
                    h('input', { type: 'checkbox', checked: deleteBranch, disabled: disabled, onChange: function (event) { setDeleteBranch(!!(event && event.target && event.target.checked)) } }),
                    t('popover.clean.deleteBranch'),
                  ),
                  h('div', { className: 'daw-actions' },
                    h('button', { type: 'button', className: 'daw-button daw-button-danger', disabled: disabled, onClick: function () { runClean(false) } },
                      busy === 'clean' ? h('span', { className: 'daw-spin', 'aria-hidden': 'true' }) : null,
                      t('popover.clean.confirmAction'),
                    ),
                    h('button', { type: 'button', className: 'daw-button daw-button-ghost', disabled: disabled, onClick: function () { setConfirming(false); setDirtyBlocked(false); setInUseBlocked(false); setActionError('') } }, t('popover.clean.cancel')),
                  ),
                )
              : h('div', { className: 'daw-actions', style: { marginTop: 0 } },
                  h('button', { type: 'button', className: 'daw-button', disabled: disabled || !sessionId, onClick: function () { setConfirming(true); setActionError(''); setNotice(''); setDirtyBlocked(false); setInUseBlocked(false) } }, t('popover.clean.action')),
                ),
            inUseBlocked
              ? h('div', null,
                  h('p', { className: 'daw-note' }, t('error.worktreeInUse')),
                  h('div', { className: 'daw-actions' },
                    h('button', { type: 'button', className: 'daw-button daw-button-danger', disabled: disabled, 'data-action': 'force-clean', onClick: function () { runClean(true) } },
                      busy === 'force' ? h('span', { className: 'daw-spin', 'aria-hidden': 'true' }) : null,
                      t('error.forceCleanupAction'),
                    ),
                    h('button', { type: 'button', className: 'daw-button daw-button-ghost', disabled: disabled, onClick: function () { setInUseBlocked(false); setActionError('') } }, t('popover.clean.cancel')),
                  ),
                )
              : dirtyBlocked
              ? h('div', null,
                  h('p', { className: 'daw-note' }, t('popover.clean.forceHint')),
                  h('div', { className: 'daw-actions' },
                    h('button', { type: 'button', className: 'daw-button daw-button-danger', disabled: disabled, onClick: function () { runClean(true) } },
                      busy === 'force' ? h('span', { className: 'daw-spin', 'aria-hidden': 'true' }) : null,
                      t('popover.clean.force'),
                    ),
                  ),
                )
              : null,
          ),
        )
      }

      return h(
        'div',
        {
          className: 'daw-popover',
          role: 'dialog',
          'aria-label': t('popover.title'),
          'data-dsh-codex-style-worktree-popover': '',
        },
        head,
        body,
        actionError ? h('div', { className: 'daw-error', role: 'alert' }, actionError) : null,
        notice ? h('div', { className: 'daw-notice', role: 'status' }, notice) : null,
      )
    }

    /* ================================================================== *
     * 8b. Work-location selector — conversation.hero.options              *
     * ================================================================== */

    function placementIcon(size) {
      var dimension = size || 14
      return h(
        'svg',
        {
          width: dimension,
          height: dimension,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('line', { x1: 6, y1: 3, x2: 6, y2: 15 }),
        h('circle', { cx: 18, cy: 6, r: 3 }),
        h('circle', { cx: 6, cy: 18, r: 3 }),
        h('path', { d: 'M18 9a9 9 0 0 1-9 9' }),
      )
    }

    function iconCheck() {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M20 6 9 17l-5-5' }),
      )
    }

    function iconChevronDown(size) {
      return h(
        'svg',
        {
          width: size || 12,
          height: size || 12,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          className: 'daw-placement-chevron',
        },
        h('path', { d: 'm6 9 6 6 6-6' }),
      )
    }

    var PLACEMENT_OPTIONS = [PLACEMENT_WORKTREE, PLACEMENT_LOCAL]

    function placementLabel(t, mode) {
      return mode === PLACEMENT_LOCAL ? t('placement.local') : t('placement.worktree')
    }

    function PlacementField(props) {
      var t = useTranslator(props)
      useLocaleVersion()
      var apiRef = useStableRef(props.api)
      var hero = useHeroSessionInfo(props)
      var workspacePath = hero.path
      var placement = usePlacementValue(workspacePath, apiRef)
      var openPair = React.useState(false)
      var open = openPair[0]
      var setOpen = openPair[1]
      var rootRef = React.useRef(null)
      useDismiss(open, React.useCallback(function () {
        setOpen(false)
      }, [setOpen]), rootRef)

      if (!hero.sessionId || !hero.blank || !workspacePath) return null
      var value = placement.state.value
      if (value && value.isGit === false) return null

      var fallbackMode = value && value.mode ? value.mode : value && value.defaultMode ? value.defaultMode : PLACEMENT_WORKTREE
      var readOnly = placement.state.phase === 'error' || placement.state.phase === 'loading'
      var busy = placement.state.busy
      var disabled = readOnly || busy
      var mode = placement.state.phase === 'ready' && value ? value.mode : fallbackMode

      var pill = h(
        'button',
        {
          type: 'button',
          className: 'daw-placement-pill' + (mode === PLACEMENT_LOCAL ? ' daw-placement-pill-is-local' : ''),
          disabled: disabled,
          'aria-haspopup': 'menu',
          'aria-expanded': open ? 'true' : 'false',
          'aria-label': t('placement.title') + ': ' + placementLabel(t, mode),
          title: t('placement.title'),
          'data-dsh-codex-style-worktree-placement': PLACEMENT_ID,
          onClick: function () {
            if (disabled) return
            setOpen(!open)
          },
        },
        placementIcon(13),
        h('span', null, placementLabel(t, mode)),
        busy ? h('span', { className: 'daw-spin', 'aria-hidden': 'true' }) : iconChevronDown(12),
      )

      var menu = open
        ? h(
            'div',
            { className: 'daw-placement-menu', role: 'menu', 'aria-label': t('placement.title') },
            PLACEMENT_OPTIONS.map(function (option) {
              return h(
                'button',
                {
                  type: 'button',
                  key: option,
                  role: 'menuitemradio',
                  'aria-checked': option === mode ? 'true' : 'false',
                  className: 'daw-placement-option',
                  onClick: function () {
                    setOpen(false)
                    if (option === mode) return
                    placement.write(option)
                  },
                },
                h('span', { className: 'daw-placement-check', 'aria-hidden': 'true' }, option === mode ? iconCheck() : null),
                h(
                  'span',
                  { className: 'daw-placement-option-text' },
                  h('span', { className: 'daw-placement-option-label' }, placementLabel(t, option)),
                ),
              )
            }),
            h('p', { className: 'daw-placement-hint' }, t('placement.hint')),
          )
        : null

      return h(
        'div',
        { className: 'daw-placement', ref: rootRef },
        pill,
        placement.state.note ? h('span', { className: 'daw-placement-note', role: 'status' }, placement.state.note) : null,
        menu,
      )
    }

    function PlacementEntry(props) {
      return boundary(null, h(PlacementField, props))
    }

    /* ================================================================== *
     * 8c. Creation progress card — conversation.input.dock                *
     * ================================================================== */

    var PROGRESS_MIN_VISIBLE_MS = 1000
    var PROGRESS_FADE_MS = 400

    /**
     * Display state machine for the progress card:
     * hidden → creating → done (400ms fade) → hidden, or creating → error.
     * The card is shown for at least 1000ms after creation starts; `cancel` only
     * hides it (the host keeps creating).
     */
    function useProgressDisplay(projection) {
      var pair = React.useState({ mode: 'hidden' })
      var state = pair[0]
      var setState = pair[1]
      var stateRef = React.useRef(state)
      stateRef.current = state
      var minElapsedRef = React.useRef(false)
      var pendingReadyRef = React.useRef(false)
      var cancelledRef = React.useRef(false)
      var sawCreatingRef = React.useRef(false)
      var minTimerRef = React.useRef(null)
      var fadeTimerRef = React.useRef(null)

      function clearTimer(ref) {
        if (ref.current && typeof clearTimeout === 'function') {
          try {
            clearTimeout(ref.current)
          } catch (error) {
            /* already fired */
          }
        }
        ref.current = null
      }

      function clearTimers() {
        clearTimer(minTimerRef)
        clearTimer(fadeTimerRef)
      }

      function finishReady() {
        if (cancelledRef.current) return
        clearTimer(minTimerRef)
        clearTimer(fadeTimerRef)
        minElapsedRef.current = true
        pendingReadyRef.current = false
        setState({ mode: 'done' })
        if (typeof setTimeout === 'function') {
          fadeTimerRef.current = setTimeout(function () {
            fadeTimerRef.current = null
            setState({ mode: 'hidden' })
          }, PROGRESS_FADE_MS)
        } else {
          setState({ mode: 'hidden' })
        }
      }

      React.useEffect(
        function () {
          var phase = projection && typeof projection === 'object' ? projection.phase : null
          if (phase === 'creating') {
            // A new creation cycle starts only when we were not already creating;
            // updates within the same cycle must not resurrect a cancelled card.
            if (!sawCreatingRef.current) {
              sawCreatingRef.current = true
              cancelledRef.current = false
              pendingReadyRef.current = false
              minElapsedRef.current = false
              clearTimers()
              setState({ mode: 'creating' })
              if (typeof setTimeout === 'function') {
                minTimerRef.current = setTimeout(function () {
                  minTimerRef.current = null
                  minElapsedRef.current = true
                  if (pendingReadyRef.current) finishReady()
                }, PROGRESS_MIN_VISIBLE_MS)
              } else {
                minElapsedRef.current = true
              }
            }
            return
          }
          if (phase === 'ready') {
            if (cancelledRef.current) {
              sawCreatingRef.current = false
              return
            }
            if (stateRef.current.mode === 'creating' && !minElapsedRef.current) {
              pendingReadyRef.current = true
              return
            }
            sawCreatingRef.current = false
            if (stateRef.current.mode !== 'done' && stateRef.current.mode !== 'hidden') finishReady()
            return
          }
          if (phase === 'error') {
            sawCreatingRef.current = false
            clearTimers()
            if (!cancelledRef.current) setState({ mode: 'error' })
            return
          }
          sawCreatingRef.current = false
          if (stateRef.current.mode === 'creating') {
            clearTimers()
            setState({ mode: 'hidden' })
          }
        },
        [projection],
      )

      React.useEffect(
        function () {
          return function () {
            clearTimers()
          }
        },
        [],
      )

      function cancel() {
        cancelledRef.current = true
        clearTimers()
        setState({ mode: 'hidden' })
      }

      return { state: state, cancel: cancel }
    }

    function progressStepStates(projection) {
      var current = 0
      if (projection && projection.phase === 'creating' && projection.step) {
        var index = PROJECTION_STEPS.indexOf(projection.step)
        if (index !== -1) current = index
      }
      return PROJECTION_STEPS.map(function (step, index) {
        if (projection && projection.phase !== 'creating') return { step: step, status: 'done' }
        if (index < current) return { step: step, status: 'done' }
        if (index === current) return { step: step, status: 'current' }
        return { step: step, status: 'pending' }
      })
    }

    function progressMarkClass(status) {
      return 'daw-progress-mark daw-progress-mark-' + status
    }

    function ProgressCard(props) {
      var t = useTranslator(props)
      useLocaleVersion()
      var sessionId = readSessionId(props)
      var projection = useProjectionValue(sessionId)
      var display = useProgressDisplay(projection)
      var mode = display.state.mode

      if (!sessionId || mode === 'hidden') return null

      var steps = progressStepStates(projection)
      var rows = steps.map(function (entry) {
        var marker =
          entry.status === 'done'
            ? h('span', { className: progressMarkClass('done'), 'aria-hidden': 'true' }, '\u2713')
            : entry.status === 'current'
              ? h('span', { className: progressMarkClass('current'), 'aria-hidden': 'true' }, h('span', { className: 'daw-progress-dot' }))
              : h('span', { className: progressMarkClass('pending'), 'aria-hidden': 'true' }, '\u25cb')
        return h(
          'li',
          {
            key: entry.step,
            className: 'daw-progress-step daw-progress-step-' + entry.status,
            'aria-current': entry.status === 'current' ? 'step' : undefined,
            'data-step': entry.step,
            'data-status': entry.status,
          },
          marker,
          h('span', null, t('progress.' + entry.step)),
        )
      })

      var body
      if (mode === 'error') {
        body = [
          h('p', { className: 'daw-progress-error', key: 'failed' }, t('progress.failed')),
          projection && projection.error
            ? h('p', { className: 'daw-progress-error', key: 'reason' }, t('progress.reason', { reason: projection.error }))
            : null,
        ]
      } else {
        body = h(
          'div',
          null,
          h('ul', { className: 'daw-progress-steps' }, rows),
          mode === 'done' ? h('p', { className: 'daw-progress-done', 'data-step': 'done' }, t('progress.done')) : null,
        )
      }

      return h(
        'section',
        {
          className: 'daw-progress daw-progress-' + mode + (mode === 'done' ? ' daw-progress-fade' : ''),
          'data-dsh-codex-style-worktree-progress': PROGRESS_ID,
          'aria-label': t('progress.title'),
          'aria-live': 'polite',
        },
        h(
          'div',
          { className: 'daw-progress-head' },
          h('span', { className: 'daw-progress-title-icon', 'aria-hidden': 'true' }, placementIcon(14)),
          h('span', { className: mode === 'error' ? 'daw-progress-error' : null }, t('progress.title')),
        ),
        body,
        mode === 'done'
          ? null
          : h(
              'div',
              { className: 'daw-progress-foot' },
              h(
                'button',
                { type: 'button', className: 'daw-progress-cancel', onClick: display.cancel, 'data-action': 'cancel' },
                t('progress.cancel'),
              ),
            ),
      )
    }

    function ProgressEntry(props) {
      return boundary(null, h(ProgressCard, props))
    }

    /* ================================================================== *
     * 8d. Sidebar row marker — sidebar.session.row.leading                *
     * ================================================================== */

    function SessionMarker(props) {
      var t = useTranslator(props)
      useLocaleVersion()
      var sessionId = readSessionId(props)
      var projection = useProjectionValue(sessionId)
      if (!sessionId || !projection || projection.phase !== 'ready') return null
      var path = projection.path || ''
      var title = t('marker.tooltip', { title: t('marker.title'), path: path || '\u2014' })
      return h(
        'span',
        {
          className: 'daw-marker',
          title: title,
          role: 'img',
          'aria-label': title,
          'data-dsh-codex-style-worktree-marker': MARKER_ID,
        },
        placementIcon(14),
      )
    }

    function MarkerEntry(props) {
      return boundary(null, h(SessionMarker, props))
    }

    /* ================================================================== *
     * 9. Settings section — editable config + worktree management         *
     * ================================================================== */

    var DETACHED_MODE = 'detached'
    var BRANCH_MODE = 'branch'
    var CONFIG_INPUT_TYPES = ['boolean', 'number', 'text', 'select', 'lines']

    function recordKey(record, index) {
      return record.path || (record.repoRoot ? record.repoRoot + '#' + index : 'record-' + index)
    }

    function iconRefresh(size) {
      var dimension = size || 14
      return h(
        'svg',
        {
          width: dimension,
          height: dimension,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }),
        h('path', { d: 'M21 3v5h-5' }),
        h('path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }),
        h('path', { d: 'M8 16H3v5' }),
      )
    }

    function iconChevron(expanded) {
      return h(
        'svg',
        {
          width: 12,
          height: 12,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          className: 'daw-chevron' + (expanded ? ' daw-chevron-open' : ''),
        },
        h('path', { d: 'm9 18 6-6-6-6' }),
      )
    }

    /* ---------------- configuration model ---------------- */

    function normalizeSettingsField(field) {
      if (!field || typeof field !== 'object') return null
      var key = typeof field.key === 'string' ? field.key : ''
      if (!key) return null
      var type = CONFIG_INPUT_TYPES.indexOf(field.type) !== -1 ? field.type : 'text'
      var options = []
      if (Array.isArray(field.options)) {
        for (var index = 0; index < field.options.length; index += 1) {
          var option = field.options[index]
          var value = typeof option === 'string' ? option : option && typeof option.value === 'string' ? option.value : ''
          if (value) options.push(value)
        }
      }
      return {
        key: key,
        type: type,
        options: options,
        min: typeof field.min === 'number' && isFinite(field.min) ? field.min : undefined,
        description: typeof field.description === 'string' ? field.description : '',
      }
    }

    function normalizeSettingsDescriptor(value) {
      if (!value || typeof value !== 'object') return null
      var fields = []
      if (Array.isArray(value.fields)) {
        for (var index = 0; index < value.fields.length; index += 1) {
          var field = normalizeSettingsField(value.fields[index])
          if (field) fields.push(field)
        }
      }
      return {
        ns: typeof value.ns === 'string' ? value.ns : SETTINGS_NS,
        revision: typeof value.revision === 'number' && isFinite(value.revision) ? value.revision : 0,
        writable: value.writable !== false,
        values: value.values && typeof value.values === 'object' ? value.values : {},
        defaults: value.defaults && typeof value.defaults === 'object' ? value.defaults : {},
        fields: fields,
      }
    }

    function cloneConfigValues(values) {
      var out = {}
      if (!values || typeof values !== 'object') return out
      for (var key in values) {
        if (!Object.prototype.hasOwnProperty.call(values, key)) continue
        var value = values[key]
        out[key] = Array.isArray(value) ? value.slice() : value
      }
      return out
    }

    function draftFromDescriptor(descriptor) {
      var draft = cloneConfigValues(descriptor.values)
      for (var index = 0; index < descriptor.fields.length; index += 1) {
        var field = descriptor.fields[index]
        if (field.type === 'lines' && !Array.isArray(draft[field.key])) {
          draft[field.key] = typeof draft[field.key] === 'string' && draft[field.key] ? draft[field.key].split('\n') : []
        }
      }
      return draft
    }

    function configValuesEqual(left, right) {
      if (Array.isArray(left) || Array.isArray(right)) {
        var a = Array.isArray(left) ? left : []
        var b = Array.isArray(right) ? right : []
        if (a.length !== b.length) return false
        for (var index = 0; index < a.length; index += 1) if (String(a[index]) !== String(b[index])) return false
        return true
      }
      if (typeof left === 'number' || typeof right === 'number') return String(left) === String(right)
      return left === right
    }

    function buildConfigPatch(descriptor, draft) {
      var patch = {}
      var changed = false
      for (var index = 0; index < descriptor.fields.length; index += 1) {
        var key = descriptor.fields[index].key
        if (!configValuesEqual(descriptor.values[key], draft[key])) {
          patch[key] = draft[key]
          changed = true
        }
      }
      return changed ? patch : null
    }

    function configFieldLabel(t, field) {
      var label = t('settings.edit.' + field.key)
      return label === 'settings.edit.' + field.key ? field.key : label
    }

    function configFieldDescription(t, field) {
      var key = 'settings.edit.' + field.key + '.desc'
      var text = t(key)
      if (text !== key) return text
      return field.description || ''
    }

    function configOptionLabel(t, field, value) {
      if (field.key === 'defaultPlacement') return placementLabel(t, value)
      if (field.key === 'mode') {
        if (value === DETACHED_MODE) return t('popover.mode.detached')
        if (value === BRANCH_MODE) return t('popover.mode.branch')
      }
      return value
    }

    function settingsStatusText(t, state) {
      if (state.status === 'saving') return t('settings.saving')
      if (state.status === 'saved') return t('settings.saved')
      if (state.status === 'dirty') return t('settings.dirty')
      if (state.status === 'conflict') return t('settings.conflict')
      if (state.status === 'invalid') return t('settings.invalid', { message: state.message || t('settings.unknown') })
      if (state.status === 'unavailable') return t('settings.unavailable')
      return ''
    }

    /**
     * Load the settings descriptor and keep the draft, revision and status in one
     * state object. `save`/`reset` write through the host settings service.
     */
    function useSettingsConfig(apiRef) {
      var pair = React.useState({
        phase: 'loading',
        descriptor: null,
        draft: {},
        status: 'saved',
        message: '',
        busy: false,
      })
      var state = pair[0]
      var setState = pair[1]

      function load(preserveStatus) {
        var api = apiRef.current
        if (!api || typeof api.settings !== 'function') {
          setState({ phase: 'unavailable', descriptor: null, draft: {}, status: 'unavailable', message: '', busy: false })
          return Promise.resolve(false)
        }
        setState(function (previous) {
          return {
            phase: previous.descriptor ? previous.phase : 'loading',
            descriptor: previous.descriptor,
            draft: previous.draft,
            status: preserveStatus ? previous.status : 'saved',
            message: preserveStatus ? previous.message : '',
            busy: false,
          }
        })
        return Promise.resolve(api.settings({ action: 'get' })).then(
          function (value) {
            var descriptor = normalizeSettingsDescriptor(value)
            if (!descriptor) {
              setState({ phase: 'error', descriptor: null, draft: {}, status: 'invalid', message: 'invalid settings response', busy: false })
              return false
            }
            setState({
              phase: 'ready',
              descriptor: descriptor,
              draft: draftFromDescriptor(descriptor),
              status: preserveStatus ? 'conflict' : 'saved',
              message: preserveStatus ? translate('settings.conflict') : '',
              busy: false,
            })
            return true
          },
          function (error) {
            var code = error && error.code ? String(error.code) : ''
            if (code === 'settings-unavailable') {
              setState({ phase: 'unavailable', descriptor: null, draft: {}, status: 'unavailable', message: '', busy: false })
              return false
            }
            setState({ phase: 'error', descriptor: null, draft: {}, status: 'invalid', message: messageOf(error), busy: false })
            return false
          },
        )
      }

      React.useEffect(function () {
        load(false)
      }, [apiRef])

      function setField(key, value) {
        setState(function (previous) {
          if (!previous.descriptor) return previous
          var draft = cloneConfigValues(previous.draft)
          draft[key] = value
          return {
            phase: previous.phase,
            descriptor: previous.descriptor,
            draft: draft,
            status: 'dirty',
            message: '',
            busy: previous.busy,
          }
        })
      }

      function applyResult(value) {
        var descriptor = normalizeSettingsDescriptor(value)
        if (!descriptor) {
          setState(function (previous) {
            return {
              phase: previous.phase,
              descriptor: previous.descriptor,
              draft: previous.draft,
              status: 'invalid',
              message: 'invalid settings response',
              busy: false,
            }
          })
          return
        }
        setState({
          phase: 'ready',
          descriptor: descriptor,
          draft: draftFromDescriptor(descriptor),
          status: 'saved',
          message: '',
          busy: false,
        })
      }

      function handleFailure(error) {
        var code = error && error.code ? String(error.code) : ''
        if (code === 'conflict') {
          setState(function (previous) {
            return {
              phase: previous.phase,
              descriptor: previous.descriptor,
              draft: previous.draft,
              status: 'conflict',
              message: translate('settings.conflict'),
              busy: false,
            }
          })
          load(true)
          return
        }
        if (code === 'settings-unavailable') {
          setState(function (previous) {
            return {
              phase: 'unavailable',
              descriptor: previous.descriptor,
              draft: previous.draft,
              status: 'unavailable',
              message: '',
              busy: false,
            }
          })
          return
        }
        setState(function (previous) {
          return {
            phase: previous.phase,
            descriptor: previous.descriptor,
            draft: previous.draft,
            status: 'invalid',
            message: messageOf(error),
            busy: false,
          }
        })
      }

      function save() {
        if (state.busy || !state.descriptor || state.descriptor.writable === false) return
        var patch = buildConfigPatch(state.descriptor, state.draft)
        if (!patch) {
          setState(function (previous) {
            return {
              phase: previous.phase,
              descriptor: previous.descriptor,
              draft: previous.draft,
              status: 'saved',
              message: '',
              busy: false,
            }
          })
          return
        }
        var api = apiRef.current
        if (!api || typeof api.settings !== 'function') {
          handleFailure(operationError('settings-unavailable', 'settings unavailable'))
          return
        }
        setState(function (previous) {
          return {
            phase: previous.phase,
            descriptor: previous.descriptor,
            draft: previous.draft,
            status: 'saving',
            message: '',
            busy: true,
          }
        })
        Promise.resolve(api.settings({ action: 'set', patch: patch, revision: state.descriptor.revision })).then(
          function (value) {
            applyResult(value)
          },
          function (error) {
            handleFailure(error)
          },
        )
      }

      function reset() {
        if (state.busy || !state.descriptor || state.descriptor.writable === false) return
        var api = apiRef.current
        if (!api || typeof api.settings !== 'function') {
          handleFailure(operationError('settings-unavailable', 'settings unavailable'))
          return
        }
        setState(function (previous) {
          return {
            phase: previous.phase,
            descriptor: previous.descriptor,
            draft: previous.draft,
            status: 'saving',
            message: '',
            busy: true,
          }
        })
        Promise.resolve(api.settings({ action: 'reset', revision: state.descriptor.revision })).then(
          function (value) {
            applyResult(value, 'saved')
          },
          function (error) {
            handleFailure(error)
          },
        )
      }

      return {
        state: state,
        reload: function () {
          return load(false)
        },
        setField: setField,
        save: save,
        reset: reset,
      }
    }

    function ConfigForm(props) {
      var t = useTranslator(props)
      useLocaleVersion()
      var apiRef = useStableRef(props.api)
      var config = useSettingsConfig(apiRef)
      var state = config.state
      var descriptor = state.descriptor
      var readOnly = state.status === 'unavailable' || (descriptor && descriptor.writable === false)

      var rows = []
      if (descriptor) {
        for (let index = 0; index < descriptor.fields.length; index += 1) {
          // `let`/`const` keep each row's handlers bound to its own field.
          const field = descriptor.fields[index]
          const key = field.key
          const rawValue = state.draft[key]
          let control
          if (field.type === 'boolean') {
            control = h(
              'button',
              {
                type: 'button',
                className: 'daw-switch',
                role: 'switch',
                'aria-checked': rawValue === true ? 'true' : 'false',
                disabled: readOnly || state.busy,
                onClick: function (event) {
                  event.preventDefault()
                  config.setField(key, rawValue !== true)
                },
              },
              rawValue === true ? t('settings.config.on') : t('settings.config.off'),
            )
          } else if (field.type === 'select') {
            var options = field.options.length > 0 ? field.options : field.key === 'defaultPlacement' ? PLACEMENT_OPTIONS : field.key === 'mode' ? [DETACHED_MODE, BRANCH_MODE] : []
            control = h(
              'select',
              {
                className: 'daw-select',
                value: rawValue === undefined || rawValue === null ? '' : String(rawValue),
                disabled: readOnly || state.busy,
                'aria-label': configFieldLabel(t, field),
                onChange: function (event) {
                  config.setField(key, event && event.target ? event.target.value : '')
                },
              },
              options.map(function (option) {
                return h('option', { key: option, value: option }, configOptionLabel(t, field, option))
              }),
            )
          } else if (field.type === 'lines') {
            control = h('textarea', {
              className: 'daw-textarea',
              rows: 3,
              value: Array.isArray(rawValue) ? rawValue.join('\n') : rawValue === undefined || rawValue === null ? '' : String(rawValue),
              placeholder: field.description || '',
              disabled: readOnly || state.busy,
              spellCheck: false,
              'aria-label': configFieldLabel(t, field),
              onChange: function (event) {
                var text = event && event.target ? event.target.value : ''
                config.setField(
                  key,
                  String(text)
                    .split('\n')
                    .map(function (line) {
                      return line.trim()
                    })
                    .filter(function (line) {
                      return line !== ''
                    }),
                )
              },
            })
          } else if (field.type === 'number') {
            control = h('input', {
              className: 'daw-input',
              type: 'number',
              min: field.min,
              value: rawValue === undefined || rawValue === null ? '' : String(rawValue),
              disabled: readOnly || state.busy,
              'aria-label': configFieldLabel(t, field),
              onChange: function (event) {
                var text = event && event.target ? event.target.value : ''
                config.setField(key, text === '' ? '' : Number(text))
              },
            })
          } else {
            control = h('input', {
              className: 'daw-input',
              type: 'text',
              value: rawValue === undefined || rawValue === null ? '' : String(rawValue),
              disabled: readOnly || state.busy,
              spellCheck: false,
              autoComplete: 'off',
              'aria-label': configFieldLabel(t, field),
              onChange: function (event) {
                config.setField(key, event && event.target ? event.target.value : '')
              },
            })
          }
          const description = configFieldDescription(t, field)
          rows.push(
            h(
              'div',
              { className: 'daw-form-row', key: key, 'data-field': key },
              h('label', { className: 'daw-form-label' }, configFieldLabel(t, field)),
              h('div', { className: 'daw-form-control' }, control),
              description ? h('p', { className: 'daw-form-desc' }, description) : null,
            ),
          )
        }
      }

      var statusText = settingsStatusText(t, state)
      var statusClass = 'daw-form-status daw-form-status-' + (state.status || 'saved')
      var dirty = descriptor ? buildConfigPatch(descriptor, state.draft) !== null : false

      var body
      if (state.phase === 'loading' && !descriptor) {
        body = h('p', { className: 'daw-note' }, h('span', { className: 'daw-spin', 'aria-hidden': 'true' }), ' ', t('settings.loading'))
      } else if (state.status === 'unavailable' && !descriptor) {
        body = h('p', { className: 'daw-note' }, t('settings.unavailable'))
      } else if (state.phase === 'error' && !descriptor) {
        body = h(
          'div',
          null,
          h('div', { className: 'daw-error', role: 'alert' }, t('settings.loadError', { message: state.message || t('settings.unknown') })),
          h('div', { className: 'daw-actions' }, h('button', { type: 'button', className: 'daw-button', onClick: config.reload }, t('settings.retry'))),
        )
      } else {
        body = h(
          'div',
          { className: 'daw-form', 'aria-busy': state.busy ? 'true' : 'false' },
          rows,
          h(
            'div',
            { className: 'daw-form-footer' },
            h(
              'button',
              {
                type: 'button',
                className: 'daw-button daw-button-primary',
                disabled: readOnly || state.busy || !dirty,
                onClick: config.save,
                'data-action': 'save',
              },
              state.busy ? h('span', { className: 'daw-spin', 'aria-hidden': 'true' }) : null,
              t('settings.save'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'daw-button',
                disabled: readOnly || state.busy,
                onClick: config.reset,
                'data-action': 'reset',
              },
              t('settings.reset'),
            ),
            readOnly ? h('span', { className: 'daw-form-status daw-form-status-unavailable' }, t('settings.readOnly')) : null,
            statusText ? h('span', { className: statusClass, role: 'status', 'data-status': state.status }, statusText) : null,
          ),
        )
      }

      return h(
        'section',
        { className: 'daw-config', 'aria-label': t('settings.edit.title'), 'data-dsh-codex-style-worktree-config': SETTINGS_NS },
        h('h3', { className: 'daw-block-title' }, t('settings.edit.title')),
        body,
      )
    }

    function WorktreeSettings(props) {
      var t = useTranslator(props)
      useLocaleVersion()
      var apiRef = useStableRef(props.api)
      var ctxRef = useStableRef(props.ctx)
      var list = useWorktreeList(apiRef)
      var state = list.state
      var refresh = list.refresh

      var collapsedPair = React.useState({})
      var collapsed = collapsedPair[0]
      var setCollapsed = collapsedPair[1]
      var busyPair = React.useState('')
      var busy = busyPair[0]
      var setBusy = busyPair[1]
      var confirmPair = React.useState('')
      var confirmKey = confirmPair[0]
      var setConfirmKey = confirmPair[1]
      var forcePair = React.useState('')
      var forceKey = forcePair[0]
      var setForceKey = forcePair[1]
      var inUsePair = React.useState('')
      var inUseKey = inUsePair[0]
      var setInUseKey = inUsePair[1]
      var errorPair = React.useState(null)
      var rowError = errorPair[0]
      var setRowError = errorPair[1]
      var noticePair = React.useState('')
      var notice = noticePair[0]
      var setNotice = noticePair[1]

      var language = activeLanguage()
      var total = countRecords(state.repos)
      var loading = state.phase === 'loading' || state.phase === 'refreshing'

      function fail(key, message) {
        setRowError({ key: key, message: message })
      }

      function clearMessages() {
        setRowError(null)
        setNotice('')
      }

      function toggleRepo(repoRoot) {
        setCollapsed(function (previous) {
          var next = Object.assign({}, previous)
          next[repoRoot] = !next[repoRoot]
          return next
        })
      }

      function runPrune() {
        if (busy) return
        var api = apiRef.current
        if (!api || typeof api.prune !== 'function') {
          fail('prune', t('settings.rpcUnavailable'))
          return
        }
        setBusy('prune')
        clearMessages()
        var pending
        try {
          pending = api.prune(undefined)
        } catch (error) {
          pending = Promise.reject(error)
        }
        Promise.resolve(pending).then(
          function (result) {
            setBusy('')
            var removed = result && Array.isArray(result.removed) ? result.removed.length : 0
            var snapshots = result && Array.isArray(result.snapshots) ? result.snapshots.length : 0
            setNotice(
              removed === 0 && snapshots === 0
                ? t('settings.prune.nothing')
                : t('settings.prune.result', { removed: String(removed), snapshots: String(snapshots) }),
            )
            refresh()
          },
          function (error) {
            setBusy('')
            fail('prune', t('settings.rowError', { message: messageOf(error) }))
          },
        )
      }

      function openConversation(sessionId, key) {
        if (!sessionId) return
        clearMessages()
        try {
          openSessionById(ctxRef.current, sessionId)
        } catch (error) {
          fail(key, t('settings.openFailed', { message: messageOf(error) }))
        }
      }

      function runDelete(record, key, force) {
        if (busy) return
        var api = apiRef.current
        if (!record.sessionId) {
          fail(key, t('settings.noSession'))
          return
        }
        if (!api || typeof api.clean !== 'function') {
          fail(key, t('settings.rpcUnavailable'))
          return
        }
        setBusy('delete:' + key)
        setInUseKey('')
        clearMessages()
        var pending
        try {
          pending = api.clean(record.sessionId, { force: force === true, deleteBranch: true })
        } catch (error) {
          pending = Promise.reject(error)
        }
        Promise.resolve(pending).then(
          function () {
            setBusy('')
            setConfirmKey('')
            setForceKey('')
            setInUseKey('')
            setNotice(t('settings.deleted', { path: record.path || record.repoRoot || '' }))
            refresh()
          },
          function (error) {
            setBusy('')
            if (force !== true && isWorktreeInUseError(error)) {
              setForceKey('')
              setInUseKey(key)
              setRowError(null)
              return
            }
            if (force !== true && isDirtyError(error)) {
              setForceKey(key)
              fail(key, t('settings.delete.forceHint'))
              return
            }
            fail(key, t('settings.rowError', { message: messageOf(error) }))
          },
        )
      }

      /** Restore one recoverable snapshot; then refresh the list and report the path. */
      function runRestore(snapshot) {
        if (busy) return
        var api = apiRef.current
        var key = 'restore:' + snapshot.ref
        if (!api || typeof api.restore !== 'function') {
          fail(key, t('settings.rpcUnavailable'))
          return
        }
        setBusy('restore:' + snapshot.ref)
        clearMessages()
        var pending
        try {
          pending = api.restore(snapshot.ref)
        } catch (error) {
          pending = Promise.reject(error)
        }
        Promise.resolve(pending).then(
          function (value) {
            setBusy('')
            var restoredPath = (value && typeof value.path === 'string' && value.path) || snapshot.path || snapshot.restoredPath || ''
            setNotice(t('settings.snapshots.restored', { path: restoredPath || t('settings.unknown') }))
            refresh()
          },
          function (error) {
            setBusy('')
            fail(key, t('settings.snapshots.restoreFailed', { message: messageOf(error) }))
          },
        )
      }

      var header = h(
        'header',
        { className: 'daw-settings-header' },
        h(
          'div',
          null,
          h('h2', { className: 'daw-settings-title' }, t('settings.title')),
          h('p', { className: 'daw-settings-subtitle' }, t('settings.subtitle')),
        ),
        h(
          'div',
          { className: 'daw-toolbar' },
          h('span', { className: 'daw-meta' }, t('settings.count', { count: String(total) })),
          h(
            'button',
            { type: 'button', className: 'daw-button daw-button-ghost', disabled: loading, onClick: refresh, title: t('settings.refresh') },
            loading ? h('span', { className: 'daw-spin', 'aria-hidden': 'true' }) : iconRefresh(14),
            t('settings.refresh'),
          ),
        ),
      )

      var managementHeader = h(
        'div',
        { className: 'daw-toolbar', style: { marginTop: '18px', marginBottom: '8px' } },
        h('h3', { className: 'daw-block-title', style: { margin: 0, flex: '1' } }, t('settings.management.title')),
        h(
          'button',
          { type: 'button', className: 'daw-button', disabled: busy !== '' || loading, onClick: runPrune, 'data-action': 'prune' },
          busy === 'prune' ? h('span', { className: 'daw-spin', 'aria-hidden': 'true' }) : null,
          busy === 'prune' ? t('settings.prune.busy') : t('settings.prune.action'),
        ),
      )

      var content
      if (state.phase === 'loading') {
        content = h('p', { className: 'daw-note' }, h('span', { className: 'daw-spin', 'aria-hidden': 'true' }), ' ', t('settings.loading'))
      } else if (state.phase === 'error') {
        content = h(
          'div',
          null,
          h('div', { className: 'daw-error', role: 'alert' }, t('settings.loadError', { message: messageOf(state.error) })),
          h('div', { className: 'daw-actions' }, h('button', { type: 'button', className: 'daw-button', onClick: refresh }, t('settings.retry'))),
        )
      } else if (state.repos.length === 0) {
        content = h(
          'div',
          { className: 'daw-empty' },
          h('p', null, t('settings.empty')),
          h('p', { className: 'daw-empty-hint' }, t('settings.emptyHint')),
        )
      } else {
        var groups = []
        for (let groupIndex = 0; groupIndex < state.repos.length; groupIndex += 1) {
          const group = state.repos[groupIndex]
          const repoLabel = group.repoRoot || t('settings.unknown')
          const expanded = collapsed[repoLabel] !== true
          const rows = []

          for (let recordIndex = 0; recordIndex < group.records.length; recordIndex += 1) {
            const record = group.records[recordIndex]
            const key = recordKey(record, recordIndex) + '@' + repoLabel
            const isConfirming = confirmKey === key
            const isForcing = forceKey === key
            const isInUse = inUseKey === key
            const isBusy = busy === 'delete:' + key
            const isDetached = record.mode === DETACHED_MODE || (!record.mode && !record.branch)
            const modeText = isDetached
              ? t('settings.mode.detached')
              : record.branch || (record.mode === BRANCH_MODE ? t('settings.mode.branch') : record.mode || t('settings.unknown'))
            const createdText = record.createdAt !== undefined && record.createdAt !== null ? formatDate(record.createdAt, language) : ''
            const dirtyCount = typeof record.dirty === 'number' ? record.dirty : null

            const conversations = record.sessionId
              ? h(
                  'div',
                  { className: 'daw-conversations' },
                  h('span', { className: 'daw-meta' }, t('settings.conversations') + ':'),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'daw-link',
                      title: t('settings.openSession'),
                      onClick: function () {
                        openConversation(record.sessionId, key)
                      },
                    },
                    sessionTitle(ctxRef.current, record.sessionId),
                  ),
                )
              : null

            rows.push(
              h(
                'article',
                { className: 'daw-wt', key: key },
                h(
                  'div',
                  { className: 'daw-wt-main' },
                  h('code', { className: 'daw-code daw-wt-path', title: record.path }, record.path || t('settings.unknown')),
                  h(
                    'div',
                    { className: 'daw-wt-facts' },
                    h('span', { className: 'daw-badge' + (isDetached ? ' daw-badge-dashed' : ' daw-badge-managed') }, modeText),
                    dirtyCount !== null && dirtyCount > 0
                      ? h('span', { className: 'daw-badge daw-badge-warn' }, t('settings.dirty', { count: String(dirtyCount) }))
                      : dirtyCount === 0
                        ? h('span', { className: 'daw-badge daw-badge-ok' }, t('settings.noDirty'))
                        : null,
                    createdText ? h('span', { className: 'daw-meta' }, t('settings.created', { time: createdText })) : null,
                  ),
                  conversations,
                  isConfirming
                    ? h(
                        'div',
                        { className: 'daw-confirm' },
                        h('p', { className: 'daw-note', style: { marginTop: 0 } }, t('settings.delete.confirm')),
                        isInUse
                          ? h(
                              'div',
                              null,
                              h('p', { className: 'daw-note' }, t('error.worktreeInUse')),
                              h(
                                'div',
                                { className: 'daw-actions' },
                                h(
                                  'button',
                                  { type: 'button', className: 'daw-button daw-button-danger', disabled: busy !== '', 'data-action': 'force-delete', onClick: function () { runDelete(record, key, true) } },
                                  isBusy ? h('span', { className: 'daw-spin', 'aria-hidden': 'true' }) : null,
                                  t('error.forceCleanupAction'),
                                ),
                                h('button', { type: 'button', className: 'daw-button daw-button-ghost', disabled: busy !== '', onClick: function () { setConfirmKey(''); setForceKey(''); setInUseKey('') } }, t('settings.cancel')),
                              ),
                            )
                          : isForcing
                          ? h(
                              'div',
                              null,
                              h('p', { className: 'daw-note' }, t('settings.delete.forceHint')),
                              h(
                                'div',
                                { className: 'daw-actions' },
                                h(
                                  'button',
                                  { type: 'button', className: 'daw-button daw-button-danger', disabled: busy !== '', onClick: function () { runDelete(record, key, true) } },
                                  isBusy ? h('span', { className: 'daw-spin', 'aria-hidden': 'true' }) : null,
                                  t('settings.delete.force'),
                                ),
                                h('button', { type: 'button', className: 'daw-button daw-button-ghost', disabled: busy !== '', onClick: function () { setConfirmKey(''); setForceKey('') } }, t('settings.cancel')),
                              ),
                            )
                          : h(
                              'div',
                              { className: 'daw-actions' },
                              h(
                                'button',
                                { type: 'button', className: 'daw-button daw-button-danger', disabled: busy !== '', onClick: function () { runDelete(record, key, false) } },
                                isBusy ? h('span', { className: 'daw-spin', 'aria-hidden': 'true' }) : null,
                                t('settings.delete.confirmAction'),
                              ),
                              h('button', { type: 'button', className: 'daw-button daw-button-ghost', disabled: busy !== '', onClick: function () { setConfirmKey(''); setForceKey('') } }, t('settings.cancel')),
                            ),
                      )
                    : null,
                  rowError && rowError.key === key ? h('div', { className: 'daw-error', role: 'alert' }, rowError.message) : null,
                ),
                h(
                  'div',
                  { className: 'daw-wt-actions' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'daw-button daw-button-danger',
                      disabled: busy !== '' || !record.sessionId,
                      title: record.sessionId ? t('settings.delete') : t('settings.noSession'),
                      onClick: function () {
                        setConfirmKey(key)
                        setForceKey('')
                        setInUseKey('')
                        clearMessages()
                      },
                    },
                    t('settings.delete'),
                  ),
                ),
              ),
            )
          }

          groups.push(
            h(
              'section',
              { className: 'daw-repo', key: repoLabel },
              h(
                'header',
                { className: 'daw-repo-head' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'daw-repo-toggle',
                    'aria-expanded': expanded ? 'true' : 'false',
                    'aria-label': expanded ? t('settings.collapse', { repo: repoLabel }) : t('settings.expand', { repo: repoLabel }),
                    onClick: function () {
                      toggleRepo(repoLabel)
                    },
                  },
                  iconChevron(expanded),
                  h('code', { className: 'daw-code daw-repo-path', title: repoLabel }, repoLabel),
                  h('span', { className: 'daw-meta' }, t('settings.repo.count', { count: String(group.records.length) })),
                ),
                h(
                  'button',
                  { type: 'button', className: 'daw-icon-button', disabled: loading, title: t('settings.repo.refresh'), 'aria-label': t('settings.repo.refresh'), onClick: refresh },
                  loading ? h('span', { className: 'daw-spin', 'aria-hidden': 'true' }) : iconRefresh(13),
                ),
              ),
              expanded
                ? h(
                    React.Fragment,
                    null,
                    h('div', { className: 'daw-wt-list' }, rows.length > 0 ? rows : h('p', { className: 'daw-note' }, t('settings.empty'))),
                    (function () {
                      var repoSnapshots = snapshotsForRepo(state.snapshots, group.repoRoot)
                      if (repoSnapshots.length === 0) return null
                      var snapshotRows = []
                      for (let snapshotIndex = 0; snapshotIndex < repoSnapshots.length; snapshotIndex += 1) {
                        const snapshot = repoSnapshots[snapshotIndex]
                        const restoreKey = 'restore:' + snapshot.ref
                        const isRestoring = busy === restoreKey
                        const snapshotCreated = snapshot.createdAt !== undefined && snapshot.createdAt !== null ? formatDate(snapshot.createdAt, language) : ''
                        const snapshotRestored = snapshot.restoredAt !== undefined && snapshot.restoredAt !== null ? formatDate(snapshot.restoredAt, language) : ''
                        snapshotRows.push(
                          h(
                            'div',
                            { className: 'daw-snapshot', key: snapshot.ref, 'data-snapshot-ref': snapshot.ref },
                            h(
                              'div',
                              { className: 'daw-snapshot-main' },
                              h('code', { className: 'daw-code daw-snapshot-ref', title: snapshot.ref }, shortSnapshotRef(snapshot.ref)),
                              snapshot.commit ? h('span', { className: 'daw-snapshot-sha', title: snapshot.commit }, shortCommit(snapshot.commit)) : null,
                              snapshotCreated ? h('span', { className: 'daw-meta' }, t('settings.snapshots.created', { time: snapshotCreated })) : null,
                              snapshot.restoredAt
                                ? h('span', { className: 'daw-badge daw-badge-ok' }, t('settings.snapshots.restoreBadge'))
                                : null,
                              snapshotRestored ? h('span', { className: 'daw-meta' }, t('settings.snapshots.restoredAt', { time: snapshotRestored })) : null,
                              snapshot.restoredPath ? h('code', { className: 'daw-code', title: snapshot.restoredPath }, snapshot.restoredPath) : null,
                            ),
                            h(
                              'div',
                              { className: 'daw-wt-actions' },
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'daw-button',
                                  disabled: busy !== '',
                                  'data-action': 'restore',
                                  'data-snapshot-ref': snapshot.ref,
                                  title: t('settings.snapshots.restore'),
                                  onClick: function () {
                                    runRestore(snapshot)
                                  },
                                },
                                isRestoring ? h('span', { className: 'daw-spin', 'aria-hidden': 'true' }) : null,
                                isRestoring ? t('settings.snapshots.restoring') : t('settings.snapshots.restore'),
                              ),
                            ),
                            rowError && rowError.key === restoreKey ? h('div', { className: 'daw-error', role: 'alert' }, rowError.message) : null,
                          ),
                        )
                      }
                      return h(
                        'div',
                        { className: 'daw-snapshots', 'data-dsh-codex-style-worktree-snapshots': group.repoRoot || '' },
                        h(
                          'div',
                          { className: 'daw-snapshots-head' },
                          h('h4', { className: 'daw-snapshots-title' }, t('settings.snapshots.title')),
                          h('span', { className: 'daw-meta' }, t('settings.snapshots.count', { count: String(repoSnapshots.length) })),
                        ),
                        snapshotRows,
                      )
                    })(),
                  )
                : null,
            ),
          )
        }
        content = h('div', { className: 'daw-groups' }, groups)
      }

      return h(
        'section',
        { className: 'daw-settings', 'aria-label': t('settings.title'), 'data-dsh-codex-style-worktree-settings': SECTION_ID },
        header,
        h(ConfigForm, { api: props.api }),
        managementHeader,
        content,
        rowError && rowError.key === 'prune' ? h('div', { className: 'daw-error', role: 'alert' }, rowError.message) : null,
        notice ? h('div', { className: 'daw-notice', role: 'status' }, notice) : null,
      )
    }

    function SettingsEntry(props) {
      return boundary(
        h('p', { className: 'daw-note' }, 'dsh-codex-style-worktree: render failed'),
        h(WorktreeSettings, props),
      )
    }

    /* ================================================================== *
     * 10. Plugin object                                                   *
     * ================================================================== */

    /**
     * Register one slot entry. `slots.inject(ownerKey, () => slots.register(...))`
     * is the documented contribution form; the disposer is owned by the plugin
     * fiber when `ctx.effect` exists.
     */
    function registerSlot(ctx, ownerKey, options, component) {
      var slots = ctx && ctx.slots
      if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return
      var install = function () {
        return slots.inject(ownerKey, function () {
          return slots.register(options, component)
        })
      }
      if (typeof ctx.effect === 'function') {
        try {
          ctx.effect(install, PLUGIN_NAME + ': ' + ownerKey)
          return
        } catch (error) {
          /* fall through to a bare registration */
        }
      }
      try {
        install()
      } catch (error) {
        /* a missing owner or a rejected registration must not break activation */
      }
    }

    function apply(ctx) {
      var api = createApi(ctx)

      ctx.effect(function () {
        return installStyles()
      }, PLUGIN_NAME + ': styles')

      ctx.effect(function () {
        return installLocale(resolveLocale(ctx))
      }, PLUGIN_NAME + ': locale')

      // One shared Session-projection store feeds the chip, the progress card and
      // the sidebar marker; it is refreshed only from the sessions list event.
      ctx.effect(function () {
        return installProjectionStore(ctx)
      }, PLUGIN_NAME + ': session projection store')

      registerSlot(
        ctx,
        'conversation.hero.options',
        {
          name: 'conversation.hero.options',
          id: PLACEMENT_ID,
          order: 10,
          locale: LOCALE_NS,
          inject: function () {
            return { api: api, ctx: ctx }
          },
        },
        PlacementEntry,
      )

      registerSlot(
        ctx,
        'conversation.input.dock',
        {
          name: 'conversation.input.dock',
          id: PROGRESS_ID,
          order: 30,
          locale: LOCALE_NS,
          inject: function () {
            return { api: api, ctx: ctx }
          },
        },
        ProgressEntry,
      )

      registerSlot(
        ctx,
        'sidebar.session.row.leading',
        {
          name: 'sidebar.session.row.leading',
          id: MARKER_ID,
          order: 20,
          locale: LOCALE_NS,
        },
        MarkerEntry,
      )

      registerSlot(
        ctx,
        'conversation.session.header.utilities',
        {
          name: 'conversation.session.header.utilities',
          id: CHIP_ID,
          order: -20,
          locale: LOCALE_NS,
          inject: function () {
            return { api: api }
          },
        },
        ChipEntry,
      )

      registerSlot(
        ctx,
        'settings.section',
        {
          name: 'settings.section',
          id: SECTION_ID,
          order: 40,
          locale: LOCALE_NS,
          label: function () {
            return translate('settings.title')
          },
          inject: function () {
            return { api: api, ctx: ctx }
          },
        },
        SettingsEntry,
      )
    }

    var plugin = {
      name: PLUGIN_NAME,
      inject: ['slots', 'connection', 'locale', 'workspaces', 'sessions'],
      apply: apply,
    }

    module.exports = { __esModule: true, default: plugin }
    return (module.exports && module.exports.default) || module.exports
  },
})
