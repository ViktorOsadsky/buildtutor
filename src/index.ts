import Anthropic from "@anthropic-ai/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "node:crypto";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { z } from "zod";

type LessonSection = {
  heading: string;
  body: string;
};

type QuizOption = {
  label: string;
  text: string;
};

type Lesson = {
  id: string;
  updateId: string;
  title: string;
  overview: string;
  sections: LessonSection[];
  operationalNotes: string[];
  quizRecommended: boolean;
  quizPrompt: string | null;
  createdAt: string;
};

type ProjectUpdate = {
  id: string;
  summary: string;
  changedFiles: string[];
  infrastructureImpact: string;
  majorChange: boolean;
  rationale: string;
  createdAt: string;
  lessonId: string | null;
};

type Quiz = {
  id: string;
  lessonId: string;
  question: string;
  options: QuizOption[];
  correctIndex: number;
  selectedIndex: number | null;
  gap: string;
  createdAt: string;
  passes: boolean | null;
};

type AppState = {
  projectName: string;
  webBaseUrl: string;
  updates: ProjectUpdate[];
  lessons: Lesson[];
  quizzes: Quiz[];
  events: ServerEvent[];
};

type ServerEvent =
  | { type: "update"; payload: ProjectUpdate }
  | { type: "lesson"; payload: Lesson }
  | { type: "quiz"; payload: Quiz }
  | { type: "status"; payload: { message: string; createdAt: string } };

const apiKey = process.env.ANTHROPIC_API_KEY;
const anthropic = apiKey ? new Anthropic({ apiKey }) : null;
const TUTOR_MODEL = process.env.BUILDTUTOR_MODEL ?? "claude-sonnet-4-6";
const WEB_PORT = Number(process.env.BUILDTUTOR_WEB_PORT ?? "3333");
const WEB_HOST = process.env.BUILDTUTOR_WEB_HOST ?? "127.0.0.1";
const LOCK_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".buildtutor.lock");

const state: AppState = {
  projectName: "buildtutor",
  webBaseUrl: "",
  updates: [],
  lessons: [],
  quizzes: [],
  events: [],
};

const eventBus = new EventEmitter();

const server = new McpServer({
  name: "buildtutor",
  version: "0.2.0",
});

function nowIso() {
  return new Date().toISOString();
}

function emitEvent(event: ServerEvent) {
  state.events.push(event);
  if (state.events.length > 100) {
    state.events.shift();
  }
  eventBus.emit("event", event);
}

function pushStatus(message: string) {
  emitEvent({ type: "status", payload: { message, createdAt: nowIso() } });
}

type StartupLock = {
  pid: number;
  webPort: number;
  startedAt: string;
};

async function writeStartupLock() {
  const lock: StartupLock = {
    pid: process.pid,
    webPort: WEB_PORT,
    startedAt: nowIso(),
  };
  await writeFile(LOCK_FILE, JSON.stringify(lock, null, 2), "utf8");
}

async function clearStartupLock() {
  await unlink(LOCK_FILE).catch(() => {});
}

function jsonResponse(res: ServerResponse, statusCode: number, payload: unknown) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function textResponse(res: ServerResponse, statusCode: number, body: string, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function stripCodeFences(text: string) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function shorten(text: string, maxLength: number) {
  void maxLength;
  return text.trim().replace(/\s+/g, " ");
}

function choiceLabel(index: number) {
  return String.fromCharCode(65 + index);
}

function normalizeOptions(value: unknown): QuizOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => ({
      label: choiceLabel(index),
      text: typeof item === "string" && item.trim().length > 0 ? item.trim() : "",
    }))
    .filter((item) => item.text.length > 0)
    .slice(0, 4);
}

function normalizeSection(value: unknown, heading: string): LessonSection {
  return {
    heading,
    body: typeof value === "string" && value.trim().length > 0 ? value.trim() : "No detail was generated.",
  };
}

