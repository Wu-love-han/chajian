# 安装说明（给 AI / 给人看的完整流程）

> **一句话**：把本文件夹交给 AI，让它照着这份文档做；或你自己在 PowerShell 里
> 跑 `powershell -ExecutionPolicy Bypass -File tools\install.ps1`。

---

## 给 AI 的指令（复制这段给 AI 即可）

```
我拿到了一个 DSH（DeepSeek Harness）插件，文件夹叫 chajian-plugin-money-credits-card。
请你在 Windows 上把它装好，步骤：

1. 先读这个文件夹里的 README.md 和这份 INSTALL.md，按里面写的做，不要自己发明流程。
2. 运行：powershell -ExecutionPolicy Bypass -File tools\install.ps1
   - 如果它报 profile 找不到，用 -ProfileName web 再试一次（Web 版）。
   - 如果它报 ERR_PNPM_IGNORED_BUILDS，按提示把 pnpm 打印的 key 加进
     <profile>\pnpm-workspace.yaml 的 allowBuilds 再重跑。
3. 脚本最后会打印「NEXT STEP」，照它说的做：完全退出 DSH Desktop 再重新打开。
4. 重启后确认侧栏底部（设置行上方）出现 DeepSeek / WorkBuddy 两行 + 今日合计。
5. 如果某一行显示「未安装 / 读取失败」，不要修本插件——那是上游插件没装：
   - DeepSeek 行需要 @linxin666/dsh-usage
   - WorkBuddy 行需要 dsh-workbuddy-connect
6. 把每一步的实际输出贴给我，别只说"应该装好了"。
```

---

## 前提条件（先确认，缺哪个补哪个）

| 条件 | 怎么确认 | 不满足会怎样 |
|---|---|---|
| Windows + PowerShell 5.1 或更新 | `$PSVersionTable.PSVersion` | 脚本用不到 7 的特性，5.1 就能跑 |
| 装了 DSH Desktop（或 Web 版）并**至少启动过一次** | `Test-Path "$env:APPDATA\DSH Desktop\host-commands"` | 没有 dsh CLI，无法安装 |
| DSH 内核 ≥ `0.2.0-rc.2` | 看 `...\resources\app\node_modules\@deepseek-ai\dsh-llm\package.json` 的 version | 低于此版本不要装（本插件按 0.2.0 的形式写） |
| Node.js ≥ 22（桌面版自带） | `node -v` | 自检跑不了（不影响插件本身） |

---

## 安装（三种情况，选一种）

### 情况 1：从 GitHub 直接装（有网，推荐）

```powershell
# 注意必须有 # 号指分支；/tree/xxx 网页地址装不了（pnpm 会报 could not resolve）
dsh plugin --profile desktop add github:Wu-love-han/chajian#plugin/money-credits-card
```

### 情况 2：从下载的压缩包装（离线 / 别人发给你）

1. 在 GitHub 打开本插件分支 → 绿色 **Code** 按钮 → **Download ZIP**
2. 解压，得到 `chajian-plugin-money-credits-card\` 文件夹
3. 在这个文件夹里执行：

```powershell
powershell -ExecutionPolicy Bypass -File tools\install.ps1
```

> **重要（脚本已自动处理，但你要知道原理）**：本地安装产生的是一个**目录联接
> （Junction）**，指向你执行安装时所在的文件夹。那个文件夹一旦被删或被移动，
> 插件就会失效（而且目录看起来还在，报错很隐晦）。
>
> 所以脚本做了两件保护：
> 1. 如果它发现源目录在**临时目录 / 下载目录**这类"随时会没"的位置，
>    会**先自动复制到稳定位置** `~\.dsh\plugins\dsh-workbuddy-foot-card`，再从那里安装
>    （想换位置用 `-KeepCopy "D:\DSH插件\money-credits-card"`）；
> 2. 校验阶段不只检查目录存在，还会**检查联接目标是否还在**，目标没了会明确告诉你怎么修。
>
> 手动安装时请自己遵守：**先把文件夹放到最终位置，再执行安装**。

### 情况 3：手动装（上面两种都不行时）

按顺序做，不要跳步：

```powershell
# 0) 变量：把这两行改成你的实际情况（插件目录要放在稳定位置，别放下载目录！）
$plugin  = "D:\DSH插件\money-credits-card"                    # 先把这个文件夹放好，之后别删
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"           # Web 版改成 profiles\web

# 1) 让 profile 记住这个插件（用 dsh 自己写，别手改 JSON）
Push-Location $plugin
dsh plugin --profile desktop add .
Pop-Location

