# 更新记录

## v1.0.1 — 修一处会导致 DSH 无法启动的重复插入（2026-10-15）

**崩溃**：DSH 一打开就进恢复模式，日志报
`duplicate loader entry id "workbuddy-foot-card" in the composed profile`。

**原因**：同一条 Loader 行被插了两次 —— profile 的 `cordis.patch.yml` 里有一份**手写**的
`- insert:`（本插件**早期**没有自带 `bundle.patch`，那时代安装说明要求手改），而插件现在
自带 `dsh.bundle.patch`，`dsh plugin add` 会自动再插一份。两个同 id 条目 → DSH 拒绝组合
profile → 拒绝启动。

**修法**：

- `tools/install.ps1` 装之前**自动清除** profile 里这类陈旧的同 id 手写行
  （先备份成 `cordis.patch.yml.stale-insert-<时间戳>`），装之后**断言该 id 只被插一次**，
  不满足就直接失败并指出要删哪一段。
- `INSTALL.md` 新增「一打开就崩溃 / 进恢复模式」一节：症状、原因、逐步修法，并明确
  **`dsh plugin add` 已自动写 `dependencies` + `bundles`，Loader 行由包自带 patch 提供 —— 都不要手工补**。
- 文档里推荐的安装方式改为 `dsh plugin add github:Wu-love-han/chajian#<分支>`：装出来是
  **真实目录**而不是 `link:` 软链接，源目录被删也不会让插件失效（这次就是源目录消失导致插件全废）。

## v1.0 — 首发（2026-10-11）

侧栏底部「今日消耗 / 剩余」速览卡，随 DSH Desktop（内核 0.2.0-rc.2）实测通过。

- **两行、两种计量单位**：DeepSeek 行按**金额（¥）**、WorkBuddy 行按**积分**，各自带单位标注。
- **单独计量**：DeepSeek 行只算 DeepSeek 官方渠道当天的消费金额（按 `usage.today.providers[]` 的
  家族拆分），其它渠道单独列出并标注不计入本行；WorkBuddy 的**国内版 / 国际版各自计量**。
- **今日合计**：`¥ 金额 + N 积分`，两类单位分开写、不做跨单位相加。
- **手风琴折叠**：默认两行各一行高，点哪行才展开哪行；同一时刻只有一个明细区。
- **三种灯**：橙灯（呼吸）= 当前正在消耗的那一个（按 `current.provider` 判断），绿=可用，
  灰=未登录/读不到；拿不到当前 provider 时不瞎标。
- **WorkBuddy 今日消耗**用「余额下降」推算：每 30 秒采样，只把下降计入今日（充值不计），
  按本地日累计、跨日归零。
- **降级路径**：缺用量插件 / 接口 500 / 未登录 / 企业不限额度 / `credits` 为对象，都能显示成可读文字。
- **零依赖**：纯 DOM 实现，不 require 任何模块（`dsh.client.inject: []`）。
- **自检**：`tools/smoke.mjs` 在手写 DOM 里真跑卡片逻辑，74 项全过。
