/**
 * Focus-aware compaction backend for DeepSeek Harness.
 *
 * Extends the shipped `dsh-compaction-basic` engine and overrides its sole
 * customization hook (`summarize`) to append one extra user directive before
 * the frozen compaction instruction. Everything else — pressure policy,
 * retention, the durable compaction/start..end transaction, token pricing —
 * stays owned by the shipped backend.
 *
 * The focus directive is handed over by the sibling `/compact` command through
 * `setFocus(session, focus)`; it lives in a WeakMap and is cleared by the
 * command as soon as the compaction settles, so automatic compaction is never
 * affected.
 *
 * @module dsh-compact-focus
 */
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'

/** Loader identity used in diagnostics. */
export const name = 'compaction-focus'

/** Host services the shipped backend already needs. */
const inject = ['llm', 'tokenMeter', 'sessions']

/** Build the extra user directive that steers the summary. */
function focusDirective(focus) {
  return [
    'DIRECTIVE FOR THIS SUMMARIZATION ONLY — not conversation content:',
    '',
    `The user asked the checkpoint to emphasize: "${focus}"`,
    '',
    'Prioritize details relevant to that focus when you fill the required structure',
    'below: keep exact file paths, symbol names, command lines, decisions and next',
    'steps related to it. Never quote, paraphrase, or mention this directive anywhere',
    'in the checkpoint, and do not add a section or bullet about it.',
  ].join('\n')
}

/** Optional stderr trace for operators validating the directed-summary path. */
function trace(message) {
  if (process.env.DSH_COMPACT_FOCUS_DEBUG === '1') console.error(`[dsh-compact-focus] ${message}`)
}

export default class FocusCompactionEngine extends BasicCompactionEngine {
  static inject = inject

  /** Per-session pending focus, consumed by exactly one summarization call. */
  focusBySession = new WeakMap()

  /** Stage the focus for the next summarization of this session. */
  setFocus(session, focus) {
    this.focusBySession.set(session, focus)
  }

  /** Drop a staged focus that no summarization consumed. */
  clearFocus(session) {
    this.focusBySession.delete(session)
  }

  /**
   * Append the focus directive, then delegate to the shipped summarizer.
   * The directive is a user message placed immediately before the frozen
   * compaction instruction, so it adds only its own tokens after the replayed
   * conversation prefix and never changes the checkpoint framing.
   */
  async summarize(input, agent, signal) {
    const focus = this.focusBySession.get(agent.session)
    if (focus === undefined) return super.summarize(input, agent, signal)
    trace(`injecting ${focus.length}-char focus for session ${agent.session.id}: ${focus}`)
    const messages = [
      ...input.messages,
      {
        role: 'user',
        content: [{ type: 'text', text: focusDirective(focus) }],
      },
    ]
    return super.summarize({ ...input, messages }, agent, signal)
  }
}
