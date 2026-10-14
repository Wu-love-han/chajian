# 金额与积分插件 · Money & Credits Card

> DSH（DeepSeek Harness）侧栏底部的**「今日消耗 / 剩余」速览卡**：
> **DeepSeek 按金额（¥）**、**WorkBuddy 按积分**分开计量，可折叠，
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

---

# 给下一个 AI 的交接说明（先读这一段）

你（下一个 AI）拿到这个仓库后，**按下面顺序做，不要自由发挥**：

## 第 0 步：先确认宿主环境

```powershell
# 找 DSH CLI（桌面版会生成一个）
Get-ChildItem "$env:APPDATA\DSH Desktop\host-commands" -Recurse -Filter dsh.cmd | Select-Object -First 1 -ExpandProperty FullName

# 确认 profile 与内核版本（本插件要求内核 >= 0.2.0-rc.2）
Get-Content "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml" -Raw -Encoding UTF8
Get-Content "$env:USERPROFILE\.dsh\profiles\desktop\package.json" -Raw -Encoding UTF8
```

- 桌面版 profile 一般是 `~\.dsh\profiles\desktop`；Web 版是 `~\.dsh\profiles\web`。
- 内核版本看 `D:\AI驱动盘\Deep Harness\resources\app\node_modules\@deepseek-ai\dsh-llm\package.json`
  的 `version`。**必须是 `0.2.0-rc.2` 或更高**，否则不要装（本插件用了 0.2.0 的 settings 形式）。

## 第 1 步：安装（推荐方式，装完即生效）

本包声明了 `dsh.bundle.patch`，Loader 行随包自带，**不需要手改任何配置文件**：

```powershell
# 从 GitHub 分支装（本插件在 chajian 仓库的 plugin/money-credits-card 分支）
dsh plugin --profile desktop add github:Wu-love-han/chajian#plugin/money-credits-card

# 或者：先克隆再本地装
git clone -b plugin/money-credits-card https://github.com/Wu-love-han/chajian.git
cd chajian
dsh plugin --profile desktop add .
```

装完**完全退出 DSH Desktop 再打开**（客户端插件名册在宿主启动时组合，只刷新页面看不到卡片）。

## 第 2 步：验证（必须做，别跳过）

```powershell
node tools\smoke.mjs      # 期望最后一行：侧栏用量卡自检 OK - 全部通过（74 项）
```

再看卡片是否真的出现：侧栏底部、`设置`行上方，应有 **DeepSeek / WorkBuddy 两行 + 今日合计**。
如果没出现，按下面「排障」一节处理。

## 第 3 步：确认它读得到数据（本插件只读，不改别的插件）

| 行 | 依赖 | 没有时会怎样 |
|---|---|---|
| DeepSeek 行 | `@linxin666/dsh-usage` 提供 `GET /api/dsh-usage/overview` | 显示「未安装」，WorkBuddy 行照常工作 |
| WorkBuddy 行 | `dsh-workbuddy-connect` 提供 `/plugins/dsh-workbuddy-connect/status` | 该行显示「未登录 / 读取失败」 |

**本插件不会安装、修改、卸载上面两个插件**。它们缺失只是对应行降级显示，不会报错、不会影响 DSH 本体。

## 排障（按顺序试）

1. **卡片完全没出现**
   - 确认 profile 的 `package.json` 里有本包依赖；
   - 确认 profile 的 `cordis.patch.yml` 里有 `workbuddy-foot-card` 那行（`bundle.patch` 正常工作时会自动写入）；
   - 确认是**完全退出** DSH 后重启，不是刷新页面。
2. **卡片出现了但两行都是「未安装 / 读取失败」** → 对应上游插件没装或没登录，见第 3 步的表格。
3. **WorkBuddy 今日消耗是 0** → 正常：上游没有按日接口，本插件靠**余额下降**推算，
   装上后从第一次采样开始累计，不回补更早的消耗。
4. **想彻底删掉** → 见下面「卸载」。

---

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
- **WorkBuddy 今日消耗**：用「余额下降」推算 —— 每 30 秒采样一次余额，**只把下降计入今日（充值上涨不计）**，按本地日累计、跨日归零，与用量插件的 observed spend 同口径。
- 只读展示：**不碰凭据、不发模型请求、不消耗积分**。纯 DOM，零依赖（连 React 都不用）。

## 目录

```
package.json          dsh.client = { platform: 'web', inject: [] }
                      dsh.bundle.patch = './cordis.patch.yml'  ← 装完即用的关键
cordis.patch.yml      自带 Loader 行（安装时自动插入 profile）
lib/client.js         卡片本体（浏览器半区，纯 DOM + 零依赖，35 KB）
lib/index.js          宿主半区（空 apply，仅为让 Loader 行存在）
tools/smoke.mjs       自检（74 项，手写 DOM，不需要浏览器/jsdom）
```

## 自检覆盖什么

自检在**手写 DOM** 里真实执行 `lib/client.js`，覆盖：

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

## 卸载

```powershell
# 1) 从 profile 移除依赖（会同时清掉它带来的 Loader 行）
dsh plugin --profile desktop remove dsh-workbuddy-foot-card

# 2) 若上面没清干净，手动删 profile 里这两处
#    package.json  → dependencies 里的 dsh-workbuddy-foot-card
#    cordis.patch.yml → workbuddy-foot-card 那三行
```

改完**完全重启 DSH Desktop**。

## 手动安装（仅当 `dsh plugin` 不可用时）

按顺序做，别跳步：

```powershell
# 1) 复制到 profile 的 node_modules
$dst = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-workbuddy-foot-card"
New-Item -ItemType Directory -Force -Path "$dst\lib" | Out-Null
Copy-Item package.json "$dst\" -Force
Copy-Item cordis.patch.yml "$dst\" -Force
Copy-Item lib\*.js "$dst\lib\" -Force

# 2) 把依赖写进 profile 的 package.json（dependencies 加 "dsh-workbuddy-foot-card": "1.0.0"）

# 3) 把 Loader 行追进 profile 的 cordis.patch.yml
#    - insert:
#        - id: workbuddy-foot-card
#          name: 'dsh-workbuddy-foot-card'

# 4) 完全重启 DSH Desktop
```

（本插件在 chajian 仓库的分支 `plugin/money-credits-card`；`main` 分支只有仓库说明，**不要**从 `main` 装。）

## 已知边界

- WorkBuddy 的今日消耗是**余额下降观测**得来的，装上后从第一次采样开始累计，不回补更早的消耗。
- 单位不同不可换算，所以「今日合计」分列 `¥` 与 `积分`，不给出单一数字。
- 依赖两个上游插件的**私有路由**（非官方开放 API），上游改名会降级为「读取失败」而不是崩溃。

## 许可

MIT
