/**
 * Zotero local-API client and mapping helpers for dsh-zotero-workspace.
 *
 * Everything here is read-only and dependency-free (Node builtins only):
 *  - talk to Zotero's local HTTP API on 127.0.0.1:23119
 *  - map collections / items / children into a small stable shape
 *  - resolve the absolute paths of a paper's PDF and parsed Markdown
 *
 * Kept separate from the plugin entry so it can be exercised by a plain node
 * script without a running DSH.
 */
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const API_VERSION = '3'
const LIBRARY_PREFIX = '/api/users/0'
const MAX_PAGES = 50
const PAGE_FETCH_MAX = 100

export class ZoteroError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ZoteroError'
    this.code = code
  }
}

export const DEFAULT_SETTINGS = {
  zoteroBaseUrl: 'http://127.0.0.1:23119',
  storageRoot: '',
  pageSize: 50,
  requestTimeoutMs: 8000,
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(max, Math.max(min, n))
}

/** Merge the bundle-row config, environment overrides, and defaults. */
export function resolveSettings(config = {}) {
  const cfg = config && typeof config === 'object' ? config : {}
  const env = process.env
  const base = String(env.ZOTERO_WORKSPACE_BASE_URL || cfg.zoteroBaseUrl || DEFAULT_SETTINGS.zoteroBaseUrl)
    .replace(/\/+$/, '')
  const storage = String(env.ZOTERO_WORKSPACE_STORAGE_ROOT || cfg.storageRoot || '').trim()
  return {
    zoteroBaseUrl: base,
    storageRoot: storage === '' ? join(homedir(), 'Zotero', 'storage') : resolve(storage),
    pageSize: clampInt(cfg.pageSize, 10, 100, DEFAULT_SETTINGS.pageSize),
    requestTimeoutMs: clampInt(cfg.requestTimeoutMs, 1000, 60000, DEFAULT_SETTINGS.requestTimeoutMs),
  }
}

function apiUrl(settings, path, params) {
  const url = new URL(`${settings.zoteroBaseUrl}${LIBRARY_PREFIX}${path}`)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }
  return url
}

async function zget(settings, path, params, allowMissing = false) {
  const result = await zgetPage(settings, path, params, allowMissing)
  return result === undefined ? undefined : result.data
}

