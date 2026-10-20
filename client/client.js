/**
 * dsh-codex-worktree — browser half (DSH Web GUI). Display title:
 * "Codex 风格 Worktree" / "Codex-style Worktree".
 *
 * Registers three surfaces:
 *   1. `conversation.session.header.utilities` — a chip for the current Session's
 *      automatically created Git worktree (`wt:<name>` / branch), with a popover
 *      that shows the worktree facts and offers "clean up".
 *   2. `conversation.input.dock` — a "新建 Worktree / New worktree" button above the
 *      composer for a blank Session whose Workspace is not itself a worktree.
 *   3. `settings.section` — a management page listing every recorded worktree with
 *      refresh, prune and per-row actions.
 *
 * The browser artifact is a lazy factory whose id equals the package name
 * (`dsh-codex-worktree`). React comes from the browser module table, so `react` is
 * the only module this file may require.
 *
 * No build step: plain CommonJS-shaped source using React.createElement.
 */

window.__ModuleLoader__.load({
  id: 'dsh-codex-worktree',
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
    var PLUGIN_NAME = 'dsh-codex-worktree'
    /** Locale namespace owned by the client half. */
    var LOCALE_NS = 'dsh-codex-worktree'
    /** Base path of the authenticated host route carrier. */
    var API_PREFIX = '/api/dsh-codex-worktree'
    /** RPC method prefix the connection layer derives from API_PREFIX. */
    var RPC_NAMESPACE = 'dsh-codex-worktree'
    /**
     * RPC endpoints registered by the host half.
     *
     * `status`/`clean`/`list`/`prune` drive the Session chip and the management page;
     * `create` backs the composer dock button.
     */
    var ENDPOINTS = ['status', 'clean', 'list', 'prune', 'create']

    /**
     * `connection.rpc.call(channel, endpoint, payload, signal)` is the DSH wire
     * surface: the channel is one path segment (`/api`) and the endpoint is
     * `<namespace>/<key>` (its segments are validated individually). Together they
     * address `${API_PREFIX}/${key}` and produce `message.method ===
     * 'dsh-codex-worktree/'+key`, which is exactly the host-side contract.
     */
    var RPC_CHANNEL = '/' + String(API_PREFIX).split('/')[1]

    /** Attribute guarding the single injected <style> element. */
    var STYLE_ATTR = 'data-dsh-codex-worktree-style'
    var CHIP_ID = 'dsh-codex-worktree-chip'
    var SECTION_ID = 'dsh-codex-worktree'
    var DOCK_ID = 'dsh-codex-worktree-new'

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
      'popover.errorState': 'Could not read the worktree status.',
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
      'settings.confirmAction': 'Confirm',
      'settings.cancel': 'Cancel',
      'settings.forceHint': 'This worktree has uncommitted changes; force cleanup discards them.',
      'settings.deleteBranch': 'Also delete the branch',
      'settings.loadError': 'Failed to load records: {message}',
      'settings.rowError': 'Operation failed: {message}',
      'settings.noSession': 'This record has no Session id, so it cannot be managed from here.',
      'settings.unknown': 'unknown',
      'settings.config.title': 'Configuration',
      'settings.config.hint': 'Read-only here. Change these values in the profile cordis.patch.yml.',
      'settings.config.root': 'Worktree root',
      'settings.config.inRepo': 'inside the repository: {directory}',
      'settings.config.fetchBeforeCreate': 'Always fetch upstream before creating a worktree',
      'settings.config.autoPrune': 'Automatically delete old worktrees',
      'settings.config.autoPruneKeep': 'keep {count}',
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
      'settings.newChat': 'New chat here',
      'settings.newChat.busy': 'Opening\u2026',
      'settings.delete': 'Delete',
      'settings.delete.confirm': 'Delete this worktree? Its checkout directory is removed from disk.',
      'settings.delete.confirmAction': 'Confirm delete',
      'settings.delete.forceHint': 'This worktree has uncommitted changes. Force delete discards them.',
      'settings.delete.force': 'Force delete',
      'settings.deleted': 'Deleted {path}',
      'settings.conversations': 'Known conversations',
      'settings.openSession': 'Open conversation',
      'settings.newChatFailed': 'Could not start a chat: {message}',
      'settings.openFailed': 'Could not open the conversation: {message}',
      'settings.controllersUnavailable': 'This Client does not expose the Workspace/Session controllers.',
      'settings.rpcUnavailable': 'The host RPC connection is unavailable.',
      'dock.new': 'New worktree',
      'dock.new.busy': 'Creating\u2026',
      'dock.new.show': 'Create a Codex-style worktree and open a new Session in it',
      'dock.error.notGit': 'Not a Git repository',
      'dock.error.noCommit': 'Repository has no commits',
      'dock.error.disabled': 'Worktree disabled for this repository',
      'dock.error.limitReached': 'Worktree limit reached',
      'dock.error.noWorkspace': 'Could not find the Workspace of this Session.',
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
      'popover.errorState': '\u65e0\u6cd5\u8bfb\u53d6 Worktree \u72b6\u6001\u3002',
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
      'settings.confirmAction': '\u786e\u8ba4',
      'settings.cancel': '\u53d6\u6d88',
      'settings.forceHint': '\u8be5 Worktree \u6709\u672a\u63d0\u4ea4\u7684\u6539\u52a8\uff0c\u5f3a\u5236\u6e05\u7406\u4f1a\u4e22\u5f03\u5b83\u4eec\u3002',
      'settings.deleteBranch': '\u540c\u65f6\u5220\u9664\u5206\u652f',
      'settings.loadError': '\u8bfb\u53d6\u8bb0\u5f55\u5931\u8d25\uff1a{message}',
      'settings.rowError': '\u64cd\u4f5c\u5931\u8d25\uff1a{message}',
      'settings.noSession': '\u8be5\u8bb0\u5f55\u7f3a\u5c11\u4f1a\u8bdd ID\uff0c\u65e0\u6cd5\u5728\u6b64\u7ba1\u7406\u3002',
      'settings.unknown': '\u672a\u77e5',
      'settings.config.title': '\u914d\u7f6e',
      'settings.config.hint': '\u6b64\u5904\u4ec5\u4f9b\u67e5\u770b\uff0c\u8bf7\u5728 profile \u7684 cordis.patch.yml \u4e2d\u4fee\u6539\u3002',
      'settings.config.root': '\u5de5\u4f5c\u6811\u6839\u76ee\u5f55',
      'settings.config.inRepo': '\u4ed3\u5e93\u5185\uff1a{directory}',
      'settings.config.fetchBeforeCreate': '\u521b\u5efa\u5de5\u4f5c\u6811\u524d\u59cb\u7ec8\u83b7\u53d6\u4e0a\u6e38\u66f4\u65b0',
      'settings.config.autoPrune': '\u81ea\u52a8\u5220\u9664\u65e7\u5de5\u4f5c\u6811',
      'settings.config.autoPruneKeep': '\u4fdd\u7559 {count} \u4e2a',
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
      'settings.newChat': '\u5728\u6b64\u5de5\u4f5c\u6811\u4e2d\u65b0\u5efa\u804a\u5929',
      'settings.newChat.busy': '\u6b63\u5728\u6253\u5f00\u2026',
      'settings.delete': '\u5220\u9664',
      'settings.delete.confirm': '\u5220\u9664\u8fd9\u4e2a\u5de5\u4f5c\u6811\uff1f\u5de5\u4f5c\u533a\u76ee\u5f55\u5c06\u4ece\u78c1\u76d8\u4e0a\u79fb\u9664\u3002',
      'settings.delete.confirmAction': '\u786e\u8ba4\u5220\u9664',
      'settings.delete.forceHint': '\u8be5\u5de5\u4f5c\u6811\u6709\u672a\u63d0\u4ea4\u7684\u6539\u52a8\uff0c\u5f3a\u5236\u5220\u9664\u4f1a\u4e22\u5f03\u5b83\u4eec\u3002',
      'settings.delete.force': '\u5f3a\u5236\u5220\u9664',
      'settings.deleted': '\u5df2\u5220\u9664 {path}',
      'settings.conversations': '\u5df2\u77e5\u5bf9\u8bdd',
      'settings.openSession': '\u6253\u5f00\u5bf9\u8bdd',
      'settings.newChatFailed': '\u65e0\u6cd5\u65b0\u5efa\u804a\u5929\uff1a{message}',
      'settings.openFailed': '\u65e0\u6cd5\u6253\u5f00\u5bf9\u8bdd\uff1a{message}',
      'settings.controllersUnavailable': '\u5f53\u524d\u5ba2\u6237\u7aef\u672a\u63d0\u4f9b Workspace/Session \u63a7\u5236\u5668\u3002',
      'settings.rpcUnavailable': '\u4e3b\u673a RPC \u8fde\u63a5\u4e0d\u53ef\u7528\u3002',
      'dock.new': '\u65b0\u5efa Worktree',
      'dock.new.busy': '\u521b\u5efa\u4e2d\u2026',
      'dock.new.show': '\u521b\u5efa\u4e00\u4e2a Codex \u98ce\u683c Worktree \u5e76\u5728\u5176\u4e2d\u6253\u5f00\u65b0\u4f1a\u8bdd',
      'dock.error.notGit': '\u5f53\u524d\u5de5\u4f5c\u533a\u4e0d\u662f Git \u4ed3\u5e93',
      'dock.error.noCommit': '\u4ed3\u5e93\u8fd8\u6ca1\u6709\u4efb\u4f55\u63d0\u4ea4',
      'dock.error.disabled': '\u8be5\u4ed3\u5e93\u5df2\u5173\u95ed\u81ea\u52a8 Worktree',
      'dock.error.limitReached': '\u5df2\u8fbe\u5230\u8be5\u4ed3\u5e93\u7684 Worktree \u4e0a\u9650',
      'dock.error.noWorkspace': '\u672a\u627e\u5230\u5f53\u524d\u4f1a\u8bdd\u7684\u5de5\u4f5c\u533a\u3002',
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
     *   rpc.call('/api', 'dsh-codex-worktree/<key>', payload, signal)
     * which is the wire form of `${API_PREFIX}/${key}` with `method` =
     * `'dsh-codex-worktree/<key>'`.
     */
    function createApi(ctx) {
      function invoke(key, payload, signal) {
        if (ENDPOINTS.indexOf(key) === -1) {
          return Promise.reject(operationError('unknown-endpoint', 'dsh-codex-worktree: unknown endpoint ' + key))
        }
        var connection = readConnection(ctx)
        var rpc = connection && connection.rpc
        if (!rpc || typeof rpc.call !== 'function') {
          return Promise.reject(operationError('connection-unavailable', 'dsh-codex-worktree: connection.rpc.call is unavailable'))
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
        /**
         * Create a worktree for one Workspace path (the composer dock button).
         * Value: `{ path, repoRoot, baseCommit, repoLabel, mode, branch, createdAt }`.
         */
        createWorktree: function (input, signal) {
          var workspacePath = input && typeof input.path === 'string' ? input.path : ''
          return invoke('create', { path: workspacePath }, signal)
        },
      }
    }

    function unwrapResult(key, result) {
      if (!result || typeof result !== 'object') {
        throw operationError('invalid-response', 'dsh-codex-worktree/' + key + ': invalid RPC response')
      }
      if (result.ok === true) return result.value
      var wireError = result.error && typeof result.error === 'object' ? result.error : {}
      throw operationError(
        wireError.code === undefined ? 'rpc-failed' : wireError.code,
        typeof wireError.message === 'string' && wireError.message ? wireError.message : 'dsh-codex-worktree/' + key + ' failed',
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

    var EMPTY_LIST = Object.freeze({ repos: Object.freeze([]), config: EMPTY_CONFIG })

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
        return { repos: repos, config: config }
      }
      var rawRecords = value && Array.isArray(value.records) ? value.records : Array.isArray(value) ? value : []
      for (var flatIndex = 0; flatIndex < rawRecords.length; flatIndex += 1) {
        var flat = normalizeRecord(rawRecords[flatIndex], '')
        if (!flat) continue
        var key = flat.repoRoot || ''
        if (!byRepo[key]) pushRepo(repos, byRepo, key, [])
        byRepo[key].records.push(flat)
      }
      return { repos: repos, config: config }
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

    function pathsEqual(left, right) {
      var a = String(left == null ? '' : left).replace(/[\\/]+$/, '')
      var b = String(right == null ? '' : right).replace(/[\\/]+$/, '')
      if (!a || !b) return false
      var caseInsensitive = /^[A-Za-z]:/.test(a)
      return caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b
    }

    function workspaceItems(workspaces) {
      if (!workspaces || !workspaces.list || typeof workspaces.list.getSnapshot !== 'function') return []
      try {
        var snapshot = workspaces.list.getSnapshot()
        if (!snapshot) return []
        if (Array.isArray(snapshot.items)) return snapshot.items
        if (snapshot.byId && typeof snapshot.byId === 'object') return Object.keys(snapshot.byId).map(function (id) { return snapshot.byId[id] })
      } catch (error) {
        return []
      }
      return []
    }

    function findWorkspaceByPath(workspaces, path) {
      var items = workspaceItems(workspaces)
      for (var index = 0; index < items.length; index += 1) {
        if (items[index] && pathsEqual(items[index].path, path)) return items[index]
      }
      return null
    }

    /** Registered workspace for `path`, created on demand. Returns the workspace or null. */
    function ensureWorkspace(workspaces, path) {
      if (!workspaces || typeof workspaces.create !== 'function' || !path) return Promise.resolve(null)
      var existing = findWorkspaceByPath(workspaces, path)
      if (existing) return Promise.resolve(existing)
      return Promise.resolve(workspaces.create({ path: path })).then(function (created) {
        if (created) return created
        return findWorkspaceByPath(workspaces, path)
      })
    }

    function sessionIdOf(created) {
      if (typeof created === 'string' && created) return created
      if (created && typeof created === 'object') {
        if (typeof created.sessionId === 'string' && created.sessionId) return created.sessionId
        if (typeof created.id === 'string' && created.id) return created.id
      }
      return ''
    }

    /** Start a Session in the workspace registered for `path`. */
    function createSessionIn(ctx, path) {
      var workspaces = readService(ctx, 'workspaces')
      var sessions = readService(ctx, 'sessions')
      if (!workspaces || typeof workspaces.create !== 'function' || !sessions || typeof sessions.create !== 'function') {
        return Promise.reject(operationError('controllers-unavailable', 'workspaces/sessions controllers are unavailable'))
      }
      return ensureWorkspace(workspaces, path).then(function (workspace) {
        if (!workspace || !workspace.workspaceId) {
          throw operationError('workspace-unavailable', 'could not register a Workspace for ' + path)
        }
        return sessions.create({ workspaceId: workspace.workspaceId })
      }).then(function (created) {
        var sessionId = sessionIdOf(created)
        if (!sessionId) throw operationError('session-unavailable', 'the Session controller returned no Session id')
        openSessionById(ctx, sessionId)
        return sessionId
      })
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

    /**
     * Read the `status` endpoint for one Session. `revision` is the manual refresh
     * token; the effect aborts its request when the Session changes or unmounts.
     */
    function useWorktreeStatus(sessionId, apiRef, revision) {
      var pair = React.useState({ phase: 'idle', value: null, error: null })
      var setState = pair[1]
      React.useEffect(
        function () {
          if (!sessionId) {
            setState({ phase: 'idle', value: null, error: null })
            return undefined
          }
          var api = apiRef.current
          if (!api || typeof api.status !== 'function') {
            setState({
              phase: 'error',
              value: null,
              error: operationError('connection-unavailable', 'dsh-codex-worktree: connection.rpc.call is unavailable'),
            })
            return undefined
          }
          var alive = true
          var controller = typeof AbortController === 'function' ? new AbortController() : null
          setState(function (previous) {
            return {
              phase: previous && previous.value ? 'refreshing' : 'loading',
              value: previous ? previous.value : null,
              error: null,
            }
          })
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
        [sessionId, revision, apiRef, setState],
      )
      return pair[0]
    }

    /** Read the `list` endpoint; refresh through the returned revision bump. */
    function useWorktreeList(apiRef) {
      var pair = React.useState({ phase: 'loading', repos: [], config: EMPTY_CONFIG, error: null })
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
              config: previous ? previous.config : EMPTY_CONFIG,
              error: null,
            }
          })
          var pending
          try {
            if (!api || typeof api.list !== 'function') {
              throw operationError('connection-unavailable', 'dsh-codex-worktree: connection.rpc.call is unavailable')
            }
            pending = api.list(undefined, controller ? controller.signal : undefined)
          } catch (error) {
            pending = Promise.reject(error)
          }
          Promise.resolve(pending).then(
            function (value) {
              if (!alive) return
              var normalized = normalizeList(value)
              setState({ phase: 'ready', repos: normalized.repos, config: normalized.config, error: null })
            },
            function (error) {
              if (!alive) return
              if (controller && controller.signal && controller.signal.aborted) return
              setState({ phase: 'error', repos: [], config: EMPTY_CONFIG, error: toError(error) })
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
      '@layer dsh-codex-worktree {',
      '  .daw-chip-wrap, .daw-popover, .daw-settings, .daw-dock {',
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
      '  .daw-chip-wrap *, .daw-popover *, .daw-settings *, .daw-dock * { box-sizing: border-box; }',
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
      '  .daw-empty { margin-top: 16px; padding: 20px; border: 1px dashed var(--daw-line); border-radius: 12px; text-align: center; color: var(--daw-secondary); }',
      '  .daw-empty-hint { margin-top: 4px; color: var(--daw-muted); font-size: 12px; line-height: 18px; }',
      '  .daw-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }',
      '  .daw-dock { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 2px 2px 4px; }',
      '  .daw-dock-button { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px dashed var(--daw-line); border-radius: 8px; background: transparent; color: var(--daw-secondary); font: inherit; font-size: 12px; line-height: 1; cursor: pointer; transition: background .14s ease, border-color .14s ease, color .14s ease; }',
      '  .daw-dock-button:hover:not(:disabled) { border-color: var(--daw-brand); background: var(--daw-hover); color: var(--daw-text); }',
      '  .daw-dock-button:focus-visible { outline: 2px solid var(--daw-brand); outline-offset: 2px; }',
      '  .daw-dock-button:disabled { opacity: .55; cursor: default; }',
      '  .daw-dock-label { white-space: nowrap; }',
      '  .daw-dock-error { color: var(--daw-danger); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }',
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

    function chipTone(state) {
      if (state.phase === 'loading' || state.phase === 'refreshing' || state.phase === 'idle') return 'loading'
      if (state.phase === 'error') return 'error'
      if (!state.value || state.value.managed !== true) return 'idle'
      return 'managed'
    }

    function managedLabel(t, value) {
      if (!value || value.managed !== true) return t('chip.unmanaged')
      if (value.branch) return value.branch
      var name = baseName(value.path) || 'worktree'
      // The default directory prefix is `wt-`, so display `wt:<name>` without doubling it.
      var stripped = name.replace(/^wt[-_]/i, '')
      return 'wt:' + (stripped || name)
    }

    function WorktreeChip(props) {
      var t = useTranslator(props)
      useLocaleVersion()
      var apiRef = useStableRef(props.api)
      var sessionId = readSessionId(props)
      var revisionPair = React.useState(0)
      var revision = revisionPair[0]
      var bump = revisionPair[1]
      var refresh = React.useCallback(function () {
        bump(function (value) {
          return value + 1
        })
      }, [bump])
      var state = useWorktreeStatus(sessionId, apiRef, revision)
      var openPair = React.useState(false)
      var open = openPair[0]
      var setOpen = openPair[1]
      var wrapRef = React.useRef(null)
      useDismiss(open, React.useCallback(function () {
        setOpen(false)
      }, [setOpen]), wrapRef)

      if (!sessionId) return null

      var tone = chipTone(state)
      var value = state.value
      var label = tone === 'managed' ? managedLabel(t, value) : t('chip.' + (tone === 'idle' ? 'unmanaged' : tone))
      var dirty = tone === 'managed' && value && typeof value.dirty === 'number' && value.dirty > 0 ? value.dirty : 0
      var tooltip = tone === 'managed' && value ? value.path || t('chip.title') : t('chip.show')

      var chip = h(
        'button',
        {
          type: 'button',
          className: 'daw-chip daw-chip-' + tone,
          'data-dsh-codex-worktree-chip': CHIP_ID,
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
            state: state,
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
        h('span', { className: 'daw-chip daw-chip-error', title: 'dsh-codex-worktree' }, 'dsh-codex-worktree'),
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
      var state = props.state
      var value = state.value

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

      var managed = !!(value && value.managed === true)
      var disabled = busy !== ''

      function fail(error) {
        setActionError(describeError(t, error))
      }

      function runClean(force) {
        if (disabled) return
        var api = apiRef.current
        if (!api || typeof api.clean !== 'function') {
          fail(operationError('connection-unavailable', 'dsh-codex-worktree: connection.rpc.call is unavailable'))
          return
        }
        setBusy(force ? 'force' : 'clean')
        setActionError('')
        setNotice('')
        var targetPath = value && value.path ? value.path : ''
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
            setNotice(t('popover.clean.success', { path: targetPath || t('popover.none') }))
            onRefresh()
          },
          function (error) {
            setBusy('')
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
          h('button', { type: 'button', className: 'daw-button daw-button-ghost', onClick: onRefresh, disabled: state.phase === 'loading' || state.phase === 'refreshing' }, t('popover.refresh')),
          h('button', { type: 'button', className: 'daw-button daw-button-ghost', onClick: onClose, 'aria-label': t('popover.close'), title: t('popover.close') }, '\u00d7'),
        ),
      )

      var body
      if (state.phase === 'loading' || state.phase === 'refreshing' || state.phase === 'idle') {
        body = h('p', { className: 'daw-note' }, h('span', { className: 'daw-spin', 'aria-hidden': 'true' }), ' ', t('settings.loading'))
      } else if (state.phase === 'error') {
        body = h('div', null,
          h('p', { className: 'daw-note' }, t('popover.errorState')),
          h('div', { className: 'daw-error' }, t('popover.error', { message: messageOf(state.error) })),
        )
      } else if (!managed) {
        body = h('p', { className: 'daw-note' }, t('popover.unmanagedHint'))
      } else {
        var dirtyValue = value && typeof value.dirty === 'number' ? String(value.dirty) : t('popover.none')
        var modeText = value && value.mode === 'branch' ? t('popover.mode.branch') : value && value.mode === 'detached' ? t('popover.mode.detached') : value && value.mode ? value.mode : t('popover.none')
        var createdText = value && value.createdAt ? formatDate(value.createdAt, activeLanguage()) : ''
        body = h('div', null,
          h('dl', { className: 'daw-facts' },
            factRow(t, 'popover.path', h('code', { className: 'daw-code', title: value.path }, value.path || t('popover.none'))),
            value.repoRoot ? factRow(t, 'popover.repo', h('code', { className: 'daw-code', title: value.repoRoot }, value.repoRoot)) : null,
            factRow(t, 'popover.mode', modeText),
            factRow(t, 'popover.baseCommit', h('code', { className: 'daw-code', title: value.baseCommit }, shortCommit(value.baseCommit) || t('popover.none'))),
            factRow(t, 'popover.dirty', dirtyValue),
            createdText ? factRow(t, 'popover.created', createdText) : null,
          ),
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
                    h('button', { type: 'button', className: 'daw-button daw-button-ghost', disabled: disabled, onClick: function () { setConfirming(false); setDirtyBlocked(false); setActionError('') } }, t('popover.clean.cancel')),
                  ),
                )
              : h('div', { className: 'daw-actions', style: { marginTop: 0 } },
                  h('button', { type: 'button', className: 'daw-button', disabled: disabled, onClick: function () { setConfirming(true); setActionError(''); setNotice('') } }, t('popover.clean.action')),
                ),
            dirtyBlocked
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
          'data-dsh-codex-worktree-popover': '',
        },
        head,
        body,
        actionError ? h('div', { className: 'daw-error', role: 'alert' }, actionError) : null,
        notice ? h('div', { className: 'daw-notice', role: 'status' }, notice) : null,
      )
    }

    /* ================================================================== *
     * 8b. Composer dock — "新建 Worktree" for a blank Session             *
     * ================================================================== */

    /** The worktree directory marker used to tell a main checkout from a worktree. */
    var WORKTREE_DIR_SEGMENT = '/.agents/worktrees/'

    function isWorktreePath(path) {
      var normalized = String(path == null ? '' : path).replace(/\\/g, '/')
      return normalized.indexOf(WORKTREE_DIR_SEGMENT) !== -1
    }

    function sessionIdOfSnapshot(session) {
      if (!session || typeof session !== 'object') return ''
      return firstString(session.sessionId, session.id)
    }

    /** Selector for the Workspace that owns this Session (the owner passes `useWorkspaces`). */
    function selectWorkspaceForSession(session) {
      var sessionId = sessionIdOfSnapshot(session)
      return function (state) {
        if (!sessionId || !state || !Array.isArray(state.items)) return undefined
        for (var index = 0; index < state.items.length; index += 1) {
          var workspace = state.items[index]
          if (!workspace) continue
          if (Array.isArray(workspace.sessionIds) && workspace.sessionIds.indexOf(sessionId) !== -1) return workspace
        }
        return undefined
      }
    }

    /**
     * Resolve the Session's Workspace through the slot-provided selector hook. The
     * fallback (no hook supplied, e.g. a direct component mount) reads the snapshot
     * once without subscribing; the slot runtime always provides `useWorkspaces`.
     */
    function useSessionWorkspace(props, session) {
      var useWorkspaces = props && typeof props.useWorkspaces === 'function' ? props.useWorkspaces : null
      if (useWorkspaces) return useWorkspaces(selectWorkspaceForSession(session))
      var service = readService(props && props.ctx, 'workspaces')
      if (!service || !service.list || typeof service.list.getSnapshot !== 'function') return undefined
      try {
        return selectWorkspaceForSession(session)(service.list.getSnapshot())
      } catch (error) {
        return undefined
      }
    }

    function iconWorktree(size) {
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

    /** Map the host's `create` failure codes to friendly copy; otherwise keep the message. */
    function describeCreateError(t, error) {
      var code = String((error && error.code) || '')
      if (code === 'not-git-repository') return t('dock.error.notGit')
      if (code === 'no-commit') return t('dock.error.noCommit')
      if (code === 'disabled') return t('dock.error.disabled')
      if (code === 'limit-reached') return t('dock.error.limitReached')
      return messageOf(error) || t('settings.rpcUnavailable')
    }

    /** Open the Session just created in the new Worktree's Workspace. */
    function openCreatedSession(ctx, created, sessionId) {
      var sessions = readService(ctx, 'sessions')
      if (sessions && typeof sessions.open === 'function') {
        sessions.open(typeof created === 'string' && created ? created : sessionId)
        return
      }
      openSessionById(ctx, sessionId)
    }

    function WorktreeCreationDock(props) {
      var t = useTranslator(props)
      useLocaleVersion()
      var apiRef = useStableRef(props.api)
      var ctxRef = useStableRef(props.ctx)
      var statePair = React.useState({ phase: 'idle', error: '' })
      var state = statePair[0]
      var setState = statePair[1]
      var timerRef = React.useRef(null)
      var abortRef = React.useRef(null)
      var session = props && props.session && typeof props.session === 'object' ? props.session : null
      var workspace = useSessionWorkspace(props, session)

      React.useEffect(function () {
        return function () {
          if (timerRef.current && typeof clearTimeout === 'function') {
            try {
              clearTimeout(timerRef.current)
            } catch (error) {
              /* already fired */
            }
            timerRef.current = null
          }
          if (abortRef.current && typeof abortRef.current.abort === 'function') {
            try {
              abortRef.current.abort()
            } catch (error) {
              /* already aborted */
            }
            abortRef.current = null
          }
        }
      }, [])

      // A brand-new Session may render before the Workspace snapshot lists it;
      // its header cwd is the same directory the Workspace would report.
      var workspacePath = firstString(
        workspace && workspace.path,
        session && session.header && session.header.cwd,
        session && session.cwd,
      )
      var visible = !!(session && session.blank === true && workspacePath !== '' && !isWorktreePath(workspacePath))
      if (!visible) return null

      var creating = state.phase === 'creating'

      function showError(message) {
        setState({ phase: 'idle', error: message })
        if (timerRef.current && typeof clearTimeout === 'function') {
          try {
            clearTimeout(timerRef.current)
          } catch (error) {
            /* already fired */
          }
          timerRef.current = null
        }
        if (typeof setTimeout === 'function') {
          timerRef.current = setTimeout(function () {
            timerRef.current = null
            setState({ phase: 'idle', error: '' })
          }, 8000)
        }
      }

      function startCreate() {
        if (creating) return
        var api = apiRef.current
        var ctx = ctxRef.current
        var workspaces = readService(ctx, 'workspaces')
        var sessions = readService(ctx, 'sessions')
        if (!api || typeof api.createWorktree !== 'function') {
          showError(t('settings.rpcUnavailable'))
          return
        }
        if (!workspaces || typeof workspaces.create !== 'function' || !sessions || typeof sessions.create !== 'function') {
          showError(t('settings.controllersUnavailable'))
          return
        }
        if (!workspacePath) {
          showError(t('dock.error.noWorkspace'))
          return
        }
        if (timerRef.current && typeof clearTimeout === 'function') {
          try {
            clearTimeout(timerRef.current)
          } catch (error) {
            /* already fired */
          }
          timerRef.current = null
        }
        var controller = typeof AbortController === 'function' ? new AbortController() : null
        abortRef.current = controller
        setState({ phase: 'creating', error: '' })

        var pending
        try {
          pending = api.createWorktree({ path: workspacePath }, controller ? controller.signal : undefined)
        } catch (error) {
          pending = Promise.reject(error)
        }
        Promise.resolve(pending)
          .then(function (value) {
            var createdWorktree = value && typeof value === 'object' ? value : {}
            var worktreePath = firstString(createdWorktree.path)
            if (!worktreePath) throw operationError('create-failed', 'create returned no worktree path')
            var repoLabel = firstString(createdWorktree.repoLabel) || (createdWorktree.repoRoot ? baseName(createdWorktree.repoRoot) : '')
            var title = (repoLabel || 'worktree') + '/' + (baseName(worktreePath) || 'worktree')
            return Promise.resolve(workspaces.create({ path: worktreePath }))
              .then(function (createdWorkspace) {
                if (!createdWorkspace || !createdWorkspace.workspaceId) {
                  throw operationError('workspace-unavailable', 'workspaces.create returned no workspaceId')
                }
                // Same sequence as the reference plugin: create → rename → create Session → open.
                var rename =
                  typeof workspaces.rename === 'function'
                    ? Promise.resolve(workspaces.rename(createdWorkspace.workspaceId, title))
                    : Promise.resolve()
                return rename.then(function () {
                  return createdWorkspace
                })
              })
              .then(function (createdWorkspace) {
                return Promise.resolve(sessions.create({ workspaceId: createdWorkspace.workspaceId })).then(function (createdSession) {
                  var nextSessionId = sessionIdOf(createdSession) || sessionIdOfSnapshot(createdSession)
                  if (!nextSessionId) throw operationError('session-unavailable', 'sessions.create returned no Session id')
                  openCreatedSession(ctx, createdSession, nextSessionId)
                })
              })
          })
          .then(
            function () {
              abortRef.current = null
              setState({ phase: 'idle', error: '' })
            },
            function (error) {
              abortRef.current = null
              if (controller && controller.signal && controller.signal.aborted) return
              showError(describeCreateError(t, error))
            },
          )
      }

      return h(
        'div',
        { className: 'daw-dock', 'data-dsh-codex-worktree-new': DOCK_ID },
        h(
          'button',
          {
            type: 'button',
            className: 'daw-dock-button',
            disabled: creating,
            'aria-busy': creating ? 'true' : undefined,
            'aria-label': t('dock.new.show'),
            title: t('dock.new.show'),
            onClick: startCreate,
          },
          creating ? h('span', { className: 'daw-spin', 'aria-hidden': 'true' }) : iconWorktree(14),
          h('span', { className: 'daw-dock-label' }, creating ? t('dock.new.busy') : t('dock.new')),
        ),
        state.error ? h('div', { className: 'daw-dock-error', role: 'alert' }, state.error) : null,
      )
    }

    function DockEntry(props) {
      return boundary(null, h(WorktreeCreationDock, props))
    }

    /* ================================================================== *
     * 9. Settings section — Worktrees management page                     *
     * ================================================================== */

    var DETACHED_MODE = 'detached'
    var BRANCH_MODE = 'branch'

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

    function onOff(t, value) {
      return value ? t('settings.config.on') : t('settings.config.off')
    }

    function configRootText(t, config) {
      if (config.root) return config.root
      return '(' + t('settings.config.inRepo', { directory: config.directory || '.' }) + ')'
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
      var errorPair = React.useState(null)
      var rowError = errorPair[0]
      var setRowError = errorPair[1]
      var noticePair = React.useState('')
      var notice = noticePair[0]
      var setNotice = noticePair[1]

      var language = activeLanguage()
      var config = state.config || EMPTY_CONFIG
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

      function startChat(record, key) {
        if (busy) return
        if (!record.path) {
          fail(key, t('settings.newChatFailed', { message: t('settings.unknown') }))
          return
        }
        setBusy('new:' + key)
        clearMessages()
        Promise.resolve()
          .then(function () {
            return createSessionIn(ctxRef.current, record.path)
          })
          .then(
            function () {
              setBusy('')
            },
            function (error) {
              setBusy('')
              var message = error && error.code === 'controllers-unavailable' ? t('settings.controllersUnavailable') : messageOf(error)
              fail(key, t('settings.newChatFailed', { message: message }))
            },
          )
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
            setNotice(t('settings.deleted', { path: record.path || record.repoRoot || '' }))
            refresh()
          },
          function (error) {
            setBusy('')
            if (force !== true && isDirtyError(error)) {
              setForceKey(key)
              fail(key, t('settings.delete.forceHint'))
              return
            }
            fail(key, t('settings.rowError', { message: messageOf(error) }))
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

      var configBlock = h(
        'section',
        { className: 'daw-config', 'aria-label': t('settings.config.title') },
        h('h3', { className: 'daw-config-title' }, t('settings.config.title')),
        h(
          'dl',
          { className: 'daw-config-grid' },
          h(
            React.Fragment,
            { key: 'root' },
            h('dt', { className: 'daw-fact-label' }, t('settings.config.root')),
            h('dd', { className: 'daw-fact-value' }, h('code', { className: 'daw-code', title: configRootText(t, config) }, configRootText(t, config))),
          ),
          h(
            React.Fragment,
            { key: 'fetch' },
            h('dt', { className: 'daw-fact-label' }, t('settings.config.fetchBeforeCreate')),
            h('dd', { className: 'daw-fact-value' }, onOff(t, config.fetchBeforeCreate)),
          ),
          h(
            React.Fragment,
            { key: 'prune' },
            h('dt', { className: 'daw-fact-label' }, t('settings.config.autoPrune')),
            h(
              'dd',
              { className: 'daw-fact-value' },
              onOff(t, config.autoPrune),
              config.autoPrune && config.autoPruneKeep !== null ? h('span', { className: 'daw-meta' }, ' \u00b7 ' + t('settings.config.autoPruneKeep', { count: String(config.autoPruneKeep) })) : null,
            ),
          ),
        ),
        h('p', { className: 'daw-note' }, t('settings.config.hint')),
        h(
          'div',
          { className: 'daw-actions' },
          h(
            'button',
            { type: 'button', className: 'daw-button', disabled: busy !== '' || loading, onClick: runPrune },
            busy === 'prune' ? h('span', { className: 'daw-spin', 'aria-hidden': 'true' }) : null,
            busy === 'prune' ? t('settings.prune.busy') : t('settings.prune.action'),
          ),
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
            const isBusy = busy === 'delete:' + key
            const isStarting = busy === 'new:' + key
            const isDetached = record.mode === DETACHED_MODE || (!record.mode && !record.branch)
            const modeText = isDetached
              ? t('settings.mode.detached')
              : record.branch || (record.mode === BRANCH_MODE ? t('settings.mode.branch') : record.mode || t('settings.unknown'))
            const createdText = record.createdAt !== undefined && record.createdAt !== null ? formatDate(record.createdAt, language) : ''
            const dirtyCount = typeof record.dirty === 'number' ? record.dirty : null

            const actions = h(
              'div',
              { className: 'daw-wt-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'daw-button',
                  disabled: busy !== '' || !record.path,
                  onClick: function () {
                    startChat(record, key)
                  },
                },
                isStarting ? h('span', { className: 'daw-spin', 'aria-hidden': 'true' }) : null,
                isStarting ? t('settings.newChat.busy') : t('settings.newChat'),
              ),
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
                    clearMessages()
                  },
                },
                t('settings.delete'),
              ),
            )

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
                        isForcing
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
                actions,
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
              expanded ? h('div', { className: 'daw-wt-list' }, rows.length > 0 ? rows : h('p', { className: 'daw-note' }, t('settings.empty'))) : null,
            ),
          )
        }
        content = h('div', { className: 'daw-groups' }, groups)
      }

      return h(
        'section',
        { className: 'daw-settings', 'aria-label': t('settings.title'), 'data-dsh-codex-worktree-settings': SECTION_ID },
        header,
        configBlock,
        content,
        rowError && rowError.key === 'prune' ? h('div', { className: 'daw-error', role: 'alert' }, rowError.message) : null,
        notice ? h('div', { className: 'daw-notice', role: 'status' }, notice) : null,
      )
    }

    function SettingsEntry(props) {
      return boundary(
        h('p', { className: 'daw-note' }, 'dsh-codex-worktree: render failed'),
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
        'conversation.input.dock',
        {
          name: 'conversation.input.dock',
          id: DOCK_ID,
          order: 20,
          locale: LOCALE_NS,
          label: function () {
            return translate('dock.new')
          },
          inject: function () {
            return { api: api, ctx: ctx }
          },
        },
        DockEntry,
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
