# dsh-compact-focus 交接文档

> 最后更新：2026-10-17 · 维护者：当前 DSH 会话（lead）
> 项目位置：本仓库目录（下文记为 `<repo>`）
> 状态：**已实现、已安装、已验证可用**（用户确认插件可用）

---

## 1. 一句话

给 DeepSeek Harness 的 `/compact` 增加一个可选参数：`/compact <重点文本>`。压缩较早历史时，让摘要器在保持官方固定结构的前提下，优先保留你指定的重点；不带参数时行为与官方内置命令完全一致。

```text
/compact                                  → 官方默认压缩（无重点）
/compact 重点总结项目框架                  → 压缩并让摘要重点保留“项目框架”
/compact 重点保留部署与数据库相关决策       → 压缩并重点保留部署/数据库决策
```

---

## 2. 当前状态

| 项 | 值 |
|---|---|
| 项目源码 | `<repo>` |
| DSH 安装 | `%LOCALAPPDATA%\Programs\DeepSeek Harness`（desktop，Electron） |
| DSH 版本 | 0.2.1-rc.2（插件生成/首次验证时是 0.2.1-rc.1；rc.2 的 `standard` 预设逐字节未变） |
| 目标 profile | `%DSH_HOME%\profiles\desktop`（**desktop** profile） |
| 安装形态 | profile 依赖 `"dsh-compact-focus": "link:<repo 的绝对路径（正斜杠）>"` + `node_modules\dsh-compact-focus` junction + `dsh.profile.bundles` 追加 `dsh-compact-focus` |
| 生效方式 | **完全退出并重启 DSH desktop 后生效**（当前运行中的进程是重启后启动的） |
| 验证 | 隔离 DSH_HOME 端到端 GUI 测试（压缩命令、focus 注入、摘要内容）+ 真实 profile 隔离启动（组合中出现 `compaction-focus` / `command-compact-focus` 行） |
| 回滚 | `uninstall.ps1` + 重启；profile `package.json` 有自动备份 |

> 注意：插件是**手工本地安装**（link + junction），没有通过 plugin_manager 安装，因此 DSH 插件管理页不会把它当成普通插件管理。不要用插件页对它做升级/卸载。

---

## 3. 使用指南

前提：会话使用 **standard** 预设（插件只覆盖 `preset-standard`）。

| 方式 | 操作 |
|---|---|
| 直接输入 | `/compact 重点总结项目框架` 回车 |
| Tab 补全 | 输入 `/com` → 候选出现 `compact` → **先按 `↓` 高亮** → 按 `Tab` 补全为 `/compact `（指令 chip，自带尾随空格）→ 输入重点 → 回车 |
| 菜单 | 点输入框 `+` →「指令」→「compact」→ 输入重点 → 回车 |
| 无重点 | Tab 补全后直接回车；或输入 `/compact` 回车（先变 chip，再回车执行） |

行为细节：

- **补全后不输入任何内容直接发送** = 无参数 `/compact`，走官方默认规则，不注入 focus；结果文案不带“摘要重点：…”。
- 结果文案区分：`已压缩 N 条历史记录（约 X tokens）。`（无重点）vs `…。摘要重点：<文本>`（有重点）。
- 只有 agent 空闲且没有进行中的压缩时可用；压缩期间发送的消息会排队。
- DSH 候选菜单默认不预高亮：**必须先 `↓` 再 `Tab`**，否则 Tab 只是离开输入框。

---

## 4. 实现原理（维护者必读）

### 4.1 DSH 压缩 seam 的关键事实

- 压缩由 seam `@deepseek-ai/dsh-compaction` 定义（`ctx.compaction: CompactionEngine`），随包后端是 `@deepseek-ai/dsh-compaction-basic`。
- 一次压缩 = 把会话表面上的一段较早历史替换成一条摘要，事务事件：`compaction/start` → `compaction/summary` + 替换 `user/message` → `compaction/end`。
- 官方后端 `summarize()` 是**唯一的子类定制钩子**；摘要请求 = 回放系统提示词 + 被遮蔽区域消息，最后追加一条**冻结的** compaction 指令。
- 官方 `/compact`（`@deepseek-ai/dsh-command-compact`）**不接受参数**，自动选“最旧的平衡范围”；自动压缩在压力/溢出时触发。
- 官方**没有**面向模型的压缩工具，也没有“指定范围/重点”的用户入口（见官方 README 的“尚未决定”条目）。