function fallbackLesson(update: ProjectUpdate): Lesson {
  const sections: LessonSection[] = [
    {
      heading: "Why it matters",
      body: shorten(update.infrastructureImpact || update.summary, 90),
    },
  ];

  return {
    id: randomUUID(),
    updateId: update.id,
    title: shorten(`Infrastructure lesson: ${update.summary}`, 54),
    overview: shorten(update.rationale || "A major infrastructure change was published.", 84),
    sections,
    operationalNotes: [
      "Verify the runtime boundary.",
    ],
    quizRecommended: true,
    quizPrompt: "What is the main infrastructure change, and what should an engineer verify next?",
    createdAt: nowIso(),
  };
}

function parseLessonDraft(text: string, update: ProjectUpdate): Lesson {
  try {
    const parsed = JSON.parse(stripCodeFences(text)) as Record<string, unknown>;
    const title = shorten(typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : `Infrastructure lesson: ${update.summary}`, 54);
    const overview = shorten(
      typeof parsed.overview === "string" && parsed.overview.trim() ? parsed.overview.trim() : "A major change was published and the front end captured the infrastructure-level explanation.",
      84
    );
    const sections = [
      normalizeSection(parsed.whyItMatters ?? parsed.whatChanged, "Why it matters"),
    ];
    const operationalNotes = asStringArray(parsed.operationalBullets).slice(0, 1).map((note) => shorten(note, 60));
    const finalOperationalNotes =
      operationalNotes.length > 0 ? operationalNotes : ["Verify the runtime boundary."];

    return {
      id: randomUUID(),
      updateId: update.id,
      title,
      overview,
      sections,
      operationalNotes: finalOperationalNotes,
      quizRecommended: true,
      quizPrompt: shorten(
        typeof parsed.quizPrompt === "string" && parsed.quizPrompt.trim()
          ? parsed.quizPrompt.trim()
          : "What changed, and what should an engineer verify?",
        72
      ),
      createdAt: nowIso(),
    };
  } catch {
    return fallbackLesson(update);
  }
}

function renderLessonPrompt(update: ProjectUpdate) {
  return `You write infrastructure lessons for engineers.

Return JSON only with this shape:
{
  "title": string,
  "overview": string,
  "whyItMatters": string,
  "operationalBullets": string[],
  "quizRecommended": boolean,
  "quizPrompt": string
}

Rules:
- Focus on infrastructure, runtime, deployment, config, boundaries, and operational behavior.
- Do not mention source lines, code snippets, or implementation details that would expose the actual code.
- Explain the project as if the reader needs to understand the system, not the diff.
- Use clear, practical language that would help an engineer explain the project back to someone else.
- Keep the whole lesson very short. Aim for one short overview sentence, one short explanation sentence, and at most one operational bullet.
- Only recommend a quiz if the lesson covers a meaningful architectural or operational shift.

Project update:
Summary: ${update.summary}
Changed files: ${update.changedFiles.join(", ") || "none provided"}
Infrastructure impact: ${update.infrastructureImpact}
Rationale for major change: ${update.rationale}`;
}

