// scripts/check-api-parity.mjs — asserts that the Android bridge exposes
// every method electron/preload.cjs does, with the same namespace and
// name. The renderer is shared, so a missing method is a runtime
// TypeError on whichever page happens to call it.
//
// Static (regex) rather than dynamic: importing src/native/bridge.js
// under Node would pull in Capacitor's native plugins.
//
//   node scripts/check-api-parity.mjs
import fs from 'node:fs'

const preload = fs.readFileSync('electron/preload.cjs', 'utf8')
const bridge = fs.readFileSync('src/native/bridge.js', 'utf8')

// Everything between exposeInMainWorld('api', { ... }) — parse the
// namespace blocks the same way for both files.
// Brace-matched so a multi-line method body (exportPdf, the guarded
// wrappers) does not look like the end of its namespace.
function blockAfter(src, from) {
  const open = src.indexOf('{', from)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  throw new Error('unbalanced braces')
}

function collect(src, startMarker) {
  const from = src.indexOf(startMarker)
  if (from < 0) throw new Error(`could not find ${startMarker}`)
  const api = blockAfter(src, from)

  const out = new Map()
  const nsRe = /(?:^|\n)\s{2,6}([a-zA-Z_$][\w$]*):\s*\{/g
  let m
  while ((m = nsRe.exec(api))) {
    const body = blockAfter(api, m.index + m[0].length - 1)
    const methods = new Set()
    const mRe = /(?:^|\n)\s+([a-zA-Z_$][\w$]*):\s*(?:async\s*)?\(/g
    let mm
    while ((mm = mRe.exec(body))) methods.add(mm[1])
    out.set(m[1], methods)
  }
  return out
}

const want = collect(preload, "exposeInMainWorld('api'")
// Start at the returned object literal, not at createNativeApi's own
// destructured parameter list.
const have = collect(bridge.slice(bridge.indexOf('export function createNativeApi')), 'return {')

let failures = 0
for (const [ns, methods] of want) {
  const got = have.get(ns)
  if (!got) {
    console.log(`  ✗ missing namespace: ${ns}`)
    failures++
    continue
  }
  for (const m of methods) {
    if (!got.has(m)) { console.log(`  ✗ missing: ${ns}.${m}`); failures++ }
  }
}

// onDbChanged sits outside the namespaces in both files.
for (const [name, src] of [['preload', preload], ['bridge', bridge]]) {
  if (!/onDbChanged/.test(src)) { console.log(`  ✗ ${name} has no onDbChanged`); failures++ }
}

const total = [...want.values()].reduce((n, s) => n + s.size, 0)
if (failures) {
  console.log(`\n${failures} missing of ${total} channels across ${want.size} namespaces`)
  process.exit(1)
}
console.log(`✓ all ${total} channels across ${want.size} namespaces are implemented in the native bridge`)
