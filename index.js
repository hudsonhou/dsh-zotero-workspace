/**
 * dsh-zotero-workspace — Host half.
 *
 * Registers the read-only Zotero proxy on DSH's web server and records an
 * activation snapshot under ~/.dsh/zotero-workspace/status.json so a loaded
 * plugin can be diagnosed without browser access.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { resolveSettings } from './lib/core.js'
import { createHandler } from './lib/handler.js'

export const name = 'dsh-zotero-workspace'

const ROUTE_MATCH = '/dsh-zotero-workspace/api'

function writeActivationSnapshot(settings) {
  try {
    const dir = join(homedir(), '.dsh', 'zotero-workspace')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'status.json'),
      JSON.stringify(
        {
          plugin: 'dsh-zotero-workspace',
          version: '0.1.0',
          activatedAt: new Date().toISOString(),
          route: ROUTE_MATCH,
          settings: { zoteroBaseUrl: settings.zoteroBaseUrl, storageRoot: settings.storageRoot, pageSize: settings.pageSize },
        },
        null,
        2,
      ),
      'utf8',
    )
  } catch {
    /* diagnostics only; never fail activation over it */
  }
}

export function apply(ctx, config = {}) {
  const settings = resolveSettings(config)
  writeActivationSnapshot(settings)

  ctx.inject(['webServer'], (hostCtx) => {
    const webServer = hostCtx.webServer
    const handler = createHandler(() => settings)
    hostCtx.effect(
      () => webServer.register({ kind: 'prefix', path: ROUTE_MATCH, handler }),
      'dsh-zotero-workspace: http routes',
    )
  })
}
