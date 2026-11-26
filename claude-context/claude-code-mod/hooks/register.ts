// herdr-claude-context: saves this session's model, context window and cost to
// a file named after its Herdr terminal ($HC_TERMINAL_ID), which the Herdr
// desktop app's claude-context bar reads for the focused pane.
//
// The file: { updated_at: epoch s, session_id, model,
//             context: { tokens, window, percent }, cost_usd, ended }

import type { EngineInterface as Engine, Register, SessionContextUsage, SessionCost } from 'claude-code'

type Figures = {
  session_id: string
  model: string
  context: { tokens: number | null; window: number; percent: number | null }
  cost_usd: number | null
  ended: boolean
}

// What this session last wrote, so unchanged figures aren't written again.
type Saved = { figures: Figures | null; text: string | null }

async function figuresOf($: Engine, context: SessionContextUsage, cost: SessionCost | undefined): Promise<Figures> {
  return {
    session_id: await $.session.id(),
    model: await $.session.model(),
    context: { tokens: context.tokens ?? null, window: context.window, percent: context.percent ?? null },
    cost_usd: cost?.usd ?? null,
    ended: false,
  }
}

async function current($: Engine): Promise<Figures> {
  const usage = await $.session.usage()
  return figuresOf($, usage.context, usage.cost)
}

async function save($: Engine, saved: Saved, figures: Figures) {
  const id = await $.env.get('HC_TERMINAL_ID')
  if (!id) return // not running inside Herdr
  const text = JSON.stringify(figures)
  if (text === saved.text) return
  const dir = (await $.env.get('HERDR_CLAUDE_CONTEXT_DIR')) ?? `${await $.env.get('HOME')}/.cache/herdr-claude-context`
  const updated_at = Math.floor((await $.clock.now()) / 1000)
  await $.fs.write(`${dir}/${id}.json`, `${JSON.stringify({ updated_at, ...figures })}\n`)
  saved.figures = figures
  saved.text = text
}

// Saving is best effort: a failure is logged and the session goes on.
function logFailure($: Engine, err: unknown) {
  $.ui.log(`${$.plugin.name}: could not save context: ${err instanceof Error ? err.message : String(err)}`)
}

export const register: Register = on => {
  const saved: Saved = { figures: null, text: null }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      await save($, saved, await current($))
    } catch (err) {
      logFailure($, err)
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    try {
      await save($, saved, await figuresOf($, e.context, e.cost))
    } catch (err) {
      logFailure($, err)
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    try {
      const figures = saved.figures ?? (await current($))
      // /clear: the process goes on with an empty conversation, so the figures start over.
      const after =
        e.reason === 'clear'
          ? { ...figures, context: { ...figures.context, tokens: null, percent: null }, cost_usd: null }
          : { ...figures, ended: true }
      await save($, saved, after)
    } catch (err) {
      logFailure($, err)
    }
    return next(e)
  })
}