async function generateLesson(update: ProjectUpdate): Promise<Lesson> {
  if (!anthropic) {
    return fallbackLesson(update);
  }

  try {
    const response = await anthropic.messages.create({
      model: TUTOR_MODEL,
      max_tokens: 900,
      system: "You are an infrastructure-first teaching assistant.",
      messages: [{ role: "user", content: renderLessonPrompt(update) }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    if (!text.trim()) {
      return fallbackLesson(update);
    }
    return parseLessonDraft(text, update);
  } catch (error) {
    console.error("Failed to generate lesson:", error);
    return fallbackLesson(update);
  }
}

function getLessonById(lessonId: string) {
  return state.lessons.find((lesson) => lesson.id === lessonId) ?? null;
}

function getUpdateByLessonId(lessonId: string) {
  const lesson = getLessonById(lessonId);
  if (!lesson) return null;
  return state.updates.find((update) => update.id === lesson.updateId) ?? null;
}

function fallbackQuiz(lesson: Lesson) {
  return {
    question: `What is the main change described by "${lesson.title}"?`,
    options: [
      "A runtime, deployment, or config change that should be verified.",
      "A minor wording refresh with no system impact.",
      "A rename of a single local variable.",
      "A formatting-only cleanup with no workflow effect.",
    ],
    correctIndex: 0,
  };
}

type GeneratedQuiz = {
  question: string;
  options: string[];
  correctIndex: number;
};

async function generateQuizForLesson(lesson: Lesson, priorAttempts = 1): Promise<GeneratedQuiz> {
  if (!lesson.quizRecommended) {
    return {
      question: `No quiz needed for "${lesson.title}".`,
      options: ["No quiz was recommended.", "A quiz is required.", "The lesson was not published.", "The summary was hidden."],
      correctIndex: 0,
    };
  }

  if (!anthropic) {
    return fallbackQuiz(lesson);
  }

  try {
    const response = await anthropic.messages.create({
      model: TUTOR_MODEL,
      max_tokens: 300,
      system:
        "You write multiple-choice checks for infrastructure lessons. Return JSON only with question, options, and correctIndex. Ask about system behavior, boundaries, or operational consequences. Never mention code lines or implementation specifics.",
      messages: [
        {
          role: "user",
          content: `Lesson title: ${lesson.title}\n\nLesson overview: ${lesson.overview}\n\nThis is attempt #${priorAttempts} for the same lesson.\n\nReturn exactly four options. One must be correct and three must be plausible distractors.`,
        },
      ],
    });
    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const parsed = JSON.parse(stripCodeFences(text)) as Record<string, unknown>;
    const question = shorten(
      typeof parsed.question === "string" && parsed.question.trim() ? parsed.question.trim() : lesson.quizPrompt || fallbackQuiz(lesson).question,
      120
    );
    const options = normalizeOptions(parsed.options).map((option) => shorten(option.text, 88));
    const correctIndexRaw = typeof parsed.correctIndex === "number" ? parsed.correctIndex : 0;
    const correctIndex = Math.max(0, Math.min(3, Math.trunc(correctIndexRaw)));
    if (options.length === 4) {
      return { question, options, correctIndex };
    }
    return fallbackQuiz(lesson);
  } catch (error) {
    console.error("Failed to generate quiz:", error);
    return fallbackQuiz(lesson);
  }
}

function latestQuizForLesson(lessonId: string) {
  return state.quizzes.find((quiz) => quiz.lessonId === lessonId && quiz.selectedIndex === null) ?? null;
}

function serveStatic(rootDir: string, req: IncomingMessage, res: ServerResponse) {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const normalizedPath = pathname.replace(/^\/+/, "");
  const filePath = path.resolve(rootDir, normalizedPath);
  const rootPrefix = rootDir.endsWith(path.sep) ? rootDir : `${rootDir}${path.sep}`;

  if (filePath !== rootDir && !filePath.startsWith(rootPrefix)) {
    textResponse(res, 403, "Forbidden");
    return;
  }

  readFile(filePath)
    .then((content) => {
      const ext = path.extname(filePath).toLowerCase();
      const contentType =
        ext === ".html"
          ? "text/html; charset=utf-8"
          : ext === ".js"
            ? "text/javascript; charset=utf-8"
            : ext === ".css"
              ? "text/css; charset=utf-8"
              : "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=60",
      });
      res.end(content);
    })
    .catch(() => textResponse(res, 404, "Not found"));
}

async function handleApiRequest(req: IncomingMessage, res: ServerResponse, rootDir: string) {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = requestUrl.pathname;

  if (req.method === "GET" && pathname === "/api/state") {
    jsonResponse(res, 200, {
      projectName: state.projectName,
      webBaseUrl: state.webBaseUrl,
      updates: state.updates,
      lessons: state.lessons,
      quizzes: state.quizzes,
      apiKeyConfigured: Boolean(apiKey),
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");

    const replay = state.events.slice(-20);
    for (const event of replay) {
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    const onEvent = (event: ServerEvent) => {
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    eventBus.on("event", onEvent);
    req.on("close", () => {
      eventBus.off("event", onEvent);
      res.end();
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/debug/update") {
    const body = await readBody(req);
    try {
      const payload = JSON.parse(body) as Partial<ProjectUpdate>;
      const update: ProjectUpdate = {
        id: randomUUID(),
        summary: typeof payload.summary === "string" ? payload.summary : "Untitled update",
        changedFiles: Array.isArray(payload.changedFiles) ? asStringArray(payload.changedFiles) : [],
        infrastructureImpact: typeof payload.infrastructureImpact === "string" ? payload.infrastructureImpact : "",
        majorChange: Boolean(payload.majorChange),
        rationale: typeof payload.rationale === "string" ? payload.rationale : "",
        createdAt: nowIso(),
        lessonId: null,
      };

      state.updates.unshift(update);
      emitEvent({ type: "update", payload: update });
      jsonResponse(res, 200, { ok: true, update });
    } catch (error) {
      jsonResponse(res, 400, { ok: false, error: "Invalid JSON payload." });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/") {
    serveStatic(rootDir, req, res);
    return;
  }

  if (req.method === "GET" && (pathname === "/app.js" || pathname === "/styles.css")) {
    serveStatic(rootDir, req, res);
    return;
  }

  textResponse(res, 404, "Not found");
}

async function startWebServer() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
  const serverInstance = createServer((req, res) => {
    handleApiRequest(req, res, rootDir).catch((error) => {
      console.error("Web server request failed:", error);
      textResponse(res, 500, "Internal server error");
    });
  });

  const listen = (port: number) =>
    new Promise<number>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        serverInstance.off("error", onError);
        reject(error);
      };

      serverInstance.once("error", onError);
      serverInstance.listen(port, WEB_HOST, () => {
        serverInstance.off("error", onError);
        resolve(port);
      });
    });

  let port = WEB_PORT;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const boundPort = await listen(port);
      state.webBaseUrl = `http://${WEB_HOST}:${boundPort}`;
      await writeStartupLock();
      pushStatus(`Web front end listening at ${state.webBaseUrl}`);
      console.error(`buildtutor web front end running at ${state.webBaseUrl}`);
      return serverInstance;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE") {
        throw error;
      }
      port += 1;
    }
  }

  throw new Error("Unable to bind a web port for the front end.");
}

const reportProjectUpdateSchema = {
  summary: z.string().min(3).describe("A concise summary of the major project update"),
  majorChange: z.boolean().describe("Whether the agent has detected a major project change"),
  changedFiles: z.array(z.string()).optional().describe("Files most directly associated with the update"),
  infrastructureImpact: z.string().optional().describe("How the change affects runtime, deployment, configuration, or boundaries"),
  rationale: z.string().optional().describe("Why the agent considers this a major change"),
};

server.registerTool(
  "report_project_update",
  {
    description:
      "Publish a major project update to the web front end. Call this only after the agent detects a significant feature, infrastructure, or workflow change. The server turns that update into a lesson for the website.",
    inputSchema: reportProjectUpdateSchema,
  },
  async ({ summary, majorChange, changedFiles = [], infrastructureImpact = "", rationale = "" }) => {
    const update: ProjectUpdate = {
      id: randomUUID(),
      summary: shorten(summary, 110),
      changedFiles,
      infrastructureImpact: shorten(infrastructureImpact, 130),
      majorChange,
      rationale: shorten(rationale, 130),
      createdAt: nowIso(),
      lessonId: null,
    };

    state.updates.unshift(update);
    emitEvent({ type: "update", payload: update });

    if (!majorChange) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Update recorded: ${update.summary}. No lesson published.`,
          },
        ],
      };
    }

    const lesson = await generateLesson(update);
    update.lessonId = lesson.id;
    state.lessons.unshift(lesson);
    emitEvent({ type: "lesson", payload: lesson });

    const text = [
      `Lesson published: ${lesson.title}.`,
      `Dashboard: ${state.webBaseUrl || "starting..."}`,
      lesson.quizRecommended ? `Follow-up quiz recommended.` : `No quiz recommended.`,
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  }
);

const QUIZ_SYSTEM_PROMPT = `You write one short, open-ended question for an already-published infrastructure lesson.
Ask about how the system works, why the change matters, or what operational behavior should be verified.
Do not mention code lines, snippets, or implementation details.`;

server.registerTool(
  "generate_quiz",
  {
    description:
      "Generate a multiple-choice quiz only after a lesson has been published, and only if the lesson recommends a quiz. The quiz should check whether the engineer understands the infrastructure-level change.",
    inputSchema: {
      lessonId: z.string().describe("The lesson to quiz"),
      priorAttempts: z.number().optional().describe("How many times this lesson has already been quizzed"),
    },
  },
  async ({ lessonId, priorAttempts = 1 }) => {
    const lesson = getLessonById(lessonId);
    if (!lesson) {
      return { content: [{ type: "text" as const, text: "No lesson was found for that lessonId." }] };
    }

    if (!lesson.quizRecommended) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Quiz skipped for "${lesson.title}".`,
          },
        ],
      };
    }

    const draft = await generateQuizForLesson(lesson, priorAttempts);
    const quiz: Quiz = {
      id: randomUUID(),
      lessonId,
      question: draft.question,
      options: draft.options.map((text, index) => ({ label: choiceLabel(index), text })),
      correctIndex: draft.correctIndex,
      selectedIndex: null,
      gap: "",
      createdAt: nowIso(),
      passes: null,
    };
    state.quizzes.unshift(quiz);
    emitEvent({ type: "quiz", payload: quiz });

    const text = [
      draft.question,
      ...draft.options.map((option, index) => `${choiceLabel(index)}. ${option}`),
      "Reply with the choice letter, like A or C.",
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  }
);

