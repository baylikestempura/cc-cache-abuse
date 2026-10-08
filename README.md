# cc-cache-abuse

A Claude Code plugin that keeps your prompt cache warm.

- Forces the 1-hour cache TTL. If `FORCE_PROMPT_CACHING_5M` is set, it clears it.
- After 58 idle minutes, sends one small request that reads your cached context, then waits again. It stops after 12 pings in a row with no new message from you.
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

- Each ping is billed. It reads your whole context at cache-read rates and adds a few output tokens.
- If a ping finds the cache already cold, the plugin stops and says so. The 1-hour TTL may not apply to your plan or API key.
- The plugin API is early access and can change between Claude Code releases.
