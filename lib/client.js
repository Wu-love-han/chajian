/**
 * dsh-workbuddy-foot-card — 侧栏底部「今日消耗 / 剩余」速览卡（客户端半区）。
 *
 * 一张卡、两条紧凑行，和 @linxin666/dsh-usage 的用量卡并排放在侧栏 footArea
 * （设置行上方），风格一致、可折叠，且两张卡**互斥展开**，总高度不叠加：
 *
 *   ◉ DeepSeek    今日 ¥0.12 （金额）   余额 ¥9.99        ▸
 *   ● WorkBuddy   今日 45 （积分）      剩余 2,100 积分    ▾  已选中
 *      [只有展开的那一行下面才挂明细，另一行永远保持一行高]
 *
 * 三种灯：
 *   - 橙灯（选中态）= **手动点灯选中的那一种**；没手动选过时，跟随当前正在消耗的那一家
 *     （按用量插件给的 `current.provider` 判断）。**点灯就能在两种计量单位间手动切换**。
 *   - 绿灯          = 已登录/可用，但当前没选中它
 *   - 灰灯          = 未登录 / 读不到
 *
 * 点灯 = 切换选中（点已选中的灯则取消手动选择，回到自动跟随）；选中的那一行会自动展开。
 * 灯是独立按钮，点行体仍然只是展开/收起，两者互不干扰。
 *
 * 数据：DeepSeek 行读 `/api/dsh-usage/overview`（今日消费金额 CNY + 余额 + 当前 provider）；
 * WorkBuddy 行读本插件自己的状态路由（剩余积分）。上游没有按日接口，所以 WorkBuddy 的
 * 「今日消耗」由每 30 秒采样余额、只累计**下降量**得到（充值不计），按本地日记在本地。
 *
 * 只读展示：不碰凭据、不发模型请求、不消耗积分。纯 DOM，零依赖。
 */