# 2) 检查：profile\package.json 应出现
#      "dsh-workbuddy-foot-card": "link:<你的路径>"
#    且 profile\package.json 的 dsh.profile.bundles 里应出现 "dsh-workbuddy-foot-card"

# 3) 检查装好的副本
Test-Path "$profile\node_modules\dsh-workbuddy-foot-card\lib\client.js"    # 应为 True
Test-Path "$profile\node_modules\dsh-workbuddy-foot-card\cordis.patch.yml" # 应为 True

# 4) 确认联接目标还在（目标没了插件就废了）
(Get-Item "$profile\node_modules\dsh-workbuddy-foot-card" -Force).Target
```

如果 `dsh plugin add .` 报 `ERR_PNPM_FETCH_404 ... not in the npm registry`：
说明 profile 里残留了旧的**版本号**依赖，先清掉再装：

```powershell
dsh plugin --profile desktop remove dsh-workbuddy-foot-card
dsh plugin --profile desktop add .          # 回到插件目录里执行
```

---

## 装完必须做的两步

### 第 1 步：完全重启 DSH

**不是刷新页面**，是**完全退出 DSH Desktop 进程再启动**。
原因：客户端插件名册（roster）是宿主启动时组合的，运行中不会重扫。
（第一次装必须重启；以后只改 `lib\client.js` 的话，重跑安装脚本 + 刷新页面就够。）

### 第 2 步：确认卡片出现

看**侧栏底部、`设置`行上方**，应该出现：

```
◉ DeepSeek    今日 ¥0.00 （金额）              余额 ...
● WorkBuddy   今日 0 （积分）                 剩余 ... 积分
今日合计  ¥0.00 金额 + 0 积分
```

- 点某一行会展开明细，另一行自动收起（手风琴，不会把侧栏撑长）。
- 橙灯 = 当前**选中**的那一种计量单位。**点前面的灯即可手动切换**（金额 ↔ 积分）；
  没手动选过时，橙灯跟随"当前正在消耗的那一家"。点已选中的灯可取消，回到自动跟随。

---

## 排障（按顺序试）

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 侧栏没有这张卡 | 没重启 / bundles 里没登记 | 确认 profile 的 `dsh.profile.bundles` 含 `dsh-workbuddy-foot-card`；完全重启 |
| 卡片在，但两行都「未安装」 | 上游插件的路由不存在 | 装 `@linxin666/dsh-usage`（DeepSeek 行）与 `dsh-workbuddy-connect`（WorkBuddy 行） |
| 只有 WorkBuddy 行数字是 0 | **正常**：上游没有按日接口 | 本插件靠"余额下降"推算今日消耗，从装上后第一次采样开始累计，不回补历史 |
| 安装报 `invalid profile name` | 把**路径**当成 profile 名传了 | `--profile` 只接受名字（`desktop` / `web`），不是路径 |
| 安装报 `Could not resolve plugin to a commit` | 用了 `/tree/分支` 网页地址 | 用 `github:owner/repo#branch`，或本地目录 |
| 安装报 `ERR_PNPM_IGNORED_BUILDS` | profile 缺构建白名单 | 按 pnpm 提示把 key 加进 `<profile>\pnpm-workspace.yaml` 的 `allowBuilds`，再重跑 |
| 移动/删掉了插件文件夹后失效 | 本地安装是 `link:` 软链接 | 把文件夹放回原位，或在新位置重新 `dsh plugin add .` |
| 想彻底卸载 | — | `dsh plugin --profile desktop remove dsh-workbuddy-foot-card`，然后完全重启 |

---

## 自检（不需要浏览器，随时可跑）

```powershell
node tools\smoke.mjs
# 期望最后一行：侧栏用量卡自检 OK - 全部通过
```

它会用一个**手写的假 DOM** 真实执行 `lib/client.js`，验证 69 项：挂载位置、
单位标注（金额 / 积分）、单独计量、手风琴、点灯手动切换计量单位、余额下降累计、跨日归零、
缺失插件时的降级、幂等。

---

## 这个插件会不会动我的东西

**不会。** 它只做三件事：

1. 每 30 秒 `fetch` 两个**同源**只读接口（`/api/dsh-usage/overview`、
   `/plugins/dsh-workbuddy-connect/status`）；
2. 在侧栏底部插一个自己的 DOM 容器；
3. 在 `localStorage` 里记自己的折叠状态与余额观测台账。

它**不改**其它插件、**不发**任何模型请求、**不读**任何凭据、**不消耗** token 或积分。
不想用了按上面的「卸载」删掉即可，不留残留。
