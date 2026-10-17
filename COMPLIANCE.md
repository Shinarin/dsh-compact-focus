# DSH 插件规范符合性审查

> 审查日期：2026-10-17
> 审查对象：`dsh-compact-focus` v0.1.0
> 审查基线：DeepSeek Harness desktop **0.2.1-rc.2**（Electron 44.7.0 运行时）
> 结论：**符合 DSH bundle/plugin 规范，无阻塞问题。**

审查中发现并修复了若干非阻塞的规范/展示缺口（locale、icon、`manifestVersion`、`definitionId`、打包清单、license 等），并移除了 1 处死代码。desktop profile 的 junction 安装是唯一有意保留的偏差，原因见 §3.8。

---

## 1. 审查依据

以安装包内随 DSH 0.2.1-rc.2 发布的官方文档和实现为准：

- `@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/SKILL.md`
  - `references/host-plugin.md`（bundle 清单、展示元数据、Host 导出形式、安装）
  - `references/practices.md`（状态、扩展点、性能）
  - `references/verification.md`（验证边界）
- `@deepseek-ai/dsh-agent-preset/skills/editing-cordis-compositions/SKILL.md`（preset 覆盖规则）
- `@deepseek-ai/dsh-package-manifest/README.md`（`dsh.*` 字段与 `engines.dsh`）
- `@deepseek-ai/dsh-plugin-manager/README.md`（bundle 校验、兼容性检查、安装流程）
- `@deepseek-ai/dsh-commands/README.md`（`ctx.commands.register` 契约）
- `@deepseek-ai/dsh-compaction-basic/lib/index.js`（`BasicCompactionEngine` / `summarize` / `compactNow`）
- `@deepseek-ai/dsh-command-compact/lib/index.js`（官方命令实现）
- `@deepseek-ai/dsh-compaction/lib/index.js`（`ManualCompactionError`）

---

## 2. 逐项检查

### 2.1 Bundle 清单

| 检查项 | 结果 |
|---|---|
| `package.json` 声明 `dsh.bundle.patch`，路径指向相对文件 | ✅ `./cordis.patch.yml` |
| `dsh.manifestVersion` | ✅ `1` |
| `engines.dsh` | ✅ `>=0.2.1-rc.1 <0.3.0-0` |
| `type: "module"`、`main`、`exports` | ✅ |
| `name`、`version`、`description` | ✅ |
| `license` / `repository` / `homepage` / `bugs` / `keywords` | ✅ |

### 2.2 Loader patch

| 检查项 | 结果 |
|---|---|
| 使用 Loader 的 YAML 方言（含 `!!js`） | ✅ |
| 按 row id 覆盖 `preset-standard` | ✅ |
| 覆盖时完整重述 `config`（Loader 不做深合并） | ✅ |
| 只替换 compaction 组的两项，其余插件保持原样 | ✅ |
| 快照与已安装的 `standard.patch.yml` 逐字节一致 | ✅ SHA-256 `0D398D2A…C2C68F5` |
| 生成器幂等 | ✅ 生成结果 SHA-256 `6553474A…4965FD` |

### 2.3 Host 插件导出形式

| 入口 | 形式 | 结果 |
|---|---|---|
| `dsh-compact-focus`（`lib/engine.js`） | 服务类默认导出，继承 `BasicCompactionEngine` | ✅ |
| 后端 `static inject` | `['llm', 'tokenMeter', 'sessions']`，与官方后端一致 | ✅ |
| `dsh-compact-focus/command`（`lib/command.js`） | `apply(ctx)` + `inject` + `ctx.effect` | ✅ |
| 命令 `inject` | `['commands', 'compaction']` | ✅ |
| 资源注册在 `ctx.effect` 内，返回 disposer | ✅ |

### 2.4 命令注册契约

| 检查项 | 结果 |
|---|---|
| `ctx.commands.register({ name, description, input, handler })` | ✅ |
| `input.hint` 为非空字符串（客户端据此把尾随文本作为参数） | ✅ |
| `definitionId`（插件命名空间的稳定标识） | ✅ `dsh-compact-focus/command` |
| 同名命令不重复注册 | ✅ patch 已移除官方 `command-compact` row |
| 错误码 / 结果形状与官方 `command-compact` 对齐 | ✅ 复用 `ManualCompactionError` 与 `command/done` |

### 2.5 展示元数据与打包

| 检查项 | 结果 |
|---|---|
| `locale/en.json` 的 `meta.title` / `meta.description` | ✅ |
| `locale/zh.json` 的 `meta.title` / `meta.description` | ✅ |
| `icon.svg`（SVG，≤ 256 KiB，无外部引用） | ✅ 419 bytes |
| `exports` 暴露 `./locale/*.json`、`./icon` | ✅ |
| 子路径插件 `dsh-compact-focus/command` 的元数据 | ✅ `./command/locale/*.json`、`./command/icon` |
| 顶层 `icon` | ✅ `./icon.svg` |
| `files` 包含运行时、patch、快照、locale、icon、文档 | ✅ |

### 2.6 版本兼容