### 4.2 为什么必须替换整份 `preset-standard`

- Agent preset 的插件列表写在 `@deepseek-ai/dsh-web-app` 的 `presets/standard.patch.yml` 里，作为 `@deepseek-ai/dsh-agent-preset` 一行的 `config.plugins`。
- Loader 的覆盖规则：**按 Loader 行 id 覆盖时，`config` 是整体替换、不做深合并**（DSH 自带 `editing-cordis-compositions` skill 明确说明）。
- 因此不能只 patch 嵌套的 `compaction-basic` / `command-compact`；只能整份重述 `preset-standard` 的 `config`，只把 compaction 组换掉。
- `tools/gen-focus-patch.mjs` 就是做这件事：读插件包内保存的 `standard-preset.source.yml` 快照 → 输出 `cordis.patch.yml`（已验证生成幂等）。

### 4.3 后端：`lib/engine.js`

- `FocusCompactionEngine extends BasicCompactionEngine`（import 自安装包的 `@deepseek-ai/dsh-compaction-basic`）。
- 只 override `summarize(input, agent, signal)`：
  - `focusBySession: WeakMap<Session, string>`，由命令在同一次压缩前 `setFocus()` 写入；
  - `summarize` 时取出 focus，把一条 **focus 指令 user 消息** 追加在回放历史之后（官方冻结指令之前），再调用 `super.summarize(...)`；
  - 指令明确要求：把重点融进官方固定结构、不要新增章节、不要复述这条指令本身（措辞经过实测调优，避免 focus 指令泄漏进摘要）。
- 其余全部继承：自动压缩、阈值/溢出、保留尾部、锁、token 计价、失败恢复。
- 无 focus 时直接 `super.summarize(...)`，与官方完全一致。
- 可选调试：环境变量 `DSH_COMPACT_FOCUS_DEBUG=1`，注入时 stderr 打印 `[dsh-compact-focus] injecting N-char focus …`。

### 4.4 命令：`lib/command.js`

- 注册同名 `compact`，声明 `input: { hint: … }`。
  - **为什么必须声明 input**：客户端 `matchEnter` 对“没有 input 声明”的宿主命令只在裸 token 时执行；带空格参数的行会被当成模型提示词发给模型。声明 input 后，客户端走 leadingInput claim 路径，把尾随文本当参数提交。
  - 代价：裸 `/compact` 回车会先变成指令 chip，再回一次车执行（官方带 input 命令的通用交互）。
- 处理器：`rawInput.trim()` → 有文本则 `ctx.compaction.setFocus(session, focus)`；随后 `ctx.compaction.compactNow(agent, signal, commandId)`（与官方命令同一入口）；`finally` 清除 focus，避免泄漏到后续自动压缩。
- 错误码沿用官方 `ManualCompactionError`（busy/cancelled/changed/summary/commit/persistence），文案汉化；结果文案与 `command/done` 一致，带重点时追加“摘要重点：<文本>”。
- focus 上限 4000 字符。

### 4.5 为什么 focus 放“摘要指令之前”

官方摘要是把冻结指令作为最后一条 user 消息追加；子类钩子只能在它之前插入。实测该位置对摘要有效，且只让 focus 文本本身（几十 token）脱离提供方热前缀缓存，代价很小。

---

## 5. 文件清单