server.registerTool(
  "check_understanding",
  {
    description:
      "Grade a learner's answer to a quiz that followed a published infrastructure lesson. Do not use this before a lesson exists.",
    inputSchema: {
      lessonId: z.string(),
      selectedIndex: z.number().int().min(0).max(3).describe("The chosen answer index, where 0 = A, 1 = B, 2 = C, 3 = D"),
    },
  },
  async ({ lessonId, selectedIndex }) => {
    const lesson = getLessonById(lessonId);
    if (!lesson) {
      return { content: [{ type: "text" as const, text: "No lesson was found for that lessonId." }] };
    }

    const pendingQuiz = latestQuizForLesson(lessonId);
    if (!pendingQuiz) {
      return { content: [{ type: "text" as const, text: "No quiz was found for that lessonId." }] };
    }

    const passes = selectedIndex === pendingQuiz.correctIndex;
    const result = {
      passes,
      gap: passes
        ? "none"
        : `That choice missed the infrastructure effect. ${choiceLabel(pendingQuiz.correctIndex)} is the better match for this lesson.`,
    };
    pendingQuiz.selectedIndex = selectedIndex;
    pendingQuiz.gap = result.gap;
    pendingQuiz.passes = result.passes;
    pendingQuiz.createdAt = nowIso();
    emitEvent({ type: "quiz", payload: pendingQuiz });

    return {
      content: [
        {
          type: "text" as const,
          text: `PASS: ${result.passes ? "true" : "false"}\nGAP: ${result.gap}`,
        },
      ],
    };
  }
);

