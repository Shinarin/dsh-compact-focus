# dsh-compact-focus

给 DeepSeek Harness 的 `/compact` 加上“摘要重点”：压缩较早历史时，告诉摘要器这次要重点保留什么。

> 交接/维护文档：[HANDOVER.md](HANDOVER.md)（实现原理、安装/升级 Runbook、验证记录、已知坑、故障排查）。
> 规范审查记录：[COMPLIANCE.md](COMPLIANCE.md)。
> 仓库目录：本目录（**移动目录后必须重跑 `install.ps1`**，否则 profile 里的 junction 仍指向旧路径）。

```text
/compact                             → 和内置命令一样，压缩较早历史
/compact 重点总结项目框架             → 压缩较早历史，并让摘要优先保留“项目框架”相关内容
/compact 重点保留部署与数据库相关决策  → 同上，摘要重点换成部署与数据库
```

## 它是怎么工作的

DSH 的压缩（compaction）会把“会话表面上的一段较早历史”替换成一条摘要，内置 `/compact` 不接受参数，摘要指令也是固定的。本插件替换 `preset-standard` 里 compaction 组的两项：

| 内置 | 替换为 | 说明 |
|---|---|---|
| `@deepseek-ai/dsh-compaction-basic` | `dsh-compact-focus`（后端） | 继承官方后端，只覆盖 `summarize()`：有重点时在摘要请求末尾追加一条 focus 指令 |
| `@deepseek-ai/dsh-command-compact` | `dsh-compact-focus/command`（命令） | 注册同名 `/compact`，可带可选重点 |

其余行为完全沿用官方实现：自动压缩、阈值、保留近期尾部、`compaction/start`→`compaction/summary`→`compaction/end` 事务、token 计价、错误码都不变。focus 只对“由本次命令触发的那一次摘要”生效，自动压缩永远不受影响。

摘要的固定 Markdown 结构不变；focus 只影响结构内的重点取舍，不会新增章节。命令结果会把重点写进 `command/done`（会话日志可查，例如 `已压缩 8 条历史记录（约 752 tokens）。摘要重点：重点总结项目框架`）。

## 使用方式

前提：当前会话使用 **standard** 预设（本插件只覆盖 `preset-standard`；其他预设仍是内置行为）。

- **直接输入**：在输入框输入 `/compact 重点总结项目框架`，回车执行。
- **Tab 补全**：输入 `/com` → 候选菜单出现 `compact` → 按 `↓` 选中它 → 按 `Tab` 补全为 `/compact `（指令 chip，自带尾随空格）→ 输入重点（如 `重点总结项目框架`）→ 回车执行。
  - 注意：DSH 的候选菜单默认不预先高亮，必须先按 `↓` 选中候选项，`Tab` 才会补全；没有高亮时 `Tab` 会离开输入框。
  - 补全后**不输入任何内容直接回车**（或点发送）＝无参数 `/compact`：按内置默认规则压缩，不注入摘要重点，与装插件前的行为一致。
- **菜单**：点输入框的 `+` →「指令」→「compact」，输入重点后回车；或只输入 `/compact` 回车（会先变成指令 chip），再回车执行普通压缩。
- 命令只在 agent 空闲、没有进行中的压缩时可用；压缩期间发送的消息会排队，压缩结束后才开始。

## 安装

需要 Node/DSH desktop 0.2.1-rc.x（`engines.dsh` 声明为 `>=0.2.1-rc.1 <0.3.0-0`）。

```powershell
git clone https://github.com/Shinarin/dsh-compact-focus.git
cd dsh-compact-focus
pwsh -File .\install.ps1
```

> DSH 的 desktop profile 由 Electron 应用独占管理，`dsh plugin` 会拒绝该 profile，
> 所以本仓库用 `install.ps1` 建 junction；其他 profile 可优先使用官方的
> `plugin_manager` `install_bundle`。

脚本做四件事（可重复执行）：

