/**
 * Offline self-test for dsh-zotero-workspace: exercises lib/core.js and
 * lib/handler.js against a real Zotero local API, without DSH.
 *
 * Usage: node test/selftest.mjs
 */
import http from 'node:http'
import { existsSync } from 'node:fs'
import { resolveSettings, probe, listCollections, listItems, listTags, getItemDetail, isPathAllowed } from '../lib/core.js'
import { createHandler } from '../lib/handler.js'

const settings = resolveSettings({ pageSize: 5 })
let failures = 0
function check(label, condition, extra = '') {
  const ok = Boolean(condition)
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`)
}

const health = await probe(settings)
check('Zotero local API reachable', health.running, `base=${health.base} version=${health.version ?? '-'} status=${health.status}`)
if (!health.running) {
  console.log('\nZotero is not reachable; start Zotero and enable Settings → Advanced → allow other applications.')
  process.exit(1)
}

const collections = await listCollections(settings)
check('collections listed', Array.isArray(collections), `count=${collections.length}`)
console.log('  sample collections:', collections.slice(0, 3).map((c) => `${c.name}(${c.key},${c.numItems})`).join(', '))

const all = await listItems(settings, { limit: 5, start: 0 })
check('top-level items listed', Array.isArray(all.items) && all.items.length > 0, `count=${all.items.length} total=${all.total} hasMore=${all.hasMore}`)
check('Total-Results reported', typeof all.total === 'number' && all.total > 0, `total=${all.total}`)

const searched = await listItems(settings, { q: '声呐', limit: 3, start: 0 })
check('server-side search returns matches', searched.items.length > 0 && typeof searched.total === 'number', `count=${searched.items.length} total=${searched.total}`)

const tags = await listTags(settings)
check('tags listed', Array.isArray(tags) && tags.length > 0, `count=${tags.length}`)
if (tags.length > 0) console.log('  sample tags:', tags.slice(0, 3).map((tag) => `${tag.tag}(${tag.numItems})`).join(', '))
const item = all.items.find((entry) => entry.itemType !== 'attachment') ?? all.items[0]
console.log('  sample item:', item && `${item.title.slice(0, 40)} (${item.key}) authors=${JSON.stringify(item.creatorSummary)} year=${item.year}`)

const wide = await listItems(settings, { limit: 50, start: 0 })
check('wide page listed', wide.items.length > 0, `count=${wide.items.length} total=${wide.total}`)

let detail = null
for (const candidate of wide.items) {
  const candidateDetail = await getItemDetail(settings, candidate.key)
  if (candidateDetail.pdf || candidateDetail.mds.length > 0 || candidateDetail.notes.length > 0) {
    detail = candidateDetail
    break
  }
}
check('found an item with PDF or parsed Markdown', detail !== null)
if (detail === null) {
  const fallback = wide.items.find((entry) => entry.itemType !== 'attachment') ?? wide.items[0]
  if (fallback) detail = await getItemDetail(settings, fallback.key)
}
check('item detail loaded', detail !== null)
if (detail) {
  check('detail has item title', typeof detail.item.title === 'string' && detail.item.title.length > 0)
  console.log('  detail:', {
    key: detail.item.key,
    pdf: detail.pdf && detail.pdf.path,
    mds: detail.mds.map((m) => m.path),
    notes: detail.notes.length,
  })
  if (detail.pdf) {
    check('PDF path exists on disk', existsSync(detail.pdf.path), detail.pdf.path)
    check('PDF path allowed by storage boundary', isPathAllowed(settings, detail.pdf.path))
  }
  for (const md of detail.mds) {
    check('MD path exists on disk', existsSync(md.path), md.path)
  }
  check('path outside storage rejected', isPathAllowed(settings, 'C:/Windows/win.ini') === false)
}

// ── HTTP handler over a throwaway server ────────────────────────────────────
const server = http.createServer(createHandler(() => settings))
await new Promise((done) => server.listen(23199, '127.0.0.1', done))
const origin = 'http://127.0.0.1:23199'
async function get(path) {
  const res = await fetch(origin + path)
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

try {
  const h = await get('/dsh-zotero-workspace/api/health')
  check('GET /health envelope', h.body && h.body.ok === true, `status=${h.status}`)
  const tree = await get('/dsh-zotero-workspace/api/tree')
  check('GET /tree returns collections', tree.body && tree.body.ok === true && Array.isArray(tree.body.data.collections), `status=${tree.status} count=${tree.body?.data?.collections?.length}`)
  const items = await get('/dsh-zotero-workspace/api/items?limit=3')
  check('GET /items returns items', items.body && items.body.ok === true && Array.isArray(items.body.data.items), `status=${items.status} count=${items.body?.data?.items?.length} total=${items.body?.data?.total}`)
  const searchedItems = await get('/dsh-zotero-workspace/api/items?limit=2&q=' + encodeURIComponent('声呐'))
  check('GET /items?q= searches', searchedItems.body && searchedItems.body.ok === true && searchedItems.body.data.items.length > 0, `status=${searchedItems.status} total=${searchedItems.body?.data?.total}`)
  const tagRoute = await get('/dsh-zotero-workspace/api/tags')
  check('GET /tags returns tags', tagRoute.body && tagRoute.body.ok === true && Array.isArray(tagRoute.body.data.tags) && tagRoute.body.data.tags.length > 0, `status=${tagRoute.status} count=${tagRoute.body?.data?.tags?.length}`)
  if (detail) {
    const one = await get('/dsh-zotero-workspace/api/item?key=' + encodeURIComponent(detail.item.key))
    check('GET /item returns detail', one.body && one.body.ok === true && one.body.data.item.key === detail.item.key, `status=${one.status}`)
    const bad = await get('/dsh-zotero-workspace/api/file?path=' + encodeURIComponent('C:/Windows/win.ini'))
    check('GET /file rejects outside path', bad.status === 403, `status=${bad.status}`)
    if (detail.pdf) {
      const file = await fetch(origin + '/dsh-zotero-workspace/api/file?path=' + encodeURIComponent(detail.pdf.path))
      const buffer = Buffer.from(await file.arrayBuffer())
      check('GET /file serves PDF bytes', file.ok && buffer.subarray(0, 4).toString() === '%PDF', `status=${file.status} bytes=${buffer.length}`)
    }
  }
  const post = await fetch(origin + '/dsh-zotero-workspace/api/health', { method: 'POST' })
  check('POST rejected with 405', post.status === 405)
} finally {
  server.close()
}

console.log(failures === 0 ? '\nSELFTEST PASS' : `\nSELFTEST FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
