import type { EngineInterface, ModelUsage, Register } from 'claude-code'

// A cache entry lives 60 minutes from the start of the request that last read it.
// 58 leaves room for a slow final generation before the timer starts.
const KEEP_ALIVE_MS = 58 * 60_000
// Idle pings per quiet stretch; 12 is about half a day. Each is a cache read of the whole context.
const MAX_PINGS = 12
const PING_PROMPT = 'Cache keep-alive. Reply with a single "." and nothing else.'
const STATS_KEY = 'stats'

type Stats = {
  caught: number
  lost: number
  tokensKept: number
  pingBilledTokens: number
  since: number
}

// Survives nothing: a hot reload starts it over.
const session = { caught: 0 }

const fmt = (n: number) => n.toLocaleString('en-US')

async function readStats($: EngineInterface, now: number): Promise<Stats> {
  const saved = (await $.store.get(STATS_KEY)) as Partial<Stats> | undefined
  return { caught: 0, lost: 0, tokensKept: 0, pingBilledTokens: 0, since: now, ...saved }
}

// Counts a ping in the lifetime stats and says so in the chat log.
async function announce($: EngineInterface, usage: ModelUsage, isCaught: boolean, ping: number, isDemo = false) {
  const now = await $.clock.now()
  const stats = await readStats($, now)
  const kept = usage.cache_read_input_tokens
  if (isDemo) {
    // A preview of the notification: leaves the stats alone.
  } else if (isCaught) {
    stats.caught += 1
    stats.tokensKept += kept
    // What the ping itself cost beyond a cache read.
    stats.pingBilledTokens += usage.input_tokens + usage.output_tokens + usage.cache_creation_input_tokens
    session.caught += 1
  } else {
    stats.lost += 1
  }
  if (!isDemo) await $.store.set(STATS_KEY, stats)

  const text = isCaught
    ? `Caught your cache! Ping ${ping}/${MAX_PINGS}: ${fmt(kept)} tokens kept warm (${fmt(stats.caught)} catches all-time).`
    : `Missed your cache. It had already lapsed on ping ${ping}, so I stopped. The 1h TTL may not be in effect.`
  // A dim row in the chat log: stays in the scrollback, never sent to the model.
  $.ui.log(isDemo ? `(demo) ${text}` : text)
  $.ui.toast(isCaught ? 'Caught your cache!' : 'Cache already cold, giving up')
  if (!isDemo) $.ui.status(session.caught > 0 ? `cache caught x${session.caught}` : undefined)
}

export const register: Register = on => {
  let timer: { cancel: () => void } | undefined
  let pings = 0
  let isCachingOff = false

  const disarm = () => {
    timer?.cancel()
    timer = undefined
  }

  on('session.start', async ($, e, next) => {
    // 1. Force the 1-hour TTL, undoing a 5-minute pin if one is set.
    if ((await $.env.get('FORCE_PROMPT_CACHING_5M')) !== undefined) {
      await $.env.set('FORCE_PROMPT_CACHING_5M', undefined)
      $.ui.log(`${$.plugin.name}: removed FORCE_PROMPT_CACHING_5M`, { to: 'debug' })
    }
    await $.env.set('ENABLE_PROMPT_CACHING_1H', '1')
    isCachingOff = (await $.env.get('DISABLE_PROMPT_CACHING')) !== undefined
    if (isCachingOff) $.ui.toast(`${$.plugin.name}: DISABLE_PROMPT_CACHING is set, nothing to keep warm`)

    await $.command.register({ name: 'cache-stats', description: 'Lifetime cache keep-alive stats' })
    await $.command.register({ name: 'cache-test', description: 'Preview the "Caught your cache!" notification' })
    return next(e)
  })

  on('command.run', { command: 'cache-stats' }, async $ => {
    const s = await readStats($, await $.clock.now())
    const since = new Date(s.since).toISOString().slice(0, 10)
    const tries = s.caught + s.lost
    const rate = tries > 0 ? Math.round((s.caught / tries) * 100) : 0
    return {
      text: [
        `Cache keep-alive since ${since}`,
        `  caught:       ${fmt(s.caught)} (${rate}% of ${fmt(tries)} pings)`,
        `  missed:       ${fmt(s.lost)}`,
        `  kept warm:    ${fmt(s.tokensKept)} tokens`,
        `  ping cost:    ${fmt(s.pingBilledTokens)} tokens billed above cache-read rate`,
        `  this session: ${fmt(session.caught)} caught, ${pings}/${MAX_PINGS} pings in the current idle stretch`,
      ].join('\n'),
    }
  })

  on('command.run', { command: 'cache-test' }, async $ => {
    const usage = { input_tokens: 12, output_tokens: 1, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 0 }
    await announce($, usage, true, 1, true)
    return { text: 'Fired a demo catch.' }
  })

  // A running turn reads the cache itself.
  on('turn.start', ($, e, next) => {
    disarm()
    pings = 0
    return next(e)
  })

  // 2. Once the turn ends, start the idle clock.
  on('turn.complete', ($, e, next) => {
    // A subagent finishing says nothing about the main thread's idleness.
    if (isCachingOff || e.agentId !== undefined) return next(e)

    const arm = () => {
      disarm()
      timer = $.clock.after(KEEP_ALIVE_MS, async () => {
        try {
          const r = await $.model.fork({ prompt: PING_PROMPT })
          if (!r.isAnswered) {
            $.ui.log(`${$.plugin.name}: keep-alive stopped (${r.reason})`, { to: 'debug' })
            return
          }
          pings += 1
          const { cache_read_input_tokens: read, cache_creation_input_tokens: wrote, input_tokens: fresh } = r.usage
          const total = read + wrote + fresh
          if (total > 0 && read / total < 0.5) {
            // The entry had lapsed: the 1-hour TTL is not in effect, so stop paying to rebuild it.
            await announce($, r.usage, false, pings)
            return
          }
          await announce($, r.usage, true, pings)
          if (pings < MAX_PINGS) arm()
        } catch (err) {
          $.ui.log(`${$.plugin.name}: keep-alive failed: ${String(err)}`, { to: 'debug' })
        }
      })
    }
    arm()
    return next(e)
  })
}
