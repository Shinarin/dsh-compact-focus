/**
 * Focus-aware compaction backend for DeepSeek Harness.
 *
 * Extends the shipped `dsh-compaction-basic` engine and overrides its sole
 * customization hook (`summarize`) for two things: append one extra user
 * directive before the frozen compaction instruction, and summarize with the
 * model the user currently has selected for that conversation. Everything else
 * — pressure policy, retention, the durable compaction/start..end transaction,
 * token pricing — stays owned by the shipped backend.
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

/**
 * Model route the user selected for this conversation.
 *
 * The shipped summarizer prefers the session's last *routed* model
 * (`session.requestHeader().config`), which is stale after a model switch and
 * can be very stale for a resumed session — it then summarizes through a
 * provider the user no longer uses. The selection the user made is recorded on
 * the session log as `model/selection`; the newest one is the current choice.
 *
 * Read-only: the session log owns the events, this plugin only reads them.
 */
function latestModelSelection(session) {
  let events
  try {
    events = session.snapshotEvents()
  } catch {
    return undefined
  }
  if (!Array.isArray(events)) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'model/selection') continue
    const provider = event.data?.provider
    const model = event.data?.model
    if (typeof provider !== 'string' || provider.length === 0) continue
    if (typeof model !== 'string' || model.length === 0) continue
    return { provider, model }
  }
  return undefined
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
   * Route to summarize through, or `undefined` to keep the shipped choice.
   * An explicitly configured `summarizationProvider` stays authoritative; it is
   * the documented way to pin a summarizer.
   */
  summarizationRoute(session) {
    const pinned = this.config.summarizationProvider
    if (typeof pinned === 'string' && pinned.length > 0) return undefined
    return latestModelSelection(session)
  }

  /**
   * Append the focus directive when one is staged, then delegate to the
   * shipped summarizer with the content of the summary request unchanged.
   * The directive is a user message placed immediately before the frozen
   * compaction instruction, so it adds only its own tokens after the replayed
   * conversation prefix and never changes the checkpoint framing.
   */
  async summarize(input, agent, signal) {
    const focus = this.focusBySession.get(agent.session)
    let payload = input
    if (focus !== undefined) {
      trace(`injecting ${focus.length}-char focus for session ${agent.session.id}: ${focus}`)
      payload = {
        ...input,
        messages: [
          ...input.messages,
          {
            role: 'user',
            content: [{ type: 'text', text: focusDirective(focus) }],
          },
        ],
      }
    }
    const route = this.summarizationRoute(agent.session)
    if (route === undefined) return super.summarize(payload, agent, signal)
    trace(`summarizing with selected model ${route.provider}/${route.model}`)
    // One engine instance serves every session of this preset generation, so a
    // temporary `this.config` swap could interleave with another session's
    // compaction mid-flight. Delegate through a per-call view instead: it owns
    // the merged config, inherits the rest from the live engine, and is
    // discarded when the call settles.
    const view = Object.create(this)
    view.config = {
      ...this.config,
      summarizationProvider: route.provider,
      summarizationModel: route.model,
    }
    return BasicCompactionEngine.prototype.summarize.call(view, payload, agent, signal)
  }
}
