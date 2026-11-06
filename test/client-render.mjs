/**
 * Render smoke test for the browser half: applies the client plugin against a
 * stub context, captures the registered pane component, then invokes it with a
 * tiny React hook shim to prove the first render does not throw and shows the
 * connecting state. No browser required.
 *
 * Usage: node test/client-render.mjs
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

function createElement(type, props, ...children) {
  return { type, props: props || {}, children: children.flat(Infinity) }
}
const stateQueue = []
const fakeReact = {
  createElement,
  useState(initial) {
    const value = stateQueue.length > 0 ? stateQueue.shift() : initial
    return [value, () => {}]
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

let registered = null
const ctx = {
  effect(callback) {
    return callback()
  },
  locale: {
    register() {
      return () => {}
    },
    getSnapshot() {
      return { locale: 'zh' }
    },
  },
  sidebarRightTabs: {
    register() {
      return () => {}
    },
  },
  slots: {
    inject(key, callback) {
      if (typeof callback === 'function') callback()
      return () => {}
    },
    register(meta, component) {
      if (meta.name === 'sidebar.right.pane.tab') registered = component
      return () => {}
    },
  },
  sidebarRight: { openResource() {} },
  get() {
    return undefined
  },
}

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

check('apply registers a pane component', () => {
  mod.apply(ctx)
  assert.equal(typeof registered, 'function')
})

function renderTree(node) {
  if (node === null || node === undefined || typeof node !== 'object') return []
  if (typeof node.type === 'function') {
    return renderTree(node.type(node.props))
  }
  const out = []
  for (const child of node.children) {
    if (typeof child === 'string' || typeof child === 'number') out.push(String(child))
    else out.push(...renderTree(child))
  }
  return out
}

check('first render does not throw and shows the connecting state', () => {
  const element = registered({ inputActions: undefined, sessionId: 'test-session' })
  const texts = renderTree(element)
  assert.ok(texts.some((text) => text.includes('正在连接 Zotero')), 'texts=' + JSON.stringify(texts).slice(0, 300))
})

console.log(failures === 0 ? '\nCLIENT RENDER PASS' : `\nCLIENT RENDER FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