server.registerTool(
  "explain_concept",
  {
    description:
      "Give a targeted explanation after a failed lesson quiz, focusing on the infrastructure gap instead of the code.",
    inputSchema: {
      lessonId: z.string(),
      gap: z.string(),
    },
  },
  async ({ lessonId, gap }) => {
    const lesson = getLessonById(lessonId);
    if (!lesson) {
      return { content: [{ type: "text" as const, text: "No lesson was found for that lessonId." }] };
    }

    const text = await anthropicExplanation(lesson, gap);
    return { content: [{ type: "text" as const, text }] };
  }
);

async function anthropicExplanation(lesson: Lesson, gap: string) {
  if (!anthropic) {
    return `The gap is about ${gap}. Revisit the lesson's infrastructure sections and make sure you can explain the runtime boundary, the operational effect, and the verification step in your own words.`;
  }

  try {
    const response = await anthropic.messages.create({
      model: TUTOR_MODEL,
      max_tokens: 260,
      system:
        "You explain infrastructure concepts after a quiz miss. Stay at the system level, name the specific misunderstanding, and suggest a concrete thing to review. Do not mention code lines or implementation details.",
      messages: [
        {
          role: "user",
          content: `Lesson title: ${lesson.title}\nLesson overview: ${lesson.overview}\nGap: ${gap}`,
        },
      ],
    });
    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    return text.trim() || `Revisit the lesson gap: ${gap}`;
  } catch (error) {
    console.error("Failed to explain concept:", error);
    return `Revisit the lesson gap: ${gap}`;
  }
}

