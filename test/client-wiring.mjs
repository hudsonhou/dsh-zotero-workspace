/**
 * Wiring self-test for the browser half without a browser:
 * captures the lazy factory, runs it with a stubbed React, then applies the
 * plugin against a stub cordis context and asserts what it registers.
 *
 * Usage: node test/client-wiring.mjs
 */
import assert from 'node:assert/strict'

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      captured = definition
    },
  },
}

await import('../client.js')

let failures = 0
function check(label, fn) {
  try {
    fn()
    console.log('PASS  ' + label)
  } catch (error) {
    failures += 1
    console.log('FAIL  ' + label + ' — ' + (error && error.message ? error.message : String(error)))
  }
}

check('loader captured one factory', () => {
  assert.ok(captured)
  assert.equal(captured.id, 'dsh-zotero-workspace')
  assert.equal(typeof captured.factory, 'function')
})

const fakeReact = {
  createElement() {
    return null
  },
  useState() {
    return [undefined, () => {}]
  },
  useEffect() {},
  useMemo(fn) {
    return fn()
  },
  useCallback(fn) {
    return fn
  },
  useRef(value) {
    return { current: value }
  },
}

const mod = captured.factory((name) => {
  if (name === 'react') return fakeReact
  throw new Error('unexpected require: ' + name)
})

check('factory exports apply + inject', () => {
  assert.equal(typeof mod.apply, 'function')
  assert.deepEqual(mod.inject, ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'])
})

const calls = []
const ctx = {
  effect(callback, label) {
    const disposer = callback()
    calls.push({ kind: 'effect', label, disposer: typeof disposer })
  },
  locale: {
    register(namespace, dicts) {
      calls.push({ kind: 'locale', namespace, languages: Object.keys(dicts) })
      return () => {}
    },
    getSnapshot() {
      return { locale: 'zh' }
    },
  },
  sidebarRightTabs: {
    register(definition) {
      calls.push({ kind: 'tab', id: definition.id, kindName: definition.kind, guide: (definition.guide || []).length })
      return () => {}
    },
  },
  slots: {
    inject(key, callback) {
      calls.push({ kind: 'slotInject', key })
      if (typeof callback === 'function') callback()
      return () => {}
    },
    register(meta, component) {
      calls.push({ kind: 'slot', name: meta.name, key: meta.key, component: typeof component })
      return () => {}
    },
  },
  sidebarRight: {
    openResource(address, options) {
      calls.push({ kind: 'openResource', address, options })
    },
  },
}

check('apply runs without throwing', () => {
  mod.apply(ctx)
})

check('registers locale dictionaries', () => {
  const entry = calls.find((call) => call.kind === 'locale')
  assert.ok(entry)
  assert.equal(entry.namespace, 'dsh-zotero-workspace')
  assert.deepEqual(entry.languages, ['zh', 'en'])
})

check('registers the sidebar tab type with a guide entry', () => {
  const entry = calls.find((call) => call.kind === 'tab')
  assert.ok(entry)
  assert.equal(entry.id, 'zotero-workspace')
  assert.equal(entry.kindName, 'zotero-workspace')
  assert.equal(entry.guide, 1)
})

check('registers the pane body in sidebar.right.pane.tab', () => {
  const entry = calls.find((call) => call.kind === 'slot')
  assert.ok(entry)
  assert.equal(entry.name, 'sidebar.right.pane.tab')
  assert.equal(entry.key, 'zotero-workspace')
  assert.equal(entry.component, 'function')
})

check('all effects returned a disposer', () => {
  const effects = calls.filter((call) => call.kind === 'effect')
  assert.ok(effects.length >= 3)
  for (const effect of effects) assert.equal(effect.disposer, 'function', effect.label)
})

console.log(failures === 0 ? '\nCLIENT WIRING PASS' : `\nCLIENT WIRING FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