1. 在仓库内建 `node_modules\@deepseek-ai` junction → `%DSH_HOME%\profiles\node_modules\@deepseek-ai`；
2. 在 `%DSH_HOME%\profiles\desktop\node_modules\dsh-compact-focus` 建一个指向本目录的 junction；
3. 在 profile 的 `package.json` 里加入 `"dsh-compact-focus": "link:<本目录>"` 依赖；
4. 把 `dsh-compact-focus` 追加到 `dsh.profile.bundles`，让本包的 `cordis.patch.yml` 生效。

最后用宿主同款导入方式自检两个入口，失败会直接报错。

> 第 1 步不是多余的：`link:` 安装时 Node 从本仓库的**物理路径**解析插件的 `@deepseek-ai/*` 依赖。缺了这层，两个入口都会 `ERR_MODULE_NOT_FOUND`，而 DSH 会静默跳过整个 bundle —— 表现为“装好后毫无反应、也没有报错”。

然后**完全退出并重新启动 DSH desktop**。重启后新建会话，输入 `/compact 重点…` 即可。

确认安装是否真的可加载：

```powershell
npm run check:install    # 两行 ok 才算装好
```

## 卸载

```powershell
pwsh -File .\uninstall.ps1
```

移除 bundle 条目、依赖和 junction，重启 DSH 后恢复内置 `/compact`。

## 调试

```powershell
$env:DSH_COMPACT_FOCUS_DEBUG = '1'   # 在启动 DSH 的环境中设置
```

摘要请求注入 focus 时，Host 的 stderr 会打印一行 `[dsh-compact-focus] injecting …`。

## 已知限制

- 只覆盖 `preset-standard`；`zcode-architect` 等自定义预设仍是内置 `/compact`。
- 摘要结构固定，focus 只能影响结构内的重点取舍，不能改变输出 schema，也不能指定“压哪一段历史”（压缩范围仍由官方策略选）。
- 每次 `/compact` 的 focus 只作用于该次摘要；不会持久化为以后每次压缩的默认值。
- 压缩不缩小系统提示词、工具定义和 session 前缀；单个不可分的大单元仍可能压不动。
- 摘要本身仍是一次额外的模型调用；focus 指令只增加几十个 token。
- 安装依赖仓库内的 `node_modules\@deepseek-ai` 软链来解析宿主依赖；删掉它插件会整体加载失败，重跑 `install.ps1` 即可修复。

## DSH 插件规范符合性

本包按 DSH 0.2.1-rc.2 的 bundle/plugin 规范组织，完整审查记录见 [COMPLIANCE.md](COMPLIANCE.md)。要点：

- `package.json` 声明 `dsh.bundle.patch`、`dsh.manifestVersion`、`engines.dsh`，并导出运行时入口、locale 与 icon；
- `cordis.patch.yml` 使用 Loader 的 row override 语法，覆盖整份 `preset-standard` config（Loader 的 override 不做深合并）；
- 后端是服务类默认导出（`FocusCompactionEngine extends BasicCompactionEngine`），命令是 `apply(ctx)` + `inject` + `ctx.effect`；
- `locale/en.json`、`locale/zh.json` 与 `icon.svg` 提供插件页显示信息；
- desktop profile 的安装方式见上文说明（app-managed profile 的已知例外）。

## 升级注意

`cordis.patch.yml` 里的 `preset-standard` 插件列表是生成快照（生成时基于 `@deepseek-ai/dsh-web-app` 0.2.1-rc.1；已在 0.2.1-rc.2 上核对标准预设未变）。DSH 大版本升级后若标准预设增加/改名了插件，需要重新生成：

```powershell
# 在插件目录内执行：
# 1. 从安装包导出当前 standard.patch.yml（app.asar 内）
node tools/asar.mjs "<安装目录>\resources\app.asar" cat "dsh/node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml" > standard-preset.source.yml
# 2. 重新生成 cordis.patch.yml
node tools/gen-focus-patch.mjs standard-preset.source.yml cordis.patch.yml
```

升级导致插件加载失败时，先卸载本插件即可恢复内置行为。
