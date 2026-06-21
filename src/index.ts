import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// ── Setup ────────────────────────────────────────────────────────────────

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Missing ANTHROPIC_API_KEY in environment. Set it in .env or your MCP config's env block.");
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey });

const TUTOR_MODEL = "claude-sonnet-4-6";

const server = new McpServer({
  name: "buildtutor",
  version: "0.1.0",
});

// ── Tool 1: generate_quiz ───────────────────────────────────────────────
// Writes a comprehension question grounded in the actual diff just written.

const QUIZ_SYSTEM_PROMPT = `You are a Socratic coding tutor embedded in a build tool.
Given a code diff, write ONE short, open-ended question that probes whether the
person understands a specific decision made in THIS exact code — not a generic
question about the concept in the abstract. Never reveal the answer. Keep it to
1-2 sentences. If this is a retry (priorAttempts > 1), ask a different angle on
the same underlying concept rather than repeating the question.`;

server.registerTool(
  "generate_quiz",
  {
    description:
      "Generate a comprehension question grounded in a code diff. Call this immediately after writing any non-trivial chunk of code, before moving on to the next chunk.",
    inputSchema: {
      diff: z.string().describe("The code diff or snippet just written"),
      priorAttempts: z.number().optional().describe("How many times this chunk has been quizzed already"),
    },
  },
  async ({ diff, priorAttempts }) => {
    const response = await anthropic.messages.create({
      model: TUTOR_MODEL,
      max_tokens: 300,
      system: QUIZ_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Diff:\n${diff}\n\nAttempt #${priorAttempts ?? 1} for this chunk.`,
        },
      ],
    });
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return { content: [{ type: "text" as const, text }] };
  }
);

// ── Tool 2: check_understanding ─────────────────────────────────────────
// Grades the user's free-text answer against the diff. Returns a pass/fail
// verdict plus the specific gap, formatted so the calling agent can parse it.

const GRADE_SYSTEM_PROMPT = `You are grading a learner's answer to a coding
comprehension question. Given the code diff, the question asked, and the
learner's answer, decide if they demonstrate real understanding of the
specific decision in the code (not just that they can describe what the code
does generically). Respond in EXACTLY this format, nothing else:

PASS: true|false
GAP: <one sentence naming the specific misunderstanding, or "none" if PASS is true>`;

server.registerTool(
  "check_understanding",
  {
    description:
      "Grade a learner's answer to a generated quiz question. Returns PASS/FAIL and the specific gap if failed. Do not unlock the next chunk unless PASS is true.",
    inputSchema: {
      diff: z.string(),
      question: z.string(),
      answer: z.string(),
    },
  },
  async ({ diff, question, answer }) => {
    const response = await anthropic.messages.create({
      model: TUTOR_MODEL,
      max_tokens: 200,
      system: GRADE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Diff:\n${diff}\n\nQuestion: ${question}\n\nLearner's answer: ${answer}`,
        },
      ],
    });
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return { content: [{ type: "text" as const, text }] };
  }
);

// ── Tool 3: explain_concept ─────────────────────────────────────────────
// Targeted re-teach when check_understanding returns a gap.

const EXPLAIN_SYSTEM_PROMPT = `You are a patient coding tutor. Given a code
diff and a specific gap in the learner's understanding, explain ONLY that gap
clearly in 3-4 sentences. Suggest one concrete doc/resource to look up (a
topic or search term, not a fake URL). Do not just restate the quiz answer —
help them reason toward it.`;

server.registerTool(
  "explain_concept",
  {
    description:
      "Give a targeted explanation after a failed comprehension check, before re-quizzing.",
    inputSchema: {
      diff: z.string(),
      gap: z.string(),
    },
  },
  async ({ diff, gap }) => {
    const response = await anthropic.messages.create({
      model: TUTOR_MODEL,
      max_tokens: 300,
      system: EXPLAIN_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Diff:\n${diff}\n\nGap to address: ${gap}` }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return { content: [{ type: "text" as const, text }] };
  }
);

// ── Tool 4: generate_summary ────────────────────────────────────────────
// End-of-build comprehension report.

server.registerTool(
  "generate_summary",
  {
    description:
      "Generate a comprehension summary once all chunks for the current build are unlocked. Pass a list of per-chunk results.",
    inputSchema: {
      chunks: z
        .array(
          z.object({
            name: z.string(),
            attempts: z.number(),
            passed: z.boolean(),
          })
        )
        .describe("Per-chunk quiz results for this build"),
    },
  },
  async ({ chunks }) => {
    const total = chunks.length;
    const firstTry = chunks.filter((c) => c.attempts === 1 && c.passed).length;
    const struggled = chunks.filter((c) => c.attempts > 1);
    const pct = total > 0 ? Math.round((firstTry / total) * 100) : 0;

    let text = `## Comprehension Summary\n\n${pct}% of chunks (${firstTry}/${total}) understood on the first try.\n\n`;
    if (struggled.length > 0) {
      text += `**Review these before shipping:**\n`;
      for (const c of struggled) {
        text += `- ${c.name} (${c.attempts} attempts)\n`;
      }
    } else {
      text += `No chunks needed a re-teach. Solid build.`;
    }
    return { content: [{ type: "text" as const, text }] };
  }
);

// ── Tool 5: trigger_consequence (DEMO GAG — fully mocked, sends nothing) ──
// For the live demo only. No real email is ever sent — this just returns
// flavor text the host agent can render in chat. Intentionally has no
// email/network integration so it can't accidentally fire for real.

server.registerTool(
  "trigger_consequence",
  {
    description:
      "Demo-only flavor tool: call this when a learner fails the same quiz multiple times, purely for comedic effect during live demos. Does NOT send any real email or message anywhere.",
    inputSchema: {
      wrongAnswers: z.number().describe("How many times this chunk has been failed"),
    },
  },
  async ({ wrongAnswers }) => {
    const text =
      `📧 Drafting email to your manager: "Reconsider this hire" ` +
      `(${wrongAnswers} failed attempts on this chunk)...\n\n` +
      `...just kidding. Nothing was sent. Get the quiz right and keep building.`;
    return { content: [{ type: "text" as const, text }] };
  }
);

// ── Start ────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("buildtutor-mcp running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting buildtutor-mcp:", err);
  process.exit(1);
});
