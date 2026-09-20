---
name: code-review-graph-接入回函管理智能化项目
overview: 在“回函管理智能化”React 原型项目中，用 conda mcp-form-demo 环境安装 code-review-graph，配置为 CodeBuddy 的 MCP Server，并构建本地代码知识图谱、验证可用性与回滚方案。
todos:
  - id: preflight-backup
    content: 备份 ~/.codebuddy 的 mcp.json 与 settings.json 到临时目录并留存快照
    status: pending
  - id: pip-install
    content: 用 mcp-form-demo 解释器先 --dry-run 查依赖冲突，再安装 base 依赖
    status: pending
    dependencies:
      - preflight-backup
  - id: configure-codebuddy
    content: 先 --dry-run 预览，再执行 install --platform codebuddy 写入 MCP 配置
    status: pending
    dependencies:
      - pip-install
  - id: verify-mcp-config
    content: 校验 mcp.json 合法、8 个 server 完好、新条目指向 mcp-form-demo 解释器
    status: pending
    dependencies:
      - configure-codebuddy
  - id: build-graph
    content: 执行 build 生成图谱，核对解析统计与 partial 警告，按需补 .code-review-graphignore
    status: pending
    dependencies:
      - verify-mcp-config
  - id: verify-commands
    content: 实测 status/update/visualize/detect-changes 各命令，输出使用说明并追加当日工作记忆
    status: pending
    dependencies:
      - build-graph
---

## 用户需求

用户提供了 GitHub 仓库 `tirth8205/code-review-graph` 的链接，询问三件事：**它是什么、能帮上什么忙、如何安装使用**。经确认，用户选择的是「**动手装好并跑通**」而非仅咨询，具体范围为：

- **安装**：在 conda 环境 `mcp-form-demo`（`E:\08_Anaconda3\Anaconda3\envs\mcp-form-demo\python.exe`）中安装 `code-review-graph`
- **配置**：为 CodeBuddy 平台注册 MCP Server
- **构建**：在当前项目上构建代码知识图谱并校验结果
- **交付**：给出可直接照做的使用说明

## 目标项目

工作区 `e:\13_dingdian\02_产品\06_函证系统\04_函证智能化\01_回函管理智能化`，是「函证系统 · 回函管理智能化」的**前端交互原型**：React 18 + TypeScript 5.6 + Vite 5 + Ant Design 5，源码仅 28 个文件（`src/` 下 20 个 `.tsx` + 7 个 `.ts` + 1 个 `.css`），属小仓库。

## 已核实的环境事实

- Python 3.10.20、pip 26.1.2（均满足 CRG 要求的 3.10+）；git 2.47 可用
- 该环境**尚未安装** `code-review-graph`
- 项目**不是 git 仓库**（`git rev-parse --show-toplevel` 报 fatal，上层目录同样不是），但存在 `.gitignore`
- CodeBuddy 用户级 MCP 配置位于 `C:\Users\10355\.codebuddy\mcp.json`，当前有 7 个启用中的 server + 1 个已禁用

## 核心功能

1. 在指定 conda 环境安装 CRG，并先行核查依赖是否会污染该共享环境
2. 为 CodeBuddy 写入 MCP Server 条目，使 CodeBuddy 能调用其 30 个图谱工具
3. 在本项目构建知识图谱数据库，确认解析范围正确（不误吞 `node_modules` / `dist`）
4. 实测可用命令，界定非 git 仓库下的能力边界，输出中文使用说明

## 边界与不做的事

- **不改动任何业务源码**（`src/`、`docs/`、`public/` 一律只读）
- **不执行 `git init`**：不擅自改变项目的版本控制状态
- **先只装基础依赖**，不安装 `[embeddings]`（会拉入 torch 等重型包），语义搜索暂由关键词回退承担
- 不新建项目文档文件；使用说明直接在对话中给出

## 技术栈选型

| 项 | 选择 | 说明 |
| --- | --- | --- |
| 运行环境 | conda 环境 `mcp-form-demo` | 用户指定；`E:\08_Anaconda3\Anaconda3\envs\mcp-form-demo\python.exe` |
| 工具 | `code-review-graph`（v2.3.x，MIT，纯 Python） | Tree-sitter 解析 AST + 本地 SQLite 图谱 |
| 通信协议 | MCP（stdio） | 通过 `code-review-graph serve` 暴露给 CodeBuddy |
| 配置落点 | `C:\Users\10355\.codebuddy\mcp.json` | 用户级配置，工作区之外 |
| 解析目标 | 本项目 `src/**/*.ts(x)` | TS/TSX 为内置语言，无需 `languages.toml` |


**不引入任何新构建链或前端依赖**，本项目 `package.json` 不变。

## 实施方案

分四步：**依赖体检 → 安装 → 平台注册 → 建图验证**。

1. **依赖体检**：先 `pip install --dry-run code-review-graph`，打印将要新增/升级的包清单。`mcp-form-demo` 是别的项目在用的共享环境，必须先确认 CRG 不会强升 `pydantic` / `click` / `typer` 等基础库引发连带风险；若冲突明显，改在项目内建 `.venv` 隔离（备选路径）。
2. **安装**：`python.exe -m pip install code-review-graph`（仅 base 依赖）。
3. **平台注册**：**先 `install --dry-run`** 打印将写入的 MCP 条目与规则文件内容，人工核对无误后再执行 `install --platform codebuddy`。这一步会改工作区外的用户级配置，必须先备份。
4. **建图与验证**：在项目根执行 `build`，随后实测可用/不可用命令，形成使用说明。

