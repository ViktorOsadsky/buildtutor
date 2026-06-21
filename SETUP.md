# buildtutor-mcp — Setup Guide

A working starter is already in this folder: `package.json`, `tsconfig.json`,
and `src/index.ts` with five tools (`generate_quiz`, `check_understanding`,
`explain_concept`, `generate_summary`, `trigger_consequence`). It's already
been installed and compiled once to confirm it builds clean — you're starting
from a known-good state, not a blank page.

## 1. Prerequisites

- Node.js 20+ and npm
- An Anthropic API key — [console.anthropic.com](https://console.anthropic.com)
- At least one MCP-capable host installed to test against: Claude Code, Cursor, or VS Code

## 2. Install & build

```bash
cd buildtutor-mcp
npm install
npm run build        # compiles src/index.ts -> build/index.js
```

## 3. Set your API key

```bash
cp .env.example .env
# edit .env and paste your real key
```

Note: `.env` is for *local testing only* (see step 4). The real key actually
gets read from the `env` block in whichever MCP config you wire up in step 6 —
the host process sets that env var when it spawns your server, it doesn't
read your `.env` file automatically.

## 4. Sanity-check it runs

```bash
ANTHROPIC_API_KEY=sk-ant-... node build/index.js
```

You should see `buildtutor-mcp running on stdio` printed to stderr and the
process will just sit there waiting for input — that's correct, it's waiting
for a host to connect. Ctrl+C to stop.

## 5. Test it with the MCP Inspector (do this before wiring into any agent)

```bash
npx @modelcontextprotocol/inspector node build/index.js
```

This opens a local UI where you can call each tool directly with fake inputs
and see the real output — much faster feedback loop than debugging through a
full agent conversation. Confirm all five tools show up and `generate_quiz`
returns a real question before moving on.

## 6. Wire it into an agent

Pick whichever you'll demo with — config examples for each are in
`mcp-config-examples/`. The shape is the same everywhere: `command`, `args`
pointing at your built `build/index.js` with an **absolute path**, and an
`env` block with your real API key.

**Claude Code:** copy `mcp-config-examples/claude-code.mcp.json` to `.mcp.json`
in the root of whatever project you'll demo building. Restart Claude Code in
that project, then run `/mcp` to confirm `buildtutor` is listed and connected.

**Cursor:** copy `mcp-config-examples/cursor.mcp.json` into Cursor's MCP
settings (Settings → MCP), same shape.

**Codex CLI:** copy the block from `mcp-config-examples/codex.config.toml`
into `~/.codex/config.toml`. Double-check the exact key name against current
Codex docs first — this is the part most likely to have shifted since this
guide was written.

**VS Code:** copy `mcp-config-examples/vscode.mcp.json` to `.vscode/mcp.json`
in the demo project. Same caveat — verify `servers` vs `mcpServers` against
current docs before relying on it live.

## 7. Drop in the AGENTS.md instructions

Copy `AGENTS.md.template` to `AGENTS.md` in the root of whatever project
you're demoing the build in. This is what tells the agent to actually call
your tools instead of just building silently — without it, the server is
connected but the agent has no reason to use it.

## 8. Run the real test

In your demo project (with `AGENTS.md` and the MCP config both in place),
open your chosen agent and ask it to build something small — a single CRUD
endpoint is plenty. Watch for:

- It writes a small chunk, then pauses and asks you a question (that's `generate_quiz` firing)
- You answer, it either unlocks the next chunk or explains the gap and re-quizzes
- At the end, it shows the comprehension summary

If it just builds straight through without ever quizzing you, the agent isn't
calling your tools — check `/mcp` (or equivalent) is showing the server as
connected, and check `AGENTS.md` is actually in the directory the agent thinks
is its project root.

## 9. Demo day checklist

- [ ] `.env` key works locally (step 4)
- [ ] Inspector shows all 5 tools responding (step 5)
- [ ] Live test in your actual demo agent completes one full chunk → quiz → unlock cycle (step 8)
- [ ] Script the exact demo prompt in advance — don't improvise the build request live
- [ ] Have a recorded backup in case of API flakiness mid-demo
