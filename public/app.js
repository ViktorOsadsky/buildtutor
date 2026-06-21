/* buildtutor — Evolution-style changelog dashboard */

const S = {
  projectName: 'buildtutor',
  updates:  [],   // ProjectUpdate[], newest-first (index 0 = latest)
  lessons:  [],   // Lesson[], newest-first
  quizzes:  [],   // Quiz[], newest-first
  cursor: 0,      // index into S.updates; 0 = latest
};

const g = id => document.getElementById(id);

/* ── Safety ─────────────────────────────────────────────────────────────── */
function esc(v) {
  return String(v ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ── Time helper ────────────────────────────────────────────────────────── */
function ago(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)    return 'just now';
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/* ── Lookup helpers ─────────────────────────────────────────────────────── */
function lessonFor(update) {
  return update?.lessonId
    ? (S.lessons.find(l => l.id === update.lessonId) ?? null)
    : null;
}

function quizFor(lessonId) {
  return S.quizzes.find(q => q.lessonId === lessonId) ?? null;
}

/* ── Changelog items from a ProjectUpdate ──────────────────────────────── */
function changeItems(update) {
  const out = [];
  (update.changedFiles ?? []).slice(0, 3).forEach(f =>
    out.push({ sign: '+', text: f, type: 'add' })
  );
  if (update.infrastructureImpact)
    out.push({ sign: '~', text: update.infrastructureImpact, type: 'mod' });
  return out;
}

function badgeHtml({ sign, type }) {
  const bg = type === 'add' ? 'oklch(.9 .1 150)' :
             type === 'del' ? 'oklch(.92 .1 22)'  :
                              'oklch(.92 .1 80)';
  const fg = type === 'add' ? 'oklch(.45 .15 150)' :
             type === 'del' ? 'oklch(.55 .2 22)'   :
                              'oklch(.5 .15 80)';
  return `<span class="cl-badge" style="background:${bg};color:${fg}">${esc(sign)}</span>`;
}

/* ── Render: timeline bar ───────────────────────────────────────────────── */
function renderTimeline() {
  const bar = g('timelineBar');
  if (\!S.updates.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';

  const n = S.updates.length;
  // ordered[0] = earliest, ordered[n-1] = latest
  const ordered = S.updates.slice().reverse();
  const activeI = n - 1 - S.cursor;    // dot index (0=earliest)
  const pct     = n > 1 ? `${(activeI / (n - 1)) * 100}%` : '100%';

  /* Dots */
  const dotEl = g('timelineDots');
  dotEl.style.setProperty('--progress', pct);
  dotEl.innerHTML = ordered.map((u, i) => {
    const cls   = i === activeI ? 'tl-dot tl-dot-active' :
                  i  < activeI ? 'tl-dot tl-dot-past'   : 'tl-dot';
    const cuIdx = n - 1 - i;   // maps back to S.updates index
    return `<button class="${cls}" data-idx="${cuIdx}" title="${esc(u.summary)}">
      <span class="tl-dot-mark"></span>
      <span class="tl-dot-lbl">u${i + 1}</span>
    </button>`;
  }).join('');

  dotEl.querySelectorAll('.tl-dot').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      S.cursor = Number(btn.dataset.idx);
      renderAll();
    });
  });

  /* Prev / Next state */
  g('tlPrev').disabled = S.cursor >= n - 1;
  g('tlNext').disabled = S.cursor <= 0;

  /* Meta row */
  const cur      = S.updates[S.cursor];
  const lesson   = lessonFor(cur);
  const headline = lesson?.title    ?? cur.summary;
  const summary  = lesson?.overview ?? cur.infrastructureImpact ?? cur.rationale ?? '';
  const items    = changeItems(cur);

  const clHtml = items.length
    ? items.map(it =>
        `<div class="cl-item">${badgeHtml(it)}<span class="cl-text">${esc(it.text)}</span></div>`
      ).join('')
    : `<span style="font:500 11px 'JetBrains Mono',monospace;color:#b3aea2">No changes tracked</span>`;

  g('timelineMeta').innerHTML = `
    <div class="tl-version">
      <div class="tl-vshort">u${n - S.cursor}</div>
      <div class="tl-era">${ago(cur.createdAt)}</div>
    </div>
    <div class="tl-detail">
      <div class="tl-headline">${esc(headline)}</div>
      ${summary ? `<div class="tl-summary">${esc(summary)}</div>` : ''}
    </div>
    <div class="tl-changelog">
      <div class="cl-label">CHANGELOG</div>
      ${clHtml}
    </div>`;
}

/* ── Render: quiz section ───────────────────────────────────────────────── */
function quizHtml(quiz, lessonId) {
  if (\!quiz) return '';

  if (quiz.selectedIndex \!== null) {
    const pass = quiz.passes;
    return `<div class="quiz-result ${pass ? 'quiz-pass' : 'quiz-fail'}">
      <span class="result-icon">${pass ? '\u2713' : '\u2717'}</span>
      <span class="result-text">${pass ? 'Correct\!' : esc(quiz.gap)}</span>
    </div>`;
  }

  const opts = (quiz.options ?? []).map((o, i) =>
    `<button class="opt-btn" data-lesson="${esc(lessonId)}" data-idx="${i}">
      <span class="opt-label">${esc(o.label)}</span>
      <span class="opt-text">${esc(o.text)}</span>
    </button>`
  ).join('');

  return `<div class="quiz-inline">
    <div class="quiz-q-label">QUIZ</div>
    <p class="quiz-question">${esc(quiz.question)}</p>
    <div class="quiz-options">${opts}</div>
  </div>`;
}

