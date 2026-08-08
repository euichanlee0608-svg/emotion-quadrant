/* 감정의 사분면 — 화면.
   탐색 로직은 engine.js 에 있다(브라우저 없이 테스트할 수 있게 분리). */
import { WORDS } from './data.js';
import { FAMILIES, LEVELS, levelOf, layout, axisLabels, localMatch } from './engine.js';
import { analyze, probeLocal, VIA } from './analyze.js';

const app = typeof document !== 'undefined' ? document.getElementById('app') : null;
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const rankOf = w => WORDS.filter(x => x.p > w.p).length + 1;

let S;
function reset() {
  S = { screen: 'intro', path: [], open: null,
        note: '', busy: false, step: '', sug: null, err: '', pick: null, localUp: null };
}

/* 지금 화면에 놓인 것 하나를 눌렀을 때 뭘 보여줄지 */
const cardOf = it =>
  it.words                                          // 대분류·중분류
    ? { title: it.name,
        desc: it.kick || `${it.n}개의 말이 이 결에 묶여 있습니다.`,
        meta: `${it.n}개의 말` + (it.subs ? ` · ${it.subs.length}갈래` : ''),
        go: '이 갈래로 →' }
    : { title: it.w, desc: it.d,                    // 단어
        meta: `쾌-불쾌 ${it.v.toFixed(2)} · 활성화 ${it.a.toFixed(2)} · 원형성 ${it.p.toFixed(2)} (논문 7점 척도)`,
        go: '이게 지금 내 감정이에요' };

const keyOf = it => it.words ? it.name : it.w;

/* ---------------- 인트로 ---------------- */
const STEP_LINES = [
  ['probe', '준비'],
  ['local', '로컬 모델로 읽는 중 — 글이 컴퓨터 밖으로 안 나갑니다'],
  ['edge',  '모델이 글을 읽는 중'],
  ['match', '글자 겹침으로 찾는 중 (모델 실패)'],
];

function viewProgress() {
  if (!S.busy && !S.sug && !S.err) return '';
  const lines = STEP_LINES.filter(([k]) => k !== 'local' || S.localUp === true);
  const order = lines.map(x => x[0]);
  const at = order.indexOf(S.step);
  return `<div class="steps-live">${lines.map(([k, label], i) => {
    let cls = 'sl';
    if (S.busy) cls += k === S.step ? ' now' : (i < at ? ' done' : ' skip');
    else cls += i < at ? ' done' : (k === S.step ? (S.err ? ' fail' : ' done') : ' skip');
    return `<div class="${cls}"><span class="dot"></span>${esc(label)}</div>`;
  }).join('')}</div>`;
}

function viewIntro() {
  const sug = S.sug;
  const hint = S.localUp === true
    ? '이 컴퓨터의 로컬 모델을 먼저 씁니다 — 글이 밖으로 나가지 않습니다'
    : '입력한 글은 분석에만 쓰이고 저장하지 않습니다';

  return `
  <div class="intro">
    <div class="hero">
      <h1>지금 내 마음에<br><em>이름을 붙여 볼까요</em></h1>
      <p>“기분이 안 좋다”로는 잘 안 잡히는 감정이 있습니다.
         세 번만 고르면 그 자리에 맞는 말에 닿습니다.</p>
      <div class="cta"><button class="btn" data-act="start">시작하기</button></div>
      <div class="steps">
        <div class="step"><i>1</i><b>네 갈래에서 고르기</b><span>지금에 가까운 갈래를 누릅니다.</span></div>
        <div class="step"><i>2</i><b>결을 좁히기</b><span>같은 갈래라도 결이 다릅니다.</span></div>
        <div class="step"><i>3</i><b>맞는 말 고르기</b><span>몰랐던 단어에 닿습니다.</span></div>
      </div>
      <button class="scroll-cue" data-act="toNL">글로 적어서 찾기<i>▾</i></button>
    </div>

    <div class="nl-sec" id="nlsec">
      <h2>고르기 어렵다면, 그냥 적어 보세요</h2>
      <p class="lead">지금 상황이나 기분을 문장으로 적으면, 그 글에서 가까운 감정 단어를 찾아 줍니다.</p>
      <div class="nl">
        <label for="note">요즘 기분이나 상황</label>
        <textarea id="note" rows="3" maxlength="400"
          placeholder="예) 열심히 준비한 게 잘 안 됐는데, 남들은 다 잘 풀리는 것 같아서 자꾸 신경이 쓰인다">${esc(S.note)}</textarea>
        <div class="nl-row">
          <button class="btn sm" data-act="analyze" ${S.busy ? 'disabled' : ''}>
            ${S.busy ? '읽는 중…' : '이 글에서 감정 찾아보기'}</button>
          <span class="nl-hint">${esc(hint)}</span>
        </div>
        ${viewProgress()}
        ${S.err ? `<p class="nl-err">${esc(S.err)}</p>` : ''}
        ${sug ? viewSuggest(sug) : ''}
      </div>
    </div>
  </div>`;
}

