# buildtutor-mcp

buildtutor-mcp is an MCP server that helps engineers understand a project as deeply as the agent does. When the agent spots a major change, it publishes a short infrastructure lesson to a web dashboard, then asks a multiple-choice check only when that lesson actually needs one.

The point is not to narrate source code. It is to make the system itself legible: runtime behavior, deployment shape, configuration boundaries, and the operational consequences of each meaningful update.

## What It Does

- Turns major project updates into short, readable infrastructure lessons
- Keeps the front end focused on one lesson and one MCQ, not a wall of text
- Lets the agent ask for the current hosted URL directly from the server
- Keeps the quiz step tied to lessons instead of firing on every small edit

## Why It Exists

Most agent workflows explain code changes well enough for the model, but not for the human who needs to maintain the project afterward. buildtutor-mcp closes that gap by making the infrastructure story visible in a small dashboard and forcing the agent to teach the system, not just the diff.

That means a new engineer can open the page and quickly see:

- what changed
- why it matters
- how the system behaves now
- what to verify before trusting the change

## How It Works

1. The agent detects a major update.
2. It calls `report_project_update`.
3. The server publishes a short lesson to the front end.
4. If the lesson recommends it, the agent asks a multiple-choice quiz.
5. The quiz result stays tied to the lesson for later review.

The server also exposes `get_frontend_status`, so the agent can report the live dashboard URL without guessing.

## Run It

```powershell
git clone <repo-url>
cd buildtutor-mcp
npm.cmd install
npm.cmd run build
npm.cmd start
```

By default, the dashboard listens on `http://127.0.0.1:3333`. If that port is already in use, the launcher clears the stale prior instance before starting a new one.

## MCP Config

Point your MCP host at the launcher script:

```toml
[mcp_servers.buildtutor]
command = "node"
args = ["/absolute/path/to/buildtutor-mcp/scripts/launch.mjs"]

[mcp_servers.buildtutor.env]
ANTHROPIC_API_KEY = "sk-xxx"
BUILDTUTOR_WEB_PORT = "3341"
```

## Included Tools

- `report_project_update`
- `generate_quiz`
- `check_understanding`
- `explain_concept`
- `generate_summary`
- `get_frontend_status`

## Notes

- Lessons are intentionally short.
- Quizzes are multiple choice.
- Small updates should stay short and skip the quiz unless they truly change the system.