/** Like {@link zget}, but also reports Zotero's `Total-Results` header. */
async function zgetPage(settings, path, params, allowMissing = false) {
  const url = apiUrl(settings, path, params)
  let res
  try {
    res = await fetch(url, {
      headers: { 'Zotero-API-Version': API_VERSION, Accept: 'application/json' },
      signal: AbortSignal.timeout(settings.requestTimeoutMs),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ZoteroError('zotero_unreachable', `无法连接 Zotero 本地 API（${url.origin}）：${message}`)
  }
  if (res.status === 403) {
    throw new ZoteroError(
      'zotero_forbidden',
      'Zotero 本地 API 拒绝了请求。请在 Zotero「设置 → 高级」勾选「允许此计算机上的其他应用程序与 Zotero 通信」。',
    )
  }
  if (res.status === 404 && allowMissing) return undefined
  if (res.status >= 400) {
    throw new ZoteroError('zotero_http_error', `Zotero API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new ZoteroError('zotero_bad_payload', 'Zotero 返回了非 JSON 响应；本地 API 是否已启用？')
  }
  const totalHeader = res.headers.get('total-results')
  const total = totalHeader === null ? undefined : Number(totalHeader)
  return { data, total: Number.isFinite(total) ? total : undefined }
}

// ── probe ────────────────────────────────────────────────────────────────────

export async function probe(settings) {
  const url = `${settings.zoteroBaseUrl}/api/`
  try {
    const res = await fetch(url, {
      headers: { 'Zotero-API-Version': API_VERSION },
      signal: AbortSignal.timeout(Math.min(settings.requestTimeoutMs, 4000)),
    })
    const version = res.headers.get('x-zotero-version') || undefined
    return { running: res.ok, status: res.status, version, base: settings.zoteroBaseUrl }
  } catch (error) {
    return {
      running: false,
      status: 0,
      base: settings.zoteroBaseUrl,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

// ── collections / items ─────────────────────────────────────────────────────

export async function listCollections(settings) {
  const out = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const start = page * PAGE_FETCH_MAX
    const rows = await zget(settings, '/collections', { limit: PAGE_FETCH_MAX, start })
    if (!Array.isArray(rows) || rows.length === 0) break
    for (const row of rows) out.push(mapCollection(row))
    if (rows.length < PAGE_FETCH_MAX) break
  }
  return out
}

function mapCollection(row) {
  const data = row?.data ?? {}
  return {
    key: String(row?.key ?? data.key ?? ''),
    name: String(data.name ?? ''),
    parent: typeof data.parentCollection === 'string' ? data.parentCollection : '',
    numItems: Number(row?.meta?.numItems ?? 0),
    numCollections: Number(row?.meta?.numCollections ?? 0),
  }
}

/**
 * One page of top-level items, either library-wide or inside a collection.
 * `q` runs Zotero's own title/abstract/full-text search in the current scope;
 * results are newest-first by default.
 * @param {{collectionKey?: string, q?: string, limit?: number, start?: number, sort?: string, direction?: string}} query
 */
export async function listItems(settings, query = {}) {
  const limit = clampInt(query.limit, 1, PAGE_FETCH_MAX, settings.pageSize)
  const start = clampInt(query.start, 0, Number.MAX_SAFE_INTEGER, 0) === 0 ? 0 : Math.max(0, Number.parseInt(query.start, 10) || 0)
  const collectionKey = typeof query.collectionKey === 'string' ? query.collectionKey.trim() : ''
  const path = collectionKey === '' ? '/items/top' : `/collections/${encodeURIComponent(collectionKey)}/items/top`
  const params = {
    limit,
    start,
    sort: typeof query.sort === 'string' && query.sort !== '' ? query.sort : 'dateAdded',
    direction: typeof query.direction === 'string' && query.direction !== '' ? query.direction : 'desc',
  }
  const q = typeof query.q === 'string' ? query.q.trim() : ''
  if (q !== '') params.q = q
  const page = await zgetPage(settings, path, params)
  const items = (Array.isArray(page.data) ? page.data : []).map(mapItem)
  return {
    items,
    limit,
    start,
    total: page.total,
    hasMore: page.total !== undefined ? start + items.length < page.total : items.length >= limit,
  }
}

/** All tags (with item counts), paged internally. */
export async function listTags(settings) {
  const out = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await zget(settings, '/tags', { limit: PAGE_FETCH_MAX, start: page * PAGE_FETCH_MAX })
    if (!Array.isArray(rows) || rows.length === 0) break
    for (const row of rows) {
      out.push({
        tag: String(row?.tag ?? row?.data?.tag ?? ''),
        numItems: Number(row?.meta?.numItems ?? 0),
      })
    }
    if (rows.length < PAGE_FETCH_MAX) break
  }
  return out
}

function mapItem(row) {
  const data = row?.data ?? {}
  return {
    key: String(row?.key ?? data.key ?? ''),
    itemType: String(data.itemType ?? ''),
    title: String(data.title ?? data.name ?? '(无标题)'),
    abstractNote: String(data.abstractNote ?? ''),
    date: String(data.date ?? ''),
    year: String(row?.meta?.parsedDate ?? '').slice(0, 4) || String(data.date ?? '').match(/\d{4}/)?.[0] || '',
    url: String(data.url ?? ''),
    creatorSummary: String(row?.meta?.creatorSummary ?? ''),
    creators: mapCreators(data.creators),
  }
}

function mapCreators(creators) {
  if (!Array.isArray(creators)) return []
  return creators
    .filter((c) => c && (c.creatorType === undefined || c.creatorType === 'author'))
    .map((c) => {
      if (typeof c.name === 'string' && c.name.trim() !== '') return c.name.trim()
      const first = typeof c.firstName === 'string' ? c.firstName.trim() : ''
      const last = typeof c.lastName === 'string' ? c.lastName.trim() : ''
      return [last, first].filter(Boolean).join(' ').trim()
    })
    .filter(Boolean)
}

// ── item detail ─────────────────────────────────────────────────────────────

export async function getItemDetail(settings, key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9]{4,20}$/.test(key)) {
    throw new ZoteroError('bad_request', '缺少合法的条目标识')
  }
  const row = await zget(settings, `/items/${encodeURIComponent(key)}`, {}, true)
  if (row === undefined) throw new ZoteroError('zotero_not_found', `Zotero 中找不到条目 ${key}`)
  const children = await zget(settings, `/items/${encodeURIComponent(key)}/children`, {})
  const item = mapItem(row)
  const attachments = []
  const mds = []
  const notes = []
  for (const child of Array.isArray(children) ? children : []) {
    const data = child?.data ?? {}
    if (data.itemType === 'note') {
      notes.push({
        key: String(child.key ?? data.key ?? ''),
        title: String(data.title ?? '笔记'),
        html: sanitizeNoteHtml(String(data.note ?? '')),
      })
      continue
    }
    if (data.itemType !== 'attachment') continue
    const info = attachmentInfo(settings, child)
    attachments.push(info)
    const isMd = /markdown/i.test(info.contentType) || /\.md$/i.test(info.filename)
    if (isMd) mds.push({ kind: 'file', key: info.key, title: info.title, path: info.path })
  }
  const pdf = attachments.find((a) => /pdf/i.test(a.contentType) || /\.pdf$/i.test(a.filename))
  return {
    item,
    pdf: pdf ? { key: pdf.key, title: pdf.title, path: pdf.path } : null,
    mds,
    notes,
    attachments,
  }
}

function attachmentInfo(settings, child) {
  const data = child?.data ?? {}
  const enclosure = child?.links?.enclosure?.href
  let filename = typeof data.filename === 'string' ? data.filename : ''
  let path = ''
  const fromEnclosure = filePathFromUrl(enclosure)
  if (fromEnclosure !== '') {
    path = fromEnclosure
    if (filename === '') filename = fromEnclosure.split(/[\\/]/).pop() || ''
  } else if (filename !== '') {
    path = join(settings.storageRoot, String(child.key ?? data.key ?? ''), filename)
  }
  if (path === '') path = findInStorage(settings, String(child.key ?? data.key ?? ''), data.contentType)
  return {
    key: String(child?.key ?? data.key ?? ''),
    title: String(data.title ?? filename ?? '(附件)'),
    contentType: String(data.contentType ?? ''),
    filename,
    path,
  }
}

function findInStorage(settings, key, contentType) {
  if (key === '') return ''
  const dir = join(settings.storageRoot, key)
  try {
    if (!existsSync(dir)) return ''
    const files = readdirSync(dir).filter((name) => !name.startsWith('.'))
    const isPdf = /pdf/i.test(String(contentType ?? ''))
    const wanted = isPdf ? files.find((f) => /\.pdf$/i.test(f)) : files[0]
    return wanted === undefined ? '' : join(dir, wanted)
  } catch {
    return ''
  }
}

export function filePathFromUrl(href) {
  if (typeof href !== 'string' || href === '') return ''
  try {
    const url = new URL(href)
    if (url.protocol !== 'file:') return ''
    return fileURLToPath(url)
  } catch {
    return ''
  }
}

function sanitizeNoteHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
}

// ── file access boundary ────────────────────────────────────────────────────

/** Whether an absolute path stays inside the configured Zotero storage root. */
export function isPathAllowed(settings, absPath) {
  if (typeof absPath !== 'string' || absPath.trim() === '' || !isAbsolute(absPath)) return false
  const root = normalize(resolve(settings.storageRoot))
  const target = normalize(resolve(absPath))
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export const CONTENT_TYPES = {
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
}

export function contentTypeFor(path) {
  const m = /(\.[A-Za-z0-9]+)$/.exec(path ?? '')
  return (m && CONTENT_TYPES[m[1].toLowerCase()]) || 'application/octet-stream'
}