function viewSuggest(sug) {
  const picked = S.pick;
  return `
    <div class="sug" id="sug">
      ${sug.read ? `<p class="sug-read">${esc(sug.read)}</p>` : ''}
      <p class="sug-lab">이런 감정에 가까워 보입니다 — 눌러서 고르세요</p>
      <div class="sug-list">
        ${sug.words.map(w => `<button class="chip flat${picked && picked.w === w.w ? ' on' : ''}" data-sug="${esc(w.w)}">
            <b>${esc(w.w)}</b><small>${esc(w.d)}</small></button>`).join('')}
      </div>
      ${picked ? `
        <div class="pick">
          <p><b>${esc(picked.w)}</b> — 여기서 어떻게 할까요?</p>
          <div class="acts">
            <button class="btn sm" data-act="pickGo" data-k="${esc(picked.w)}">이 언저리에서 더 찾아보기 →</button>
            <button class="btn sm ghost" data-act="pickEnd" data-k="${esc(picked.w)}">이 말로 마무리하기</button>
          </div>
        </div>` : ''}
      <p class="sug-via">${esc(VIA[sug.via] || '')}</p>
    </div>`;
}

/* ---------------- 지도 ---------------- */
const STEP_Q = [
  ['지금 마음은 <em>어느 갈래</em>에 가까운가요?', '큰 갈래부터 고릅니다. 정확하지 않아도 됩니다 — 다음 화면에서 좁혀 갑니다.'],
  ['그 안에서도 <em>어떤 결</em>인가요?', '같은 갈래라도 결이 다릅니다. 가까운 쪽을 고르세요.'],
  ['그중 <em>어떤 말</em>이 가장 맞나요?', '여기가 마지막입니다. 눌러서 뜻을 확인하고 정하세요.'],
];

function viewMap() {
  const lv = levelOf(S.path);
  const placed = layout(lv.items, lv.xk, lv.yk);
  const ax = axisLabels(lv.items, lv.xk, lv.yk, S.path.length);
  const depth = S.path.length;

  const chips = placed.map((q, i) => {
    const it = q.item, k = keyOf(it);
    const on = S.open && keyOf(S.open) === k ? ' on' : '';
    const grp = lv.kind === 'word' ? '' : ' grp';
    const sub = lv.kind === 'family' ? `<small>${esc(it.kick)}</small>` : '';
    return `<button class="chip${grp}${on}" data-k="${esc(k)}"
      data-nx="${q.x.toFixed(5)}" data-ny="${q.y.toFixed(5)}"
      style="left:${(q.x*100).toFixed(2)}%;top:${(q.y*100).toFixed(2)}%;animation-delay:${i*40}ms,${(i*310)%2400}ms"
      >${esc(lv.kind === 'word' ? it.w : it.name)}${sub}</button>`;
  }).join('');

  const trail = S.path.length
    ? `<div class="trail">${S.path.map(p => `<span>${esc(p.name)}</span>`).join('<b>›</b>')}</div>` : '';

  const [q, hint] = STEP_Q[depth];
  const c = S.open ? cardOf(S.open) : null;
  const last = lv.kind === 'word';

  // 액션은 전부 이 시트 안에 모은다. 상단바에 흩어 두면 눌러야 할 곳을 못 찾는다.
  const sheet = c ? `
    <div class="sheet">
      <button class="sheet-close" data-act="close" aria-label="닫기">✕</button>
      <h3>${esc(c.title)}</h3>
      <p class="def">${esc(c.desc)}</p>
      <p class="meta">${esc(c.meta)}</p>
      <div class="acts">
        <button class="btn sm" data-act="${last ? 'stop' : 'dive'}" data-k="${esc(keyOf(S.open))}">${esc(c.go)}</button>
        ${last ? '' : `<button class="btn sm ghost" data-act="stop" data-k="${esc(keyOf(S.open))}">여기서 멈추기</button>`}
      </div>
    </div>`
    : `<p class="hint">${last ? '단어를 눌러 뜻을 확인해 보세요.' : '눌러서 어떤 갈래인지 확인하고 들어가세요.'}</p>`;

  return `
    <div class="topbar">
      <span class="depth-pill">${depth + 1}/${LEVELS}단계</span>
      ${trail}
      <span class="spacer"></span>
      ${depth ? `<button class="btn sm ghost" data-act="back">뒤로</button>` : ''}
      <button class="btn sm ghost" data-act="reset">처음부터</button>
    </div>
    <p class="prompt">${q}</p>
    <p class="sub">${hint} 가로는 <b>${esc(ax.xName)}</b>, 세로는 <b>${esc(ax.yName)}</b>입니다.</p>
    <div class="board-outer">
      <div class="axl left">${esc(ax.left.main)}<small>${esc(ax.left.sub)}</small></div>
      <div class="axl right">${esc(ax.right.main)}<small>${esc(ax.right.sub)}</small></div>
      <div class="axl top">${esc(ax.top.main)}<small>${esc(ax.top.sub)}</small></div>
      <div class="axl bottom">${esc(ax.bottom.main)}<small>${esc(ax.bottom.sub)}</small></div>
      <div class="board">
        <div class="quad tl"></div><div class="quad tr"></div>
        <div class="quad bl"></div><div class="quad br"></div>
        <div class="axis h"></div><div class="axis v"></div>
        ${chips}
      </div>
    </div>
    ${sheet}`;
}