```text
<repo>\
├─ package.json                 # bundle 清单：exports 运行时入口/locale/icon；dsh.bundle.patch
├─ cordis.patch.yml             # 生成的 bundle patch：整份覆盖 preset-standard
├─ standard-preset.source.yml   # 生成时的标准 preset 快照（升级后需更新）
├─ lib\engine.js                # FocusCompactionEngine（继承官方后端）
├─ lib\command.js               # /compact 命令（带可选 focus）
├─ locale\en.json               # 插件页英文标题/描述
├─ locale\zh.json               # 插件页中文标题/描述
├─ icon.svg                     # 插件页图标
├─ tools\asar.mjs               # 读 app.asar 的小工具（用于升级后提取 preset）
├─ tools\gen-focus-patch.mjs    # 生成 cordis.patch.yml（幂等）
├─ install.ps1                  # 安装/修复：junction + link 依赖 + bundles
├─ uninstall.ps1                # 卸载：移除上述三项
├─ README.md                    # 使用者向说明
├─ COMPLIANCE.md                # DSH 插件规范审查记录
├─ LICENSE                      # MIT
├─ .gitignore                   # 本地/升级临时文件
└─ HANDOVER.md                  # 本文档
```

运行时关键点：`exports` 里的 `.`、`./command`、`./locale/*.json`、`./icon`、`./command/locale/*.json`、`./command/icon` 等入口必须保留（后两组让子路径插件 `dsh-compact-focus/command` 也有插件页元数据）；`peerDependencies` 必须列出被 import 的宿主包（`@deepseek-ai/cordis`、`dsh-commands`、`dsh-compaction`、`dsh-compaction-basic`），否则 Linked 包解析会失败。

---

## 6. 安装 / 卸载 / 升级 Runbook

### 6.1 安装（或移动目录后修复）

```powershell
# 在仓库目录执行；确保环境变量指向目标 profile（desktop 应用内通常已设置；普通终端可显式指定）
$env:DSH_HOME = "$env:USERPROFILE\.dsh"   # 默认值，自定义时替换
$env:DSH_PROFILE = 'desktop'
pwsh -File .\install.ps1
```

脚本（幂等）：

1. 删除并重建 `%DSH_PROFILE_DIR%\node_modules\dsh-compact-focus` junction → 指向插件实际目录；
2. profile `package.json` 写入 `"dsh-compact-focus": "link:<当前目录（正斜杠）>"`；
3. 把 `dsh-compact-focus` 追加进 `dsh.profile.bundles`。

脚本会先备份 `package.json` 为 `package.json.dsh-compact-focus.bak`。

> ⚠️ 把项目目录移走后**必须重跑 install.ps1**，否则 junction 指向旧路径、重启后插件消失。

### 6.2 生效

完全退出 DeepSeek Harness（托盘/进程全部退出）再启动。新进程启动时读取 profile 组合并加载插件。已有会话重开后也会使用当前组合；稳妥起见新开会话验证。

### 6.3 DSH 升级后的检查（重要）

插件覆盖的是**整份标准 preset 快照**。DSH 升级若改动 `standard` 预设（增/改/删插件），旧补丁会覆盖掉新内容，需要重新生成：

```powershell
cd <repo>

# 1) 看当前安装包的 preset 是否仍与快照一致（不一致才需要重生成）
node tools\asar.mjs "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\app.asar" cat "dsh/node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml" > _current-standard.yml
fc.exe /b standard-preset.source.yml _current-standard.yml   # 无输出=一致
# 2026-10-17 在 0.2.1-rc.2 上核对：一致

# 2) 不一致时：更新快照并重生成，再重启 DSH
move /y _current-standard.yml standard-preset.source.yml
node tools\gen-focus-patch.mjs standard-preset.source.yml cordis.patch.yml
```

同时留意后端/命令 API 是否变化：插件依赖 `BasicCompactionEngine`（默认导出）、其 `summarize()` 钩子、`ctx.compaction.compactNow`、`ctx.commands.register({ definitionId, name, description, input, handler })`。升级后先看安装包内对应包 README/编译产物，必要时改 `lib\*.js`，并在隔离 DSH_HOME 里先验证（见 §7）。

### 6.4 卸载 / 回滚

```powershell
# 在仓库目录执行
pwsh -File .\uninstall.ps1
```

再重启 DSH，恢复官方 `/compact`。脚本同样备份 `package.json.dsh-compact-focus.uninstall.bak`。必要时可手工从备份恢复 profile `package.json`，并删除 `node_modules\dsh-compact-focus` junction。

---

## 7. 验证记录

