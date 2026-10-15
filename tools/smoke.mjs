/**
 * Self-check for the sidebar foot card bundle.
 *
 * Loads lib/client.js in a VM with a hand-rolled DOM (no jsdom needed) and asserts:
 *   1. the bundle registers on window.__ModuleLoader__ with apply/inject, zero externals
 *   2. apply() mounts a container above the usage card inside footArea
 *   3. DeepSeek row reads ¥ today-cost + balance from the usage plugin and labels the unit 金额
 *   4. WorkBuddy row reads remaining credits and labels the unit 积分
 *   5. today's WorkBuddy spend comes from sampled balance drops (top-ups never count)
 *   6. the ledger resets across local days
 *   7. collapse is the default, persists, and expanding collapses the usage card
 *   8. a missing usage plugin or missing intl edition degrades to readable text, never a crash
 *
 * Run: node tools/smoke.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const BUNDLE = join(ROOT, 'lib', 'client.js')

let failures = 0
const check = (ok, label, extra) => {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label + (extra === undefined ? '' : '  -> ' + extra))
  if (!ok) failures += 1
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ------------------------------------------------------------------ DOM stub
class ClassList {
  constructor() { this.items = new Set() }
  add(...names) { for (const name of names) this.items.add(name) }
  remove(...names) { for (const name of names) this.items.delete(name) }
  toggle(name, force) { const on = force === undefined ? !this.items.has(name) : force; if (on) this.items.add(name); else this.items.delete(name); return on }
  contains(name) { return this.items.has(name) }
}

class Element {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.parentNode = null
    this.attributes = {}
    this.classList = new ClassList()
    this._style = undefined
    this.dataset = {}
    this._text = ''
    this.listeners = {}
    this.className = ''
    this.type = ''
  }
  get textContent() { return this._text }
  set textContent(value) { this._text = String(value); this.children = [] }
  get innerHTML() { return this._html ?? '' }
  set innerHTML(value) { this._html = String(value); this.children = [] }
  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return this.attributes[name] === undefined ? null : this.attributes[name] }
  removeAttribute(name) { delete this.attributes[name] }
  hasAttribute(name) { return this.attributes[name] !== undefined }
  /**
   * Minimal CSSStyleDeclaration: enough for the plugin's
   * `style.setProperty(var, value)` / `getPropertyValue(var)` usage, plus plain
   * property writes like `el.style.display = 'none'`.
   */
  get style() {
    if (this._style === undefined) {
      const props = {}
      const target = {
        setProperty(name, value) { props[name] = String(value) },
        getPropertyValue(name) { return props[name] === undefined ? '' : props[name] },
        removeProperty(name) { delete props[name] },
        get cssText() { return Object.keys(props).map((k) => k + ':' + props[k]).join(';') },
      }
      this._style = new Proxy(target, {
        get: (obj, key) => (key in obj ? obj[key] : (props[key] === undefined ? '' : props[key])),
        set: (obj, key, value) => {
          if (key in obj) obj[key] = value
          else props[key] = String(value)
          return true
        },
      })
    }
    return this._style
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child }
  append(...items) { for (const item of items) this.appendChild(item) }
  insertBefore(child, anchor) {
    const index = this.children.indexOf(anchor)
    child.parentNode = this
    if (index === -1) this.children.push(child)
    else this.children.splice(index, 0, child)
    return child
  }
  remove() {
    const parent = this.parentNode
    if (parent === null) return
    const index = parent.children.indexOf(this)
    if (index !== -1) parent.children.splice(index, 1)
    this.parentNode = null
  }
  get nextElementSibling() {
    const parent = this.parentNode
    if (parent === null) return null
    const index = parent.children.indexOf(this)
    return index === -1 || index + 1 >= parent.children.length ? null : parent.children[index + 1]
  }
  get lastElementChild() { return this.children.length === 0 ? null : this.children[this.children.length - 1] }
  addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler) }
  /**
   * Dispatch a click the way a browser does: build a real event object (so
   * handlers may call `stopPropagation`/`preventDefault`), then walk up the
   * ancestor chain unless propagation was stopped.
   *
   * The event object is required, not optional: production code legitimately
   * calls `event.stopPropagation()` to keep the lamp button from also toggling
   * the row, and a harness that hands over `{ target }` alone would crash on it
   * instead of testing the behaviour.
   */
  click() {
    let stopped = false
    let defaultPrevented = false
    const event = {
      type: 'click',
      target: this,
      currentTarget: this,
      stopPropagation() { stopped = true },
      stopImmediatePropagation() { stopped = true },
      preventDefault() { defaultPrevented = true },
      get defaultPrevented() { return defaultPrevented },
    }
    let node = this
    while (node !== null && node !== undefined) {
      event.currentTarget = node
      for (const handler of [...(node.listeners.click ?? [])]) {
        handler(event)
        if (stopped) break
      }
      if (stopped) break
      node = node.parentNode
    }
    return event
  }
  /**
   * Dispatch an arbitrary event to this element only (no bubbling) with a real
   * event object, so handlers may call preventDefault/stopPropagation.
   */
  dispatch(type, props) {
    const event = {
      type,
      target: this,
      currentTarget: this,
      stopPropagation() {},
      stopImmediatePropagation() {},
      preventDefault() {},
      defaultPrevented: false,
      ...(props ?? {}),
    }
    for (const handler of [...(this.listeners[type] ?? [])]) handler(event)
    return event
  }
  querySelector(selector) { return queryAll(this, selector)[0] ?? null }
  querySelectorAll(selector) { return queryAll(this, selector) }
  getBoundingClientRect() { return { x: 0, y: 0, width: 240, height: 20 } }
}

