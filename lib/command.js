/**
 * `/compact` command with an optional directed-summary focus.
 *
 *   /compact                         — same as the shipped command
 *   /compact 重点总结项目框架        — compacts older history and tells the
 *                                     summarizer to keep that focus prominent
 *
 * The command stays backend-independent: it asks `ctx.compaction` (whatever
 * backend the composition mounted) to compact now, and only stages a focus when
 * that backend exposes the focus hook from `dsh-compact-focus`.
 *
 * @module dsh-compact-focus/command
 */
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'

/** Loader identity used in diagnostics. */
export const name = 'command-compact-focus'

/** Host services: the command registry and the mounted compaction backend. */
export const inject = ['commands', 'compaction']

/** Upper bound for one focus directive; keeps the auxiliary request small. */
const MAX_FOCUS_CHARS = 4000

/** Convert one expected backend failure into a direct command result. */
function expectedFailure(error) {
  switch (error.code) {
    case 'busy':
      return {
        kind: 'error',
        text: '当前无法压缩：已有压缩在进行，或 Agent 不在空闲状态。',
      }
    case 'cancelled':
      return { kind: 'error', text: '压缩已取消。' }
    case 'changed':
      return {
        kind: 'error',
        text: '被选中的历史在替换前发生了变化，本次未压缩。尝试已记录在会话日志中。',
      }
    case 'summary':
      return {
        kind: 'error',
        text: '未能生成有用的摘要，本次未压缩。尝试已记录在会话日志中。',
      }
    case 'commit':
      return {
        kind: 'error',
        text: '压缩未干净完成，部分会话历史可能已改变。请先检查当前会话状态再重试。',
      }
    case 'persistence':
      return {
        kind: 'error',
        text: '压缩已完成，但会话保存失败。',
      }
    default:
      return { kind: 'error', text: `压缩失败：${String(error.code)}` }
  }
}

/** Execute one `/compact [focus]` invocation. */
async function execute(ctx, invocation) {
  const focus = invocation.rawInput.trim()
  if (focus.length > MAX_FOCUS_CHARS) {
    return {
      kind: 'error',
      text: `摘要重点过长（最多 ${MAX_FOCUS_CHARS} 个字符）。`,
    }
  }
  const directed = focus.length > 0
  if (
    directed &&
    (typeof ctx.compaction.setFocus !== 'function' ||
      typeof ctx.compaction.clearFocus !== 'function')
  ) {
    return {
      kind: 'error',
      text: '当前压缩后端不支持摘要重点参数；去掉参数后可直接压缩。',
    }
  }
  if (directed) ctx.compaction.setFocus(invocation.agent.session, focus)
  try {
    const result = await ctx.compaction.compactNow(
      invocation.agent,
      invocation.signal,
      invocation.commandId,
    )
    if (result === null) {
      return { kind: 'success', text: '暂无可压缩的历史。' }
    }
    const summary = `已压缩 ${result.shadowedSeqs.length} 条历史记录（约 ${result.shadowedTokenCount} tokens）。`
    return {
      kind: 'success',
      text: directed ? `${summary}摘要重点：${focus}` : summary,
      sourceEventSeq: result.summarySeq,
    }
  } catch (error) {
    if (invocation.signal.aborted) return { kind: 'error', text: '压缩已取消。' }
    if (error instanceof ManualCompactionError) return expectedFailure(error)
    throw error
  } finally {
    if (directed) ctx.compaction.clearFocus(invocation.agent.session)
  }
}

/**
 * Register `/compact`. A second registration of the same name in this scope
 * fails at load, which is intended: the shipped `command-compact` row must be
 * replaced by this package (see the bundle patch).
 */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.commands.register({
        // Plugin-namespaced identity for adapters; independent of the display
        // name and of the per-execution commandId.
        definitionId: CommandDefinitionId('dsh-compact-focus/command'),
        name: 'compact',
        description: '压缩较早对话历史；可附带摘要重点，如 /compact 重点总结项目框架',
        // Declaring input makes trailing text an argument instead of a model
        // prompt (the client dispatches a no-input command only on its bare
        // token). The hint is what the composer shows after the command chip.
        input: { hint: '可选的摘要重点，例如：重点总结项目框架' },
        handler: (invocation) => execute(ctx, invocation),
      }),
    'command-compact-focus lifecycle',
  )
}
