/**
 * Read-only HTTP handler for dsh-zotero-workspace.
 *
 * Mounted by the plugin entry on DSH's own web server under
 * `/dsh-zotero-workspace/api`. Every route is GET, loopback-only, and answers
 * with the envelope `{ok:true,data}` / `{ok:false,error:{code,message}}`.
 */
import { createReadStream, statSync } from 'node:fs'
import {
  ZoteroError,
  contentTypeFor,
  getItemDetail,
  isPathAllowed,
  listCollections,
  listItems,
  listTags,
  probe,
} from './core.js'

const ROUTE_PREFIX = '/dsh-zotero-workspace/api'
const MAX_FILE_BYTES = 80 * 1024 * 1024

function isLoopbackHost(hostHeader) {
  if (typeof hostHeader !== 'string' || hostHeader === '') return false
  const host = hostHeader.replace(/:\d+$/u, '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
}

function isTrusted(req) {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site.toLowerCase() === 'cross-site') return false
  return isLoopbackHost(req.headers.host)
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function ok(res, data) {
  sendJson(res, 200, { ok: true, data })
}

function fail(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message } })
}

function toFailure(res, error) {
  if (error instanceof ZoteroError) {
    const status = error.code === 'zotero_not_found' ? 404 : error.code === 'bad_request' ? 400 : 502
    fail(res, status, error.code, error.message)
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  fail(res, 500, 'internal_error', message)
}

export function createHandler(getSettings) {
  return async function handler(req, res) {
    try {
      if (!isTrusted(req)) return fail(res, 403, 'forbidden', '仅接受本机回环请求')
      if (req.method !== 'GET') return fail(res, 405, 'method_not_allowed', '只读端点，仅支持 GET')
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (!url.pathname.startsWith(ROUTE_PREFIX)) return fail(res, 404, 'not_found', '未知路由')
      const route = url.pathname.slice(ROUTE_PREFIX.length).replace(/\/+$/, '') || '/'
      const settings = getSettings()

      if (route === '/health') {
        const info = await probe(settings)
        return ok(res, { ...info, storageRoot: settings.storageRoot, pageSize: settings.pageSize })
      }
      if (route === '/tree') {
        const collections = await listCollections(settings)
        return ok(res, { collections, storageRoot: settings.storageRoot })
      }
      if (route === '/items') {
        const data = await listItems(settings, {
          collectionKey: url.searchParams.get('collection') ?? '',
          q: url.searchParams.get('q') ?? '',
          sort: url.searchParams.get('sort') ?? '',
          direction: url.searchParams.get('direction') ?? '',
          limit: Number(url.searchParams.get('limit') ?? settings.pageSize),
          start: Number(url.searchParams.get('start') ?? 0),
        })
        return ok(res, data)
      }
      if (route === '/tags') {
        const tags = await listTags(settings)
        return ok(res, { tags })
      }
      if (route === '/item') {
        const key = url.searchParams.get('key') ?? ''
        const detail = await getItemDetail(settings, key)
        return ok(res, detail)
      }
      if (route === '/file') {
        const path = url.searchParams.get('path') ?? ''
        if (!isPathAllowed(settings, path)) return fail(res, 403, 'path_not_allowed', '路径不在 Zotero存储目录内')
        let stat
        try {
          stat = statSync(path)
        } catch {
          return fail(res, 404, 'file_not_found', `文件不存在：${path}`)
        }
        if (!stat.isFile()) return fail(res, 400, 'bad_request', '不是文件')
        if (stat.size > MAX_FILE_BYTES) return fail(res, 413, 'file_too_large', '文件超过 80MB')
        res.writeHead(200, {
          'content-type': contentTypeFor(path),
          'content-length': stat.size,
          'cache-control': 'no-store',
        })
        const stream = createReadStream(path)
        stream.on('error', () => {
          if (!res.headersSent) fail(res, 500, 'read_failed', '读取文件失败')
          else res.destroy()
        })
        res.on('close', () => stream.destroy())
        stream.pipe(res)
        return
      }
      if (route === '/mdtext') {
        const path = url.searchParams.get('path') ?? ''
        if (!isPathAllowed(settings, path)) return fail(res, 403, 'path_not_allowed', '路径不在 Zotero存储目录内')
        let stat
        try {
          stat = statSync(path)
        } catch {
          return fail(res, 404, 'file_not_found', `文件不存在：${path}`)
        }
        if (!stat.isFile()) return fail(res, 400, 'bad_request', '不是文件')
        if (stat.size > MAX_FILE_BYTES) return fail(res, 413, 'file_too_large', '文件超过 80MB')
        const { readFileSync } = await import('node:fs')
        return sendJson(res, 200, { ok: true, data: { path, text: readFileSync(path, 'utf8') } })
      }
      return fail(res, 404, 'not_found', `未知路由：${route}`)
    } catch (error) {
      toFailure(res, error)
    }
  }
}
