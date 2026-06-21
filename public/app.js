const state = {
  projectName: "buildtutor",
  updates: [],
  lessons: [],
  quizzes: [],
  apiKeyConfigured: false,
};

const els = {
  connectionStatus: document.getElementById("connectionStatus"),
  projectName: document.getElementById("projectName"),
  updateCount: document.getElementById("updateCount"),
  quizCount: document.getElementById("quizCount"),
  latestLesson: document.getElementById("latestLesson"),
  updateList: document.getElementById("updateList"),
  quizList: document.getElementById("quizList"),
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderLesson(lesson) {
  if (!lesson) {
    return `<p class="muted">Waiting for a major project update.</p>`;
  }

  return `
    <div class="item">
      <div class="pill">${lesson.quizRecommended ? "quiz" : "lesson"}</div>
      <strong>${escapeHtml(lesson.title)}</strong>
      <p>${escapeHtml(lesson.overview)}</p>
    </div>
  `;
}

function renderQuiz(quizzes) {
  const quiz = quizzes.find((item) => item.selectedIndex === null) || quizzes[0];
  if (!quiz) {
    return `<p class="muted">No quiz yet.</p>`;
  }

  return `
    <div class="item">
      <strong>${escapeHtml(quiz.question || "Pending quiz")}</strong>
      <ul>
        ${(quiz.options || [])
          .slice(0, 4)
          .map((option) => `<li>${escapeHtml(option.label)}. ${escapeHtml(option.text)}</li>`)
          .join("")}
      </ul>
      <p class="${quiz.passes === false ? "warn" : "muted"}">
        ${
          quiz.passes === null
            ? "Choose A, B, C, or D."
            : quiz.passes
              ? "Passed."
              : `Wrong. ${escapeHtml(quiz.gap)}`
        }
      </p>
    </div>
  `;
}

function renderUpdates(updates) {
  if (!updates.length) {
    return `<p class="muted">No updates yet.</p>`;
  }

  return updates
    .slice(0, 3)
    .map(
      (update) => `
        <div class="item">
          <strong>${escapeHtml(update.summary)}</strong>
          ${update.infrastructureImpact ? `<p>${escapeHtml(update.infrastructureImpact)}</p>` : ""}
        </div>
      `
    )
    .join("");
}

function render() {
  els.projectName.textContent = state.projectName;
  els.updateCount.textContent = String(state.updates.length);
  els.quizCount.textContent = String(state.quizzes.length);
  els.latestLesson.innerHTML = renderLesson(state.lessons[0]);
  els.quizList.innerHTML = renderQuiz(state.quizzes);
  els.updateList.innerHTML = renderUpdates(state.updates);
  els.connectionStatus.textContent = state.apiKeyConfigured ? "live" : "live";
}

async function loadState() {
  const response = await fetch("/api/state");
  if (!response.ok) {
    throw new Error(`Failed to load state: ${response.status}`);
  }
  Object.assign(state, await response.json());
  render();
}

function listen() {
  const source = new EventSource("/api/events");
  source.addEventListener("update", () => loadState().catch(() => {}));
  source.addEventListener("lesson", () => loadState().catch(() => {}));
  source.addEventListener("quiz", () => loadState().catch(() => {}));
  source.onerror = () => {
    els.connectionStatus.textContent = "reconnecting";
  };
}

loadState()
  .then(() => {
    listen();
  })
  .catch(() => {
    els.connectionStatus.textContent = "offline";
  });
