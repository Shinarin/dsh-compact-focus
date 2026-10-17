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

/** Longest focus echoed back in a result; the staged focus itself is untouched. */
const MAX_FOCUS_ECHO_CHARS = 120

/** Clip a focus for display without changing what the summarizer receives. */
function echoFocus(focus) {
  return focus.length > MAX_FOCUS_ECHO_CHARS
    ? `${focus.slice(0, MAX_FOCUS_ECHO_CHARS - 1)}…`
    : focus
}

/** Echo the typed focus at the end of a failure result. */
function withFocus(text, echo) {
  return echo === undefined ? text : `${text}（本次摘要重点：${echo}）`
}

/** Backend diagnostics that carry no actionable detail of their own. */
const UNINFORMATIVE_SUMMARY_REASONS = new Set([
  'manual compaction could not produce a smaller summary',
])

/** One short, single-line cause string for a command result, if any. */
function describeCause(cause) {
  if (cause === undefined || cause === null) return undefined
  const message = typeof cause === 'string' ? cause : cause.message
  if (typeof message !== 'string') return undefined
  const line = message.split('\n')[0].trim()
  if (line.length === 0 || UNINFORMATIVE_SUMMARY_REASONS.has(line)) return undefined
  return line.length > 120 ? `${line.slice(0, 117)}…` : line
}

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
    case 'summary': {
      // Every summarizer failure carries the same generic message; the real
      // reason (LLM or gateway error, or a summary that is not smaller than the
      // shadowed history) lives in the cause or in the backend message.
      const reason = describeCause(error.cause) ?? describeCause(error.message)
      const suffix = reason === undefined ? '' : `（${reason}）`
      return {
        kind: 'error',
        text: `未能生成有用的摘要，本次未压缩${suffix}。尝试已记录在会话日志中。`,
      }
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
  const echo = directed ? echoFocus(focus) : undefined
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
      text: directed ? `${summary}摘要重点：${echo}` : summary,
      sourceEventSeq: result.summarySeq,
    }
  } catch (error) {
    if (invocation.signal.aborted) {
      return { kind: 'error', text: withFocus('压缩已取消。', echo) }
    }
    if (error instanceof ManualCompactionError) {
      const failure = expectedFailure(error)
      return { ...failure, text: withFocus(failure.text, echo) }
    }
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