### 7.1 功能端到端（隔离 DSH_HOME，DSH 0.2.1-rc.1）

在临时 profile（同 web-app 组合、link 安装本插件）启动真实 DSH web UI，用浏览器 GUI 实测：

1. 输入 `/compact 重点总结项目框架` → 被作为命令执行（会话日志 `command/run` 的 `args` = `" 重点总结项目框架"`，不是模型消息）；
2. 压缩成功：`compaction/summary` 有 8 条被遮蔽历史、约 752 tokens，`command/done` 文本 = `已压缩 8 条历史记录（约 752 tokens）。摘要重点：重点总结项目框架`；
3. focus 确实进入摘要请求：`DSH_COMPACT_FOCUS_DEBUG=1` 时 stderr 出现 `[dsh-compact-focus] injecting 14-char focus for session …: 重点保留部署与数据库相关决策`；
4. 摘要效果：带“重点保留部署与数据库相关决策”的摘要把部署/SQLite/Loki/发布流程提到 Key Technical Concepts 前部，并多出“Established decisions to retain”；带“重点保留前端技术栈”的摘要把 React+Vite/Zustand 列为第一条技术重点，且 focus 指令本身未泄漏进摘要；
5. 无 focus 路径：`commit` 文本无“摘要重点”后缀，行为与官方一致。

### 7.2 Tab 补全（隔离 web UI 实测）

- 输入 `/com` → 候选 `compact`；
- `↓` 高亮后 `Tab` → 输入框变为 `/compact `（chip + 尾随空格，DOM：`<span data-composer-command="compact">…</span><span> </span>`）；
- 继续输入文本后回车 → 命令执行（不是发给模型）；不输入直接回车 → 无参数默认压缩。

### 7.3 真实 desktop 组合隔离启动（移动目录后，DSH 0.2.1-rc.2）

用真实 `%DSH_HOME%\profiles\desktop` 组合、临时 `DSH_HOME`、Electron-as-Node 启动：

- `BOOT OK`（唯一告警是隔离环境缺少 Electron 注入导致的 `product-analytics` pending，与本插件无关）；
- 读取 `agentPresets.definitions.standard.config.plugins`：compaction 组子项 = `["compaction-focus", "command-compact-focus", "tool-result-pruner"]`，名称 = `["dsh-compact-focus", "dsh-compact-focus/command", "@deepseek-ai/dsh-compaction-tool-result-pruner"]` → 证明 bundle patch 已生效、插件从新路径加载。

> 注：该检查脚本是一次性的（临时目录已清理），重放方法：写一个 wrapper 用 `loadProfileDirectory` + `runProfile`（参考 `@deepseek-ai/dsh-desktop-host/lib/index.js` 的 main），用 `--port 0`，并通过 `--patch` 覆盖关掉需要 Electron 注入的 `desktop-product-telemetry`。

---

## 8. 已知限制与坑

1. **只覆盖 standard 预设**：`zcode-architect` 等自定义预设仍是官方 `/compact`。需要的话复制同样思路覆盖对应 `preset-<id>`。
2. **Tab 需先 `↓`**：客户端候选菜单默认无高亮；这是 DSH 客户端行为，插件无法改变。没有高亮时按 Tab 只是移走焦点。
3. **裸 `/compact` 两段式**：因为声明了 input，裸 token 回车先变 chip，再回车执行；带 focus 时一次回车即可。
4. **preset 快照脆弱**：DSH 升级改动 standard 预设后必须重生成 `cordis.patch.yml`（§6.3），否则可能丢掉新插件/引用不存在的包。
5. **只能引导摘要重点，不能指定压缩范围**：范围仍由官方 `compactNow` 选（最旧的平衡范围）；focus 也不改变固定输出结构。
6. **focus 一次性**：只作用于该次 `/compact`，不会持久化。
7. **不走插件管理器**：link + junction 手工安装；插件页的升级/卸载可能破坏或忽略它。升级/卸载请用本目录脚本。
8. **目录移动**：移走目录后必须重跑 `install.ps1`（junction 是绝对路径）。
9. **profile 备份文件**：profile 目录里有 `package.json.dsh-compact-focus*.bak`，属正常回滚材料。
10. **DSH 自动更新后 GUI 端口会变**（本次从 3598 → 4807），与插件无关。

