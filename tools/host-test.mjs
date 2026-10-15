/**
 * Host-half test: the default-model route in lib/index.js.
 *
 * The route is the only way the browser half can change the GLOBAL default model
 * (changing it is a host concern: the official `agentDefaultModel.saveSelection()`
 * writes the profile patch, and the browser cannot reach that service).
 *
 * What this covers, with no real server and no real DSH:
 *   1. apply() wires nothing when the host lacks `webServer` (never throws)
 *   2. GET  returns the current selection + the two targets
 *   3. POST saves exactly the right provider/model for each lamp
 *   4. unknown row -> 400, bad method -> 405, non-loopback -> 403
 *   5. a missing/failing agentDefaultModel is reported honestly (503 / 500)
 *   6. dispose() unregisters the route
 *
 * Run: node tools/host-test.mjs
 */
import { apply, inject } from '../lib/index.js'

let checks = 0
let failures = 0
const check = (ok, label, detail) => {
  checks++
  if (ok) {
    console.log('  PASS  ' + label + (detail === undefined ? '' : '  -> ' + detail))
  } else {
    failures++
    console.log('  FAIL  ' + label + '  -> ' + String(detail))
  }
}

/** Build a fake host with the two services the route needs. */
function makeHost(options) {
  const opts = options ?? {}
  const registered = []
  const disposers = []
  /** 记录 saveSelection 收到的选择。 */
  const saved = []
  const ctx = {
    inject: (names, callback) => {
      if (names.includes('agentDefaultModel') && opts.noModel !== true) {
        return callback({
          agentDefaultModel: {
            currentSelection: () => opts.current ?? { provider: 'workbuddy', model: 'deepseek-v4.1-flash' },
            saveSelection: (next) => {
              saved.push(next)
              if (opts.saveFails === true) return Promise.reject(new Error('profile write refused'))
              return Promise.resolve()
            },
          },
        })
      }
      if (names.includes('webServer') && opts.noServer !== true) {
        return callback({
          effect: (fn) => {
            const dispose = fn()
            if (typeof dispose === 'function') disposers.push(dispose)
          },
          webServer: {
            register: (spec) => {
              registered.push(spec)
              return () => {
                spec.__disposed = true
              }
            },
          },
        })
      }
      return undefined
    },
  }
  return { ctx, registered, saved, disposers }
}

/** Minimal req/res doubles matching what the handler touches. */
function makeReqRes(method, options) {
  const opts = options ?? {}
  const chunks = []
  const handlers = {}
  const req = {
    method,
    headers: { host: opts.host ?? '127.0.0.1:43120', origin: opts.origin ?? 'http://127.0.0.1:43120' },
    on: (name, handler) => { (handlers[name] ??= []).push(handler) },
  }
  const res = {
    statusCode: undefined,
    body: undefined,
    written: '',
    writeHead(status) { this.statusCode = status },
    end(payload) { this.written = payload === undefined ? '' : String(payload) },
  }
  // 让 handler 里的 await readBody(req) 能结束
  setImmediate(() => {
    if (opts.body !== undefined) chunks.push(Buffer.from(opts.body, 'utf8'))
    for (const handler of handlers.data ?? []) handler(Buffer.concat(chunks))
    for (const handler of handlers.end ?? []) handler()
  })
  return { req, res }
}

/** Drive one request through the registered handler and parse the reply. */
async function request(host, method, options) {
  const spec = host.registered[host.registered.length - 1]
  if (spec === undefined) throw new Error('no route registered')
  const { req, res } = makeReqRes(method, options)
  await spec.handler(req, res)
  let json
  try {
    json = JSON.parse(res.written)
  } catch {
    json = undefined
  }
  return { status: res.statusCode, json, raw: res.written, spec }
}

console.log('# 宿主半区：默认模型切换路由')

// 1. wiring never throws
{
  check(Array.isArray(inject) && inject.length === 0, 'inject 声明为空数组（Loader 行在，但不依赖服务）', JSON.stringify(inject))
  const noServer = makeHost({ noServer: true })
  let threw = false
  try { apply(noServer.ctx) } catch { threw = true }
  check(threw === false, '没有 webServer 时不抛错（卡片仍可用）')
  check(noServer.registered.length === 0, '没有 webServer 时不注册路由', String(noServer.registered.length))

  const noModel = makeHost({ noModel: true })
  apply(noModel.ctx)
  check(noModel.registered.length === 1, '没有 agentDefaultModel 时路由仍然注册（好如实报错）', String(noModel.registered.length))

  const bare = {}
  threw = false
  try { apply(bare) } catch { threw = true }
  check(threw === false, 'ctx 不完整时不抛错')
  threw = false
  try { apply(undefined) } catch { threw = true }
  check(threw === false, 'ctx 为空时不抛错')
}

// 2. the route shape
{
  const host = makeHost()
  apply(host.ctx)
  const spec = host.registered[0] ?? {}
  check(spec.kind === 'exact', '路由是 exact 匹配', String(spec.kind))
  check(spec.path === '/plugins/dsh-workbuddy-foot-card/model', '路由路径与客户端一致', String(spec.path))
  check(typeof spec.handler === 'function', '注册了 handler')
}