server.registerTool(
  "generate_summary",
  {
    description:
      "Generate a project-level summary of published infrastructure lessons. This is about operational understanding, not the source code.",
    inputSchema: {
      lessons: z
        .array(
          z.object({
            id: z.string(),
            title: z.string(),
            quizRecommended: z.boolean(),
          })
        )
        .describe("The lessons that have been published so far"),
    },
  },
  async ({ lessons }) => {
    const total = lessons.length;
    const withQuizzes = lessons.filter((lesson) => lesson.quizRecommended).length;
    const text =
      total === 0
        ? "No major lessons have been published yet."
        : `Published ${total} infrastructure lesson${total === 1 ? "" : "s"}.\n${withQuizzes} of them recommend follow-up quiz checks.\nThe front end is now the source of truth for how the project's infrastructure evolves over time.`;
    return { content: [{ type: "text" as const, text }] };
  }
);

server.registerTool(
  "get_frontend_status",
  {
    description:
      "Return the current web front end URL and port for this buildtutor session so the agent can report where the lessons are hosted.",
    inputSchema: {},
  },
  async () => {
    const text = state.webBaseUrl
      ? `Web front end: ${state.webBaseUrl}`
      : `Web front end: starting on port ${WEB_PORT}`;
    return { content: [{ type: "text" as const, text }] };
  }
);

server.registerTool(
  "trigger_consequence",
  {
    description:
      "Demo-only flavor tool. Kept for compatibility, but it has no effect on the web lesson flow.",
    inputSchema: {
      wrongAnswers: z.number().describe("How many times this chunk has been failed"),
    },
  },
  async ({ wrongAnswers }) => {
    const text = `Demo-only: ${wrongAnswers} failed attempt${wrongAnswers === 1 ? "" : "s"}. Nothing was sent.`;
    return { content: [{ type: "text" as const, text }] };
  }
);

async function main() {
  const webServer = await startWebServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  pushStatus("MCP server connected on stdio.");
  console.error("buildtutor-mcp running on stdio");

  process.on("SIGINT", () => {
    webServer.close();
    clearStartupLock().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    webServer.close();
    clearStartupLock().finally(() => process.exit(0));
  });
  process.on("exit", () => {
    void clearStartupLock();
  });
}

main().catch((err) => {
  console.error("Fatal error starting buildtutor-mcp:", err);
  process.exit(1);
});
