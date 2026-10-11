# 更新记录（仓库级）

## 结构变更 — 2026-10-11

- **主干 `main` 改为只放仓库说明与规范**：README（插件索引 + 仓库愿景）、PR 检查清单、本文件。
  **主干不再包含插件代码**。
- **插件代码移入各自分支**：金额与积分插件位于 `plugin/money-credits-card`。
- 新增 `.github/pull_request_template.md`（与本仓库"一插件一分支"约定配套的 PR 检查清单）。

### 各插件自己的改动记录

放在各自分支的 `CHANGELOG.md` 里，例如
[`plugin/money-credits-card` 的 CHANGELOG](../../blob/plugin/money-credits-card/CHANGELOG.md)。