/** One compound selector (tag / .class / [attr]) against one element. */
function compoundMatches(element, selector) {
  let rest = selector
  let ok = true
  const tagMatch = /^[a-z]+/i.exec(rest)
  if (tagMatch !== null) {
    if (element.tagName !== tagMatch[0].toUpperCase()) ok = false
    rest = rest.slice(tagMatch[0].length)
  }
  for (const cls of [...rest.matchAll(/\.([A-Za-z0-9_-]+)/g)]) {
    rest = rest.replace(cls[0], '')
    if (!String(element.className ?? '').split(/\s+/).includes(cls[1])) ok = false
  }
  const attrMatches = [...rest.matchAll(/\[([a-zA-Z-]+)(?:\s*([*^$]?=)\s*"([^"]*)")?\]/g)]
  let consumed = rest
  for (const attr of attrMatches) {
    consumed = consumed.replace(attr[0], '')
    const [name, operator, value] = [attr[1], attr[2], attr[3]]
    const actual = name === 'class' ? element.className : element.attributes[name]
    if (actual === undefined || actual === null) { ok = false; continue }
    if (operator === undefined) continue
    if (operator === '=' && actual !== value) ok = false
    else if (operator === '*=' && !String(actual).includes(value)) ok = false
    else if (operator === '^=' && !String(actual).startsWith(value)) ok = false
  }
  if (consumed.trim() !== '') ok = false
  return ok
}

/** tag/.class/[attr] compounds + whitespace descendant combinators + comma lists. */
function matchesWithin(element, rawSelector) {
  const parts = rawSelector.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return false
  if (!compoundMatches(element, parts[parts.length - 1])) return false
  let ancestor = element.parentNode
  let index = parts.length - 2
  while (ancestor !== null && index >= 0) {
    if (compoundMatches(ancestor, parts[index])) index -= 1
    ancestor = ancestor.parentNode
  }
  return index < 0
}
function matches(element, rawSelector) {
  return rawSelector.split(',').some((part) => part.trim() !== '' && matchesWithin(element, part))
}
function queryAll(root, selector) {
  const out = []
  const walk = (node) => {
    for (const child of node.children) {
      if (matches(child, selector)) out.push(child)
      walk(child)
    }
  }
  walk(root)
  return out
}

function makeDom() {
  const body = new Element('body')
  const sidebar = new Element('div')
  sidebar.setAttribute('data-pane', 'sidebar')
  const foot = new Element('div')
  foot.className = 'sidebarCol_footArea__x1'
  const settings = new Element('div')
  settings.className = 'sidebarCol_settingsArea__x2'
  foot.appendChild(settings)
  sidebar.appendChild(foot)
  body.appendChild(sidebar)
  return { body, foot, settings }
}

function makeSandbox(dom, fetchImpl, storage) {
  const document = {
    body: dom.body,
    hidden: false,
    querySelector: (selector) => queryAll(dom.body, selector)[0] ?? null,
    querySelectorAll: (selector) => queryAll(dom.body, selector),
    createElement: (tag) => new Element(tag),
  }
  const window = {
    fetch: fetchImpl,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (fn) => { void fn(); return 0 },
    clearTimeout: () => {},
  }
  const sandbox = {
    window, document, localStorage: storage, fetch: fetchImpl,
    MutationObserver: undefined,
    console: { log: () => {}, error: () => {} },
    setTimeout: (fn) => { void fn(); return 0 }, clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    Promise, Math, Date, JSON, Object, Array, String, Number, Boolean, Error, Symbol, Set, Map,
  }
  sandbox.globalThis = sandbox
  window.__ModuleLoader__ = { load(spec) { sandbox.__loaded = spec } }
  return sandbox
}

/** localStorage stub backed by a Map. */
function makeStorage(seed) {
  const map = new Map(Object.entries(seed ?? {}))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    _map: map,
  }
}

/** Local day key, same rule the card uses (never toISOString, which is UTC). */
function localDay(offsetDays) {
  const date = new Date(Date.now() + (offsetDays ?? 0) * 86400000)
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

const DEEPSEEK_OVERVIEW = {
  updatedAt: Date.now(),
  providers: [
    { provider: 'deepseek', displayName: 'DeepSeek', credential: 'api-key', supported: true, balance: { currency: 'CNY', totalBalance: '9.99', updatedAt: Date.now() } },
  ],
  current: { provider: 'deepseek', model: 'deepseek-v4.1-flash', source: 'default', today: { cost: 0.1234, calls: 7 } },
  usage: {
    today: {
      date: '2026-10-11',
      // 官方 0.10 + 其它渠道 0.0234：DeepSeek 行只认官方那 0.10
      totals: { inputTokens: 12000, outputTokens: 3000, cacheReadTokens: 500, cacheWriteTokens: 100, reasoningTokens: 0, calls: 7, cost: 0.1234 },
      providers: [
        { provider: 'deepseek', totals: { inputTokens: 10000, outputTokens: 2000, cacheReadTokens: 500, cacheWriteTokens: 100, reasoningTokens: 0, calls: 5, cost: 0.1 } },
        { provider: 'zenmux', totals: { inputTokens: 2000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, calls: 2, cost: 0.0234 } },
      ],
    },
    days: [],
  },
}

/** Route-aware fetch stub. */
function makeFetch(options) {
  const calls = []
  /** 模型切换路由收到的 POST 记录。 */
  const modelPosts = []
  const impl = async (url, init) => {
    calls.push(url)
    if (url === '/plugins/dsh-workbuddy-foot-card/model') {
      const method = String(init?.method ?? 'GET').toUpperCase()
      if (method === 'POST') {
        let body
        try {
          body = JSON.parse(String(init?.body ?? '{}'))
        } catch {
          body = undefined
        }
        modelPosts.push({ method, body, headers: init?.headers })
        if (options.modelSwitchMissing === true) return { ok: false, status: 404, json: async () => ({}) }
        if (options.modelSwitchUnavailable === true) {
          return { ok: true, status: 503, json: async () => ({ ok: false, error: 'agent-default-model-unavailable' }) }
        }
        if (options.modelSwitchRejected === true) {
          return { ok: true, status: 500, json: async () => ({ ok: false, error: 'save-failed', message: '写入被拒绝' }) }
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, applied: { provider: 'p', model: 'm' } }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, current: undefined, targets: {} }) }
    }
    if (url === '/api/dsh-usage/overview') {
      if (options.usageMissing === true) return { ok: false, status: 404, json: async () => ({}) }
      if (options.usageError === true) return { ok: false, status: 500, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => options.overview ?? DEEPSEEK_OVERVIEW }
    }
    if (url === '/plugins/dsh-workbuddy-connect/status') {
      if (options.cnSignedOut === true) return { ok: true, status: 200, json: async () => ({ status: 'signed-out', reason: 'no credential' }) }
      return {
        ok: true, status: 200,
        json: async () => ({
          status: 'signed-in', nickname: '甲', domain: 'www.workbuddy.cn',
          credits: options.cnCredits ?? { total: 2100, accounts: [{ remain: 2100 }] },
          expiresAt: Date.now() + 86400000, source: 'desktop',
          models: [{ id: 'glm-5.3', credits: 0.79 }, { id: 'deepseek-v4-pro' }],
        }),
      }
    }
    if (url === '/plugins/dsh-workbuddy-connect/ai/status') {
      if (options.aiCredits === undefined) return { ok: false, status: 404, json: async () => ({}) }
      return {
        ok: true, status: 200,
        json: async () => ({
          status: 'signed-in', nickname: '乙', domain: 'workbuddy.ai',
          credits: options.aiCredits,
          expiresAt: Date.now() + 86400000, source: 'desktop',
        }),
      }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  impl.calls = calls
  impl.modelPosts = modelPosts
  return impl
}

/**
 * Build the client-side ctx.
 *
 * The card no longer writes settings itself: switching the global default model is
 * a host concern, so the client POSTs to its own host route
 * (`/plugins/dsh-workbuddy-foot-card/model`) and the HOST calls the official
 * `agentDefaultModel.saveSelection()`. The client ctx therefore only needs the
 * three cordis hooks it actually uses.
 *
 * @param writes - kept for call-site compatibility (unused by the client now).
 * @param options - unused.
 */
function makeHostCtx(writes, options) {
  void writes
  void options
  return {
    on: () => () => {},
    effect: (fn) => { fn(); return () => {} },
    inject: () => undefined,
  }
}

async function mountCard(options) {
  const dom = makeDom()
  const storage = makeStorage(options.seed)
  const fetchImpl = makeFetch(options)
  const sandbox = makeSandbox(dom, fetchImpl, storage)
  vm.createContext(sandbox)
  vm.runInContext(readFileSync(BUNDLE, 'utf8'), sandbox, { filename: BUNDLE })
  const module = sandbox.__loaded.factory(() => { throw new Error('bundle must not require anything') })
  const writes = []
  module.apply(makeHostCtx(writes, options))
  await sleep(0)
  return { dom, storage, fetchImpl, sandbox, module, writes, container: queryAll(dom.body, '[data-dsh-workbuddy-foot-card]')[0] }
}

/** Text spans of row N (0 = DeepSeek, 1 = WorkBuddy). */
function rowParts(container, index) {
  const rows = queryAll(container, '.wbf-row')
  const row = rows[index]
  if (row === undefined) return {}
  const pick = (selector) => {
    const el = queryAll(row, selector)[0]
    return el === undefined ? undefined : el.textContent
  }
  return {
    name: pick('.wbf-name'), today: pick('.wbf-today'),
    unit: pick('.wbf-unit'), remain: pick('.wbf-remain'),
    rowText: [pick('.wbf-name'), pick('.wbf-today'), pick('.wbf-unit'), pick('.wbf-remain')].join(' '),
  }
}
const detailText = (container) => JSON.stringify(queryAll(container, '.wbf-detail .wbf-k, .wbf-detail .wbf-v').map((el) => el.textContent))

// ------------------------------------------------------------------ run
console.log('# bundle 注册')
let registration
const registrationSandbox = { window: { __ModuleLoader__: { load: (spec) => { registration = spec } } }, console: { log: () => {}, error: () => {} } }
registrationSandbox.globalThis = registrationSandbox
vm.createContext(registrationSandbox)
vm.runInContext(readFileSync(BUNDLE, 'utf8'), registrationSandbox, { filename: BUNDLE })
check(registration !== undefined, 'window.__ModuleLoader__.load 被调用')
check(registration?.id === 'dsh-workbuddy-foot-card', '注册 id 正确', registration?.id)
check(typeof registration?.factory === 'function', 'factory 是函数')
const moduleShape = registration.factory(() => { throw new Error('bundle must not require anything') })
check(typeof moduleShape.apply === 'function', 'factory 返回 apply（客户端插件形状）')
check(Array.isArray(moduleShape.inject) && moduleShape.inject.length === 0, '不需要任何 external（零依赖）')

console.log('# 挂载位置')
const base = await mountCard({})
check(base.container !== undefined, 'apply 后卡片容器出现')
check(base.container.parentNode === base.dom.foot, '挂在侧栏 footArea 里')
check(base.dom.foot.children.indexOf(base.container) < base.dom.foot.children.indexOf(base.dom.settings), '位于设置行上方（与用量卡同区）')
check(base.fetchImpl.calls.some((url) => url === '/api/dsh-usage/overview'), '读了 DeepSeek 用量总览')
check(base.fetchImpl.calls.filter((url) => url.indexOf('/plugins/dsh-workbuddy-connect') === 0).length === 2, '同时读国内版与国际版')

console.log('# 两行：DeepSeek 金额 / WorkBuddy 积分（单位必须标清）')
const dsRow = rowParts(base.container, 0)
const wbRow = rowParts(base.container, 1)
check(dsRow.name === 'DeepSeek', '第一行是 DeepSeek', String(dsRow.name))
check(wbRow.name === 'WorkBuddy', '第二行是 WorkBuddy', String(wbRow.name))
check(dsRow.unit.includes('金额'), 'DeepSeek 行标注（金额）', String(dsRow.unit))
check(wbRow.unit.includes('积分'), 'WorkBuddy 行标注（积分）', String(wbRow.unit))
check(dsRow.today.includes('¥') && dsRow.today.includes('0.10'), 'DeepSeek 今日消费是 ¥ 金额（只算自家官方渠道）', String(dsRow.today))
check(dsRow.remain.includes('¥9.99'), 'DeepSeek 余额带货币符号', String(dsRow.remain))
check(wbRow.today.includes('今日'), 'WorkBuddy 行有今日统计位', String(wbRow.today))
check(wbRow.remain.includes('2,100') && wbRow.remain.includes('积分'), 'WorkBuddy 剩余积分', String(wbRow.remain))
check(dsRow.today.indexOf('积分') === -1, 'DeepSeek 行不会把金额写成积分')

console.log('# WorkBuddy 今日消耗 = 采样到的余额下降')
const spendCase = await mountCard({ seed: { 'dsh-workbuddy-foot-card.ledger.v1': JSON.stringify({ day: localDay(), spend: 0, last: 2145 }) } })
const spendRow = rowParts(spendCase.container, 1)
check(spendRow.today.includes('45'), '余额从 2145 掉到 2100 -> 今日 45 积分', String(spendRow.today))
const savedLedger = JSON.parse(spendCase.storage.getItem('dsh-workbuddy-foot-card.ledger.v1'))
check(savedLedger.cn.spend === 45 && savedLedger.cn.last === 2100, '台账按变体记下消耗与最新余额', JSON.stringify(savedLedger))
// 充值不计数
const topupCase = await mountCard({ seed: { 'dsh-workbuddy-foot-card.ledger.v1': JSON.stringify({ day: localDay(), spend: 12, last: 1000 }) } })
const topupRow = rowParts(topupCase.container, 1)
check(topupRow.today.includes('12'), '余额上涨（充值）不计入今日消耗', String(topupRow.today))
// 跨日重置
const yesterday = localDay(-1)
const newDayCase = await mountCard({ seed: { 'dsh-workbuddy-foot-card.ledger.v1': JSON.stringify({ day: yesterday, spend: 999, last: 5000 }) } })
const newDayRow = rowParts(newDayCase.container, 1)
check(newDayRow.today.includes('0') && !newDayRow.today.includes('999'), '跨天后今日消耗从 0 重新算', String(newDayRow.today))

console.log('# 手风琴：只展开点中的那一行')
check(base.storage.getItem('dsh-workbuddy-foot-card.row') === null, '默认两行都不展开（最省空间）')
check(queryAll(base.container, '.wbf-detail').length === 0, '收起时不渲染明细（不占高度）')
const usageCard = new Element('div')
usageCard.setAttribute('data-dsh-usage-foot-card', '')
const usageToggle = new Element('button')
usageToggle.setAttribute('data-dsh-part', 'foot-card-toggle')
let usageCollapsed = false
usageToggle.addEventListener('click', () => { usageCollapsed = true })
usageCard.appendChild(usageToggle)
base.dom.foot.insertBefore(usageCard, base.dom.settings)
check(queryAll(base.container, '.wbf-row').length === 2, '永远只有两行', String(queryAll(base.container, '.wbf-row').length))
// 展开第二行（WorkBuddy）
queryAll(base.container, '.wbf-rowmain')[1].click()
await sleep(0)
check(base.storage.getItem('dsh-workbuddy-foot-card.row') === 'workbuddy', '展开的是 WorkBuddy 行并落盘')
check(queryAll(base.container, '.wbf-detail').length === 1, '只挂一个明细区', String(queryAll(base.container, '.wbf-detail').length))
check(queryAll(base.container, '[data-dsh-detail="workbuddy"]').length === 1, '明细区属于 WorkBuddy')
check(queryAll(base.container, '[data-dsh-detail="deepseek"]').length === 0, 'DeepSeek 行保持一行高')
const wbDetail = detailText(base.container)
check(wbDetail.includes('今日消耗') && wbDetail.includes('积分'), 'WorkBuddy 明细有「今日消耗」且写积分', wbDetail.slice(0, 120))
check(usageCollapsed === true, '我展开时把用量卡收起（互斥，不叠高）')
// 切到第一行（DeepSeek）：手风琴，同时只有一个明细
queryAll(base.container, '.wbf-rowmain')[0].click()
await sleep(0)
check(base.storage.getItem('dsh-workbuddy-foot-card.row') === 'deepseek', '切换到 DeepSeek 行')
check(queryAll(base.container, '.wbf-detail').length === 1, '同一时刻只有一个明细区（手风琴）', String(queryAll(base.container, '.wbf-detail').length))
check(queryAll(base.container, '[data-dsh-detail="deepseek"]').length === 1 && queryAll(base.container, '[data-dsh-detail="workbuddy"]').length === 0, '展开项正确切换')
const dsDetail = detailText(base.container)
check(dsDetail.includes('DeepSeek 今日'), 'DeepSeek 明细有自家今日消费', dsDetail.slice(0, 120))
check(dsDetail.includes('元'), 'DeepSeek 明细写明「元」（金额口径）')
check(dsDetail.includes('tokens'), '明细里有今日 token 用量')
// 再点自己 -> 全部收起
queryAll(base.container, '.wbf-rowmain')[0].click()
await sleep(0)
check(queryAll(base.container, '.wbf-detail').length === 0, '再点自己就全部收起')
check(base.storage.getItem('dsh-workbuddy-foot-card.row') === null, '收起状态落盘')

console.log('# 单独计量 + 今日合计')
{
  // DeepSeek 只算自己：官方 0.10，合计 0.1234（含其它渠道 0.0234）
  const solo = await mountCard({})
  const dsRowSolo = rowParts(solo.container, 0)
  check(dsRowSolo.today.includes('¥0.10'), 'DeepSeek 行只算 DeepSeek 自己（¥0.10，不含其它渠道）', String(dsRowSolo.today))
  check(!dsRowSolo.today.includes('0.12'), '不会把当天合计当成 DeepSeek 自己的', String(dsRowSolo.today))
  queryAll(solo.container, '.wbf-rowmain')[0].click()
  await sleep(0)
  const dsDetail = detailText(solo.container)
  check(dsDetail.includes('只算 DeepSeek 自己'), 'DeepSeek 明细写明本行口径', dsDetail.slice(0, 100))
  check(dsDetail.includes('¥0.02') || dsDetail.includes('其它渠道今日'), '其它渠道单独列且标注不计入本行')
  check(dsDetail.includes('今日金额合计') && dsDetail.includes('0.12'), '明细里给出今日金额合计（全部消耗）')
}
{
  // 两版 WorkBuddy 各自计量：国内 2200->2100（花 100），国际 800->780（花 20）
  const day = localDay()
  const twoVariants = await mountCard({
    aiCredits: { total: 780, accounts: [{ remain: 780 }] },
    seed: {
      'dsh-workbuddy-foot-card.ledger.v1': JSON.stringify({ day, cn: { spend: 0, last: 2200 }, ai: { spend: 0, last: 800 } }),
    },
  })
  const wbRowTwo = rowParts(twoVariants.container, 1)
  check(wbRowTwo.today.includes('120'), 'WorkBuddy 行显示两版合计消耗（100+20=120）', String(wbRowTwo.today))
  check(wbRowTwo.remain.includes('2,880'), '两版余额相加（2100+780）', String(wbRowTwo.remain))
  queryAll(twoVariants.container, '.wbf-rowmain')[1].click()
  await sleep(0)
  const wbDetail = detailText(twoVariants.container)
  check(wbDetail.includes('国内版') && wbDetail.includes('国际版'), '明细里两版都在', wbDetail.slice(0, 80))
  check(wbDetail.includes('100'), '国内版单独计量 100 积分')
  check(wbDetail.includes('20'), '国际版单独计量 20 积分')
  check(wbDetail.includes('今日合计') || wbDetail.includes('WorkBuddy 今日'), '有今日消耗行')
}
{
  // 今日合计行：DeepSeek ¥ + WorkBuddy 积分 都在
  const totals = await mountCard({ aiCredits: { total: 780, accounts: [{ remain: 780 }] } })
  const totalEl = queryAll(totals.container, '[data-dsh-total]')[0]
  check(totalEl !== undefined, '有「今日合计」行')
  const totalText = totalEl === undefined ? '' : [queryAll(totalEl, '.wbf-total-label')[0]?.textContent, queryAll(totalEl, '.wbf-total-value')[0]?.textContent].join(' ')
  check(totalText.includes('今日合计'), '标签写着今日合计', totalText)
  check(totalText.includes('¥0.10'), '合计里有 DeepSeek 金额', totalText)
  check(totalText.includes('积分'), '合计里有 WorkBuddy 积分（标明单位，不跨单位相加）', totalText)
}
{
  // 单位不同不能相加：只有金额没有积分时，合计只写金额
  const onlyDs = await mountCard({ cnSignedOut: true })
  const totalEl = queryAll(onlyDs.container, '[data-dsh-total]')[0]
  const totalText = totalEl === undefined ? '' : [queryAll(totalEl, '.wbf-total-label')[0]?.textContent, queryAll(totalEl, '.wbf-total-value')[0]?.textContent].join(' ')
  check(totalText.includes('¥0.10') && !totalText.includes('积分'), 'WorkBuddy 未登录时合计只列金额', totalText)
}

console.log('# 橙灯：默认跟随「当前正在消耗哪一个」')
const dsRows = queryAll(base.container, '.wbf-row')
check(queryAll(dsRows[0], '.wbf-dot.warm').length === 1, 'DeepSeek 是当前 provider -> 它前面是橙灯')
check(queryAll(dsRows[1], '.wbf-dot.warm').length === 0, 'WorkBuddy 不是橙灯')
check(queryAll(dsRows[1], '.wbf-dot.on').length === 1, 'WorkBuddy 是绿灯（已登录但不是当前在用）')
check(queryAll(dsRows[0], '.wbf-tag').length === 1 && queryAll(dsRows[0], '.wbf-tag')[0].textContent.includes('已选中'), '橙灯那一行有「已选中」标签', queryAll(dsRows[0], '.wbf-tag')[0].textContent)
check(rowParts(base.container, 0).unit.includes('金额'), '橙灯行的单位标注仍在（金额）', String(rowParts(base.container, 0).unit))
check(rowParts(base.container, 1).unit.includes('积分'), '另一行的单位标注也在（积分）', String(rowParts(base.container, 1).unit))
const wbActive = await mountCard({ overview: { ...DEEPSEEK_OVERVIEW, current: { provider: 'workbuddy', model: 'glm-5.3', source: 'live' } } })
const wbRows = queryAll(wbActive.container, '.wbf-row')
check(queryAll(wbRows[1], '.wbf-dot.warm').length === 1, '切成 WorkBuddy 后橙灯换到它那行')
check(queryAll(wbRows[0], '.wbf-dot.warm').length === 0, 'DeepSeek 不再是橙灯')
check(queryAll(wbRows[1], '.wbf-tag').length === 1, '橙灯行标签跟着走')
const noCurrent = await mountCard({ overview: { ...DEEPSEEK_OVERVIEW, current: undefined } })
check(queryAll(noCurrent.container, '.wbf-dot.warm').length === 0, '拿不到当前 provider 时没有橙灯（不瞎标）')

console.log('# 手动切换：点前面的灯在两种计量单位间切')
{
  const lamps = queryAll(base.container, '.wbf-dotbtn')
  check(lamps.length === 2, '两行各有一个可点的灯', String(lamps.length))
  check(queryAll(base.container, '[data-dsh-pick="deepseek"]').length === 1, 'DeepSeek 的灯带 data-dsh-pick')
  check(queryAll(base.container, '[data-dsh-pick="workbuddy"]').length === 1, 'WorkBuddy 的灯带 data-dsh-pick')

  // 自动判断是 deepseek；点 WorkBuddy 的灯 -> 切过去
  queryAll(base.container, '[data-dsh-pick="workbuddy"]')[0].click()
  await sleep(0)
  check(base.storage.getItem('dsh-workbuddy-foot-card.picked') === 'workbuddy', '点灯后手动选择落盘', String(base.storage.getItem('dsh-workbuddy-foot-card.picked')))
  const afterPick = queryAll(base.container, '.wbf-row')
  check(queryAll(afterPick[1], '.wbf-dot.warm').length === 1, '点 WorkBuddy 的灯 -> 它变橙')
  check(queryAll(afterPick[0], '.wbf-dot.warm').length === 0, 'DeepSeek 不再是橙灯（被切走了）')
  check(queryAll(afterPick[1], '.wbf-tag')[0]?.textContent === '已选中', '「已选中」标签跟着移到 WorkBuddy')
  check(queryAll(base.container, '[data-dsh-detail="workbuddy"]').length === 1, '选中某行时会展开它的明细')

  // 点 DeepSeek 的灯 -> 切过去
  queryAll(base.container, '[data-dsh-pick="deepseek"]')[0].click()
  await sleep(0)
  check(base.storage.getItem('dsh-workbuddy-foot-card.picked') === 'deepseek', '再点另一盏灯 -> 切成 DeepSeek')
  const afterSwitch = queryAll(base.container, '.wbf-row')
  check(queryAll(afterSwitch[0], '.wbf-dot.warm').length === 1, 'DeepSeek 变橙')
  check(queryAll(afterSwitch[1], '.wbf-dot.warm').length === 0, 'WorkBuddy 熄灭')
  check(queryAll(base.container, '[data-dsh-detail="deepseek"]').length === 1, '明细也跟着切到 DeepSeek')

  // 点已选中的灯 -> 取消手动选择，回到自动跟随
  queryAll(base.container, '[data-dsh-pick="deepseek"]')[0].click()
  await sleep(0)
  const cleared = base.storage.getItem('dsh-workbuddy-foot-card.picked')
  check(cleared === null || cleared === '', '再点已选中的灯 -> 取消手动选择', String(cleared))
  check(queryAll(queryAll(base.container, '.wbf-row')[0], '.wbf-dot.warm').length === 1, '取消后回到自动跟随（仍是 DeepSeek）')

  // 点灯与行体是两套按钮，互不干扰
  queryAll(base.container, '[data-dsh-pick="deepseek"]')[0].click()
  await sleep(0)
  check(queryAll(base.container, '.wbf-detail').length === 1, '点灯只切选中并展开，不会误折叠', String(queryAll(base.container, '.wbf-detail').length))

  // 手动选择跨刷新保持，不被自动判断覆盖
  const persisted = await mountCard({
    overview: { ...DEEPSEEK_OVERVIEW, current: { provider: 'deepseek', model: 'x', source: 'default' } },
    seed: { 'dsh-workbuddy-foot-card.picked': 'workbuddy' },
  })
  const rowsP = queryAll(persisted.container, '.wbf-row')
  check(queryAll(rowsP[1], '.wbf-dot.warm').length === 1, '刷新后仍选中手动选的那一行（不被自动判断覆盖）')
  check(queryAll(rowsP[0], '.wbf-dot.warm').length === 0, '自动判断那行不再抢橙灯')
}

console.log('# 点灯 = 真的切换全局默认模型（POST 宿主路由）')
{
  const swap = await mountCard({})
  // 自动判断是 deepseek；点 WorkBuddy 的灯 -> 应 POST 切到 workbuddy
  queryAll(swap.container, '[data-dsh-pick="workbuddy"]')[0].click()
  await sleep(0)
  await sleep(0)
  const posts = swap.fetchImpl.modelPosts
  check(posts.length === 1, '点灯触发了一次模型切换请求', String(posts.length))
  const post = posts[0] ?? {}
  check(post.method === 'POST', '用 POST 调宿主路由', String(post.method))
  check(post.body?.row === 'workbuddy', '请求体写明要切到哪一套', JSON.stringify(post.body))
  check(String(post.headers?.['content-type'] ?? '').includes('json'), '带 json content-type', String(post.headers?.['content-type']))
  check(
    swap.fetchImpl.calls.includes('/plugins/dsh-workbuddy-foot-card/model'),
    '打的是本插件自己的宿主路由',
    swap.fetchImpl.calls.join(','),
  )
  const notice = queryAll(swap.container, '[data-dsh-model-notice]')[0]
  check(notice !== undefined, '切换后卡片上出现结果提示')
  check(String(notice?.textContent ?? '').includes('已切换默认模型'), '成功提示写明已切换', String(notice?.textContent ?? ''))
  check(String(notice?.textContent ?? '').includes('deepseek-v4.1-flash'), '提示里给出具体模型名', String(notice?.textContent ?? ''))
}
{
  // 再点另一盏灯 -> 切到 deepseek；点已选中的灯 -> 不动模型
  const swap = await mountCard({})
  queryAll(swap.container, '[data-dsh-pick="workbuddy"]')[0].click()
  await sleep(0); await sleep(0)
  queryAll(swap.container, '[data-dsh-pick="deepseek"]')[0].click()
  await sleep(0); await sleep(0)
  const posts = swap.fetchImpl.modelPosts
  check(posts.length === 2, '切两次 -> 两次请求', String(posts.length))
  check(posts[1]?.body?.row === 'deepseek', '第二次切到 deepseek', JSON.stringify(posts[1]?.body))
  // 点已选中那盏灯 = 取消手动选择，不应再发请求
  queryAll(swap.container, '[data-dsh-pick="deepseek"]')[0].click()
  await sleep(0); await sleep(0)
  check(swap.fetchImpl.modelPosts.length === 2, '点已选中的灯只取消选择、不再改模型', String(swap.fetchImpl.modelPosts.length))
}
{
  // 宿主路由不存在（旧版宿主半区）-> 如实提示失败，且卡片不崩
  const missing = await mountCard({ modelSwitchMissing: true })
  queryAll(missing.container, '[data-dsh-pick="workbuddy"]')[0].click()
  await sleep(0); await sleep(0)
  const notice = queryAll(missing.container, '[data-dsh-model-notice]')[0]
  check(notice !== undefined, '404 时仍然给出提示（不静默）')
  check(String(notice?.textContent ?? '').includes('失败'), '404 提示写明失败', String(notice?.textContent ?? ''))
  check(queryAll(missing.container, '.wbf-row').length === 2, '失败后卡片依然正常（两行都在）')
}
{
  // 宿主没有 agent-default-model 服务 -> 明确说清原因
  const unavail = await mountCard({ modelSwitchUnavailable: true })
  queryAll(unavail.container, '[data-dsh-pick="workbuddy"]')[0].click()
  await sleep(0); await sleep(0)
  const notice = queryAll(unavail.container, '[data-dsh-model-notice]')[0]
  check(String(notice?.textContent ?? '').includes('agent-default-model'), '缺少官方服务时提示指出原因', String(notice?.textContent ?? ''))
}
{
  // 宿主拒绝写入 -> 把宿主给的原因带出来
  const rejected = await mountCard({ modelSwitchRejected: true })
  queryAll(rejected.container, '[data-dsh-pick="workbuddy"]')[0].click()
  await sleep(0); await sleep(0)
  const notice = queryAll(rejected.container, '[data-dsh-model-notice]')[0]
  check(String(notice?.textContent ?? '').includes('写入被拒绝'), '宿主拒绝时带出具体原因', String(notice?.textContent ?? ''))
}

console.log('# 缺失与失败降级')
const noUsage = await mountCard({ usageMissing: true })
const noUsageRow = rowParts(noUsage.container, 0)
check(noUsageRow.remain.includes('未安装'), '用量插件没装 -> DeepSeek 行显示未安装', String(noUsageRow.remain))
check(rowParts(noUsage.container, 1).remain.includes('2,100'), '另一行不受影响照常显示积分', String(rowParts(noUsage.container, 1).remain))
const usageBroken = await mountCard({ usageError: true })
check(rowParts(usageBroken.container, 0).remain.includes('读取失败'), '用量接口失败 -> 显示读取失败', String(rowParts(usageBroken.container, 0).remain))
const signedOut = await mountCard({ cnSignedOut: true })
const signedOutRow = rowParts(signedOut.container, 1)
check(signedOutRow.remain.includes('未登录'), 'WorkBuddy 未登录时如实显示', String(signedOutRow.remain))
check(signedOutRow.today.includes('—'), '未登录时今日消耗显示 —', String(signedOutRow.today))
const unlimited = await mountCard({ cnCredits: { total: 0, accounts: [{ remain: 0, unlimited: true }], unlimited: true } })
check(rowParts(unlimited.container, 1).remain.includes('不限'), '企业不限额度显示「不限」', String(rowParts(unlimited.container, 1).remain))
const objectCredits = await mountCard({ cnCredits: { total: 2100, accounts: [{ remain: 2100 }] } })
check(rowParts(objectCredits.container, 1).remain.includes('2,100'), '对象形状 { total } 不再被误读成 0', String(rowParts(objectCredits.container, 1).remain))

console.log('# 卡片区高度控制：默认矮 + 可拖（工作区拿大头）')
{
  const ctl = await mountCard({})
  // 容器上打了标记，CSS 才能只作用于它（不猜 DSH 的内部类名）
  check(ctl.dom.foot.getAttribute('data-dsh-foot-area') !== null, '卡片区被本插件标记（不靠 DSH 类名）', String(ctl.dom.foot.getAttribute('data-dsh-foot-area')))
  const handle = queryAll(ctl.dom.foot.parentNode, '[data-dsh-foot-area-handle]')[0]
  check(handle !== undefined, '分隔条已挂上')
  check(handle?.nextElementSibling === ctl.dom.foot, '分隔条插在卡片区正上方', String(handle?.nextElementSibling === ctl.dom.foot))
  // 默认值：偏矮（工作区拿大头），且没存过时就是这个默认
  check(ctl.storage.getItem('dsh-workbuddy-foot-card.max') === null, '没拖过时不写盘（用默认值）')
  check(String(ctl.dom.foot.style.getPropertyValue('max-height')) === '172px', '默认上限 172px（偏矮）', String(ctl.dom.foot.style.getPropertyValue('max-height')))

  // 往下拖 = 卡片区变高
  handle.dispatch('pointerdown', { clientY: 100, pointerId: 1 })
  handle.dispatch('pointermove', { clientY: 180 })
  check(String(ctl.dom.foot.style.getPropertyValue('max-height')) === '252px', '下拖 80px -> 上限 +80', String(ctl.dom.foot.style.getPropertyValue('max-height')))
  handle.dispatch('pointerup', {})
  check(ctl.storage.getItem('dsh-workbuddy-foot-card.max') === '252', '松手后落盘', String(ctl.storage.getItem('dsh-workbuddy-foot-card.max')))

  // 往上拖回来
  handle.dispatch('pointerdown', { clientY: 300, pointerId: 1 })
  handle.dispatch('pointermove', { clientY: 200 })
  check(String(ctl.dom.foot.style.getPropertyValue('max-height')) === '152px', '上拖 100px -> 上限 -100', String(ctl.dom.foot.style.getPropertyValue('max-height')))

  // 夹取：不能小于下限
  handle.dispatch('pointermove', { clientY: -9999 })
  check(String(ctl.dom.foot.style.getPropertyValue('max-height')) === '40px', '再小夹到下限 40px', String(ctl.dom.foot.style.getPropertyValue('max-height')))
  // 夹取：不能大于上限
  handle.dispatch('pointermove', { clientY: 99999 })
  check(String(ctl.dom.foot.style.getPropertyValue('max-height')) === '520px', '再大夹到上限 520px', String(ctl.dom.foot.style.getPropertyValue('max-height')))
  handle.dispatch('pointerup', {})

  // 双击复位
  handle.dispatch('dblclick', {})
  check(String(ctl.dom.foot.style.getPropertyValue('max-height')) === '172px', '双击复位到 172px', String(ctl.dom.foot.style.getPropertyValue('max-height')))
  check(ctl.storage.getItem('dsh-workbuddy-foot-card.max') === '172', '复位也落盘', String(ctl.storage.getItem('dsh-workbuddy-foot-card.max')))

  // 持久化：下次挂载沿用
  const again = await mountCard({ seed: { 'dsh-workbuddy-foot-card.max': '300' } })
  check(String(again.dom.foot.style.getPropertyValue('max-height')) === '300px', '刷新后沿用上次拖的高度', String(again.dom.foot.style.getPropertyValue('max-height')))
  // 脏数据兜底
  const dirty = await mountCard({ seed: { 'dsh-workbuddy-foot-card.max': 'not-a-number' } })
  check(String(dirty.dom.foot.style.getPropertyValue('max-height')) === '172px', '脏数据回落默认值', String(dirty.dom.foot.style.getPropertyValue('max-height')))
  const outOfRange = await mountCard({ seed: { 'dsh-workbuddy-foot-card.max': '99999' } })
  check(String(outOfRange.dom.foot.style.getPropertyValue('max-height')) === '520px', '越界值夹回区间', String(outOfRange.dom.foot.style.getPropertyValue('max-height')))
}

console.log('# 幂等')
const repeat = await mountCard({})
repeat.module.apply(makeHostCtx([]))
check(queryAll(repeat.dom.body, '[data-dsh-workbuddy-foot-card]').length === 1, '重复 apply 不会挂第二张卡')

console.log('')
console.log(failures === 0 ? '侧栏用量卡自检 OK - 全部通过' : '侧栏用量卡自检失败 - ' + failures + ' 项')
process.exit(failures === 0 ? 0 : 1)
