# cc-cache-abuse

**Saves you 20–80× on the cache re-write you'd pay after an idle hour.**

A Claude Code plugin that keeps your prompt cache warm. While you're away, it sends a tiny ping that reads your cached context, so your next message is a cheap cache read instead of a full re-write.

## The math

A ping is a cache read. A cold re-read is a 1-hour cache write, which costs 2× base input. Reads are much cheaper than writes, so each ping costs a fraction of the re-write it prevents:

| Model | Ping (cache read) | Cold re-read (1h write) | Cold ÷ ping |
|---|---|---|---|
| Haiku 5.5 | $0.001 | $0.02 | 20× |
| Sonnet 5.5 | $0.01 | $0.40 | 40× |
| Opus 5.5 | $0.02 | $0.80 | 40× |
| Fable 5.1 | $0.025 | $2.00 | 80× |

Based on a 100,000-token context. Costs scale linearly with context size. Prices from Anthropic's pricing page, as of 2026-10-08.

## How it works

- Forces the 1-hour cache TTL. If `FORCE_PROMPT_CACHING_5M` is set, it clears it.
- After 58 idle minutes, sends one small request that reads your cached context, then waits again.
- Stops after 12 pings in a row with no new message from you, about 12 hours of idle time.
- Shows "Caught your cache!" as a toast and as a line in the chat log.

## Commands

- `/cache-stats`: lifetime catches, misses, and tokens kept warm.
- `/cache-test`: previews the notification. It does not touch the stats.

## Install

```
/plugin install cc-cache-abuse --marketplace baylikestempura/cc-cache-abuse
```

To try it without installing, clone the repo and run `claude --plugin-dir <path-to-clone>`.

## Heads up

- If you never come back, the pings are wasted. At 100,000 tokens, that's $0.012 on Haiku, $0.12 on Sonnet, $0.24 on Opus, or $0.30 on Fable.
- If the 1-hour TTL isn't in effect on your plan or API key, the first ping finds a lapsed cache and pays one extra write, then the plugin stops. At 100,000 tokens on Sonnet, that's $0.25.
- Switching models with `/model` rewrites the whole prefix at full write price. A ping can't prevent that.
- The plugin API is early access and can change between Claude Code releases.
