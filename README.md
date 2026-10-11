# chajian · DSH 插件合集

> 这是我的 **DSH 插件库**：**所有插件都放在这个仓库里，一个插件一条分支**；
> **主干 `main` 只放仓库说明与通用规范，不放插件代码。**

## 仓库怎么组织（刻意设计）

| 位置 | 放什么 |
|---|---|
| **主干 `main`** | 本说明（插件索引 + 我的想法）、通用 PR 检查清单；**不放任何插件代码** |
| **`plugin/<插件名>` 分支** | 某个插件的完整源码（可运行、可安装、带自检） |

好处：

- 主干干净，一眼看清"这里都有哪些插件"；
- 每个插件**互不干扰**，一个插件的改动不会碰坏另一个；
- 想要哪个插件，就切到它的分支（或下载该分支的 zip）；
- 需要合并时也不冲突——主干上没有插件文件。

## 现有插件

| 分支 | 插件 | 说明 |
|---|---|---|
| [`plugin/money-credits-card`](../../tree/plugin/money-credits-card) | **金额与积分插件**<br>Money & Credits Card | DSH 侧栏底部「今日消耗 / 剩余」速览卡：**DeepSeek 按金额（¥）**、**WorkBuddy 按积分**分开计量；两行手风琴折叠；**橙灯标出"当前正在消耗哪一个"**；今日合计分列金额与积分，不跨单位相加 |
| [git-kuangjia](../../tree/git-kuangjia) | **图谱框架**<br>关系图编辑器 | 独立的关系图 / 框架图编辑器：右键框选、节点缩放、6 种布局（力导向/放射状/树状/泳道/网格/环形）、11 个模板、侧栏可拖宽；本地 JSON 存储、可导入导出 SVG/PNG |

## 用某个插件（以金额与积分插件为例）

```powershell
# 1) 取该插件的分支
git clone -b plugin/money-credits-card https://github.com/Wu-love-han/chajian.git
cd chajian

# 2) 幂等安装进 DSH profile（复制文件 + 写依赖 + 插 Loader 行）
powershell -ExecutionPolicy Bypass -File tools\install.ps1

# 3) 自检
node tools\smoke.mjs
```

装完**重启 DSH Desktop**（客户端插件名册是宿主启动时组合的；之后只改 `lib\client.js` 时刷新页面即可）。

> 注意：插件代码在分支上，所以**切到 `main` 时本地看不到 `lib/`、`tools/`**——这是设计如此。
> 要改某个插件，先 `git checkout plugin/<插件名>`。

## 新增一个插件

```powershell
git checkout main && git pull
git checkout -b plugin/<新插件名>        # 插件代码只放自己的分支
# …写插件：package.json（声明 dsh.client）+ lib/client.js + tools/install.ps1 + tools/smoke.mjs…
powershell -ExecutionPolicy Bypass -File tools\install.ps1
node tools\smoke.mjs
git add -A && git commit -m "feat: <新插件名> 首发"
git push -u origin plugin/<新插件名>
```

然后回 `main`，把新插件补进上面的「现有插件」表格，同样走 PR。

## 每个插件的统一骨架

```
package.json        dsh.client = { platform: 'web', inject: [...] }   # 声明成 DSH 客户端插件
lib/client.js       浏览器半区：卡片/面板本体（推荐纯 DOM、零依赖）
lib/index.js        可选：宿主半区（若需要自己的服务端路由）
tools/install.ps1   幂等安装：复制到 profile + 写依赖 + 插 Loader 行
tools/smoke.mjs     自检：不依赖浏览器也能验证核心逻辑
README.md           面向使用者的说明
CHANGELOG.md        改动记录
```

## 我的想法（仓库愿景）

- 把这里做成**我自己的一站式 DSH 插件库**：所有自写/自用插件都放这一个仓库，**一插件一分支**，
  主干永远只留目录与规范。
- 插件都遵循**同一套骨架**，都要求**能自检、能一键安装、能一键卸载**，不依赖本机绝对路径。
- 优先做**只读、零依赖、不消耗额度**的小工具 —— 比如这个用量卡：只读已有插件已经暴露的路由，
  不发模型请求、不碰凭据、不消耗 token 或积分。
- 改动一律走 **PR**，主干留审查痕迹；插件分支上也保留 `CHANGELOG` 便于回溯。
- 以后插件多了，就用 README 里那张索引表当"目录页"，一屏看清仓库里都有什么。

## 规范

- 主干 `main` **受保护**：必须通过 Pull Request 才能改动（禁强推、禁删分支、**无旁路**）。
- 每个 PR 按 [`.github/pull_request_template.md`](./.github/pull_request_template.md) 填写：
  改了什么、**实际跑过的命令与结果**、检查清单。
- 插件分支必须自带 `tools/smoke.mjs`（或等价自检），并在 PR 里贴出通过结果。
- **不要提交个人数据**：账号、密钥、笔记、本地图谱内容、本机绝对路径都不要进仓库。

## 许可

MIT（各插件分支内也各自带一份 LICENSE）
