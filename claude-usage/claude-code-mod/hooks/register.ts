// herdr-claude-usage: saves the 5-hour and weekly rate limits Claude Code
// measures to the file the Herdr desktop app's claude-usage card reads.

import type { Register } from 'claude-code'
import { merge } from './merge.ts'

export const register: Register = on => {
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') && e.rateLimits.length > 0) {
      try {
        const path =
          (await $.env.get('HERDR_CLAUDE_USAGE_FILE')) ??
          `${await $.env.get('HOME')}/.cache/herdr-claude-usage.json`
        const savedText = await $.fs.read(path).then(t => (typeof t === 'string' ? t : null), () => null)
        const file = merge(savedText, e.rateLimits, Math.floor((await $.clock.now()) / 1000))
        if (file) await $.fs.write(path, `${JSON.stringify(file)}\n`)
      } catch (err) {
        // Saving is best effort: the session's own measurement always goes on.
        $.ui.log(`${$.plugin.name}: could not save usage: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return next(e)
  })
}