/* ---------------- 결과 ---------------- */
function viewFinal() {
  const w = S.path[S.path.length - 1];
  const isWord = !w.words;
  const pct = x => ((x - 1) / 6 * 100).toFixed(1);
  const journey = S.path.map(p => `<span>${esc(p.name || p.w)}</span>`).join('<b>›</b>');
  const fam = isWord ? FAMILIES[w.F] : null;

  const numbers = isWord ? `
    <div class="card">
      <h4>이 단어의 자리 <em>— 논문 평정값, 7점 척도</em></h4>
      <div class="coords">
        <div class="co">
          <div class="lab">쾌-불쾌 <span>1 불쾌 → 7 쾌</span></div>
          <div class="val">${w.v.toFixed(2)}</div>
          <div class="bar"><i style="width:${pct(w.v)}%"></i></div>
        </div>
        <div class="co">
          <div class="lab">활성화 <span>1 가라앉음 → 7 치솟음</span></div>
          <div class="val">${w.a.toFixed(2)}</div>
          <div class="bar"><i style="width:${pct(w.a)}%"></i></div>
        </div>
      </div>
      <p class="note">원형성 ${w.p.toFixed(2)} · 친숙성 ${w.f.toFixed(2)}
        ${w.r ? ' · 논문이 구조 분석에 쓴 대표단어 87개에 듭니다.' : ''}</p>
      <p class="note mine">이 사이트가 붙인 것 — 뜻풀이, 그리고 「${esc(fam.name)} ›
        ${esc(fam.subs[w.S].name)}」이라는 분류. 434개 중 ${rankOf(w)}번째로 원형성이 높습니다.</p>
    </div>` : '';

  const siblings = isWord
    ? fam.subs[w.S].words.filter(x => x.w !== w.w)
    : (w.words || []).slice(0, 8);

  return `
  <div class="result">
    <p class="kick">${isWord ? '닿은 단어' : '여기서 멈췄습니다'}</p>
    <div class="final-word">${esc(w.name || w.w)}</div>
    <p class="def">${esc(isWord ? w.d : w.kick || '')}</p>

    <div class="card">
      <h4>지나온 길</h4>
      <div class="journey">${journey}</div>
    </div>
    ${numbers}
    ${siblings.length ? `
    <div class="card">
      <h4>바로 옆의 말들 <em>— 같은 결, 미세하게 다른</em></h4>
      <div class="sibs">${siblings.slice(0, 8).map(x =>
        `<button class="chip flat" data-jump="${esc(x.w)}"><b>${esc(x.w)}</b><small>${esc(x.d)}</small></button>`).join('')}</div>
    </div>` : ''}

    <div class="acts">
      <button class="btn" data-act="reset">다시 해보기</button>
      ${S.path.length > 1 ? `<button class="btn ghost" data-act="back">한 단계 뒤로</button>` : ''}
    </div>
  </div>`;
}