/* ── Render: main content ───────────────────────────────────────────────── */
function renderMain() {
  const mc = g('mainContent');
  const ht = g('hintToast');

  if (\!S.updates.length) {
    ht.style.display = 'block';
    mc.innerHTML = '';
    return;
  }
  ht.style.display = 'none';

  const n      = S.updates.length;
  const cur    = S.updates[S.cursor];
  const lesson = lessonFor(cur);
  const quiz   = lesson ? quizFor(lesson.id) : null;
  const num    = n - S.cursor;

  const eyebrow = `<div class="lesson-eyebrow">
    <span class="version-chip">u${num}</span>
    <span class="era-chip">${ago(cur.createdAt)}</span>
    ${cur.majorChange ? '<span class="major-chip">MAJOR</span>' : ''}
  </div>`;

  const fileTagsHtml = (cur.changedFiles ?? []).length
    ? `<div class="files-section">${cur.changedFiles.map(f =>
        `<span class="file-tag">${esc(f)}</span>`).join('')}</div>`
    : '';

  if (\!lesson) {
    mc.innerHTML = `<div class="main-lesson">
      ${eyebrow}
      <h2 class="lesson-title">${esc(cur.summary)}</h2>
      ${cur.infrastructureImpact ? `<p class="lesson-overview">${esc(cur.infrastructureImpact)}</p>` : ''}
      ${fileTagsHtml}
      <p class="muted-note">Generating lesson\u2026</p>
    </div>`;
    return;
  }

  const sectHtml = (lesson.sections ?? []).map(s => `
    <div class="section-item">
      <div class="section-heading">${esc(s.heading)}</div>
      <p class="section-body">${esc(s.body)}</p>
    </div>`).join('');

  const notesHtml = (lesson.operationalNotes ?? []).map(n =>
    `<div class="ops-note"><span class="ops-dot"></span><span>${esc(n)}</span></div>`
  ).join('');

  mc.innerHTML = `<div class="main-lesson">
    ${eyebrow}
    <h2 class="lesson-title">${esc(lesson.title)}</h2>
    <p class="lesson-overview">${esc(lesson.overview)}</p>
    ${sectHtml}
    ${notesHtml ? `<div class="ops-section"><div class="ops-label">OPERATIONAL NOTES</div>${notesHtml}</div>` : ''}
    ${fileTagsHtml}
    ${quizHtml(quiz, lesson.id)}
  </div>`;

  mc.querySelectorAll('.opt-btn').forEach(btn => {
    btn.addEventListener('click', () =>
      submitAnswer(btn.dataset.lesson, Number(btn.dataset.idx))
    );
  });
}

/* ── Quiz submission ────────────────────────────────────────────────────── */
async function submitAnswer(lessonId, selectedIndex) {
  try {
    const r = await fetch('/api/quiz/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lessonId, selectedIndex }),
    });
    if (r.ok) await loadState();
  } catch (e) {
    console.error('Quiz submit failed:', e);
  }
}

/* ── Connection status ──────────────────────────────────────────────────── */
function setStatus(s) {
  g('connDot').className = `conn-dot conn-dot-${s}`;
  g('connLabel').textContent = s;
}

/* ── Master render ──────────────────────────────────────────────────────── */
function renderAll() {
  const n = S.updates.length;
  g('brandName').textContent = S.projectName;
  g('brandLogo').textContent = (S.projectName?.[0] ?? 'B').toUpperCase();
  g('brandSub').textContent  =
    `${n} update${n \!== 1 ? 's' : ''} \u00b7 ${S.lessons.length} lesson${S.lessons.length \!== 1 ? 's' : ''}`;
  renderMain();
  renderTimeline();
}

/* ── State fetch ────────────────────────────────────────────────────────── */
async function loadState() {
  const r = await fetch('/api/state');
  if (\!r.ok) throw new Error('State fetch failed');
  const data = await r.json();
  const wasCount = S.updates.length;
  Object.assign(S, data);
  if (S.updates.length > wasCount) S.cursor = 0;
  renderAll();
}

/* ── SSE listener ───────────────────────────────────────────────────────── */
function listen() {
  const src = new EventSource('/api/events');
  const reload = () => loadState().catch(() => {});
  src.addEventListener('update', reload);
  src.addEventListener('lesson', reload);
  src.addEventListener('quiz',   reload);
  src.onerror = () => setStatus('reconnecting');
  src.onopen  = () => setStatus('live');
}

/* ── Prev / Next wiring ─────────────────────────────────────────────────── */
g('tlPrev').addEventListener('click', () => {
  if (S.cursor < S.updates.length - 1) { S.cursor++; renderAll(); }
});
g('tlNext').addEventListener('click', () => {
  if (S.cursor > 0) { S.cursor--; renderAll(); }
});

/* ── Init ───────────────────────────────────────────────────────────────── */
loadState()
  .then(() => { setStatus('live'); listen(); })
  .catch(() => setStatus('offline'));