官方兼容性检查（`dsh-app-boot` 的 `evaluatePluginCompatibility`）在 `semver.satisfies(..., { includePrerelease: true })` 下比较 `engines.dsh`：

- `0.2.1-rc.2` 满足 `>=0.2.1-rc.1 <0.3.0-0` ✅
- `engines.dsh` 存在时 peer 依赖不再作为运行时门禁；peer 列表仍用于解析/打包，且 `@deepseek-ai/dsh-commands`、`dsh-compaction`、`dsh-compaction-basic` 的 dsh peer 范围均满足 0.2.1-rc.2 ✅

### 2.7 状态、时间与副作用

| 检查项 | 结果 |
|---|---|
| 不新增 Session 事件类型 | ✅ 只使用官方 `compaction/*` 与 `command/*` 事件 |
| 不把 focus 持久化 | ✅ `WeakMap<Session, string>`，命令 `finally` 清理 |
| 自动压缩不受影响 | ✅ 只有显式 `/compact <focus>` 暂存 focus |
| 不覆盖压缩事务/锁/计价 | ✅ 全部继承官方后端 |
| 不使用 `setTimeout` 等待一致性 | ✅ |
| 不写 DOM、不导入 Client 包 | ✅ Host-only 后端 + 命令 |

### 2.8 安装流程（有意偏差）

官方推荐用 `plugin_manager` 的 `install_bundle` 安装 bundle。本项目的 desktop profile 由 Electron 应用独占管理，`dsh plugin --profile desktop ...` 会直接拒绝（`profile "desktop" is managed exclusively by the Electron application`），因此 `install.ps1` 采用：

1. `node_modules\dsh-compact-focus` junction；
2. profile `package.json` 的 `link:` 依赖；
3. `dsh.profile.bundles` 追加 bundle。

这是**平台限制下的已知例外**，不是包结构违规；非 desktop profile 可以改用官方 `install_bundle`。`install.ps1` 是幂等的，并在写入前备份 profile `package.json`。

---

## 3. 本次审查修正

- 新增 `locale/en.json`、`locale/zh.json`、`icon.svg`；
- `package.json`：补 `dsh.manifestVersion`、`icon`、`license`、`author`、`repository`、`homepage`、`bugs`、`keywords`、`scripts.check`，补 locale/icon/patch 的 exports 与 `files`，收紧 `engines.dsh`，新增 `@deepseek-ai/dsh-commands` peer；
- `lib/command.js`：补 `definitionId`，移除未使用的 `USAGE` 常量及其导出，补 `clearFocus` 能力检查；
- 新增 `LICENSE`（MIT）、`.gitignore`、本文件；
- README/HANDOVER 中的本机绝对路径替换为 `<repo>`、`%DSH_HOME%`、`%LOCALAPPDATA%` 等通用写法。

---

## 4. 验证记录

| 验证 | 结果 |
|---|---|
| `npm run check`（`node --check` 全部入口） | ✅ exit 0 |
| `package.json` / locale JSON 解析 | ✅ |
| icon SVG 根元素/闭合/无 script、大小 | ✅ 419 bytes |
| 所有 `exports` 子路径通过 Node ESM 自引用解析 | ✅ 10/10 |
| `tools/gen-focus-patch.mjs` 重新生成并比对 | ✅ 逐字节一致 |
| 快照与安装包 `standard.patch.yml` 比对 | ✅ SHA-256 一致 |
| 官方兼容性范围（0.2.1-rc.2） | ✅ |
| 隔离 `DSH_HOME` + `--dump-config` 组合 | ✅ exit 0，1231 行，`patched by dsh-compact-focus`，compaction 组为 `compaction-focus` / `command-compact-focus`，无错误行 |
| 宿主同款导入验证（`internal.import`，两个入口） | ✅ 修复 peer 解析后两行 `ok`；修复前两行 `ERR_MODULE_NOT_FOUND` |

验证边界：

- `--dump-config` 证明**组合成功**（bundle patch 被正确应用、两个 row 进入 `preset-standard`），不证明插件激活后的运行时行为；
- 本次没有重启用户正在运行的 DSH desktop，因此没有在 GUI 中重新做 `/compact` 端到端与插件页图标渲染复核。运行时行为和 focus 注入效果已在 [HANDOVER.md](HANDOVER.md) §7 的隔离 GUI 测试中验证（rc.1 实测；rc.2 核对了 standard 预设与相关 API 未变）；本次改动不改变无 focus 的默认路径，也不改变摘要注入逻辑；
- 图标按官方读取逻辑（SVG、≤256 KiB、包内相对路径、导出 `./icon`）校验，实际像素渲染以插件页为准。
- `--dump-config` **不导入插件代码**，因此不能证明插件可加载：`link:` 安装还要求仓库自身能解析宿主提供的 `@deepseek-ai/*`。这一层由 `npm run check:install`（与宿主相同的 `internal.import` 路径）覆盖，`install.ps1` 也会在安装末尾强制跑一次。

---

## 5. 参考

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [压缩子系统参考](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/compaction)
- 官方 `dsh-command-compact`：<https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/compaction/command-compact>
- 官方 `dsh-compaction-basic`：<https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/compaction/compaction-basic>