function viewFooterSlim() {
  return `
  <footer class="slim">
    <p>평정값 출처 — 박인조·민경환 (2005), 「한국어 감정단어의 목록 작성과 차원 탐색」,
       <i>한국심리학회지: 사회 및 성격</i>, 19(1), 109–129.
       뜻풀이와 의미 분류는 이 사이트에서 붙였습니다. 심리 검사나 진단이 아닙니다.</p>
    <a class="backlink" href="https://euichanlee0608-svg.github.io/">전체 포트폴리오 보기 →</a>
  </footer>`;
}

function viewFooter() {
  return `
  <footer>
    <p class="cite">
      단어와 평정값 출처 — 박인조·민경환 (2005). 「한국어 감정단어의 목록 작성과 차원 탐색」.
      <i>한국심리학회지: 사회 및 성격</i>, 19(1), 109–129. 부록 1의 감정단어 434개와
      쾌-불쾌·활성화·원형성·친숙성 평정값을 그대로 썼습니다.
      <b>뜻풀이와 의미 분류(대분류 16 · 중분류 74)는 이 사이트에서 붙인 것으로 논문 내용이 아닙니다.</b>
      이 앱은 심리 검사나 진단이 아니라, 감정에 이름을 붙여 보는 어휘 도구입니다.
    </p>
    <p class="en">A Korean-only vocabulary tool: it walks a semantic tree over the 434 Korean emotion words
      compiled by Park &amp; Min (2005), plotting each step on a valence–arousal quadrant so the choices
      get more specific as you go.</p>
    <a class="backlink" href="https://euichanlee0608-svg.github.io/">전체 포트폴리오 보기 →</a>
  </footer>`;
}

/* ---------------- 배치 보정 ----------------
   engine.layout 이 정규화 좌표로 이미 벌려 놓지만, 칩의 실제 픽셀 폭은
   글자 수·화면 폭에 따라 달라진다. 그려진 뒤 실제 크기로 한 번 더 떼어 놓는다. */
const GAP_X = 10, GAP_Y = 12, EDGE = 6;
function relaxChips() {
  const board = app && app.querySelector('.board');
  if (!board) return;
  const bw = board.clientWidth, bh = board.clientHeight;
  const items = [...board.querySelectorAll('.chip')].map(el => ({
    el, w: el.offsetWidth, h: el.offsetHeight,
    x: parseFloat(el.dataset.nx) * bw, y: parseFloat(el.dataset.ny) * bh,
  }));
  const clamp = it => {
    it.x = Math.min(Math.max(it.x, it.w / 2 + EDGE), bw - it.w / 2 - EDGE);
    it.y = Math.min(Math.max(it.y, it.h / 2 + EDGE), bh - it.h / 2 - EDGE);
  };
  items.forEach(clamp);
  for (let iter = 0; iter < 40; iter++) {
    let moved = false;
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const ox = (a.w + b.w) / 2 + GAP_X - Math.abs(dx);
        const oy = (a.h + b.h) / 2 + GAP_Y - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (oy <= ox * 0.6) { const s = (dy >= 0 ? 1 : -1) * oy / 2; a.y -= s; b.y += s; }
        else { const s = (dx >= 0 ? 1 : -1) * ox / 2; a.x -= s; b.x += s; }
        clamp(a); clamp(b);
      }
    if (!moved) break;
  }
  for (const it of items) { it.el.style.left = it.x + 'px'; it.el.style.top = it.y + 'px'; }
}

/* ---------------- 동작 ---------------- */
const findItem = k => levelOf(S.path).items.find(it => keyOf(it) === k);

/* 자연어 제안이나 '옆의 말'에서 단어 하나로 곧장 뛴다 — 경로도 그 단어 기준으로 채운다 */
function jumpTo(word) {
  const fam = FAMILIES[word.F];
  S.path = [fam, fam.subs[word.S], word];
  S.open = null;
  S.screen = 'final';
  render();
}

