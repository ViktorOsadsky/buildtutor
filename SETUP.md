# buildtutor-mcp Setup Guide

A working starter is already in this folder: `package.json`, `tsconfig.json`,
and `src/index.ts` with a stdio MCP server plus a local web front end. Major
project updates become short infrastructure lessons on the website, and quizzes
only appear when a lesson recommends one.

## 1. Prerequisites

- Node.js 20+ and npm
- An Anthropic API key - [console.anthropic.com](https://console.anthropic.com)
- At least one MCP-capable host installed to test against: Claude Code, Cursor, or VS Code

## 2. Install and build

```bash
cd buildtutor-mcp
npm install
npm run build
```

## 3. Set your API key

```bash
cp .env.example .env
# edit .env and paste your real key
```

Note: `.env` is for local testing only. The real key gets read from the `env`
block in whichever MCP config you wire up in step 6.

## 4. Sanity-check it runs

```bash
ANTHROPIC_API_KEY=sk-ant-... node build/index.js
```

You should see the MCP server log plus the web front end URL printed to
stderr. The process will stay alive waiting for input, which is correct for the
stdio transport.

## 5. Test it with the MCP Inspector

```bash
npx @modelcontextprotocol/inspector node build/index.js
```

This opens a local UI where you can call each tool directly with fake inputs
and see the real output. Confirm `report_project_update` creates a short lesson
record and `generate_quiz` returns a multiple-choice question only when the
lesson asks for one.
You can also call `get_frontend_status` to see the exact hosted URL.

## 6. Wire it into an agent

Pick whichever you will demo with - config examples for each are in
`mcp-config-examples/`. The shape is the same everywhere: `command`, `args`
pointing at `scripts/launch.mjs` with an absolute path, and an `env` block
with your real API key. That launcher clears a stale previous buildtutor
process before it starts the real MCP server.

**Claude Code:** copy `mcp-config-examples/claude-code.mcp.json` to `.mcp.json`
in the root of whatever project you'll demo building. Restart Claude Code in
that project, then run `/mcp` to confirm `buildtutor` is listed and connected.

**Cursor:** copy `mcp-config-examples/cursor.mcp.json` into Cursor's MCP
settings, same shape.

**Codex CLI:** copy the block from `mcp-config-examples/codex.config.toml`
into `~/.codex/config.toml`. Double-check the exact key name against current
Codex docs first.

**VS Code:** copy `mcp-config-examples/vscode.mcp.json` to `.vscode/mcp.json`
in the demo project. Verify `servers` vs `mcpServers` against current docs
before relying on it live.

The dashboard listens on the exact port from `BUILDTUTOR_WEB_PORT` or `3333`.
If that port is already in use, the launcher clears the old process first and
then the server keeps the MCP connection alive.

## 7. Drop in the AGENTS.md instructions

Copy `AGENTS.md.template` to `AGENTS.md` in the root of whatever project
you're demoing the build in. This is what tells the agent to publish the lesson
before asking a quiz.

## 8. Run the real test

In your demo project, open your chosen agent and ask it to make a meaningful
change. Watch for:

- The agent calls `report_project_update` after a major update.
- The website front end immediately shows a short infrastructure lesson.
- A quiz only appears if the lesson recommends it.
- The quiz is multiple choice and should be answered with a letter.

If the front end stays empty, check that the server is running and that
`AGENTS.md` is actually in the directory the agent thinks is its project root.

## 9. Demo day checklist

- [ ] `.env` key works locally
- [ ] Inspector shows the tools responding
- [ ] Live test in your actual demo agent publishes a major update and lesson
- [ ] A follow-up quiz only appears when the lesson recommends it
- [ ] Script the exact demo prompt in advance
- [ ] Have a recorded backup in case of API flakiness mid-demo
