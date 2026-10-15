/**
 * dsh-workbuddy-foot-card — 宿主半区。
 *
 * 客户端那张卡需要「点灯就真的切换全局默认模型」。而改默认模型是**宿主侧**的事：
 * 官方 `@deepseek-ai/dsh-agent-default-model` 提供 `agentDefaultModel` 服务，
 * 只有它的 `saveSelection()` 会把选择写进 profile patch；浏览器半区碰不到它。
 * 所以这里只做一件事：**开一条本机路由**，让卡片把「切到哪一套」告诉宿主。
 *
 * 路由：
 *   GET  /plugins/dsh-workbuddy-foot-card/model
 *        -> { ok, current, targets }
 *   POST /plugins/dsh-workbuddy-foot-card/model   body {"row":"deepseek"|"workbuddy"}
 *        -> { ok, applied }
 *
 * 安全：只服务本机回环请求（Host 头必须是 127.0.0.1 / localhost / [::1]），
 * 不读凭据、不转发数据、不联外网，只在宿主内调用官方服务。
 * 容错：任何一环缺失（没有 webServer / 没有 agentDefaultModel）都只回 ok:false，
 * 绝不抛错拖垮插件或宿主。
 */

/** 路由路径（客户端与此处必须一致）。 */
const ROUTE = '/plugins/dsh-workbuddy-foot-card/model'

/**
 * 两套目标（与客户端 MODEL_TARGETS 是同一事实，改一处要同步另一处）：
 *   deepseek  = 官方通道，花 DeepSeek 余额（¥）
 *   workbuddy = WorkBuddy 通道，花积分
 */
const TARGETS = {
  deepseek: { provider: 'deepseek-account', model: 'deepseek-flash', label: 'DeepSeek 官方（花余额）· deepseek-flash' },
  workbuddy: { provider: 'workbuddy', model: 'deepseek-v4.1-flash', label: 'WorkBuddy（花积分）· deepseek-v4.1-flash' },
}

/** 请求体上限：很小即可，避免被本地进程灌数据。 */
const MAX_BODY_BYTES = 4096

export const inject = []

/**
 * 请求是否来自本机回环。
 * @param req - Node 请求对象。
 * @returns 回环则 true。
 */
function isLoopback(req) {
  const host = String(req?.headers?.host ?? '')
  return (
    host.startsWith('127.0.0.1') ||
    host.startsWith('localhost') ||
    host.startsWith('[::1]') ||
    host.startsWith('::1')
  )
}

/**
 * 读请求体（带字节上限），任何异常都退化成空串。
 * @param req - Node 请求对象。
 * @returns body 文本（可能为空）。
 */
function readBody(req) {
  return new Promise((resolve) => {
    let size = 0
    let done = false
    const chunks = []
    const finish = (value) => {
      if (done) return
      done = true
      resolve(value)
    }
    try {
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          finish('')
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')))
      req.on('error', () => finish(''))
    } catch {
      finish('')
    }
  })
}

/** 写 JSON 响应（连接已断等异常忽略）。 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  try {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
    res.end(payload)
  } catch {
    /* 忽略 */
  }
}

/**
 * 挂载默认模型切换路由。永不抛错。
 * @param ctx - 宿主 context。
 */
export function apply(ctx) {
  if (ctx === null || ctx === undefined || typeof ctx.inject !== 'function') return

  /**
   * 单独捕获官方默认模型服务：即便它缺失，路由本身仍然在，
   * 只是如实回 ok:false，客户端能给出可读的失败提示。
   */
  let modelService
  try {
    ctx.inject(['agentDefaultModel'], (serviceCtx) => {
      modelService = serviceCtx?.agentDefaultModel
    })
  } catch {
    /* 没有该服务：保持 undefined */
  }

  try {
    ctx.inject(['webServer'], (webCtx) => {
      if (webCtx === null || webCtx === undefined) return
      if (typeof webCtx.webServer?.register !== 'function') return
      webCtx.effect(() => {
        const dispose = webCtx.webServer.register({
          kind: 'exact',
          path: ROUTE,
          handler: async (req, res) => {
            if (!isLoopback(req)) {
              sendJson(res, 403, { ok: false, error: 'request-not-trusted' })
              return
            }
            const method = String(req?.method ?? 'GET').toUpperCase()

            if (method === 'GET') {
              let current
              try {
                current = modelService?.currentSelection?.()
              } catch {
                current = undefined
              }
              sendJson(res, 200, { ok: true, current, targets: TARGETS })
              return
            }

            if (method !== 'POST') {
              sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
              return
            }

            let row = ''
            try {
              const raw = await readBody(req)
              if (raw !== '') {
                const parsed = JSON.parse(raw)
                row = String(parsed?.row ?? '')
              }
            } catch {
              row = ''
            }
            const target = TARGETS[row]
            if (target === undefined) {
              sendJson(res, 400, { ok: false, error: 'unknown-row', row })
              return
            }
            if (modelService === undefined || typeof modelService.saveSelection !== 'function') {
              sendJson(res, 503, { ok: false, error: 'agent-default-model-unavailable' })
              return
            }
            try {
              await modelService.saveSelection({ provider: target.provider, model: target.model })
              sendJson(res, 200, { ok: true, applied: target })
            } catch (error) {
              const message = error === null || error === undefined ? 'unknown' : String(error.message ?? error)
              sendJson(res, 500, { ok: false, error: 'save-failed', message })
            }
          },
        })
        return () => {
          try {
            dispose()
          } catch {
            /* 卸载失败不该抛 */
          }
        }
      }, 'dsh-workbuddy-foot-card: default model route')
    })
  } catch {
    /* 没有 webServer：卡片仍能显示，只是不能切模型 */
  }
}