async function runAnalyze() {
  const ta = app.querySelector('#note');
  S.note = ta ? ta.value : S.note;
  if (S.note.trim().length < 4) { S.err = '조금만 더 적어 주세요 (네 글자 이상).'; render(); return; }
  S.busy = true; S.err = ''; S.sug = null; S.pick = null; S.step = 'probe';
  render();
  try {
    S.sug = await analyze(S.note, {
      WORDS, localMatch,
      onStep: k => { S.step = k; render(); },
    });
    if (S.sug.via === 'match') S.err = '모델을 쓰지 못해 글자 겹침으로만 찾았습니다. 결과가 거칠 수 있습니다.';
  } catch (e) {
    S.err = String((e && e.message) || e);
  }
  S.busy = false;
  S.scrollTarget = S.sug ? '#sug' : '#nlsec';   // 답이 나오면 그쪽으로 화면을 옮겨 준다
  render();
}

function onClick(e) {
  const el = e.target.closest('[data-act],[data-k],[data-jump],[data-sug]');
  if (!el) return;
  const act = el.dataset.act;

  if (el.dataset.jump) {
    const w = WORDS.find(x => x.w === el.dataset.jump);
    if (w) jumpTo(w);
    return;
  }
  if (el.dataset.sug) {                       // 제안 단어 고르기 → 이어갈지 마칠지 묻는다
    const w = WORDS.find(x => x.w === el.dataset.sug);
    S.pick = (S.pick && w && S.pick.w === w.w) ? null : w;
    render();
    return;
  }
  if (act === 'toNL') { scrollTo('#nlsec'); return; }
  if (act === 'pickGo' || act === 'pickEnd') {
    const w = WORDS.find(x => x.w === el.dataset.k);
    if (!w) return;
    const fam = FAMILIES[w.F];
    if (act === 'pickEnd') { jumpTo(w); return; }
    // 그 단어가 속한 중분류 화면부터 이어간다 — 옆의 미세한 차이들을 직접 보게 된다
    S.path = [fam, fam.subs[w.S]];
    S.open = w; S.screen = 'map'; render();
    return;
  }
  if (act === 'start')   { S.screen = 'map'; S.path = []; S.open = null; render(); return; }
  if (act === 'reset')   { const n = S.note, u = S.localUp; reset(); S.note = n; S.localUp = u; render(); return; }
  if (act === 'analyze') { runAnalyze(); return; }
  if (act === 'close')   { S.open = null; render(); return; }
  if (act === 'back') {
    if (S.screen === 'final') { S.screen = 'map'; S.path = S.path.slice(0, LEVELS - 1); }
    else S.path.pop();
    S.open = null; render(); return;
  }
  if (act === 'dive' || act === 'stop') {
    const it = findItem(el.dataset.k);
    if (it) {
      S.path.push(it);
      if (act === 'stop') S.screen = 'final';
      S.open = null; render();
    }
    return;
  }
  if (el.dataset.k) {
    const it = findItem(el.dataset.k);
    if (it) { S.open = (S.open && keyOf(S.open) === keyOf(it)) ? null : it; render(); }
  }
}

function scrollTo(sel, block = 'start') {
  const el = app.querySelector(sel);
  if (el) el.scrollIntoView({ behavior: 'smooth', block });
}

function render() {
  const body = S.screen === 'intro' ? viewIntro()
             : S.screen === 'final' ? viewFinal()
             : viewMap();
  const foot = S.screen === 'intro' ? viewFooter()
             : S.screen === 'final' ? viewFooterSlim() : '';
  app.innerHTML = body + foot;
  document.body.classList.toggle('sheet-open', S.screen === 'map' && !!S.open);
  if (S.screen === 'map') relaxChips();
  if (S.screen !== 'intro') window.scrollTo({ top: 0, behavior: 'instant' });
  else if (S.scrollTarget) { const t = S.scrollTarget; S.scrollTarget = null; requestAnimationFrame(() => scrollTo(t, 'center')); }
}

if (app) {
  app.addEventListener('click', onClick);
  app.addEventListener('input', e => { if (e.target.id === 'note') S.note = e.target.value; });
  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(relaxChips, 120); });
  reset();
  render();
  // 로컬 모델이 있는지 미리 확인해 안내 문구를 맞춘다(실패해도 흐름에 영향 없음)
  probeLocal().then(up => { S.localUp = up; if (S.screen === 'intro' && !S.busy) render(); });
}