## 关键决策与权衡

- **为何必须先 `--dry-run` 再真装**：项目非 git 仓库，无法用 `git diff` 看出 `install` 到底改了哪些文件；`--dry-run` 是唯一可靠的预览手段，也是回滚的前提。
- **为何不装 `[embeddings]`**：sentence-transformers 会连带 torch，体积与下载耗时都很大，且本项目仅 28 个源文件，向量检索的边际收益低；CRG 在无嵌入时语义搜索自动回退 FTS 关键词检索，功能不缺失。若后续需要社区检测/生成 wiki，再追加轻量的 `[communities]`（igraph）。
- **为何不做 `git init`**：`detect-changes` / `review-delta` 依赖 git diff，非 git 下大概率不可用。但这属于「能力受限」而非「安装失败」，且擅自初始化仓库会改变项目状态，超出授权范围。默认保留现状，仅在计划确认时由用户显式追加该步骤。
- **MCP 条目 command 的绑定**：`install` 会依据**执行它的解释器**决定 MCP 条目里的 command（`uvx code-review-graph serve` 或绝对路径解释器）。因此 install 必须用 `mcp-form-demo\python.exe` 执行，并在写完后逐字校验该条目，否则运行时会找不到包。
- **解析范围**：CRG 默认忽略清单已覆盖 `**/node_modules/**`、`/dist/**`、`package-lock.json`、`*.map`、`*.min.js`、`*.sqlite` 等，本项目无需额外配置即可避开巨量无关文件；非 git 模式下排除规则改由根目录 `.code-review-graphignore` 承担，仅在 build 报告解析到非源码文件时才补充。

## 执行注意事项

- **PowerShell 输出编码**：CRG 输出含 `Token Savings` 边框字符与中文路径，需先设 `[Console]::OutputEncoding = [Text.Encoding]::UTF8`，避免乱码误判为故障。
- **pip 源**：若默认源超时/卡顿，回退清华镜像 `-i https://pypi.tuna.tsinghua.edu.cn/simple`。
- **命令名以 `--help` 实测为准**：README 提到 `status`，而 `docs/USAGE.md` 未列该子命令，存在版本差异，不得凭文档假定其存在；`install` / `build` 的参数同理先 `--help` 核对。
- **`partial` 状态**：若部分文件解析失败，build 结果为 `partial`，摘要会列出文件名，CLI 在 stderr 打印 `Warning:`。这是正常降级（旧图数据行保留），不属于失败；需在交付说明中如实记录。
- **必须重启 CodeBuddy**：MCP 配置只在启动时加载，写完后需用户重启编辑器，新工具才可调用。这一动作计划本身无法代替完成，属于交付时明确告知用户的收尾项。
- **日志与隐私**：不上传源码；保持默认本地嵌入，不设置 `CRG_ACCEPT_CLOUD_EMBEDDINGS`。导出图谱 JSON 时需注意其可能含绝对路径，不作外发。

## 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| `mcp.json` 被写坏导致 CodeBuddy 全部 MCP 失效 | 先备份原始文件到 `$env:TEMP\crg-backup-20260916\`；写后逐字校验 JSON 合法性与其余 7 个 server 完整性 |
| 共享环境被升级基础库 | 先 `--dry-run` 看依赖解；冲突则改用项目内 `.venv` |
| 遗留无用配置 | 内置回滚路径 `code-review-graph uninstall --dry-run` / `--yes` / `--keep-data`，先预览再执行 |
| 建图误吞大目录 | 核对 build 摘要中的文件数与解析语言分布；异常时补 `.code-review-graphignore` |


## 文件变更清单

```
C:\Users\10355\.codebuddy\
├── mcp.json                                   # [MODIFY] 新增 code-review-graph 的 MCP server 条目，其余 7 个 server 保持原样
├── settings.json                              # [可能 MODIFY] 仅当 install 声明需要；以 --dry-run 输出为准
└── skills\ / plugins\                         # [可能 NEW] 若 install 安装 skills，以 --dry-run 输出为准

<工作区>\01_回函管理智能化\
├── .code-review-graph\                        # [NEW] 图谱数据库（单个 SQLite）+ 可能生成的 wiki/可视化产物
│   └── *.db                                   #       由 build/update 生成，属可再生产物
├── .code-review-graphignore                   # [条件 NEW] 仅当 build 解析到非源码文件时创建，语法同 .gitignore
└── <平台规则文件，名称以 --dry-run 结果为准>   # [条件 NEW] install 可能写入的图谱使用说明文件

$env:TEMP\crg-backup-20260916\                 # [NEW] mcp.json 与 settings.json 的原始备份
```

**明确不改动**：`src/**`、`docs/**`、`public/**`、`package.json`、`vite.config.ts`、`tsconfig.json`、`index.html`、`.gitignore`（不执行 `git init`）。

## 验收标准

1. `pip show code-review-graph` 在 `mcp-form-demo` 环境返回包信息
2. `~/.codebuddy/mcp.json` 为合法 JSON，含 8 个 server，新条目 command 指向 `mcp-form-demo` 的解释器
3. 项目根出现 `.code-review-graph` 数据库，build 摘要显示解析到 `src/` 下的 TS/TSX 文件，且未包含 `node_modules`
4. 至少 `--help`、`build`、`update --brief`、`visualize` 四条命令实测通过；`detect-changes` / `status` 是否存在、在非 git 下是否可用，以实测结论如实记录
5. 给出中文使用说明，含已验证可用命令、受限能力、回滚方式与「重启 CodeBuddy」的收尾动作