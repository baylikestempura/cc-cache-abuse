import { test, expect, mock } from 'claude-code/testing'

const MINUTE = 60_000
const warm = { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 0 }
const cold = { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 90_000 }

const setup = ($: any, on: any, usage: typeof warm) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 8) })
  mock.env(on, { FORCE_PROMPT_CACHING_5M: '1' })
  mock.store(on)
  const sets: Array<[string, string | undefined]> = []
  const notes: string[] = []
  const logs: string[] = []
  let forks = 0
  on('env.set', (_$: any, e: any) => { sets.push([e.name, e.value]); return { value: e.value } })
  on('session.start', () => ({ cwd: '/' }))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.log', (_$: any, e: any) => { if (e.to !== 'debug') logs.push(e.text); return { value: undefined } })
  on('ui.toast', (_$: any, e: any) => { notes.push(e.text); return { value: undefined } })
  on('ui.status', () => ({ value: undefined }))
  on('model.fork', () => { forks += 1; return { value: { isAnswered: true, text: '.', usage } } })
  return { clock, sets, notes, logs, forks: () => forks }
}

const done = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't0', reason: 'answer' } as const
const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

test('forces the 1h TTL and clears the 5m pin', async ($, on) => {
  const { sets } = setup($, on, warm)
  await start($)
  expect(sets).toContainEqual(['FORCE_PROMPT_CACHING_5M', undefined])
  expect(sets).toContainEqual(['ENABLE_PROMPT_CACHING_1H', '1'])
})

test('pings once after 58 idle minutes, and a new turn resets the clock', async ($, on) => {
  const { clock, forks } = setup($, on, warm)
  await start($)
  await $.turn.complete(done)
  await clock.advance(57 * MINUTE)
  expect(forks()).toBe(0)
  await clock.advance(2 * MINUTE)
  expect(forks()).toBe(1)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(120 * MINUTE)
  expect(forks()).toBe(1)
})

test('toasts and logs "Caught your cache!" on a warm ping', async ($, on) => {
  const { clock, notes, logs } = setup($, on, warm)
  await start($)
  await $.turn.complete(done)
  await clock.advance(58 * MINUTE)
  await clock.settle()
  expect(notes).toEqual(['Caught your cache!'])
  expect(logs).toHaveLength(1)
  expect(logs[0]).toContain('Caught your cache! Ping 1/12: 90,000 tokens kept warm')
})

test('stops pinging and says so when the cache came back cold', async ($, on) => {
  const { clock, forks, notes, logs } = setup($, on, cold)
  await start($)
  await $.turn.complete(done)
  await clock.advance(58 * MINUTE)
  await clock.advance(200 * MINUTE)
  await clock.settle()
  expect(forks()).toBe(1)
  expect(notes).toEqual(['Cache already cold, giving up'])
  expect(logs[0]).toContain('Missed your cache')
})

test('/cache-stats reports the lifetime catches', async ($, on) => {
  const { clock } = setup($, on, warm)
  await start($)
  await $.turn.complete(done)
  await clock.advance(58 * MINUTE)
  const out = await $.command.run({ command: 'cache-stats', args: '' })
  expect(out.text).toContain('caught:       1 (100% of 1 pings)')
  expect(out.text).toContain('kept warm:    90,000 tokens')
})

test('/cache-test previews the catch without touching the stats', async ($, on) => {
  const { notes, logs } = setup($, on, warm)
  await start($)
  await $.command.run({ command: 'cache-test', args: '' })
  expect(notes).toEqual(['Caught your cache!'])
  expect(logs[0]).toContain('(demo) Caught your cache!')
  const out = await $.command.run({ command: 'cache-stats', args: '' })
  expect(out.text).toContain('caught:       0')
})