---

## 9. 故障排查

| 现象 | 可能原因 / 处理 |
|---|---|
| 启动失败或提示插件加载失败 | 先 `uninstall.ps1` 重启恢复官方行为；再查 `%DSH_HOME%\logs` 下的 startup 诊断（仅失败时生成） |
| `/compact 重点…` 被当成普通消息发给模型 | 命令未注册（插件未加载）→ 确认已重启、junction 指向新路径、profile `bundles` 含 `dsh-compact-focus` |
| Tab 后直接开始压缩、没有 chip | 当前进程还是官方无参数命令 → 未加载插件或未重启 |
| 结果里没有“摘要重点：…” | 要么没输入 focus（默认路径），要么旧进程 |
| 有空摘要、summary 失败 | 模型路由/凭据问题，与本插件无关；命令会按官方错误码提示 |
| 想确认 focus 是否注入 | 启动 DSH 前设 `DSH_COMPACT_FOCUS_DEBUG=1`，看 stderr 的 `[dsh-compact-focus] injecting …` |
| DSH 升级后再也不生效 | 多半是 standard 预设快照过期 → 按 §6.3 重生成 |

快速检查安装状态：

```powershell
$p = Get-Content "$env:DSH_HOME\profiles\desktop\package.json" -Raw | ConvertFrom-Json
$p.dependencies.'dsh-compact-focus'                     # 应为 link:<repo 的绝对路径（正斜杠）>
$p.dsh.profile.bundles -contains 'dsh-compact-focus'    # 应为 True
(Get-Item "$env:DSH_HOME\profiles\desktop\node_modules\dsh-compact-focus").Target
```

---

## 10. 后续可做（非必须）

- **一键补全**：加客户端插件/decoration，让 Tab 直接进入“参数输入态”，省掉 `↓`。需要研究 `dsh-client-ui-input-trigger` 的 source 扩展点（当前客户端只开放 popup/action 贡献，未开放文本补全钩子）。
- **覆盖其他预设**：对 `zcode-architect` 等复制一份 `preset-<id>` 覆盖（同样整份 config）。
- **focus 模板可配置**：把 focus 指令措辞/语言做成插件 config 字段。
- **模型侧工具**：给模型一个 `compact_context(focus)` 工具（需自定义 schema，与命令路径协调；官方把“模型侧压缩工具”列为未决）。
- **接入插件管理器**：把包发布/安装为正式 bundle，用 `plugin_manager install_bundle` 管理，避免手工 junction。

---

## 11. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-17 | v0.1.0：实现 `FocusCompactionEngine` + 带 focus 的 `/compact`；bundle patch 覆盖 `preset-standard`；安装到 desktop profile；隔离环境端到端验证（rc.1） |
| 2026-10-17 | 修正 focus 指令措辞，避免指令泄漏进摘要；Tab 补全行为实测并写入文档 |
| 2026-10-17 | DSH 自动更新到 0.2.1-rc.2；核对 standard 预设与相关 API 未变，插件继续可用 |
| 2026-10-17 | 项目从旧目录移到当前仓库目录；重跑 install.ps1 更新 link/junction；真实 profile 隔离启动验证通过；补交接文档 |
| 2026-10-17 | 按 DSH 0.2.1-rc.2 官方插件规范补齐 locale/icon、`manifestVersion`、exports/files、license；移除无用常量；新增 `COMPLIANCE.md`；文档路径通用化；创建公开 GitHub 仓库并推送 |

---

## 12. 参考

- 官方压缩子系统参考：https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/compaction
- 官方 `dsh-command-compact`：https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/compaction/command-compact
- 官方 `dsh-compaction-basic`：https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/compaction/compaction-basic
- 官方 preset/组合编辑说明（安装包内 skill）：`@deepseek-ai/dsh-agent-preset/skills/editing-cordis-compositions/SKILL.md`
- DSH 安装路径：`%LOCALAPPDATA%\Programs\DeepSeek Harness`（`resources\app.asar` 为打包源码）
