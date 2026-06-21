/* buildtutor — interactive architecture diagram + changelog */

const S = {
  projectName: 'buildtutor',
  updates: [],   // ProjectUpdate[], newest-first
  lessons: [],
  quizzes: [],
  cursor: 0,     // index into S.updates; 0 = latest
};

const g = id => document.getElementById(id);

// ── Safety ──────────────────────────────────────────────────────────────────
function esc(v) {
  return String(v ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Time ────────────────────────────────────────────────────────────────────
function ago(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)    return 'just now';
  if (s < 3600)  return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

// ── Lookup ──────────────────────────────────────────────────────────────────
function lessonFor(update) {
  return update && update.lessonId
    ? (S.lessons.find(l => l.id === update.lessonId) || null)
    : null;
}
function quizFor(lessonId) {
  return S.quizzes.find(q => q.lessonId === lessonId) || null;
}

// ── Colors (category → oklch hue) ───────────────────────────────────────────
const CAT_HUE = { client:250, edge:205, service:150, security:300, data:70 };
function hue(cat)     { return CAT_HUE[cat] || 150; }
function col(cat)     { return `oklch(0.63 0.14 ${hue(cat)})`; }
function softCol(cat) { return `oklch(0.63 0.14 ${hue(cat)} / 0.13)`; }
function txtCol(cat)  { return `oklch(0.5 0.15 ${hue(cat)})`; }

// ── SVG edge path (cubic bezier matching Aperture Evolution) ─────────────────
function edgePath(a, b) {
  const mx = a.cx + (b.cx - a.cx) * 0.5;
  return `M${a.cx},${a.cy} C${mx},${a.cy} ${mx},${b.cy} ${b.cx},${b.cy}`;
}

// ── Canvas scale (fit 1200x680 into viewport) ────────────────────────────────
function computeScale() {
  const el = g('canvasArea');
  if (!el) return 1;
  const r = el.getBoundingClientRect();
  return Math.max(0.3, Math.min(1.1, Math.min(r.width / 1255, r.height / 735)));
}

// ── NEW node detection ────────────────────────────────────────────────────────
function newNodeIds(cursor) {
  const cur = S.updates[cursor];
  if (!cur || !cur.diagram || !cur.diagram.nodes) return new Set();
  const curIds = new Set(cur.diagram.nodes.map(n => n.id));
  const prev   = S.updates[cursor + 1];           // older = higher index
  if (!prev || !prev.diagram || !prev.diagram.nodes) return curIds;
  const prevIds = new Set(prev.diagram.nodes.map(n => n.id));
  return new Set([...curIds].filter(id => !prevIds.has(id)));
}

// ── Changelog items ──────────────────────────────────────────────────────────
function changeItems(update) {
  const out = [];
  (update.changedFiles || []).slice(0,3).forEach(f => out.push({ sign:'+', text:f, type:'add' }));
  if (update.infrastructureImpact) out.push({ sign:'~', text:update.infrastructureImpact, type:'mod' });
  return out;
}
function badgeHtml(it) {
  const bg = it.type==='add' ? 'oklch(.9 .1 150)' : it.type==='del' ? 'oklch(.92 .1 22)' : 'oklch(.92 .1 80)';
  const fg = it.type==='add' ? 'oklch(.45 .15 150)' : it.type==='del' ? 'oklch(.55 .2 22)' : 'oklch(.5 .15 80)';
  return `<span class="cl-badge" style="background:${bg};color:${fg}">${esc(it.sign)}</span>`;
}

// ── Quiz HTML ────────────────────────────────────────────────────────────────
function quizHtml(quiz, lessonId) {
  if (!quiz) return '';
  if (quiz.selectedIndex !== null) {
    const pass = quiz.passes;
    return `<div class="quiz-result ${pass ? 'quiz-pass' : 'quiz-fail'}">
      <span class="result-icon">${pass ? '\u2713' : '\u2717'}</span>
      <span class="result-text">${pass ? 'Correct!' : esc(quiz.gap)}</span>
    </div>`;
  }
  const opts = (quiz.options || []).map((o, i) =>
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

function bindQuiz(container, lesson) {
  if (!lesson) return;
  const quiz = quizFor(lesson.id);
  if (!quiz || quiz.selectedIndex !== null) return;
  container.querySelectorAll('.opt-btn').forEach(btn => {
    btn.addEventListener('click', () => submitAnswer(btn.dataset.lesson, Number(btn.dataset.idx)));
  });
}

// ── Node detail panel ────────────────────────────────────────────────────────
function openNodePanel(nodeId, update) {
  const d = update && update.diagram;
  if (!d) return;
  const node = d.nodes.find(n => n.id === nodeId);
  if (!node) return;

  const lesson = lessonFor(update);
  const quiz   = lesson ? quizFor(lesson.id) : null;
  const c  = col(node.cat);
  const sc = softCol(node.cat);
  const tc = txtCol(node.cat);
  const num = S.updates.length - S.cursor;

  let html = `
    <div style="display:flex;align-items:center;gap:13px;margin-bottom:14px;">
      <div class="panel-icon" style="background:${sc};color:${tc}">${esc(node.abbr)}</div>
      <div>
        <div style="font:600 20px 'Space Grotesk',sans-serif;letter-spacing:-.01em;line-height:1.1;">${esc(node.name)}</div>
        <div style="font:500 10.5px 'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.07em;color:${tc};margin-top:4px;">${esc(node.role)}</div>
      </div>
    </div>`;

  if (node.blurb) {
    html += `<p style="font:400 14px 'Space Grotesk',sans-serif;line-height:1.55;color:#544f47;margin:0 0 20px;text-wrap:pretty;">${esc(node.blurb)}</p>`;
  }

  if (lesson) {
    html += `<div class="panel-section-label">LESSON \u00b7 u${num}</div>`;
    html += `<div style="font:600 16px 'Space Grotesk',sans-serif;letter-spacing:-.01em;margin-bottom:8px;">${esc(lesson.title)}</div>`;
    html += `<p style="font:400 13px 'Space Grotesk',sans-serif;line-height:1.55;color:#544f47;margin:0 0 16px;">${esc(lesson.overview)}</p>`;
    (lesson.sections || []).forEach(s => {
      html += `<div style="border-left:2px solid rgba(31,29,26,.1);padding-left:14px;margin-bottom:16px;">
        <div style="font:600 9px 'JetBrains Mono',monospace;letter-spacing:.12em;color:#b3aea2;text-transform:uppercase;margin-bottom:6px;">${esc(s.heading)}</div>
        <p style="font:400 13px 'Space Grotesk',sans-serif;line-height:1.5;color:#544f47;margin:0;">${esc(s.body)}</p>
      </div>`;
    });
    (lesson.operationalNotes || []).forEach(n => {
      html += `<div style="display:flex;gap:9px;align-items:flex-start;margin-bottom:8px;">
        <span style="flex:none;width:6px;height:6px;border-radius:50%;background:#1F1D1A;margin-top:6px;"></span>
        <span style="font:400 12.5px 'Space Grotesk',sans-serif;color:#544f47;line-height:1.4;">${esc(n)}</span>
      </div>`;
    });
    if (quiz) html += quizHtml(quiz, lesson.id);
  } else {
    html += `<p style="font:400 13px 'Space Grotesk',sans-serif;color:#b3aea2;margin-top:12px;">Lesson generating\u2026</p>`;
  }

  const body = g('nodePanelBody');
  body.innerHTML = html;
  if (lesson && quiz && quiz.selectedIndex === null) bindQuiz(body, lesson);

  const panel = g('nodePanel');
  panel.style.display = 'block';
  // re-trigger animation on repeated opens
  panel.style.animation = 'none';
  void panel.offsetHeight;
  panel.style.animation = '';
}

function closeNodePanel() {
  g('nodePanel').style.display = 'none';
}

// ── Architecture diagram renderer ─────────────────────────────────────────────
function renderDiagram(update) {
  const d = update && update.diagram;
  if (!d || !d.nodes || !d.nodes.length) return false;

  const nodeMap = {};
  d.nodes.forEach(n => { nodeMap[n.id] = n; });
  const newIds = newNodeIds(S.cursor);
  const scale  = computeScale();

  g('canvasWrap').style.transform = `translate(-50%,-50%) scale(${scale})`;

  // ── Edges ──
  let svgHtml = '', pkts = '';
  (d.edges || []).forEach((e, i) => {
    const parts = e.split('|');
    const a = nodeMap[parts[0]], b = nodeMap[parts[1]];
    if (!a || !b) return;
    const color = col(b.cat || 'service');
    const path  = edgePath(a, b);
    const dur   = 3 + (i % 5) * 0.55;
    const dl1   = -((i * 0.7) % dur);
    const dl2   = dl1 - dur * 0.5;
    svgHtml += `<path d="${path}" fill="none" stroke="#F4F1EA" stroke-width="6" stroke-linecap="round" stroke-opacity="0.88"/>`;
    svgHtml += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-opacity="0.65" stroke-linecap="round"/>`;
    pkts += `<div style="position:absolute;left:0;top:0;width:6px;height:6px;border-radius:50%;background:${color};box-shadow:0 0 7px ${color};offset-path:path('${path}');offset-distance:0%;animation:packetflow ${dur}s linear infinite;animation-delay:${dl1}s;"></div>`;
    pkts += `<div style="position:absolute;left:0;top:0;width:4px;height:4px;border-radius:50%;background:${color};offset-path:path('${path}');offset-distance:0%;animation:packetflow ${dur}s linear infinite;animation-delay:${dl2}s;"></div>`;
  });
  g('edgeSvg').innerHTML     = svgHtml;
  g('packetLayer').innerHTML = pkts;

  // ── Node cards ──
  let nodesHtml = '';
  d.nodes.forEach(n => {
    const isNew = newIds.has(n.id);
    const c  = col(n.cat);
    const sc = softCol(n.cat);
    const tc = txtCol(n.cat);
    const softRing = c.replace(')', ' / 0.12)').replace('oklch(', 'oklch(');
    nodesHtml += `<div class="node-wrap" data-node-id="${esc(n.id)}"
      style="position:absolute;left:${n.cx}px;top:${n.cy}px;transform:translate(-50%,-50%);z-index:10;">
      ${isNew ? `<div style="position:absolute;inset:-6px;border:2px solid ${c};border-radius:20px;box-shadow:0 0 0 6px ${softRing};pointer-events:none;"></div>` : ''}
      ${isNew ? `<div style="position:absolute;top:-11px;right:-8px;background:oklch(.6 .16 150);color:#fff;font:700 8px 'JetBrains Mono',monospace;letter-spacing:.08em;padding:2px 6px;border-radius:6px;z-index:2;pointer-events:none;">NEW</div>` : ''}
      <div class="node-card">
        <div class="node-icon" style="background:${sc};color:${tc}">${esc(n.abbr)}</div>
        <div>
          <div class="node-name">${esc(n.name)}</div>
          <div class="node-role">${esc(n.role)}</div>
        </div>
      </div>
    </div>`;
  });
  g('nodesLayer').innerHTML = nodesHtml;

  g('nodesLayer').querySelectorAll('.node-wrap').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      openNodePanel(el.dataset.nodeId, update);
    });
  });

  return true;
}

// ── Text lesson (fallback when no diagram) ────────────────────────────────────
function renderTextLesson(update) {
  const lesson = lessonFor(update);
  const quiz   = lesson ? quizFor(lesson.id) : null;
  const num    = S.updates.length - S.cursor;

  const eyebrow = `<div class="lesson-eyebrow">
    <span class="version-chip">u${num}</span>
    <span class="era-chip">${ago(update.createdAt)}</span>
    ${update.majorChange ? '<span class="major-chip">MAJOR</span>' : ''}
  </div>`;
  const fileTags = (update.changedFiles || []).length
    ? `<div class="files-section">${update.changedFiles.map(f => `<span class="file-tag">${esc(f)}</span>`).join('')}</div>`
    : '';

  if (!lesson) {
    g('mainContent').innerHTML = `<div class="main-lesson">${eyebrow}
      <h2 class="lesson-title">${esc(update.summary)}</h2>
      ${update.infrastructureImpact ? `<p class="lesson-overview">${esc(update.infrastructureImpact)}</p>` : ''}
      ${fileTags}
      <p class="muted-note">Generating lesson\u2026</p>
    </div>`;
    return;
  }

  const sects = (lesson.sections || []).map(s => `
    <div class="section-item">
      <div class="section-heading">${esc(s.heading)}</div>
      <p class="section-body">${esc(s.body)}</p>
    </div>`).join('');
  const notes = (lesson.operationalNotes || []).map(n =>
    `<div class="ops-note"><span class="ops-dot"></span><span>${esc(n)}</span></div>`).join('');

  g('mainContent').innerHTML = `<div class="main-lesson">
    ${eyebrow}
    <h2 class="lesson-title">${esc(lesson.title)}</h2>
    <p class="lesson-overview">${esc(lesson.overview)}</p>
    ${sects}
    ${notes ? `<div class="ops-section"><div class="ops-label">OPERATIONAL NOTES</div>${notes}</div>` : ''}
    ${fileTags}
    ${quizHtml(quiz, lesson.id)}
  </div>`;

  bindQuiz(g('mainContent'), lesson);
}

// ── Main render ───────────────────────────────────────────────────────────────
function renderMain() {
  const ht = g('hintToast');
  if (!S.updates.length) {
    ht.style.display = 'block';
    g('canvas').style.display   = 'none';
    g('textView').style.display = 'none';
    closeNodePanel();
    return;
  }
  ht.style.display = 'none';
  const cur = S.updates[S.cursor];
  if (renderDiagram(cur)) {
    g('canvas').style.display   = 'block';
    g('textView').style.display = 'none';
  } else {
    g('canvas').style.display   = 'none';
    g('textView').style.display = 'block';
    renderTextLesson(cur);
    closeNodePanel();
  }
}

// ── Timeline bar ──────────────────────────────────────────────────────────────
function renderTimeline() {
  const bar = g('timelineBar');
  if (!S.updates.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';

  const n       = S.updates.length;
  const ordered = S.updates.slice().reverse();   // [0]=earliest, [n-1]=latest
  const activeI = n - 1 - S.cursor;
  const pct     = n > 1 ? `${(activeI / (n-1)) * 100}%` : '100%';

  const dotEl = g('timelineDots');
  dotEl.style.setProperty('--progress', pct);
  dotEl.innerHTML = ordered.map((u, i) => {
    const cls   = i === activeI ? 'tl-dot tl-dot-active' : i < activeI ? 'tl-dot tl-dot-past' : 'tl-dot';
    const cuIdx = n - 1 - i;
    return `<button class="${cls}" data-idx="${cuIdx}" title="${esc(u.summary)}">
      <span class="tl-dot-mark"></span>
      <span class="tl-dot-lbl">u${i+1}</span>
    </button>`;
  }).join('');

  dotEl.querySelectorAll('.tl-dot').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      S.cursor = Number(btn.dataset.idx);
      closeNodePanel();
      renderAll();
    });
  });

  g('tlPrev').disabled = S.cursor >= n - 1;
  g('tlNext').disabled = S.cursor <= 0;

  const cur      = S.updates[S.cursor];
  const lesson   = lessonFor(cur);
  const headline = (lesson && lesson.title)   || cur.summary;
  const summary  = (lesson && lesson.overview) || cur.infrastructureImpact || cur.rationale || '';
  const items    = changeItems(cur);
  const clHtml   = items.length
    ? items.map(it => `<div class="cl-item">${badgeHtml(it)}<span class="cl-text">${esc(it.text)}</span></div>`).join('')
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

// ── Quiz submission ───────────────────────────────────────────────────────────
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

// ── Status ────────────────────────────────────────────────────────────────────
function setStatus(s) {
  g('connDot').className   = `conn-dot conn-dot-${s}`;
  g('connLabel').textContent = s;
}

// ── Master render ─────────────────────────────────────────────────────────────
function renderAll() {
  const n = S.updates.length;
  g('brandName').textContent = S.projectName;
  g('brandLogo').textContent = (S.projectName && S.projectName[0] || 'B').toUpperCase();
  g('brandSub').textContent  = `${n} update${n!==1?'s':''} \u00b7 ${S.lessons.length} lesson${S.lessons.length!==1?'s':''}`;
  renderMain();
  renderTimeline();
}

// ── State fetch ───────────────────────────────────────────────────────────────
async function loadState() {
  const r = await fetch('/api/state');
  if (!r.ok) throw new Error('State fetch failed');
  const data = await r.json();
  const wasCount = S.updates.length;
  Object.assign(S, data);
  if (S.updates.length > wasCount) { S.cursor = 0; closeNodePanel(); }
  renderAll();
}

// ── SSE ───────────────────────────────────────────────────────────────────────
function listen() {
  const src = new EventSource('/api/events');
  const reload = () => loadState().catch(() => {});
  src.addEventListener('update', reload);
  src.addEventListener('lesson', reload);
  src.addEventListener('quiz',   reload);
  src.onerror = () => setStatus('reconnecting');
  src.onopen  = () => setStatus('live');
}

// ── Wiring ────────────────────────────────────────────────────────────────────
g('tlPrev').addEventListener('click', () => {
  if (S.cursor < S.updates.length - 1) { S.cursor++; closeNodePanel(); renderAll(); }
});
g('tlNext').addEventListener('click', () => {
  if (S.cursor > 0) { S.cursor--; closeNodePanel(); renderAll(); }
});
g('nodePanelClose').addEventListener('click', closeNodePanel);
g('canvasArea').addEventListener('click', closeNodePanel);

window.addEventListener('resize', () => {
  const cur = S.updates[S.cursor];
  if (cur && cur.diagram && cur.diagram.nodes && cur.diagram.nodes.length) {
    g('canvasWrap').style.transform = `translate(-50%,-50%) scale(${computeScale()})`;
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadState()
  .then(() => { setStatus('live'); listen(); })
  .catch(() => setStatus('offline'));
