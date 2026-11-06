// dsh-zotero-workspace — browser half (client plugin bundle).
//
// Loaded by dsh-client-modules at /plugins/dsh-zotero-workspace/client.js and
// executed through the vendored cordis Loader's lazy-CJS module table
// (window.__ModuleLoader__.load). The factory body is plain CJS with
// require() resolved against the shell's module table; only React and the
// client services declared in package.json dsh.client.inject are used.
//
// What it does: registers one native right-sidebar tab ("Zotero") whose body
// lists Zotero collections and items (through the Host half's read-only
// proxy), opens a paper's PDF or parsed Markdown in DSH's own file preview
// tab, and writes a citation plus the absolute file paths into the current
// conversation draft through the session-level `inputActions` prop.

window.__ModuleLoader__.load({
  id: 'dsh-zotero-workspace',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = null
    try {
      React = require('react')
    } catch (error) {
      React = null
    }
    if (React === null) {
      // The shell loses the tab instead of the whole page when React cannot be
      // resolved: an empty plugin that still exports the cordis shape.
      exports.apply = () => {}
      exports.inject = []
      return module.exports
    }

    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useMemo = React.useMemo
    var useCallback = React.useCallback
    var useRef = React.useRef

    var NS = 'dsh-zotero-workspace'
    var TAB_ID = 'zotero-workspace'
    var API_BASE = '/dsh-zotero-workspace/api'

    // ── locale ────────────────────────────────────────────────────────────
    var ZH = {
      'tab.title': 'Zotero',
      'tab.desc': '浏览 Zotero 集合与文献，读 PDF / Markdown，一键带入对话',
      'guide.title': 'Zotero 文献工作台',
      'guide.desc': '按 Zotero 集合浏览文献；双击读 PDF、打开解析后的 Markdown，一键把引用与文件路径带入当前对话。',
      'status.connecting': '正在连接 Zotero…',
      'status.offline': 'Zotero 未连接',
      'status.hint': '请打开 Zotero，并在「设置 → 高级」勾选「允许此计算机上的其他应用程序与 Zotero 通信」。',
      'status.retry': '重试',
      'status.storage': '存储',
      'all': '全部文献',
      'empty.collections': '（没有集合）',
      'empty.items': '这个范围里没有文献',
      'loading': '加载中…',
      'loadMore': '加载更多',
      'search.placeholder': '搜索当前范围（标题 / 摘要 / 全文）',
      'empty.search': '没有匹配的文献',
      'total': '共 {n} 条',
      'layout.drag': '拖动调整高度，双击恢复默认',
      'selectHint': '选中一条文献查看详情与操作',
      'btn.pdf': '打开 PDF',
      'btn.md': '打开 Markdown',
      'btn.cite': '带入对话',
      'btn.copy': '复制引用',
      'noPdf': '无 PDF 附件',
      'noMd': '无解析后的 Markdown',
      'notice.inserted': '已写入当前对话草稿',
      'notice.draftChanged': '草稿已变化，请再点一次',
      'notice.copied': '输入框不可用，引用已复制到剪贴板',
      'notice.copiedPath': '无法打开预览，路径已复制到剪贴板',
      'notice.openFailed': '打开预览失败',
      'notes.title': 'Zotero 笔记',
      'abstract.title': '摘要',
      'err.network': '无法访问宿主端点',
    }
    var EN = {
      'tab.title': 'Zotero',
      'tab.desc': 'Browse Zotero collections, read PDF / Markdown, cite into chat',
      'guide.title': 'Zotero workspace',
      'guide.desc': 'Browse Zotero collections; double-click to read the PDF, open parsed Markdown, and put a citation plus file paths into the current conversation.',
      'status.connecting': 'Connecting to Zotero…',
      'status.offline': 'Zotero not connected',
      'status.hint': 'Open Zotero and enable “Allow other applications on this computer to communicate with Zotero” in Settings → Advanced.',
      'status.retry': 'Retry',
      'status.storage': 'Storage',
      'all': 'All items',
      'empty.collections': '(no collections)',
      'empty.items': 'No items in this scope',
      'loading': 'Loading…',
      'loadMore': 'Load more',
      'search.placeholder': 'Search this scope (title / abstract / full text)',
      'empty.search': 'No matching items',
      'total': '{n} total',
      'layout.drag': 'Drag to resize, double-click to reset',
      'selectHint': 'Select an item to see details and actions',
      'btn.pdf': 'Open PDF',
      'btn.md': 'Open Markdown',
      'btn.cite': 'Send to chat',
      'btn.copy': 'Copy citation',
      'noPdf': 'No PDF attachment',
      'noMd': 'No parsed Markdown',
      'notice.inserted': 'Inserted into the current draft',
      'notice.draftChanged': 'Draft changed, try again',
      'notice.copied': 'Composer unavailable; citation copied to clipboard',
      'notice.copiedPath': 'Preview unavailable; path copied to clipboard',
      'notice.openFailed': 'Could not open the preview',
      'notes.title': 'Zotero notes',
      'abstract.title': 'Abstract',
      'err.network': 'Cannot reach the Host endpoint',
    }

    function makeT(locale) {
      var dicts = { zh: ZH, en: EN }
      return function t(key) {
        var preferred = dicts[locale] || ZH
        return preferred[key] !== undefined ? preferred[key] : key
      }
    }

    // ── host API ──────────────────────────────────────────────────────────
    async function api(action, query) {
      var url = API_BASE + '/' + action
      if (query) {
        var params = new URLSearchParams()
        for (var key in query) {
          if (!Object.prototype.hasOwnProperty.call(query, key)) continue
          var value = query[key]
          if (value === undefined || value === null || value === '') continue
          params.set(key, String(value))
        }
        var qs = params.toString()
        if (qs !== '') url += '?' + qs
      }
      var res = await fetch(url)
      var payload = null
      try {
        payload = await res.json()
      } catch (error) {
        throw new Error('非 JSON 响应（HTTP ' + res.status + '）')
      }
      if (!payload || payload.ok !== true) {
        var message = payload && payload.error && payload.error.message ? payload.error.message : 'HTTP ' + res.status
        throw new Error(message)
      }
      return payload.data
    }

    // ── DSH helpers ───────────────────────────────────────────────────────
    // DSH's document-preview tab claims SESSION file addresses only (it does
    // not claim the `absolute/` scope), so a file outside the workspace is
    // opened as `session/<id>/<absolute path>` — the same grammar the host's
    // own sidebar_open tool uses. Absolute scope stays as a last resort.
    var FILE_PREFIX = 'dsh-resource://file/'
    function encodeSegment(segment) {
      return encodeURIComponent(segment).replace(/%3A/gi, ':')
    }
    function encodePath(path) {
      return String(path).split('/').map(encodeSegment).join('/')
    }
    function sessionFileAddress(sessionId, path) {
      var normalized = String(path).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
      if (sessionId) return FILE_PREFIX + 'session/' + encodeSegment(sessionId) + '/' + encodePath(normalized)
      var absolute = normalized.replace(/^\/+/, '')
      return FILE_PREFIX + 'absolute/' + encodePath(absolute)
    }
    function baseName(path) {
      var text = String(path || '')
      var at = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
      return at === -1 ? text : text.slice(at + 1)
    }
    function copyText(text) {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(text)
          return true
        }
      } catch (error) {
        return false
      }
      return false
    }

    // ── resizable section layout ──────────────────────────────────────────
    // Vertical boundaries between the collection tree, the item list and the
    // detail pane are draggable; the two fractions persist per user.
    var LAYOUT_KEY = 'dsh-zotero-workspace:layout'
    var DEFAULT_TREE_FRAC = 0.32
    var DEFAULT_DETAIL_FRAC = 0.42

    function clampFraction(value, fallback) {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0.08 && value <= 0.82 ? value : fallback
    }

    function readLayout() {
      var fallback = { tree: DEFAULT_TREE_FRAC, detail: DEFAULT_DETAIL_FRAC }
      try {
        var raw = localStorage.getItem(LAYOUT_KEY)
        if (!raw) return fallback
        var parsed = JSON.parse(raw)
        return { tree: clampFraction(parsed && parsed.tree, fallback.tree), detail: clampFraction(parsed && parsed.detail, fallback.detail) }
      } catch (error) {
        return fallback
      }
    }

    function writeLayout(tree, detail) {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify({ tree: tree, detail: detail }))
      } catch (error) {
        /* layout persistence is cosmetic */
      }
    }

    // ── components ────────────────────────────────────────────────────────
    function Pane(props) {
      var ctx = props.ctx
      var t = props.t
      var inputActions = props.inputActions
      var sessionId = props.sessionId
      var [boot, setBoot] = useState({ status: 'loading' })
      var [collections, setCollections] = useState([])
      var [storageRoot, setStorageRoot] = useState('')
      var [expanded, setExpanded] = useState({})
      var [scope, setScope] = useState({ type: 'all', key: '' })
      var [items, setItems] = useState([])
      var [total, setTotal] = useState(null)
      var [search, setSearch] = useState('')
      var [debouncedSearch, setDebouncedSearch] = useState('')
      var [itemsLoading, setItemsLoading] = useState(false)
      var [hasMore, setHasMore] = useState(false)
      var [itemsError, setItemsError] = useState('')
      var [selectedKey, setSelectedKey] = useState('')
      var [detail, setDetail] = useState(null)
      var [detailLoading, setDetailLoading] = useState(false)
      var [notice, setNotice] = useState('')
      var [reloadToken, setReloadToken] = useState(0)
      var noticeTimer = useRef(null)
      var rootRef = useRef(null)
      var [containerH, setContainerH] = useState(0)
      var [treeFrac, setTreeFrac] = useState(function () {
        return readLayout().tree
      })
      var [detailFrac, setDetailFrac] = useState(function () {
        return readLayout().detail
      })

      function flash(message) {
        setNotice(message)
        if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
        noticeTimer.current = setTimeout(function () {
          setNotice('')
        }, 2600)
      }

      var refresh = useCallback(async function () {
        setBoot({ status: 'loading' })
        try {
          var health = await api('health')
          if (!health.running) {
            setBoot({ status: 'offline', message: health.message || '' })
            return
          }
          var tree = await api('tree')
          setCollections(Array.isArray(tree.collections) ? tree.collections : [])
          setStorageRoot(tree.storageRoot || health.storageRoot || '')
          setBoot({ status: 'ready', version: health.version || '' })
          setReloadToken(function (value) {
            return value + 1
          })
        } catch (error) {
          setBoot({ status: 'offline', message: error && error.message ? error.message : String(error) })
        }
      }, [])

      var loadItems = useCallback(async function (nextScope, start, append, qText) {
        setItemsLoading(true)
        setItemsError('')
        try {
          var data = await api('items', {
            collection: nextScope.type === 'collection' ? nextScope.key : '',
            q: qText || '',
            start: start || 0,
          })
          setItems(function (previous) {
            return append ? previous.concat(data.items) : data.items
          })
          setTotal(typeof data.total === 'number' ? data.total : null)
          setHasMore(Boolean(data.hasMore))
        } catch (error) {
          setItemsError(error && error.message ? error.message : String(error))
        } finally {
          setItemsLoading(false)
        }
      }, [])

      useEffect(function () {
        refresh()
        return function () {
          if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
        }
      }, [refresh])

      // Leaving a scope clears the search box; typing debounces into the
      // server-side Zotero search (title/abstract/full text within the scope).
      useEffect(function () {
        setSearch('')
        setDebouncedSearch('')
      }, [scope])

      useEffect(function () {
        var timer = setTimeout(function () {
          setDebouncedSearch(search)
        }, 350)
        return function () {
          clearTimeout(timer)
        }
      }, [search])

      useEffect(function () {
        setItems([])
        setTotal(null)
        setSelectedKey('')
        setDetail(null)
        loadItems(scope, 0, false, debouncedSearch)
      }, [scope, reloadToken, debouncedSearch, loadItems])

      // Track the panel height so the draggable sections keep their real size
      // when the user resizes the right column or the window.
      useEffect(function () {
        var node = rootRef.current
        if (!node) return undefined
        function measure() {
          setContainerH(node.clientHeight || 0)
        }
        measure()
        if (typeof ResizeObserver !== 'undefined') {
          var observer = new ResizeObserver(measure)
          observer.observe(node)
          return function () {
            observer.disconnect()
          }
        }
        window.addEventListener('resize', measure)
        return function () {
          window.removeEventListener('resize', measure)
        }
      }, [])

      useEffect(function () {
        writeLayout(treeFrac, detailFrac)
      }, [treeFrac, detailFrac])

      var selectItem = useCallback(async function (key) {
        setSelectedKey(key)
        setDetail(null)
        setDetailLoading(true)
        try {
          var data = await api('item', { key: key })
          setDetail(data)
        } catch (error) {
          flash(error && error.message ? error.message : String(error))
        } finally {
          setDetailLoading(false)
        }
      }, [])

      function openPath(path, title) {
        if (!path) return
        var label = title || baseName(path)
        var opened = false
        // Preferred: better-sidebar's public openFile — the same call path DSH's
        // own sidebar_open tool uses (verified working for files outside the
        // workspace). Absent, fall back to the native Session file address.
        try {
          var betterSidebar = typeof ctx.get === 'function' ? ctx.get('betterSidebar') : undefined
          if (betterSidebar && typeof betterSidebar.openFile === 'function' && sessionId) {
            betterSidebar.openFile({ sessionId: sessionId }, path, label)
            opened = true
          }
        } catch (error) {
          opened = false
        }
        if (!opened) {
          try {
            ctx.sidebarRight.openResource(sessionFileAddress(sessionId, path), {
              params: { title: label },
            })
            opened = true
          } catch (error) {
            opened = false
          }
        }
        if (!opened) {
          copyText(path)
          flash(t('notice.copiedPath'))
        }
      }

      function buildCitation(current) {
        if (!current) return ''
        var item = current.item
        var authors = Array.isArray(item.creators) && item.creators.length > 0
          ? item.creators.slice(0, 3).join(', ') + (item.creators.length > 3 ? ' 等' : '')
          : item.creatorSummary || ''
        var head = '[Zotero] ' + item.title
        if (authors !== '' || item.year !== '') {
          head += ' — ' + authors + (item.year !== '' ? ' (' + item.year + ')' : '')
        }
        var parts = [head, 'itemKey=' + item.key]
        parts.push('PDF: ' + (current.pdf && current.pdf.path ? current.pdf.path : '无'))
        parts.push('MD: ' + (current.mds && current.mds.length > 0 && current.mds[0].path ? current.mds[0].path : '无'))
        return parts.join(' | ')
      }

      function insertCitation(current) {
        var text = buildCitation(current)
        if (text === '') return
        if (inputActions && typeof inputActions.captureInsertion === 'function' && typeof inputActions.insertText === 'function') {
          try {
            var span = inputActions.captureInsertion()
            var inserted = inputActions.insertText(text, span)
            flash(inserted ? t('notice.inserted') : t('notice.draftChanged'))
            return
          } catch (error) {
            /* fall through to clipboard */
          }
        }
        copyText(text)
        flash(t('notice.copied'))
      }

      /** Drag a horizontal boundary; sections are stored as panel-height fractions. */
      function beginDrag(kind, event) {
        if (!event || typeof event.clientY !== 'number') return
        var node = rootRef.current
        var height = node ? node.clientHeight : 0
        if (height <= 0) height = containerH
        if (height <= 0) return
        if (typeof event.preventDefault === 'function') event.preventDefault()
        var startY = event.clientY
        var startTree = treeFrac
        var startDetail = detailFrac
        var detailPresent = selectedKey !== ''
        var minList = 96 / height
        function onMove(moveEvent) {
          var delta = (moveEvent.clientY - startY) / height
          if (kind === 'tree') {
            var maxTree = 1 - (detailPresent ? startDetail : 0) - minList
            var floorTree = 64 / height
            setTreeFrac(Math.min(Math.max(startTree + delta, floorTree), Math.max(floorTree, maxTree)))
          } else {
            var maxDetail = 1 - startTree - minList
            var floorDetail = 84 / height
            setDetailFrac(Math.min(Math.max(startDetail - delta, floorDetail), Math.max(floorDetail, maxDetail)))
          }
        }
        function onUp() {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
          try {
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
          } catch (error) {
            /* ignore */
          }
        }
        try {
          document.body.style.cursor = 'row-resize'
          document.body.style.userSelect = 'none'
        } catch (error) {
          /* ignore */
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
      }

      var childrenByParent = useMemo(function () {
        var map = {}
        for (var i = 0; i < collections.length; i += 1) {
          var node = collections[i]
          var parent = node.parent || '__root__'
          if (!map[parent]) map[parent] = []
          map[parent].push(node)
        }
        for (var key in map) {
          if (!Object.prototype.hasOwnProperty.call(map, key)) continue
          map[key].sort(function (a, b) {
            return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN')
          })
        }
        return map
      }, [collections])

      function toggleExpand(key) {
        setExpanded(function (previous) {
          var next = {}
          for (var k in previous) if (Object.prototype.hasOwnProperty.call(previous, k)) next[k] = previous[k]
          next[key] = !previous[key]
          return next
        })
      }

      function renderCollectionTree(parentKey, depth) {
        var nodes = childrenByParent[parentKey] || []
        if (nodes.length === 0) return []
        var rows = []
        for (var i = 0; i < nodes.length; i += 1) {
          var node = nodes[i]
          var hasChildren = (childrenByParent[node.key] || []).length > 0
          var open = expanded[node.key] !== false
          var active = scope.type === 'collection' && scope.key === node.key
          rows.push(h(CollectionRow, {
            key: node.key,
            node: node,
            depth: depth,
            hasChildren: hasChildren,
            open: open,
            active: active,
            t: t,
            onToggle: toggleExpand,
            onSelect: function (target) {
              setScope({ type: 'collection', key: target.key })
            },
          }))
          if (hasChildren && open) {
            rows = rows.concat(renderCollectionTree(node.key, depth + 1))
          }
        }
        return rows
      }

      var treeRows = boot.status === 'ready' ? renderCollectionTree('__root__', 0) : []

      var rootActive = scope.type === 'all'

      // Pixel heights for the two draggable sections, derived from the stored
      // fractions against the measured panel height (list keeps >= 96px).
      var hasDetail = selectedKey !== ''
      var treePx = null
      var detailPx = null
      if (containerH > 0) {
        var treeRaw = Math.round(treeFrac * containerH)
        var detailRaw = hasDetail ? Math.round(detailFrac * containerH) : 0
        treePx = Math.max(64, Math.min(treeRaw, containerH - 96 - detailRaw))
        detailPx = hasDetail ? Math.max(84, Math.min(detailRaw, containerH - 96 - treePx)) : null
      }
      var treeStyle = treePx === null ? S.treeWrap : Object.assign({}, S.treeWrap, { height: treePx + 'px', maxHeight: 'none' })

      return h(
        'div',
        { style: S.root, ref: rootRef },
        h(
          'div',
          { style: S.header },
          h('span', { style: boot.status === 'ready' ? S.dotOk : boot.status === 'offline' ? S.dotBad : S.dotWait }),
          h('span', { style: S.headerTitle }, t('tab.title')),
          h('span', { style: S.headerMeta, title: storageRoot !== '' ? t('status.storage') + ': ' + storageRoot : '' }, boot.status === 'ready' ? 'Zotero ' + (boot.version || '') : ''),
          h('span', { style: S.grow }),
          h('button', { type: 'button', style: S.iconBtn, title: t('status.retry'), onClick: refresh }, '⟳'),
        ),
        boot.status === 'loading'
          ? h('div', { style: S.center }, t('status.connecting'))
          : boot.status === 'offline'
            ? h(
                'div',
                { style: S.center },
                h('div', { style: S.errorTitle }, t('status.offline')),
                h('div', { style: S.hint }, t('status.hint')),
                boot.message ? h('div', { style: S.hintMono }, boot.message) : null,
                h('button', { type: 'button', style: S.primaryBtn, onClick: refresh }, t('status.retry')),
              )
            : h(
                'div',
                { style: S.body },
                h(
                  'div',
                  { style: treeStyle },
                  h(
                    'div',
                    {
                      style: rootActive ? S.treeRowActive : S.treeRow,
                      onClick: function () {
                        setScope({ type: 'all', key: '' })
                      },
                    },
                    h('span', { style: S.treeChevronSpace }, ''),
                    h('span', { style: S.treeLabel }, t('all')),
                  ),
                  treeRows.length === 0 ? h('div', { style: S.hintSmall }, t('empty.collections')) : treeRows,
                ),
                h(
                  'div',
                  {
                    style: S.dragHandle,
                    title: t('layout.drag'),
                    onPointerDown: function (event) {
                      beginDrag('tree', event)
                    },
                    onDoubleClick: function () {
                      setTreeFrac(DEFAULT_TREE_FRAC)
                    },
                  },
                  h('div', { style: S.dragGrip }),
                ),
                h(
                  'div',
                  { style: S.listWrap },
                  h(
                    'div',
                    { style: S.searchRow },
                    h('input', {
                      style: S.searchInput,
                      type: 'search',
                      value: search,
                      placeholder: t('search.placeholder'),
                      onChange: function (event) {
                        setSearch(event.target.value)
                      },
                    }),
                  ),
                  h(
                    'div',
                    { style: S.listHead },
                    h('span', { style: S.listHeadText }, scope.type === 'all' ? t('all') : findName(collections, scope.key)),
                    h('span', { style: S.grow }),
                    total !== null ? h('span', { style: S.hintSmall }, t('total').replace('{n}', String(total))) : null,
                    itemsLoading ? h('span', { style: S.hintSmall }, t('loading')) : null,
                  ),
                  itemsError !== '' ? h('div', { style: S.errorLine }, itemsError) : null,
                  items.length === 0 && !itemsLoading && itemsError === ''
                    ? h('div', { style: S.hintSmall }, debouncedSearch !== '' ? t('empty.search') : t('empty.items'))
                    : null,
                  h(
                    'div',
                    { style: S.listScroll },
                    items.map(function (item) {
                      return h(ItemRow, {
                        key: item.key,
                        item: item,
                        selected: selectedKey === item.key,
                        t: t,
                        onSelect: selectItem,
                      })
                    }),
                  ),
                  hasMore
                    ? h(
                        'button',
                        {
                          type: 'button',
                          style: S.moreBtn,
                          disabled: itemsLoading,
                          onClick: function () {
                            loadItems(scope, items.length, true, debouncedSearch)
                          },
                        },
                        t('loadMore'),
                      )
                    : null,
                ),
                hasDetail
                  ? h(
                      'div',
                      {
                        style: S.dragHandle,
                        title: t('layout.drag'),
                        onPointerDown: function (event) {
                          beginDrag('detail', event)
                        },
                        onDoubleClick: function () {
                          setDetailFrac(DEFAULT_DETAIL_FRAC)
                        },
                      },
                      h('div', { style: S.dragGrip }),
                    )
                  : null,
                h(DetailPane, {
                  t: t,
                  height: detailPx,
                  loading: detailLoading,
                  detail: detail,
                  selectedKey: selectedKey,
                  onOpenPdf: function () {
                    if (detail && detail.pdf && detail.pdf.path) openPath(detail.pdf.path, detail.pdf.title)
                  },
                  onOpenMd: function () {
                    if (detail && detail.mds && detail.mds.length > 0 && detail.mds[0].path) openPath(detail.mds[0].path, detail.mds[0].title)
                  },
                  onCite: function () {
                    insertCitation(detail)
                  },
                  onCopy: function () {
                    copyText(buildCitation(detail))
                    flash(t('notice.copied'))
                  },
                }),
              ),
        notice !== '' ? h('div', { style: S.notice }, notice) : null,
      )
    }

    function findName(collections, key) {
      for (var i = 0; i < collections.length; i += 1) {
        if (collections[i].key === key) return collections[i].name
      }
      return key
    }

    function CollectionRow(props) {
      var node = props.node
      var t = props.t
      var style = props.active ? S.treeRowActive : S.treeRow
      return h(
        'div',
        {
          style: Object.assign({}, style, { paddingLeft: 6 + props.depth * 12 }),
          onClick: function () {
            props.onSelect(node)
          },
          title: node.name,
        },
        props.hasChildren
          ? h(
              'span',
              {
                style: S.treeChevron,
                onClick: function (event) {
                  event.stopPropagation()
                  props.onToggle(node.key)
                },
              },
              props.open ? '▾' : '▸',
            )
          : h('span', { style: S.treeChevronSpace }, ''),
        h('span', { style: S.treeLabel }, node.name),
        node.numItems > 0 ? h('span', { style: S.count }, String(node.numItems)) : null,
      )
    }

    function ItemRow(props) {
      var item = props.item
      var meta = [item.creatorSummary, item.year].filter(function (part) {
        return typeof part === 'string' && part !== ''
      }).join(' · ')
      return h(
        'div',
        {
          style: props.selected ? S.itemRowActive : S.itemRow,
          onClick: function () {
            props.onSelect(item.key)
          },
          title: item.title,
        },
        h('span', { style: S.itemTitle }, item.title),
        meta !== '' ? h('span', { style: S.itemMeta }, meta) : null,
      )
    }

    function DetailPane(props) {
      var t = props.t
      var detail = props.detail
      // The wrapper keeps the SAME height in the loading/empty state as in the
      // loaded state, so selecting an item never resizes the list first and
      // then snaps back (the "bounce" the reader sees as part 2 expanding).
      var detailStyle = typeof props.height === 'number'
        ? Object.assign({}, S.detail, { height: props.height + 'px', maxHeight: 'none' })
        : S.detail
      if (props.selectedKey === '') {
        return h('div', { style: detailStyle }, h('div', { style: S.detailHint }, t('selectHint')))
      }
      if (props.loading || !detail) {
        return h('div', { style: detailStyle }, h('div', { style: S.detailHint }, t('loading')))
      }
      var item = detail.item
      var hasPdf = Boolean(detail.pdf && detail.pdf.path)
      var hasMd = Boolean(detail.mds && detail.mds.length > 0 && detail.mds[0].path)
      return h(
        'div',
        { style: detailStyle },
        h('div', { style: S.detailTitle }, item.title),
        h(
          'div',
          { style: S.detailMeta },
          [item.itemType, item.creatorSummary, item.year].filter(Boolean).join(' · '),
        ),
        item.abstractNote !== ''
          ? h(
              'div',
              { style: S.abstract },
              h('div', { style: S.sectionTitle }, t('abstract.title')),
              h('div', { style: S.abstractText }, item.abstractNote),
            )
          : null,
        h(
          'div',
          { style: S.actions },
          h(
            'button',
            { type: 'button', style: hasPdf ? S.primaryBtn : S.disabledBtn, disabled: !hasPdf, onClick: props.onOpenPdf, title: hasPdf ? detail.pdf.path : t('noPdf') },
            t('btn.pdf'),
          ),
          h(
            'button',
            { type: 'button', style: hasMd ? S.primaryBtn : S.disabledBtn, disabled: !hasMd, onClick: props.onOpenMd, title: hasMd ? detail.mds[0].path : t('noMd') },
            t('btn.md'),
          ),
          h('button', { type: 'button', style: S.accentBtn, onClick: props.onCite }, t('btn.cite')),
          h('button', { type: 'button', style: S.ghostBtn, onClick: props.onCopy }, t('btn.copy')),
        ),
        detail.notes && detail.notes.length > 0
          ? h(
              'div',
              { style: S.notes },
              h('div', { style: S.sectionTitle }, t('notes.title')),
              detail.notes.map(function (note) {
                return h(
                  'details',
                  { key: note.key, style: S.noteItem },
                  h('summary', { style: S.noteSummary }, note.title || '笔记'),
                  h('div', {
                    style: S.noteBody,
                    dangerouslySetInnerHTML: { __html: note.html },
                  }),
                )
              }),
            )
          : null,
      )
    }

    // ── styles (host theme variables with safe fallbacks) ─────────────────
    var S = {
      root: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        fontSize: '12px',
        lineHeight: 1.45,
        color: 'var(--dsw-alias-label-primary, #e6e6e6)',
        background: 'transparent',
        position: 'relative',
      },
      header: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '8px 10px',
        borderBottom: '1px solid var(--dsw-alias-separator-primary, rgba(127,127,127,.25))',
        flex: '0 0 auto',
      },
      headerTitle: { fontWeight: 600, fontSize: '12px' },
      headerMeta: { color: 'var(--dsw-alias-label-tertiary, #8a8a8a)', fontSize: '11px' },
      grow: { flex: '1 1 auto' },
      dotOk: { width: '7px', height: '7px', borderRadius: '50%', background: '#3fb950', flex: '0 0 auto' },
      dotBad: { width: '7px', height: '7px', borderRadius: '50%', background: '#f85149', flex: '0 0 auto' },
      dotWait: { width: '7px', height: '7px', borderRadius: '50%', background: '#d29922', flex: '0 0 auto' },
      iconBtn: {
        border: '1px solid var(--dsw-alias-separator-primary, rgba(127,127,127,.35))',
        background: 'transparent',
        color: 'inherit',
        borderRadius: '5px',
        cursor: 'pointer',
        padding: '1px 6px',
        fontSize: '12px',
      },
      center: { padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' },
      errorTitle: { fontWeight: 600, color: '#f85149' },
      hint: { color: 'var(--dsw-alias-label-secondary, #bdbdbd)' },
      hintSmall: { color: 'var(--dsw-alias-label-tertiary, #8a8a8a)', fontSize: '11px', padding: '4px 2px' },
      hintMono: {
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: '10.5px',
        color: 'var(--dsw-alias-label-tertiary, #8a8a8a)',
        wordBreak: 'break-all',
      },
      primaryBtn: {
        border: '1px solid var(--dsw-alias-interactive-border, rgba(77,107,254,.6))',
        background: 'var(--dsw-alias-interactive-bg-hover, rgba(77,107,254,.16))',
        color: 'inherit',
        borderRadius: '5px',
        cursor: 'pointer',
        padding: '3px 9px',
        fontSize: '11.5px',
      },
      accentBtn: {
        border: '1px solid rgba(63,185,80,.6)',
        background: 'rgba(63,185,80,.16)',
        color: 'inherit',
        borderRadius: '5px',
        cursor: 'pointer',
        padding: '3px 9px',
        fontSize: '11.5px',
      },
      ghostBtn: {
        border: '1px solid var(--dsw-alias-separator-primary, rgba(127,127,127,.35))',
        background: 'transparent',
        color: 'inherit',
        borderRadius: '5px',
        cursor: 'pointer',
        padding: '3px 9px',
        fontSize: '11.5px',
      },
      disabledBtn: {
        border: '1px solid var(--dsw-alias-separator-primary, rgba(127,127,127,.25))',
        background: 'transparent',
        color: 'var(--dsw-alias-label-tertiary, #777)',
        borderRadius: '5px',
        cursor: 'not-allowed',
        padding: '3px 9px',
        fontSize: '11.5px',
      },
      body: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' },
      treeWrap: {
        flex: '0 0 auto',
        maxHeight: '38%',
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '4px 4px 6px 4px',
      },
      treeRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        padding: '2px 4px',
        borderRadius: '4px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
      treeRowActive: {
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        padding: '2px 4px',
        borderRadius: '4px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        background: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.18))',
      },
      treeChevron: { width: '12px', flex: '0 0 auto', color: 'var(--dsw-alias-label-tertiary, #999)', fontSize: '10px' },
      treeChevronSpace: { width: '12px', flex: '0 0 auto' },
      treeLabel: { overflow: 'hidden', textOverflow: 'ellipsis', flex: '1 1 auto' },
      count: { color: 'var(--dsw-alias-label-tertiary, #8a8a8a)', fontSize: '10.5px', flex: '0 0 auto' },
      divider: { height: '1px', flex: '0 0 auto', background: 'var(--dsw-alias-separator-primary, rgba(127,127,127,.25))' },
      dragHandle: {
        flex: '0 0 auto',
        height: '8px',
        cursor: 'row-resize',
        background: 'transparent',
        borderTop: '1px solid var(--dsw-alias-separator-primary, rgba(127,127,127,.22))',
        boxSizing: 'border-box',
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
      dragGrip: {
        width: '26px',
        height: '2px',
        borderRadius: '1px',
        background: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,.55))',
      },
      searchRow: { flex: '0 0 auto', padding: '6px 10px 2px 10px' },
      searchInput: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '4px 7px',
        fontSize: '11.5px',
        color: 'inherit',
        background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08))',
        border: '1px solid var(--dsw-alias-separator-primary, rgba(127,127,127,.35))',
        borderRadius: '5px',
        outline: 'none',
      },
      listWrap: { flex: '1 1 0%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
      listHead: { display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px 3px 10px', flex: '0 0 auto' },
      listHeadText: { fontWeight: 600, fontSize: '11.5px' },
      listScroll: { overflowY: 'auto', overflowX: 'hidden', flex: '1 1 auto', minHeight: 0 },
      itemRow: {
        display: 'flex',
        flexDirection: 'column',
        gap: '1px',
        padding: '5px 10px',
        borderBottom: '1px solid var(--dsw-alias-separator-primary, rgba(127,127,127,.12))',
        cursor: 'pointer',
      },
      itemRowActive: {
        display: 'flex',
        flexDirection: 'column',
        gap: '1px',
        padding: '5px 10px',
        borderBottom: '1px solid var(--dsw-alias-separator-primary, rgba(127,127,127,.12))',
        cursor: 'pointer',
        background: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.18))',
      },
      itemTitle: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      itemMeta: { color: 'var(--dsw-alias-label-tertiary, #8a8a8a)', fontSize: '10.5px' },
      moreBtn: {
        flex: '0 0 auto',
        margin: '4px 10px',
        padding: '3px 8px',
        border: '1px solid var(--dsw-alias-separator-primary, rgba(127,127,127,.35))',
        background: 'transparent',
        color: 'inherit',
        borderRadius: '5px',
        cursor: 'pointer',
        fontSize: '11px',
      },
      detail: {
        flex: '0 0 auto',
        maxHeight: '46%',
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '8px 10px 10px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '5px',
      },
      detailHint: { color: 'var(--dsw-alias-label-tertiary, #8a8a8a)', fontSize: '11px' },
      detailTitle: { fontWeight: 600, fontSize: '12.5px', wordBreak: 'break-word' },
      detailMeta: { color: 'var(--dsw-alias-label-tertiary, #8a8a8a)', fontSize: '10.5px' },
      abstract: { display: 'flex', flexDirection: 'column', gap: '2px' },
      sectionTitle: { fontWeight: 600, fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #bdbdbd)' },
      abstractText: {
        maxHeight: '96px',
        overflowY: 'auto',
        color: 'var(--dsw-alias-label-secondary, #cfcfcf)',
        fontSize: '11px',
      },
      actions: { display: 'flex', flexWrap: 'wrap', gap: '6px', paddingTop: '2px' },
      notes: { display: 'flex', flexDirection: 'column', gap: '4px', paddingTop: '2px' },
      noteItem: {
        border: '1px solid var(--dsw-alias-separator-primary, rgba(127,127,127,.25))',
        borderRadius: '5px',
        padding: '3px 6px',
      },
      noteSummary: { cursor: 'pointer', fontSize: '11px' },
      noteBody: {
        maxHeight: '180px',
        overflowY: 'auto',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-secondary, #cfcfcf)',
        paddingTop: '4px',
      },
      errorLine: { color: '#f85149', padding: '0 10px 4px 10px', fontSize: '11px' },
      notice: {
        position: 'absolute',
        left: '10px',
        right: '10px',
        bottom: '10px',
        padding: '5px 8px',
        borderRadius: '5px',
        background: 'var(--dsw-alias-bg-layer-3, rgba(40,40,40,.95))',
        border: '1px solid var(--dsw-alias-separator-primary, rgba(127,127,127,.35))',
        fontSize: '11px',
      },
    }

    // ── plugin body ───────────────────────────────────────────────────────
    function apply(ctx) {
      var locale = 'zh'
      try {
        var snapshot = ctx.locale && typeof ctx.locale.getSnapshot === 'function' ? ctx.locale.getSnapshot() : null
        if (snapshot && typeof snapshot.locale === 'string') locale = snapshot.locale
      } catch (error) {
        /* keep zh */
      }
      var t = makeT(locale)

      try {
        ctx.effect(function () {
          return ctx.locale.register(NS, { zh: ZH, en: EN })
        }, 'dsh-zotero-workspace: dictionaries')
      } catch (error) {
        /* dictionaries are cosmetic */
      }

      ctx.effect(function () {
        return ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_ID,
          title: function () {
            return t('tab.title')
          },
          guide: [
            {
              id: TAB_ID,
              title: function () {
                return t('guide.title')
              },
              description: function () {
                return t('guide.desc')
              },
              order: 12,
            },
          ],
        })
      }, 'dsh-zotero-workspace: sidebar tab')

      var Body = function Body(props) {
        return h(Pane, {
          ctx: ctx,
          t: t,
          inputActions: props ? props.inputActions : undefined,
          sessionId: props ? props.sessionId : undefined,
        })
      }

      ctx.effect(function () {
        return ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, Body)
      }, 'dsh-zotero-workspace: pane body')
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight']
    return module.exports
  },
})