window.__ModuleLoader__.load({
	id: 'dsh-workbuddy-foot-card',
	factory: () => {
		/** 卡片容器标记，用于 DOM 级幂等。 */
		const CARD_SELECTOR = '[data-dsh-workbuddy-foot-card]'
		/** 哪一行展开着（'deepseek' | 'workbuddy' | 缺省 = 都收起）。 */
		const ROW_KEY = 'dsh-workbuddy-foot-card.row'
		/** 手动选中了哪一行（点前面的灯切换）；缺省 = 跟随自动判断。 */
		const PICK_KEY = 'dsh-workbuddy-foot-card.picked'
		/**
		 * 点灯要切到的三套默认模型（与宿主半区 lib/index.js 的 TARGETS 是同一事实，
		 * 改一处必须同步另一处）：
		 *   deepseek  = 官方通道，花 DeepSeek 余额（¥）
		 *   zhipu     = 智谱 GLM，走 llm-pi-ai 的 zhipu 路由，花智谱余额（¥）
		 *   workbuddy = WorkBuddy 通道，花积分
		 *
		 * `aliases` 是"这个行还认哪些写法"：官方有两个**不同的** provider id ——
		 *   deepseek-official = 官方 API Key（GUI 的模型选择器用的就是这个）
		 *   deepseek-account  = DeepSeek 账号/订阅平台
		 * 只要当前默认模型命中任何一个别名，这行的灯就点亮。不写别名的话，用 GUI
		 * 切到官方后灯不会动（因为写的是 official，而这里原来只认 account）。
		 */
		const MODEL_TARGETS = {
			deepseek: {
				row: 'deepseek',
				provider: 'deepseek-official',
				model: 'deepseek-flash',
				label: 'DeepSeek 官方（花余额 ¥）· deepseek-flash',
				aliases: [
					{ provider: 'deepseek-official', model: 'deepseek-flash' },
					{ provider: 'deepseek-account', model: 'deepseek-flash' },
					{ provider: 'deepseek-official', model: 'deepseek-v4-pro' },
					{ provider: 'deepseek-account', model: 'deepseek-v4-pro' },
				],
			},
			zhipu: {
				row: 'zhipu',
				provider: 'zhipu',
				model: 'glm-5.3-flash',
				label: '智谱 GLM（花余额 ¥）· glm-5.3-flash',
				aliases: [
					{ provider: 'zhipu', model: 'glm-5.3-flash' },
					{ provider: 'zhipu', model: 'glm-5.3-flashx' },
					{ provider: 'zhipu', model: 'glm-5.3' },
				],
			},
			workbuddy: {
				row: 'workbuddy',
				provider: 'workbuddy',
				model: 'deepseek-v4.1-flash',
				label: 'WorkBuddy（花积分）· deepseek-v4.1-flash',
				aliases: [{ provider: 'workbuddy', model: 'deepseek-v4.1-flash' }],
			},
		}

		/**
		 * 把「当前全局默认模型」映射回是哪一行。
		 * @param current - 宿主 `agentDefaultModel.currentSelection()` 的选择。
		 * @returns 行 id，或 undefined（不属于任何一行）。
		 */
		function rowOfSelection(current) {
			const provider = String(current?.provider ?? '')
			const model = String(current?.model ?? '')
			if (provider === '') return undefined
			for (const target of Object.values(MODEL_TARGETS)) {
				for (const alias of target.aliases) {
					if (alias.provider === provider && alias.model === model) return target.row
				}
			}
			// provider 认得但模型不认识：仍然算这一行（例如官方换了个新模型）。
			for (const target of Object.values(MODEL_TARGETS)) {
				if (target.provider === provider) return target.row
			}
			return undefined
		}
		/** 宿主半区暴露的默认模型切换路由（lib/index.js 里的 ROUTE，必须一致）。 */
		const MODEL_ROUTE = '/plugins/dsh-workbuddy-foot-card/model'
		/** 旧版的整体折叠键，只用于一次性迁移。 */
		const LEGACY_COLLAPSED_KEY = 'dsh-workbuddy-foot-card.collapsed'
		/** 今日消耗台账（按本地日累计观测到的余额下降）。 */
		const LEDGER_KEY = 'dsh-workbuddy-foot-card.ledger.v1'
		/** 轮询周期：与用量卡一致，30 秒。 */
		const POLL_MS = 30000
		/** 真实默认模型的轮询周期：短一点，这样在 GUI 里换模型后灯很快就跟上。 */
		const MODEL_POLL_MS = 4000
		/** 两张卡的互斥协调：探针频率。 */
		const WATCH_MS = 1200
		const CN_STATUS = '/plugins/dsh-workbuddy-connect/status'
		const AI_STATUS = '/plugins/dsh-workbuddy-connect/ai/status'
		const USAGE_API = '/api/dsh-usage'

		const FOOT_SELECTOR = '[data-pane="sidebar"], [class*="sidebarCol"]'
		const USAGE_CARD = '[data-dsh-usage-foot-card]'
		const USAGE_TOGGLE = '[data-dsh-part="foot-card-toggle"]'
		const USAGE_STRIP = '[data-dsh-part="foot-card-strip"]'
		const SETTINGS_SEAT = '[class*="settingsArea"]'

		/**
		 * 底部卡片区高度上限的持久化键，以及拖拽区间。
		 *
		 * 卡片区（footArea）装的是「用量卡 + 本卡 + 设置行」这一坨。它默认多高，
		 * 直接决定上面的「工作区」文件树/列表能拿多少地方 —— 所以默认给一个**偏矮**的
		 * 上限（刚好放下两张收起的卡），再给一条拖拽条随时调；双击复位。
		 */
		const AREA_KEY = 'dsh-workbuddy-foot-card.max'
		/** 默认上限：两张卡都收起时的自然高度附近，工作区拿大头。 */
		const AREA_DEFAULT = 172
		/** 拖拽下限：再小就看不见内容了。 */
		const AREA_MIN = 40
		/** 拖拽上限：再大就等于不限高。 */
		const AREA_MAX = 520
		/** 分隔条标记，用于 DOM 级幂等。 */
		const AREA_HANDLE = 'data-dsh-foot-area-handle'
		/** 被本插件托管的卡片区元素上的标记（CSS 用它挂 max-height）。 */
		const AREA_MARK = 'data-dsh-foot-area'
		/** CSS 变量：卡片区高度上限。 */
		const AREA_VAR = '--dsh-foot-card-max'

		/** 行 id -> 计量口径。 */
		const ROW_IDS = ['deepseek', 'workbuddy']

		/** 侧栏脚部（footer 动作 + 设置行）所在容器。 */
		function findFoot() {
			const column = document.querySelector(FOOT_SELECTOR)
			return column === null ? undefined : column.querySelector('[class*="footArea"]') ?? undefined
		}

		/**
		 * 卡片区高度控制：把「底部卡片区」的高度上限交给用户。
		 *
		 * 为什么要做：卡片区多高，直接决定上面的「工作区」文件树/列表能拿多少地方。
		 * 默认给一个**偏矮**的上限（刚好放下两张收起的卡），工作区拿大头；想多看卡片
		 * 就拖分隔条往下，双击复位。
		 *
		 * 实现刻意避开 DSH 的内部类名：手柄插在**本卡片所在的那个容器**旁边，
		 * 由本插件自己起 DOM、自己标记（`data-dsh-foot-area`），不猜 DSH 的结构。
		 *
		 * @returns 卸载函数（移手柄、撤标记、还原高度）。
		 */
		function createAreaControl() {
			/** 当前上限（px）。 */
			let maxPx = readAreaMax()
			/** 被托管的卡片区元素。 */
			let area
			/** 分隔条本体。 */
			let handle
			/** 正在拖拽时的起点。 */
			let drag

			const apply = () => {
				if (area === undefined || area === null) return
				const style = area.style
				if (style === undefined || style === null || typeof style.setProperty !== 'function') return
				/*
				 * 用**内联 !important**写高度，而不是只靠样式表：
				 * 侧栏里可能还装着另一个"伸缩器"插件，它的规则形如
				 *   [class*="sidebarCol"] [class*="footArea"]{max-height:…!important}
				 * 特异性比单属性选择器高，会盖掉我们的表规则。内联 important 的优先级
				 * 高于任何作者样式表 important，所以这里能稳定拿到控制权。
				 */
				style.setProperty('max-height', maxPx + 'px', 'important')
				style.setProperty('overflow-y', 'auto', 'important')
				style.setProperty('overflow-x', 'hidden', 'important')
				// 变量留着，便于外部/样式表读取当前值
				style.setProperty(AREA_VAR, maxPx + 'px')
			}
			const clamp = (value) => Math.max(AREA_MIN, Math.min(AREA_MAX, value))

			const onDown = (event) => {
				drag = { y: event.clientY, start: maxPx }
				if (handle !== undefined) handle.setAttribute('data-dragging', '1')
				if (typeof handle?.setPointerCapture === 'function' && event.pointerId !== undefined) {
					try { handle.setPointerCapture(event.pointerId) } catch { /* 指针已释放：忽略 */ }
				}
			}
			const onMove = (event) => {
				if (drag === undefined) return
				/*
				 * 手柄挂在卡片区**上沿**，卡片区贴侧栏底部：
				 * 往上拖 = 上沿抬起来 = 卡片区变**高**。
				 * 屏幕上 clientY 往下是增大，所以这里要**取负**：
				 * 指针上移（clientY 变小）→ maxPx 变大。
				 * （写反过一次：往上拖反而变矮，方向感完全相反。）
				 */
				maxPx = clamp(drag.start - (event.clientY - drag.y))
				apply()
			}
			const onUp = () => {
				if (drag === undefined) return
				drag = undefined
				if (handle !== undefined) handle.removeAttribute('data-dragging')
				writeAreaMax(maxPx)
			}
			const onReset = () => {
				maxPx = AREA_DEFAULT
				apply()
				writeAreaMax(maxPx)
			}

			/**
			 * 找到并托管卡片区：取本卡片当前所在的那个「footArea」容器。
			 * 找不到就不做任何事（卡片照常显示）。
			 */
			const own = () => {
				const target = findFoot()
				if (target === undefined || target === null) return false
				if (area !== target) {
					if (area !== undefined && area !== null && typeof area.removeAttribute === 'function') {
						area.removeAttribute(AREA_MARK)
					}
					area = target
					if (typeof area.setAttribute === 'function') area.setAttribute(AREA_MARK, '')
				}
				apply()
				if (handle === undefined) {
					handle = document.createElement('div')
					handle.setAttribute(AREA_HANDLE, '')
					handle.setAttribute('title', '拖动调整底部卡片区高度（工作区自动伸缩）；双击复位 ' + AREA_DEFAULT + 'px')
					handle.addEventListener('pointerdown', onDown)
					handle.addEventListener('pointermove', onMove)
					handle.addEventListener('pointerup', onUp)
					handle.addEventListener('pointercancel', onUp)
					handle.addEventListener('dblclick', onReset)
				}
				if (area.parentNode !== undefined && area.parentNode !== null && area.previousElementSibling !== handle) {
					area.parentNode.insertBefore(handle, area)
				}
				return true
			}

			return { own, stop }
			function stop() {
				if (area !== undefined && area !== null) {
					if (typeof area.removeAttribute === 'function') area.removeAttribute(AREA_MARK)
					const style = area.style
					if (style !== undefined && style !== null && typeof style.removeProperty === 'function') {
						for (const prop of ['max-height', 'overflow-y', 'overflow-x', AREA_VAR]) {
							try { style.removeProperty(prop) } catch { /* ignore */ }
						}
					}
				}
				if (handle !== undefined && typeof handle.remove === 'function') handle.remove()
			}
		}

		/** 读存的高度上限；没存过或读不出就用默认值。 */
		function readAreaMax() {
			try {
				const raw = localStorage.getItem(AREA_KEY)
				if (raw === null || raw === '') return AREA_DEFAULT
				const value = Number(raw)
				if (!Number.isFinite(value)) return AREA_DEFAULT
				return Math.max(AREA_MIN, Math.min(AREA_MAX, value))
			} catch {
				return AREA_DEFAULT
			}
		}

		/** 存高度上限（存不住也不影响本次会话）。 */
		function writeAreaMax(value) {
			try {
				localStorage.setItem(AREA_KEY, String(Math.round(value)))
			} catch {
				/* ignore */
			}
		}

		/** 用量卡当前是不是展开着（收起时会渲染 foot-card-strip）。 */
		function usageExpanded() {
			const card = document.querySelector(USAGE_CARD)
			if (card === null) return false
			return card.querySelector(USAGE_STRIP) === null
		}

		/** 让用量卡收成一行（点它自己的折叠箭）。 */
		function collapseUsage() {
			const toggle = document.querySelector(USAGE_TOGGLE)
			if (toggle !== null && usageExpanded()) toggle.click()
		}

		/** 千分位整数。 */
		const formatNumber = (value) => {
			const number = Number(value)
			if (!Number.isFinite(number)) return '—'
			return number.toLocaleString('zh-CN')
		}

		/** 金额：两位小数（极小值保留 4 位，别显示成 0.00）。 */
		function formatMoney(value) {
			const number = Number(value)
			if (!Number.isFinite(number)) return '—'
			if (number !== 0 && Math.abs(number) < 0.01) return number.toFixed(4)
			return number.toFixed(2)
		}

		/** 货币符号：CNY → ¥，USD → $，其它用代码。 */
		const currencySign = (code) => (code === 'CNY' ? '¥' : code === 'USD' ? '$' : String(code || '') + ' ')

		/** 本地日 key（和用量插件的台账口径一致）。 */
		function localDay() {
			const now = new Date()
			return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
		}

		/** Unix 毫秒/ISO 字符串 -> 简短本地时间。 */
		function formatStamp(value) {
			if (value === undefined || value === null || value === '') return ''
			const date = typeof value === 'number' ? new Date(value) : new Date(String(value))
			if (Number.isNaN(date.getTime())) return String(value)
			const diff = Date.now() - date.getTime()
			if (diff >= 0 && diff < 60000) return '刚刚'
			if (diff >= 60000 && diff < 3600000) return Math.round(diff / 60000) + ' 分钟前'
			if (diff >= 3600000 && diff < 86400000) return Math.round(diff / 3600000) + ' 小时前'
			return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
		}

		/* ---------------- 今日消耗台账（国内版/国际版各自单独计量） ---------------- */

		/** 空台账：两个变体各自一份计量。 */
		const emptyLedger = (day) => ({ day, cn: { spend: 0, last: undefined }, ai: { spend: 0, last: undefined } })

		/**
		 * 读台账；跨日重置。兼容旧版「只有一个合计」的形状：
		 * 旧版的 spend/last 视为国内版的（那时只装了国内版）。
		 */
		function loadLedger() {
			let parsed = null
			try { parsed = JSON.parse(localStorage.getItem(LEDGER_KEY) || 'null') } catch { parsed = null }
			const day = localDay()
			if (parsed === null || typeof parsed !== 'object' || parsed.day !== day) return emptyLedger(day)
			if (parsed.cn === undefined && parsed.ai === undefined) {
				return {
					day,
					cn: { spend: Number(parsed.spend) || 0, last: Number.isFinite(parsed.last) ? parsed.last : undefined },
					ai: { spend: 0, last: undefined },
				}
			}
			const bucket = (raw) => ({
				spend: raw !== null && typeof raw === 'object' && Number.isFinite(Number(raw.spend)) ? Number(raw.spend) : 0,
				last: raw !== null && typeof raw === 'object' && Number.isFinite(Number(raw.last)) ? Number(raw.last) : undefined,
			})
			return { day, cn: bucket(parsed.cn), ai: bucket(parsed.ai) }
		}
		function saveLedger(ledger) {
			try { localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger)) } catch { /* 存不住不影响显示 */ }
		}
		/** 一个变体观测一次：只有余额下降才算消耗（充值不计）。 */
		function observeOne(bucket, value) {
			if (!Number.isFinite(value)) return bucket
			if (Number.isFinite(bucket.last) && value < bucket.last) bucket.spend += bucket.last - value
			bucket.last = value
			return bucket
		}
		/** 只读今日消耗（渲染时用，不推进观测）：国内版 / 国际版 / 合计。 */
		function currentSpend() {
			const ledger = loadLedger()
			return { cn: ledger.cn.spend, ai: ledger.ai.spend, total: ledger.cn.spend + ledger.ai.spend }
		}

		/* ---------------- 取数 ---------------- */

		/**
		 * 余额可能是数字，也可能是宿主 billing 返回的对象
		 * `{ total, accounts, unlimited?, cycleResetTime? }`；认不出来返回 undefined（显示「未知」）。
		 */
		function readCredits(raw) {
			if (raw === undefined || raw === null) return undefined
			if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw } : undefined
			if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) return { value: Number(raw) }
			if (typeof raw !== 'object') return undefined
			if (raw.unlimited === true) return { unlimited: true }
			for (const key of ['total', 'remaining', 'balance', 'value', 'remain']) {
				const value = Number(raw[key])
				if (Number.isFinite(value)) return { value, resetTime: raw.cycleResetTime ?? raw.resetTime }
			}
			if (Array.isArray(raw.accounts)) {
				let sum = 0
				let any = false
				for (const account of raw.accounts) {
					const value = Number(account?.remain ?? account?.remaining)
					if (Number.isFinite(value)) { sum += value; any = true }
				}
				if (any) return { value: sum, resetTime: raw.cycleResetTime ?? raw.resetTime }
			}
			return undefined
		}

		/** WorkBuddy 状态归一化。 */
		function normalize(payload, label) {
			if (payload === null || typeof payload !== 'object') return undefined
			const signedIn = String(payload.status ?? '').toLowerCase() === 'signed-in'
			const modelList = Array.isArray(payload.models) ? payload.models : undefined
			return {
				label,
				signedIn,
				status: String(payload.status ?? 'unknown'),
				credits: readCredits(payload.credits ?? payload.remainingCredits ?? payload.balance),
				creditsUnlimited: payload.creditsUnlimited === true,
				creditsError: typeof payload.creditsError === 'string' ? payload.creditsError : undefined,
				reason: typeof payload.reason === 'string' ? payload.reason : undefined,
				nickname: typeof payload.nickname === 'string' ? payload.nickname : '',
				domain: typeof payload.domain === 'string' ? payload.domain : '',
				expires: payload.expiresAt ?? payload.accessTokenExpires,
				models: modelList === undefined ? undefined : modelList.length,
				source: typeof payload.source === 'string' ? payload.source : '',
			}
		}

		/** 一个 WorkBuddy 变体取一次状态；404 视为「这一版没装」。 */
		async function readVariant(path, label) {
			try {
				const response = await fetch(path, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
				if (response.status === 404) return { label, missing: true }
				if (!response.ok) return { label, error: 'HTTP ' + response.status }
				const value = await response.json()
				const state = normalize(value, label)
				if (state === undefined) return { label, error: '响应无法识别' }
				return state
			} catch (error) {
				return { label, error: error && error.message ? error.message : String(error) }
			}
		}

		/**
		 * DeepSeek 用量总览：今日消费金额（CNY）+ 余额 + 当前 provider。
		 * DeepSeek 行**只算 DeepSeek 自己的**：把今天的 per-provider 明细拆开，
		 * 官方（deepseek 家族）单独计量，其余渠道单独记一行，不和其它家混在一起。
		 */
		async function readDeepSeekUsage() {
			try {
				const response = await fetch(USAGE_API + '/overview', { headers: { accept: 'application/json' }, credentials: 'same-origin' })
				if (response.status === 404) return { missing: true }
				if (!response.ok) return { missing: false, error: 'HTTP ' + response.status }
				const value = await response.json()
				const today = value?.usage?.today
				const observed = value?.usage?.observedSpend
				const current = value?.current
				let balance
				for (const provider of Array.isArray(value?.providers) ? value.providers : []) {
					const family = String(provider.provider ?? '')
					if (family.indexOf('deepseek') === -1 || provider.balance === undefined) continue
					const total = Number(provider.balance.totalBalance)
					balance = {
						currency: String(provider.balance.currency ?? 'CNY'),
						total: Number.isFinite(total) ? total : undefined,
						updatedAt: provider.balance.updatedAt,
						displayName: typeof provider.displayName === 'string' ? provider.displayName : family,
					}
					break
				}
				// 今天的 per-provider 明细：官方与其它渠道分开
				const rows = Array.isArray(today?.providers) ? today.providers : []
				const pick = (predicate) => {
					let cost = 0
					let tokens = 0
					let calls = 0
					let found = false
					for (const row of rows) {
						if (!predicate(row)) continue
						found = true
						const totals = row?.totals ?? {}
						cost += Number(totals.cost ?? 0)
						calls += Number(totals.calls ?? 0)
						tokens += Number(totals.inputTokens ?? 0) + Number(totals.outputTokens ?? 0)
							+ Number(totals.cacheReadTokens ?? 0) + Number(totals.cacheWriteTokens ?? 0)
					}
					return found ? { cost, tokens, calls } : undefined
				}
				const isOfficial = (row) => {
					const family = String(row?.provider ?? '')
					return family === 'deepseek' || family === 'deepseek-official' || family.indexOf('deepseek-official') === 0
				}
				const official = pick(isOfficial)
				const others = pick((row) => !isOfficial(row))
				// 智谱 GLM 走 llm-pi-ai 的 zhipu 路由；用量插件按 provider family 记账，
				// 家族名可能是 zhipu / glm / bigmodel，都算智谱自己的。
				const isZhipu = (row) => {
					const family = String(row?.provider ?? '').toLowerCase()
					return family === 'zhipu' || family.indexOf('zhipu') === 0 || family.indexOf('glm') === 0 || family.indexOf('bigmodel') !== -1
				}
				const zhipu = pick(isZhipu)
				let zhipuBalance
				for (const provider of Array.isArray(value?.providers) ? value.providers : []) {
					const family = String(provider.provider ?? '').toLowerCase()
					if (!(family.indexOf('zhipu') === 0 || family.indexOf('glm') === 0 || family.indexOf('bigmodel') !== -1)) continue
					if (provider.balance === undefined) continue
					const total = Number(provider.balance.totalBalance)
					zhipuBalance = {
						currency: String(provider.balance.currency ?? 'CNY'),
						total: Number.isFinite(total) ? total : undefined,
					}
					break
				}
				const allTotals = today?.totals
				const allCost = allTotals === undefined ? undefined : Number(allTotals.cost)
				const allTokens = allTotals === undefined ? 0
					: Number(allTotals.inputTokens ?? 0) + Number(allTotals.outputTokens ?? 0)
					+ Number(allTotals.cacheReadTokens ?? 0) + Number(allTotals.cacheWriteTokens ?? 0)
				const allCalls = allTotals === undefined ? 0 : Number(allTotals.calls ?? 0)
				return {
					missing: false,
					// DeepSeek 自己的（没有 per-provider 明细时回落到合计，并标出来）
					official: official ?? (rows.length === 0 ? { cost: allCost, tokens: allTokens, calls: allCalls, fallback: true } : { cost: 0, tokens: 0, calls: 0 }),
					others,
					zhipu,
					zhipuBalance,
					allCost,
					allTokens,
					allCalls,
					todayCost: official === undefined ? allCost : official.cost,
					todayTokens: official === undefined ? allTokens : official.tokens,
					todayCalls: official === undefined ? allCalls : official.calls,
					observedCost: observed === undefined || observed === null ? undefined : Number(observed.cny),
					balance,
					updatedAt: value?.updatedAt,
					currentProvider: typeof current?.provider === 'string' ? current.provider : undefined,
					currentModel: typeof current?.model === 'string' ? current.model : undefined,
					currentSource: typeof current?.source === 'string' ? current.source : undefined,
				}
			} catch (error) {
				return { missing: false, error: error && error.message ? error.message : String(error) }
			}
		}

		/* ---------------- 两行的数字 ---------------- */

		/**
		 * WorkBuddy 行：国内版与国际版**各自计量**（今日各自消耗多少积分），
		 * 行上显示合计；有哪几版、各多少，明细里逐条列。
		 */
		function workbuddyRow(state) {
			const spends = currentSpend()
			const variants = [
				{ id: 'cn', label: '国内版', item: state.cn, spend: spends.cn },
				{ id: 'ai', label: '国际版', item: state.ai, spend: spends.ai },
			]
			const present = variants.filter((entry) => entry.item !== undefined && entry.item !== null && entry.item.missing !== true)
			if (present.length === 0) {
				return {
					online: false, today: undefined, count: 0, spendTotal: 0,
					remain: '未登录', remainText: '未登录', variants,
					detail: '装并登录 WorkBuddy 桌面 App 后可用',
				}
			}
			let remainSum = 0
			let remainKnown = false
			let unlimited = false
			let signedIn = 0
			let spendTotal = 0
			let spendKnown = false
			for (const entry of present) {
				const item = entry.item
				if (item.signedIn !== true) continue
				signedIn += 1
				spendTotal += Number.isFinite(entry.spend) ? entry.spend : 0
				spendKnown = true
				if (item.creditsUnlimited === true || (item.credits !== undefined && item.credits.unlimited === true)) { unlimited = true; continue }
				if (item.credits !== undefined && Number.isFinite(item.credits.value)) { remainSum += item.credits.value; remainKnown = true }
			}
			if (signedIn === 0) {
				return {
					online: false, today: undefined, count: present.length, spendTotal: 0,
					remain: '未登录', remainText: '未登录', variants,
					detail: present.map((entry) => entry.label + (entry.item.error === undefined ? ' 未登录' : ' 读取失败')).join(' · '),
				}
			}
			const remain = unlimited ? '不限' : (remainKnown ? formatNumber(remainSum) + ' 积分' : '积分未知')
			return {
				online: true,
				today: spendKnown ? spendTotal : undefined,
				count: signedIn,
				spendTotal,
				remain,
				remainText: unlimited || !remainKnown ? remain : '剩余 ' + remain,
				variants,
				detail: present.map((entry) => entry.label + (entry.item.signedIn ? ' 已登录' : ' 未登录')).join(' · '),
			}
		}

		/** DeepSeek 行：只算 DeepSeek 官方自己今天的消费金额。 */
		function deepseekRow(state) {
			const item = state.deepseek
			if (item === undefined) return { online: false, today: undefined, remain: '—', remainText: '正在读取…', sign: '¥' }
			if (item.missing === true) return { online: false, today: undefined, remain: '未安装', remainText: '未安装', sign: '¥' }
			if (item.error !== undefined) return { online: false, today: undefined, remain: '读取失败', remainText: '读取失败', sign: '¥' }
			const sign = item.balance === undefined ? '¥' : currencySign(item.balance.currency)
			const today = Number.isFinite(item.official?.cost) ? item.official.cost : undefined
			const remainText = item.balance === undefined || item.balance.total === undefined
				? '余额未知'
				: '余额 ' + sign + formatMoney(item.balance.total)
			return {
				online: true,
				today,
				remain: item.balance === undefined ? '余额未知' : sign + formatMoney(item.balance.total),
				remainText,
				sign,
				official: item.official,
				others: item.others,
				allCost: item.allCost,
				allTokens: item.allTokens,
				allCalls: item.allCalls,
				observed: item.observedCost,
				balance: item.balance,
				todayText: today === undefined ? '—' : sign + formatMoney(today),
			}
		}

		/**
		 * 智谱 GLM 行：走 profile 里 `llm-pi-ai` 的 **zhipu** 路由（官方开放平台，
		 * 花智谱余额 ¥）。余额接口智谱不给，所以只剩"今日花了多少"这一列。
		 */
		function zhipuRow(state) {
			const item = state.deepseek
			if (item === undefined) return { online: false, today: undefined, remainText: '正在读取…', sign: '¥' }
			if (item.missing === true) return { online: false, today: undefined, remainText: '未安装用量插件', sign: '¥' }
			if (item.error !== undefined) return { online: false, today: undefined, remainText: '读取失败', sign: '¥' }
			const sign = item.zhipuBalance === undefined ? '¥' : currencySign(item.zhipuBalance.currency)
			const today = Number.isFinite(item.zhipu?.cost) ? item.zhipu.cost : undefined
			const remainText = item.zhipuBalance === undefined || item.zhipuBalance.total === undefined
				? '余额未知'
				: '余额 ' + sign + formatMoney(item.zhipuBalance.total)
			return {
				online: true,
				today,
				remainText,
				sign,
				zhipu: item.zhipu,
				balance: item.zhipuBalance,
			}
		}

		/**
		 * 今日合计 = 全部消耗：DeepSeek 官方金额 + 智谱金额 + WorkBuddy 积分。
		 * 金额之间相加，积分单独写（¥ 与积分不可换算）。
		 */
		function totalRow(state) {
			const ds = deepseekRow(state)
			const wb = workbuddyRow(state)
			const zp = zhipuRow(state)
			const parts = []
			// 金额可以相加（都是 ¥）
			const money = (ds.today ?? 0) + (zp.today ?? 0)
			if (ds.today !== undefined || zp.today !== undefined) parts.push(ds.sign + formatMoney(money) + ' 金额')
			if (wb.today !== undefined) parts.push(formatNumber(wb.today) + ' 积分')
			return { text: parts.length === 0 ? '今日还没有用量' : parts.join(' + '), hasData: parts.length > 0 }
		}

		/**
		 * 当前正在消耗哪一家（自动判断，仅在没有手动选择时作为初始值）。
		 * 用量插件给的 `current.provider` 最能说明问题（live = 本 boot 最近一次请求，
		 * default = 配置的默认模型）。
		 */
		function autoActiveRow(state) {
			const provider = String(state.deepseek?.currentProvider ?? '').toLowerCase()
			if (provider !== '') {
				if (provider.indexOf('workbuddy') === 0) return 'workbuddy'
				if (provider.indexOf('zhipu') === 0) return 'zhipu'
				if (provider.indexOf('deepseek') !== -1) return 'deepseek'
			}
			return undefined
		}

		const STYLE = [
			'.wbf-root{box-sizing:border-box;font-size:11px;line-height:1.35;color:var(--dsw-alias-label-secondary,#b4b4b4);border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));border-radius:8px;margin:4px 6px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));overflow:hidden}',
			'.wbf-row{display:flex;align-items:center;gap:2px;width:100%;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14))}',
			'.wbf-row:first-child{border-top:0}',
			'.wbf-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
			'.wbf-dotbtn{flex:none;display:flex;align-items:center;justify-content:center;width:20px;height:22px;padding:0;background:0 0;border:0;cursor:pointer;border-radius:5px}',
			'.wbf-dotbtn:hover{background:rgba(127,127,127,.22)}',
			'.wbf-dotbtn:focus-visible{outline:1px solid var(--dsw-alias-brand-primary,#4c6ef5);outline-offset:-1px}',
			'.wbf-rowmain{display:flex;align-items:center;gap:5px;flex:1;min-width:0;padding:3px 6px 3px 0;background:0 0;border:0;color:inherit;font:inherit;cursor:pointer;text-align:left}',
			'.wbf-dot{width:7px;height:7px;border-radius:50%;flex:none;background:#8a8a8a}',
			'.wbf-dot.on{background:#37b26c}',
			'.wbf-dot.warm{background:#e0a03a;box-shadow:0 0 0 3px rgba(224,160,58,.2)}',
			'.wbf-name{flex:none;color:var(--dsw-alias-label-primary,#e6e6e6);font-weight:600}',
			'.wbf-today{flex:none;color:var(--dsw-alias-label-secondary,#b4b4b4);font-variant-numeric:tabular-nums}',
			'.wbf-unit{color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:10px}',
			'.wbf-tag{flex:none;color:#e0a03a;font-size:10px;border:1px solid rgba(224,160,58,.45);border-radius:5px;padding:0 3px}',
			'.wbf-remain{margin-left:auto;flex:none;color:var(--dsw-alias-label-primary,#e6e6e6);font-variant-numeric:tabular-nums}',
			'.wbf-caret{flex:none;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:9px}',
			'.wbf-detail{padding:3px 8px 6px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04))}',
			'.wbf-kv{display:flex;gap:6px;padding:1px 0}',
			'.wbf-k{color:var(--dsw-alias-label-tertiary,#8a8a8a);flex:none;min-width:62px}',
			'.wbf-v{color:var(--dsw-alias-label-secondary,#b4b4b4);word-break:break-all}',
			'.wbf-actions{display:flex;gap:6px;margin-top:5px;align-items:center}',
			'.wbf-btn{cursor:pointer;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));background:0 0;color:var(--dsw-alias-label-secondary,#b4b4b4);border-radius:6px;font:inherit;padding:1px 7px}',
			'.wbf-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
			'.wbf-stamp{margin-left:auto;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:10px}',
			'.wbf-total{display:flex;gap:6px;align-items:center;padding:3px 6px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));color:var(--dsw-alias-label-secondary,#b4b4b4)}',
			'.wbf-total-label{flex:none;color:var(--dsw-alias-label-tertiary,#8a8a8a)}',
			'.wbf-total-value{color:var(--dsw-alias-label-primary,#e6e6e6);font-variant-numeric:tabular-nums}',
			'.wbf-notice{padding:3px 8px 5px;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:10px;line-height:1.45;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));word-break:break-all}',
			// 卡片区高度控制：手柄 + 另一套伸缩器的手柄让位（见 installAreaControl 的说明）
			'[data-dsh-foot-area-handle]{height:7px;margin:0 8px 1px;border-radius:4px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;cursor:ns-resize;opacity:.28;user-select:none;touch-action:none;color:inherit}',
			'[data-dsh-foot-area-handle]:hover{opacity:.8}',
			'[data-dsh-foot-area-handle][data-dragging="1"]{opacity:.95}',
			'[data-dsh-foot-area-handle]::before{content:"";display:block;width:34px;height:2px;border-radius:1px;background:currentColor}',
			// 卡片区上限：只作用在本插件标记过的那个容器上（不猜 DSH 的内部类名）
			'[data-dsh-foot-area]{max-height:var(' + AREA_VAR + ',' + AREA_DEFAULT + 'px)!important;overflow-y:auto!important;overflow-x:hidden!important;scrollbar-width:thin;scrollbar-gutter:stable}',
			'[data-dsh-foot-resizer]{display:none!important}',
		].join('')

		/** 挂载卡片。 @returns 摘除卡片的 disposer */
		function mount() {
			const container = document.createElement('div')
			container.setAttribute('data-dsh-workbuddy-foot-card', '')
			const style = document.createElement('style')
			style.textContent = STYLE
			const root = document.createElement('div')
			root.className = 'wbf-root'
			container.appendChild(style)
			container.appendChild(root)
			/** 卡片区高度控制（默认矮 + 可拖）。 */
			const areaControl = createAreaControl()

			// 展开哪一行：默认都收起（最省空间）；老版本的「整体已展开」只迁移一次
			let expanded = localStorage.getItem(ROW_KEY)
			if (expanded !== 'deepseek' && expanded !== 'workbuddy') {
				expanded = localStorage.getItem(LEGACY_COLLAPSED_KEY) === '0' ? 'workbuddy' : undefined
			}
			/**
			 * 手动选中的那一行（点前面的灯切换）。
			 * 空 = 没手动选过，此时橙灯跟随自动判断（当前正在消耗的那一家）；
			 * 一旦手动点过，就以用户的选择为准，值持久化到 localStorage。
			 */
			let picked = localStorage.getItem(PICK_KEY)
			if (picked !== 'deepseek' && picked !== 'workbuddy' && picked !== 'zhipu') picked = undefined
			let state = { cn: undefined, ai: undefined, deepseek: undefined, updatedAt: undefined, busy: false }
			/**
			 * 宿主报回来的**真实**全局默认模型（`agentDefaultModel.currentSelection()`）。
			 *
			 * 这是灯的权威来源：不管是在这里点灯，还是在 GUI 的模型选择器里换，
			 * 只要默认模型变了，灯就跟着走。以前只看 `state.deepseek.currentProvider`
			 * （那是"最近一次请求用的谁"），所以在 GUI 里切到官方后灯**不会动**。
			 */
			let modelCurrent
			let disposed = false
			/** 切换模型的请求序号：并发点击时只有最后一次的结果会被展示。 */
			let requestSeq = 0
			/** 切换结果的一行提示（空 = 不显示）。 */
			let modelNotice = ''

			/** 只把错误对象变成能读的一句话（不能让它把卡片搞崩）。 */
			function describeError(error) {
				if (error === null || error === undefined) return '未知错误'
				if (typeof error === 'string') return error
				if (typeof error.message === 'string' && error.message !== '') return error.message
				if (typeof error.code === 'string') return error.code
				try { return JSON.stringify(error) } catch { return '未知错误' }
			}

			/** 设置/清除切换提示，并重绘。 */
			function notifyModel(text) {
				modelNotice = typeof text === 'string' ? text : ''
				render()
			}

			function kv(key, value) {
				const wrap = document.createElement('div')
				wrap.className = 'wbf-kv'
				const k = document.createElement('span')
				k.className = 'wbf-k'
				k.textContent = key
				const v = document.createElement('span')
				v.className = 'wbf-v'
				v.textContent = value
				wrap.appendChild(k)
				wrap.appendChild(v)
				return wrap
			}

			/**
			 * 一条紧凑行：灯（可点，用来手动切换选中）+ 名称 + 今日值 + 单位 + 右侧剩余 + 箭头。
			 *
			 * 点灯 = 手动选中这一种计量单位（变橙、停止呼吸），再点另一行的灯就切过去；
			 * 橙灯那一行同时会展开明细。灯自带 title 说明，且灯是独立按钮（不是整行点击），
			 * 所以点行体仍然是展开/收起，互不干扰。
			 */
			function rowElement(options) {
				const row = document.createElement('div')
				row.className = 'wbf-row'
				row.setAttribute('data-dsh-row', options.id)

				// 灯：切换选中状态的按钮
				const dotButton = document.createElement('button')
				dotButton.type = 'button'
				dotButton.className = 'wbf-dotbtn'
				dotButton.setAttribute('data-dsh-pick', options.id)
				const dot = document.createElement('span')
				dot.className = 'wbf-dot' + (options.active === true ? ' warm' : (options.online === true ? ' on' : ''))
				dotButton.appendChild(dot)
				dotButton.title = options.active === true
					? '已选中：' + options.name + '。点另一行的灯可切换（会切换全局默认模型）'
					: '点这里把默认模型切到 ' + options.name + options.switchHint
				dotButton.setAttribute('aria-pressed', options.active === true ? 'true' : 'false')
				dotButton.addEventListener('click', (event) => {
					event.stopPropagation()
					pick(options.active === true ? undefined : options.id)
				})

				// 行体：展开/收起明细
				const body = document.createElement('button')
				body.type = 'button'
				body.className = 'wbf-rowmain'
				body.setAttribute('data-dsh-rowmain', options.id)
				body.title = options.isExpanded ? '收起明细' : '展开这一行明细（另一行会自动收起）'

				const name = document.createElement('span')
				name.className = 'wbf-name'
				name.textContent = options.name
				const today = document.createElement('span')
				today.className = 'wbf-today'
				today.textContent = '今日 ' + options.todayText
				// 单位始终标着（金额 / 积分），不因为"选中"而消失
				const unit = document.createElement('span')
				unit.className = 'wbf-unit'
				unit.textContent = options.unitText
				body.appendChild(name)
				body.appendChild(today)
				body.appendChild(unit)
				if (options.active === true) {
					const tag = document.createElement('span')
					tag.className = 'wbf-tag'
					tag.textContent = '已选中'
					body.appendChild(tag)
				}
				const remain = document.createElement('span')
				remain.className = 'wbf-remain'
				remain.textContent = options.remainText
				const caret = document.createElement('span')
				caret.className = 'wbf-caret'
				caret.textContent = options.isExpanded ? '▾' : '▸'
				body.appendChild(remain)
				body.appendChild(caret)
				body.addEventListener('click', () => setExpanded(options.isExpanded ? undefined : options.id))

				row.appendChild(dotButton)
				row.appendChild(body)
				return row
			}

			/**
			 * 点灯：切换选中的计量单位，并**真的把全局默认模型切过去**。
			 *
			 * 两条通道（用户确认过的固定组合）：
			 *   deepseek  -> provider `deepseek-official` + model `deepseek-flash`（花官方余额 ¥）
			 *   workbuddy -> provider `workbuddy`         + model `deepseek-v4.1-flash`（花积分）
			 *
			 * 写入路径与官方「设置」页同一条：`settings.get('agent-default-model').set(field, value)`，
			 * 也就是改 profile 里 `agent-default-model` 那个 Loader 条目的 provider/model 字段。
			 * 这是**全局**默认：改完以后新建的会话都用它（已开着的旧会话不会被动）。
			 *
			 * - 点未选中的灯 -> 选中它 + 展开明细 + 切默认模型
			 * - 点已选中的灯 -> 只取消手动选中、回到自动跟随，**不动模型**（避免误点改掉花钱方式）
			 */
			function pick(next) {
				const changed = picked !== next
				picked = next
				try {
					if (next === undefined) {
						if (typeof localStorage.removeItem === 'function') localStorage.removeItem(PICK_KEY)
						else localStorage.setItem(PICK_KEY, '')
					} else {
						localStorage.setItem(PICK_KEY, next)
					}
				} catch { /* 存不住也能用 */ }
				if (next === undefined) {
					modelNotice = ''
					render()
					return
				}
				// 选中某一行时顺便展开它，让"切到了哪一项"一目了然
				setExpanded(next)
				if (changed) switchModel(next)
				else render()
			}

			/**
			 * 点灯要走的写入逻辑（见 pick 的说明）。
			 *
			 * 改全局默认模型是宿主侧的事（官方 `agentDefaultModel.saveSelection()`），
			 * 浏览器半区碰不到那个服务，所以我们 POST 给本插件自己的宿主路由：
			 *   POST /plugins/dsh-workbuddy-foot-card/model  {"row":"deepseek"|"workbuddy"}
			 * 宿主校验通过后调官方服务写进 profile patch。
			 */
			function switchModel(next) {
				const target = next === undefined ? undefined : MODEL_TARGETS[next]
				if (target === undefined) {
					notifyModel('')
					return
				}
				const seq = ++requestSeq
				notifyModel('正在切换默认模型…')
				void postModelSwitch(next).then(
					(result) => {
						if (seq !== requestSeq) return
						if (result.ok === true) {
							notifyModel('✓ 已切换默认模型：' + target.label + '　（新会话生效）')
						} else if (result.reason === 'no-route') {
							notifyModel('切换失败：宿主没装本插件的宿主半区（重启 DSH 后重试）')
						} else if (result.reason === 'unavailable') {
							notifyModel('切换失败：宿主没有 agent-default-model 服务，无法改默认模型')
						} else {
							notifyModel('切换失败：' + result.detail)
						}
						// 无论成败都重新读一次，让橙灯与数字跟上真实状态
						void poll()
					},
					(error) => {
						if (seq !== requestSeq) return
						notifyModel('切换失败：' + describeError(error))
					},
				)
			}

			/**
			 * 调宿主路由切默认模型。永不抛错，统一返回一个可判断的结果对象：
			 *   { ok:true } | { ok:false, reason, detail }
			 */
			function postModelSwitch(row) {
				const url = MODEL_ROUTE
				const init = {
					method: 'POST',
					headers: { 'content-type': 'application/json', accept: 'application/json' },
					credentials: 'same-origin',
					body: JSON.stringify({ row }),
				}
				let call
				try {
					call = fetch(url, init)
				} catch (error) {
					return Promise.resolve({ ok: false, reason: 'fetch-threw', detail: describeError(error) })
				}
				return Promise.resolve(call).then(
					(response) => {
						if (response === undefined || response === null) {
							return { ok: false, reason: 'no-response', detail: '没有响应' }
						}
						if (response.status === 404) {
							return { ok: false, reason: 'no-route', detail: '404（宿主半区未启用）' }
						}
						// 读 JSON；读不到就用状态码兜底
						let parsed
						try {
							parsed = response.json()
						} catch {
							parsed = undefined
						}
						return Promise.resolve(parsed).then(
							(body) => {
								if (response.ok === true && body?.ok === true) return { ok: true, applied: body.applied }
								const code = body?.error ?? ('HTTP ' + String(response.status ?? '?'))
								if (code === 'agent-default-model-unavailable') {
									return { ok: false, reason: 'unavailable', detail: String(code) }
								}
								const message = body?.message === undefined ? '' : '：' + String(body.message)
								return { ok: false, reason: 'rejected', detail: String(code) + message }
							},
							(error) => ({ ok: false, reason: 'bad-json', detail: describeError(error) }),
						)
					},
					(error) => ({ ok: false, reason: 'network', detail: describeError(error) }),
				)
			}

			/**
			 * 当前生效的选中行。
			 *
			 * 优先级：**真实的全局默认模型** > 手动点过的 > 自动判断。
			 * 真实模型优先是关键：你在 GUI 里切成官方，这里的灯也必须跟着亮官方，
			 * 而不是继续显示上一次点的那一行。
			 */
			function selectedRow() {
				const real = rowOfSelection(modelCurrent)
				if (real !== undefined) return real
				return picked ?? autoActiveRow(state)
			}

			/** 拉一次真实默认模型（宿主路由的 GET）。 */
			async function refreshModelCurrent() {
				try {
					const response = await fetch(MODEL_ROUTE, { headers: { accept: 'application/json' } })
					if (!response.ok) return
					const body = await response.json()
					const next = body?.current
					const before = rowOfSelection(modelCurrent)
					modelCurrent = next === undefined ? undefined : next
					if (rowOfSelection(modelCurrent) !== before) render()
				} catch {
					/* 宿主没起来时静默：卡片照常显示用量 */
				}
			}

			function deepseekDetail() {
				const body = document.createElement('div')
				body.className = 'wbf-detail'
				body.setAttribute('data-dsh-detail', 'deepseek')
				const ds = deepseekRow(state)
				if (state.deepseek === undefined) body.appendChild(kv('状态', '正在读取…'))
				else if (state.deepseek.missing === true) body.appendChild(kv('状态', '未安装用量插件（@linxin666/dsh-usage）'))
				else if (state.deepseek.error !== undefined) body.appendChild(kv('状态', '读取失败：' + state.deepseek.error))
				else {
					body.appendChild(kv('本行口径', '只算 DeepSeek 自己 · 金额（' + (ds.sign === '¥' ? '¥ 元' : ds.sign) + '）'))
					body.appendChild(kv('DeepSeek 今日', ds.today === undefined ? '—（今日暂无可计价用量）' : ds.sign + formatMoney(ds.today) + ' 元'))
					if (ds.official?.fallback === true) body.appendChild(kv('说明', '上游没给分家明细，此处按当天合计显示'))
					if (ds.official !== undefined && ds.official.fallback !== true) {
						body.appendChild(kv('├ 用量', formatNumber(ds.official.tokens) + ' tokens · ' + formatNumber(ds.official.calls) + ' 次调用'))
					}
					if (ds.others !== undefined && ds.others.cost > 0) {
						body.appendChild(kv('其它渠道今日', ds.sign + formatMoney(ds.others.cost) + ' 元（不计入本行）'))
					}
					if (ds.allCost !== undefined) {
						body.appendChild(kv('今日金额合计', ds.sign + formatMoney(ds.allCost) + ' 元 · ' + formatNumber(ds.allTokens ?? 0) + ' tokens · ' + formatNumber(ds.allCalls ?? 0) + ' 次'))
					}
					if (ds.observed !== undefined) body.appendChild(kv('累计实付', ds.sign + formatMoney(ds.observed) + ' 元（按余额下降观测）'))
					if (ds.balance !== undefined) {
						body.appendChild(kv('账户余额', currencySign(ds.balance.currency) + formatMoney(ds.balance.total) + ' ' + ds.balance.currency))
						if (ds.balance.updatedAt !== undefined) body.appendChild(kv('余额更新', formatStamp(ds.balance.updatedAt)))
					} else {
						body.appendChild(kv('账户余额', '未配置 DeepSeek 官方 key / 未探测到'))
					}
				}
				return body
			}

			function workbuddyDetail() {
				const body = document.createElement('div')
				body.className = 'wbf-detail'
				body.setAttribute('data-dsh-detail', 'workbuddy')
				const wb = workbuddyRow(state)
				body.appendChild(kv('本行口径', '只算 WorkBuddy 自己 · 积分（按余额下降观测）'))
				body.appendChild(kv('WorkBuddy 今日', wb.today === undefined ? '—（未登录，无法统计）' : formatNumber(wb.today) + ' 积分'))
				// 逐版单独计量：国内版 / 国际版各花了多少
				for (const entry of wb.variants) {
					const item = entry.item
					if (item === undefined) continue
					if (item.missing === true) { body.appendChild(kv(entry.label, '未安装（该版 App 不存在）')); continue }
					if (item.error !== undefined) { body.appendChild(kv(entry.label, '读取失败：' + item.error)); continue }
					if (item.signedIn !== true) {
						body.appendChild(kv(entry.label, '今日 ' + formatNumber(entry.spend) + ' 积分 · 未登录' + (item.reason ? '（' + item.reason + '）' : '')))
						continue
					}
					const who = '已登录' + (item.nickname ? ' · ' + item.nickname : '') + (item.domain ? ' · ' + item.domain : '')
					body.appendChild(kv(entry.label, who))
					body.appendChild(kv('├ 今日消耗', formatNumber(entry.spend) + ' 积分'))
					if (item.creditsUnlimited === true || (item.credits !== undefined && item.credits.unlimited === true)) {
						body.appendChild(kv('├ 该版余额', '不限'))
					} else if (item.credits !== undefined && Number.isFinite(item.credits.value)) {
						body.appendChild(kv('├ 该版余额', formatNumber(item.credits.value) + ' 积分'))
						if (item.credits.resetTime !== undefined) body.appendChild(kv('├ 额度重置', formatStamp(item.credits.resetTime)))
					}
					if (item.expires !== undefined) body.appendChild(kv('└ 令牌有效期', formatStamp(item.expires)))
				}
				if (wb.count > 1) body.appendChild(kv('剩余合计', wb.remain))
				const actions = document.createElement('div')
				actions.className = 'wbf-actions'
				const refresh = document.createElement('button')
				refresh.type = 'button'
				refresh.className = 'wbf-btn'
				refresh.textContent = state.busy ? '刷新中…' : '刷新'
				refresh.addEventListener('click', () => { void poll() })
				const settings = document.createElement('button')
				settings.type = 'button'
				settings.className = 'wbf-btn'
				settings.textContent = '看详情'
				settings.title = '打开设置（设置 → 插件）'
				settings.addEventListener('click', () => {
					const column = document.querySelector(FOOT_SELECTOR)
					const trigger = column === null ? null : column.querySelector('[class*="settingsArea"] button')
					if (trigger !== null) trigger.click()
				})
				actions.appendChild(refresh)
				actions.appendChild(settings)
				const stamp = document.createElement('span')
				stamp.className = 'wbf-stamp'
				stamp.textContent = state.updatedAt === undefined ? '' : formatStamp(state.updatedAt)
				actions.appendChild(stamp)
				body.appendChild(actions)
				return body
			}

			/** 智谱行的明细。 */
			function zhipuDetail() {
				const body = document.createElement('div')
				body.className = 'wbf-detail'
				body.setAttribute('data-dsh-detail', 'zhipu')
				const zp = zhipuRow(state)
				body.appendChild(kv('本行口径', '智谱开放平台（open.bigmodel.cn）· 只算智谱自己 · 金额（¥）'))
				body.appendChild(kv('今日消耗', zp.today === undefined ? '—（今日暂无智谱用量）' : zp.sign + formatMoney(zp.today) + ' 元'))
				body.appendChild(kv('余额', zp.remainText))
				body.appendChild(kv('点灯切到', MODEL_TARGETS.zhipu.label))
				body.appendChild(kv('说明', '智谱不提供余额接口，所以只有"今日花了多少"；数据来自用量插件的 per-provider 明细（family 为 zhipu / glm / bigmodel 的行）。'))
				return body
			}

			function render() {
				if (disposed) return
				const ds = deepseekRow(state)
				const wb = workbuddyRow(state)
				const zp = zhipuRow(state)
				const active = selectedRow()
				const total = totalRow(state)
				root.innerHTML = ''

				root.appendChild(rowElement({
					id: 'deepseek',
					name: 'DeepSeek',
					online: ds.online,
					active: active === 'deepseek',
					isExpanded: expanded === 'deepseek',
					todayText: ds.today === undefined ? '—' : ds.sign + formatMoney(ds.today),
					unitText: '（金额）',
					switchHint: '（官方通道 · deepseek-flash · 花余额 ¥）',
					remainText: ds.remainText,
				}))
				if (expanded === 'deepseek') root.appendChild(deepseekDetail())

				root.appendChild(rowElement({
					id: 'workbuddy',
					name: 'WorkBuddy',
					online: wb.online,
					active: active === 'workbuddy',
					isExpanded: expanded === 'workbuddy',
					todayText: wb.today === undefined ? '—' : formatNumber(wb.today),
					unitText: '（积分）',
					switchHint: '（WorkBuddy 通道 · deepseek-v4.1-flash · 花积分）',
					remainText: wb.remainText,
				}))
				if (expanded === 'workbuddy') root.appendChild(workbuddyDetail())

				root.appendChild(rowElement({
					id: 'zhipu',
					name: '智谱 GLM',
					online: zp.online,
					active: active === 'zhipu',
					isExpanded: expanded === 'zhipu',
					todayText: zp.today === undefined ? '—' : zp.sign + formatMoney(zp.today),
					unitText: '（金额）',
					switchHint: '（智谱开放平台 · glm-5.3-flash · 花余额 ¥）',
					remainText: zp.remainText,
				}))
				if (expanded === 'zhipu') root.appendChild(zhipuDetail())

				// 今日合计 = 全部消耗（两家单位不同，分开写，不跨单位相加）
				const foot = document.createElement('div')
				foot.className = 'wbf-total'
				foot.setAttribute('data-dsh-total', '')
				const label = document.createElement('span')
				label.className = 'wbf-total-label'
				label.textContent = '今日合计'
				const value = document.createElement('span')
				value.className = 'wbf-total-value'
				value.textContent = total.text
				foot.appendChild(label)
				foot.appendChild(value)
				root.appendChild(foot)

				// 切换结果的一行提示（只在刚切过时出现，见 switchModel）
				if (modelNotice !== '') {
					const notice = document.createElement('div')
					notice.className = 'wbf-notice'
					notice.setAttribute('data-dsh-model-notice', '')
					notice.textContent = modelNotice
					root.appendChild(notice)
				}
			}

			/** 手风琴：展开某一行（另一行保持一行高）；展开时把用量卡也收起来。 */
			function setExpanded(next) {
				expanded = next
				try {
					if (next === undefined) {
						// 有些环境下没有 removeItem，用空串当"未选择"也一样能读回来
						if (typeof localStorage.removeItem === 'function') localStorage.removeItem(ROW_KEY)
						else localStorage.setItem(ROW_KEY, '')
					} else {
						localStorage.setItem(ROW_KEY, next)
					}
					localStorage.setItem(LEGACY_COLLAPSED_KEY, next === undefined ? '1' : '0')
				} catch { /* 存不住也能用 */ }
				if (next !== undefined) collapseUsage()
				render()
			}

			async function poll() {
				if (disposed) return
				state = { ...state, busy: true }
				render()
				const [deepseek, cn, ai] = await Promise.all([
					readDeepSeekUsage(),
					readVariant(CN_STATUS, '国内版'),
					readVariant(AI_STATUS, '国际版'),
				])
				if (disposed) return
				// 每个周期每个变体各观测一次：下降计入各自的今日消耗，充值不计
				const ledger = loadLedger()
				for (const entry of [{ bucket: ledger.cn, item: cn }, { bucket: ledger.ai, item: ai }]) {
					const item = entry.item
					if (item === undefined || item.missing === true || item.signedIn !== true) continue
					if (item.creditsUnlimited === true || (item.credits !== undefined && item.credits.unlimited === true)) continue
					if (item.credits !== undefined && Number.isFinite(item.credits.value)) observeOne(entry.bucket, item.credits.value)
				}
				saveLedger(ledger)
				state = { deepseek, cn, ai, updatedAt: Date.now(), busy: false }
				render()
			}

			/** 把容器摆到用量卡上方（没有用量卡就摆到设置行上方）。 */
			function place() {
				const foot = findFoot()
				if (foot === undefined) {
					container.style.display = 'none'
					return
				}
				const rect = typeof foot.getBoundingClientRect === 'function' ? foot.getBoundingClientRect() : undefined
				const width = rect === undefined ? 0 : rect.width
				container.style.display = width > 0 && width < 90 ? 'none' : ''
				const anchor = foot.querySelector(USAGE_CARD) ?? foot.querySelector(SETTINGS_SEAT)
				if (anchor !== null && anchor !== undefined) {
					if (container.nextElementSibling !== anchor) foot.insertBefore(container, anchor)
					return
				}
				if (foot.lastElementChild !== container) foot.append(container)
			}

			place()
			render()
			void poll()
			// 灯的真实来源：先读一次，再每 4 秒跟一次（GUI 里换模型也能跟上）
			void refreshModelCurrent()
			// 卡片区高度控制：默认矮（工作区拿大头）+ 可拖
			areaControl.own()

			const timer = window.setInterval(() => { if (document.hidden !== true) void poll() }, POLL_MS)
			const modelTimer = window.setInterval(() => {
				if (document.hidden !== true) void refreshModelCurrent()
			}, MODEL_POLL_MS)
			// 互斥协调：用量卡一展开，就把我这张收起来
			const watcher = window.setInterval(() => {
				if (disposed) return
				place()
				areaControl.own()
				if (expanded !== undefined && usageExpanded()) {
					expanded = undefined
					try { localStorage.removeItem(ROW_KEY) } catch { /* ignore */ }
					render()
				}
			}, WATCH_MS)
			let bodyObserver
			if (typeof MutationObserver === 'function' && document.body !== null) {
				bodyObserver = new MutationObserver(() => { place(); areaControl.own() })
				bodyObserver.observe(document.body, { childList: true, subtree: true })
			}

			return () => {
				disposed = true
				window.clearInterval(timer)
				window.clearInterval(modelTimer)
				window.clearInterval(watcher)
				if (bodyObserver !== undefined) bodyObserver.disconnect()
				areaControl.stop()
				container.remove()
			}
		}

		return {
			name: 'workbuddy-foot-card',
			inject: [],
			apply(ctx) {
				if (typeof document === 'undefined') return
				if (document.querySelector(CARD_SELECTOR) !== null) return
				const unmount = mount()
				if (typeof ctx?.effect === 'function') ctx.effect(() => unmount, 'workbuddy-foot-card')
				else if (typeof ctx?.on === 'function') ctx.on('dispose', unmount)
			},
		}
	},
})