// 3. GET reports current + targets
{
  const host = makeHost({ current: { provider: 'deepseek-account', model: 'deepseek-flash' } })
  apply(host.ctx)
  const got = await request(host, 'GET')
  check(got.status === 200, 'GET 回 200', String(got.status))
  check(got.json?.ok === true, 'GET ok:true')
  check(got.json?.current?.provider === 'deepseek-account', 'GET 带出当前 provider', JSON.stringify(got.json?.current))
  check(typeof got.json?.targets?.deepseek === 'object' && typeof got.json?.targets?.workbuddy === 'object', 'GET 带出两套目标')
  check(got.json?.targets?.deepseek?.provider === 'deepseek-account', 'deepseek 目标是官方通道', JSON.stringify(got.json?.targets?.deepseek))
  check(got.json?.targets?.deepseek?.model === 'deepseek-flash', 'deepseek 目标是 deepseek-flash', JSON.stringify(got.json?.targets?.deepseek))
  check(got.json?.targets?.workbuddy?.provider === 'workbuddy', 'workbuddy 目标是 workbuddy 通道', JSON.stringify(got.json?.targets?.workbuddy))
  check(got.json?.targets?.workbuddy?.model === 'deepseek-v4.1-flash', 'workbuddy 目标是 deepseek-v4.1-flash', JSON.stringify(got.json?.targets?.workbuddy))
}

// 4. POST saves the right selection
{
  const host = makeHost()
  apply(host.ctx)
  const ds = await request(host, 'POST', { body: JSON.stringify({ row: 'deepseek' }) })
  check(ds.status === 200 && ds.json?.ok === true, 'POST deepseek 成功', String(ds.status) + ' ' + String(ds.raw))
  check(host.saved.length === 1, 'saveSelection 被调用一次', String(host.saved.length))
  check(host.saved[0]?.provider === 'deepseek-account', '写的是官方 provider', JSON.stringify(host.saved[0]))
  check(host.saved[0]?.model === 'deepseek-flash', '写的是 deepseek-flash', JSON.stringify(host.saved[0]))

  const wb = await request(host, 'POST', { body: JSON.stringify({ row: 'workbuddy' }) })
  check(wb.status === 200 && wb.json?.ok === true, 'POST workbuddy 成功', String(wb.status))
  check(host.saved.length === 2, 'saveSelection 累计两次', String(host.saved.length))
  check(host.saved[1]?.provider === 'workbuddy', '第二次写 workbuddy provider', JSON.stringify(host.saved[1]))
  check(host.saved[1]?.model === 'deepseek-v4.1-flash', '第二次写 deepseek-v4.1-flash', JSON.stringify(host.saved[1]))
}

// 5. rejections
{
  const host = makeHost()
  apply(host.ctx)
  const bad = await request(host, 'POST', { body: JSON.stringify({ row: 'nope' }) })
  check(bad.status === 400 && bad.json?.ok === false, '未知行 -> 400（不写）', String(bad.status))
  check(host.saved.length === 0, '未知行不会碰 saveSelection', String(host.saved.length))

  const noBody = await request(host, 'POST')
  check(noBody.status === 400, '空 body -> 400（不猜）', String(noBody.status))

  const badJson = await request(host, 'POST', { body: '{not json' })
  check(badJson.status === 400, '坏 JSON -> 400', String(badJson.status))

  const put = await request(host, 'PUT')
  check(put.status === 405, '非 GET/POST -> 405', String(put.status))

  const foreign = await request(host, 'POST', { host: 'evil.example.com', body: JSON.stringify({ row: 'deepseek' }) })
  check(foreign.status === 403, '非回环 Host -> 403', String(foreign.status))
  check(host.saved.length === 0, '外部请求不会改模型', String(host.saved.length))
}

// 6. unavailable / failing host service
{
  const noModel = makeHost({ noModel: true })
  apply(noModel.ctx)
  const got = await request(noModel, 'POST', { body: JSON.stringify({ row: 'workbuddy' }) })
  check(got.status === 503, '没有 agentDefaultModel -> 503', String(got.status))
  check(got.json?.error === 'agent-default-model-unavailable', '错误码说明原因', String(got.json?.error))

  const failing = makeHost({ saveFails: true })
  apply(failing.ctx)
  const bad = await request(failing, 'POST', { body: JSON.stringify({ row: 'deepseek' }) })
  check(bad.status === 500, '写入失败 -> 500', String(bad.status))
  check(bad.json?.message === 'profile write refused', '把宿主的原因带出来', String(bad.json?.message))
}

// 7. dispose
{
  const host = makeHost()
  apply(host.ctx)
  for (const dispose of host.disposers) dispose()
  check(host.registered[0]?.__disposed === true, 'dispose 会注销路由')

  // effect 缺失时也要能工作（不注册也不抛）
  const noEffect = makeHost()
  const ctxNoEffect = {
    inject: (names, callback) => {
      if (names.includes('agentDefaultModel')) return callback({ agentDefaultModel: { currentSelection: () => undefined, saveSelection: () => Promise.resolve() } })
      if (names.includes('webServer')) return callback({ webServer: { register: () => () => {} } })
      return undefined
    },
  }
  void noEffect
  let threw = false
  try { apply(ctxNoEffect) } catch { threw = true }
  check(threw === false, 'webServer 上下文缺 effect 时不抛错')
}

console.log('')
console.log(failures === 0 ? '宿主半区自检 OK - 全部通过（' + checks + ' 项）' : '宿主半区自检失败 - ' + failures + ' 项')
process.exit(failures === 0 ? 0 : 1)
