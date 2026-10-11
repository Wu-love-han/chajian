# 金额与积分插件 · Money & Credits Card

> DSH（DeepSeek Harness）侧栏底部的**「今日消耗 / 剩余」速览卡**：
> **DeepSeek 按金额（¥）**、**WorkBuddy 按积分**分开计量，可折叠、可拖宽，
> 前面那盏**橙灯标出"当前正在消耗哪一个"**。

```
◉ DeepSeek    今日 ¥0.10 （金额）              余额 ¥9.99        ▸
● WorkBuddy   今日 120 （积分）  当前在用      剩余 2,880 积分    ▾
   ├ 本行口径   只算 WorkBuddy 自己 · 积分（按余额下降观测）
   ├ WorkBuddy 今日  120 积分
   ├ 国内版     已登录 · 甲 · www.workbuddy.cn
   │   ├ 今日消耗  100 积分
   │   └ 该版余额  2,100 积分
   └ 国际版     已登录 · 乙 · workbuddy.ai
       ├ 今日消耗  20 积分
       └ 该版余额  780 积分
今日合计  ¥0.10 金额 + 120 积分
```

## 特性

- **两行、两种计量单位，绝不混**：DeepSeek 行一律带 `¥` 并标注 `（金额）`；WorkBuddy 行一律带 `积分` 并标注 `（积分）`。
- **手风琴**：默认两行都只有一行高，**点哪一行才展开哪一行**的明细；同一时刻只有一个明细区，不会把侧栏撑开。
- **三种灯**：

  | 灯 | 含义 |
  |---|---|
  | **橙灯（呼吸）** | **当前正在消耗这一个**（按用量插件的 `current.provider` 判断），并带「当前在用」小标签 |
  | 绿灯 | 已登录 / 可用，但不是当前在用的 |
  | 灰灯 | 未登录 / 读不到 |

- **单独计量**：
  - DeepSeek 行**只算 DeepSeek 官方渠道**当天的消费金额（把用量插件的 `usage.today.providers[]` 拆开按家族求和），其它渠道单独列出并标注「不计入本行」。
  - WorkBuddy 行**国内版与国际版各自计量**（每版单独采样余额下降），行上显示两版合计。
- **今日合计**：`¥ 金额 + N 积分` —— 两家单位不同，**分开写、不做跨单位相加**。
- **WorkBuddy 今日消耗**：上游没有按日接口，用「余额下降」推算 —— 每 30 秒采样一次余额，**只把下降计入今日（充值上涨不计）**，按本地日累计、跨日归零，与用量插件的 observed spend 同口径。
- 只读展示：**不碰凭据、不发模型请求、不消耗积分**。纯 DOM，零依赖（连 React 都不用）。

## 与其它插件的关系

| 行 | 数据来源 |
|---|---|
| DeepSeek | `@linxin666/dsh-usage` 的 `GET /api/dsh-usage/overview`（今日 `cost`、`providers[].balance`、`current.provider`） |
| WorkBuddy | `dsh-workbuddy-connect` 的 `GET /plugins/dsh-workbuddy-connect/status`（国内版）与 `/ai/status`（国际版） |

本插件**不改这两个插件**，只读取它们已经暴露的同源路由；任一插件缺失或接口失败都会降级成可读文字，不影响另一行。

## 安装

前置：桌面版 DSH（内核 `>= 0.2.0-rc.2`）。

```powershell
# 在仓库目录里执行：复制到 profile + 写依赖 + 插 Loader 行（幂等）
powershell -ExecutionPolicy Bypass -File tools\install.ps1

# 指定其它 profile
powershell -ExecutionPolicy Bypass -File tools\install.ps1 -Profile "$env:USERPROFILE\.dsh\profiles\web"
```

安装脚本做三件事：

1. 复制 `package.json` 与 `lib\*.js` 到 `<profile>\node_modules\dsh-workbuddy-foot-card\`
2. 在 profile 的 `package.json` 加依赖
3. 在 profile 的 `cordis.patch.yml` 插入 Loader 行：

```yaml
- insert:
    - id: workbuddy-foot-card
      name: 'dsh-workbuddy-foot-card'
```

**装完重启 DSH Desktop**：客户端插件名册是宿主启动时组合的（只刷新页面看不到卡片）。
之后只改 `lib\client.js` 时，重跑 `install.ps1` + 刷新页面即可。

## 自检

```powershell
node tools\smoke.mjs      # 期望最后一行：侧栏用量卡自检 OK - 全部通过
```

自检在**手写 DOM** 里真实执行 `lib/client.js`（不需要浏览器 / jsdom），覆盖：

- bundle 注册形状与**零依赖**（不 require 任何模块）
- 挂载位置（侧栏 `footArea` 内、设置行上方；窄栏 56px 时自动隐藏）
- **DeepSeek 行只认官方金额 `¥0.10`，不会把当天合计 `0.1234` 当成自家的**
- **两版 WorkBuddy 各自计量**（国内 100 + 国际 20 = 行上 120）与余额相加
- **今日合计**两类单位都在，且**未登录时不瞎加**
- 今日消耗按余额下降累计 / **充值不计** / **跨日归零**（逐变体）
- **手风琴**（同一时刻只有一个明细区）
- **橙灯跟随 `current.provider`（DeepSeek ↔ WorkBuddy 双向），拿不到时不瞎标**
- 缺失插件、接口 500、未登录、企业不限额度、`credits` 为对象等降级路径
- 幂等（重复 apply 不挂第二张卡）

## 目录

```
lib\client.js         卡片本体（浏览器半区，纯 DOM + 零依赖）
lib\index.js          宿主半区（空 apply，仅为让 Loader 行存在）
package.json          dsh.client = { platform: web, inject: [] }
tools\install.ps1     幂等安装（复制 + 依赖 + Loader 行）
tools\smoke.mjs       自检
```

## 卸载

删掉 profile `cordis.patch.yml` 里 `workbuddy-foot-card` 那段与 profile `package.json` 里的依赖，
再删除 `<profile>\node_modules\dsh-workbuddy-foot-card`，重启 DSH Desktop。

## 已知边界

- WorkBuddy 的今日消耗是**余额下降观测**得来的，装上后从第一次采样开始累计，不回补更早的消耗。
- 单位不同不可换算，所以「今日合计」分列 `¥` 与 `积分`，不给出单一数字。
- 依赖两个上游插件的**私有路由**，上游改名会降级为「读取失败」而不是崩溃。

## 许可

MIT
