/* 감정의 사분면 — 화면.
   탐색 로직은 engine.js 에 있다(브라우저 없이 테스트할 수 있게 분리). */
import { WORDS } from './data.js';
import { FAMILIES, LEVELS, levelOf, layout, axisLabels, localMatch } from './engine.js';
import { analyze, probeLocal } from './analyze.js';

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
/* 사용자에게는 진행중 / 완료 / 실패만 보여 준다.
   중간에 어떤 경로가 실패했는지, 무슨 모델이 처리했는지는 알 필요가 없고
   오히려 "실패했나?" 하고 불안해진다(실제 지적받음). 자세한 건 콘솔·텔레그램으로만 남는다. */
function viewStatus() {
  if (S.busy) {
    const slow = S.step === 'queued';
    return `<p class="status busy"><span class="spin"></span>${
      slow ? '조금 오래 걸리고 있습니다 — 다른 방법으로 찾는 중입니다'
           : '읽는 중입니다…'}</p>`;
  }
  if (S.err) return `<p class="status fail">${esc(S.err)}</p>`;
  if (S.sug) return `<p class="status done">✓ 찾았습니다</p>`;
  return '';
}

/* 배경에 흐르는 감정 단어들 — 첫 화면이 무슨 앱인지 한눈에 말해 준다 */
const DRIFT = ['서운하다','후련하다','겸연쩍다','아련하다','울화통','뿌듯하다','착잡하다','시원섭섭하다',
               '멋쩍다','허허롭다','설레다','괘씸하다','뭉클하다','심드렁하다','애틋하다','떨떠름하다'];

function viewIntro() {
  const sug = S.sug;
  const hint = S.localUp === true
    ? '이 컴퓨터의 로컬 모델을 먼저 씁니다 — 글이 밖으로 나가지 않습니다'
    : '입력한 글은 분석에만 쓰이고 저장하지 않습니다';

  return `
  <div class="intro">
    <section class="why reveal">
      <div class="drift" aria-hidden="true">${DRIFT.map((w, i) => {
        // 좌표는 여기서 계산한다 — CSS calc() 에는 나머지 연산자가 없어 % 를 쓰면 규칙이 통째로 무효가 된다.
        // 가운데는 본문이 차지하므로 좌·우 바깥 띠에만 번갈아 놓는다(글자 위에 겹치지 않게).
        const x = (i % 2 ? 62 + (i * 13) % 30 : 2 + (i * 11) % 22).toFixed(1);
        const y = (5 + (i * 53) % 88).toFixed(1);
        const sz = (0.82 + (i % 5) * 0.16).toFixed(2);
        return `<span style="left:${x}%;top:${y}%;font-size:${sz}rem;animation-delay:${(i * -1.4).toFixed(1)}s">${esc(w)}</span>`;
      }).join('')}</div>
      <p class="why-kick">이 사이트에 대하여</p>
      <h1 class="why-h">아는 단어만큼만<br><em>보인다</em></h1>
      <blockquote class="why-quote">
        “언어의 한계가 내 세계의 한계다.”
        <cite>루트비히 비트겐슈타인, 『논리철학논고』</cite>
      </blockquote>
      <p class="why-p">감정도 다르지 않습니다. “기분이 안 좋다”로 뭉뚱그리면 마음도 딱 그만큼만 보입니다.
        억울한 것과 서운한 것과 허탈한 것은 서로 다른 상태이고,
        <b>이름이 달라지면 그다음에 할 일도 달라집니다.</b></p>
      <p class="why-p">한국어 감정단어 <b>434개</b>를 기분과 세기의 지도 위에 펼쳐 놓았습니다.
        세 번만 고르면 지금 상태에 더 맞는 말에 닿습니다.</p>
      <button class="scroll-cue" data-act="toHero">시작해 보기<i>▾</i></button>
    </section>

    <section class="hero reveal" id="herosec">
      <h2 class="hero-h">지금 내 마음에<br><em>이름을 붙여 볼까요</em></h2>
      <p class="hero-p">세 번만 고르면 그 자리에 맞는 말에 닿습니다.</p>
      <div class="cta"><button class="btn" data-act="start">시작하기</button></div>
      <div class="steps">
        <div class="step"><i>1</i><b>어느 갈래인가</b><span>16개 큰 갈래에서 가까운 쪽을 고릅니다.</span></div>
        <div class="step"><i>2</i><b>어떤 결인가</b><span>같은 갈래라도 결이 다릅니다.</span></div>
        <div class="step"><i>3</i><b>어떤 말인가</b><span>몰랐던 단어에 닿습니다.</span></div>
      </div>
      <button class="scroll-cue" data-act="toNL">글로 적어서 찾기<i>▾</i></button>
    </section>

    <section class="nl-sec reveal" id="nlsec">
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
        ${viewStatus()}
        ${sug ? viewSuggest(sug) : ''}
      </div>
    </section>
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
      <button class="btn" data-act="again">다시 해보기</button>
      ${S.path.length > 1 ? `<button class="btn ghost" data-act="back">한 단계 뒤로</button>` : ''}
      <button class="btn ghost" data-act="reset">처음 화면으로</button>
    </div>

    <div class="nl compact">
      <label for="note">다른 상황으로 찾아보기</label>
      <textarea id="note" rows="2" maxlength="400"
        placeholder="지금 상황이나 기분을 문장으로 적어 보세요">${esc(S.note)}</textarea>
      <div class="nl-row">
        <button class="btn sm" data-act="analyze2" ${S.busy ? 'disabled' : ''}>
          ${S.busy ? '읽는 중…' : '이 글에서 감정 찾아보기'}</button>
        <span class="nl-hint">${esc(S.localUp === true ? '로컬 모델을 먼저 씁니다' : '입력한 글은 저장하지 않습니다')}</span>
      </div>
      ${viewStatus()}
      ${S.sug ? viewSuggest(S.sug) : ''}
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
      서울대학교 심리학과 민경환 교수(정서심리학) 연구팀이 국어사전에서 감정 어휘를 모아
      감정 연구자 10명의 판단으로 434개를 확정하고, 각 단어의 쾌-불쾌·활성화·원형성·친숙성을
      대학생들에게 7점 척도로 평정받은 연구입니다. 이 사이트의 가로·세로 좌표는 전부 그 평정값입니다.
      <b>뜻풀이와 의미 분류(대분류 16 · 중분류 73)는 이 사이트에서 붙인 것으로 논문 내용이 아닙니다.</b>
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

async function runAnalyze(inResult = false) {
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
  } catch (e) {
    S.err = String((e && e.message) || e);
  }
  S.busy = false;
  S.scrollTarget = S.sug ? '#sug' : (inResult ? '.nl.compact' : '#nlsec');  // 답이 나오면 그쪽으로
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
  if (act === 'toNL')   { scrollTo('#nlsec'); return; }
  if (act === 'toHero') { scrollTo('#herosec'); return; }
  if (act === 'again')  {           // 결과에서 '다시 해보기' → 첫 사분면으로
    S.path = []; S.open = null; S.sug = null; S.pick = null; S.err = '';
    S.screen = 'map'; render(); return;
  }
  if (act === 'analyze2') { runAnalyze(true); return; }
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

/* 배경 단어를 본문 밖으로 밀어낸다.
   화면 폭에 따라 본문이 차지하는 자리가 달라져서 고정 비율로는 못 피한다 —
   그려진 뒤 실제 글자 상자를 재서, 겹치면 위/아래 남는 띠로 옮기고 그래도 없으면 숨긴다. */
function placeDrift() {
  const box = app.querySelector('.drift');
  if (!box) return;
  const bb = box.getBoundingClientRect();
  const texts = [...app.querySelectorAll('.why-kick,.why-h,.why-quote,.why-p,.scroll-cue')]
    .map(e => e.getBoundingClientRect());
  if (!texts.length || !bb.height) return;

  const top = Math.min(...texts.map(r => r.top)) - bb.top - 10;   // 본문 위 여유
  const bot = Math.max(...texts.map(r => r.bottom)) - bb.top + 10; // 본문 아래 여유
  const bands = [];
  if (top > 34) bands.push({ y: 4, h: top - 4 });
  if (bb.height - bot > 34) bands.push({ y: bot, h: bb.height - bot - 4 });

  const els = [...box.children];
  if (!bands.length) { els.forEach(e => { e.style.visibility = 'hidden'; }); return; }

  // 자리(줄 × 좌/우)를 먼저 다 만들어 두고 하나씩 채운다.
  // 자리보다 단어가 많으면 남는 건 접는다 — 한 자리에 둘을 넣으면 겹친다.
  const spots = [];
  bands.forEach(b => {
    const rows = Math.max(1, Math.min(5, Math.floor(b.h / 34)));
    const gap = b.h / rows;
    for (let r = 0; r < rows; r++) {
      const y = b.y + gap * r + gap * 0.12;
      spots.push({ y, side: 0 }, { y, side: 1 });
    }
  });

  // 띠 안에는 본문이 없으니 가로로도 흩는다(좌·우 반쪽으로 나눠 서로 안 겹치게)
  els.forEach((el, i) => {
    if (i >= spots.length) { el.style.visibility = 'hidden'; return; }
    const sp = spots[i], w = el.offsetWidth, half = bb.width / 2;
    const lo = sp.side ? half + 6 : 6;
    const hi = Math.max(lo, (sp.side ? bb.width - 6 : half - 6) - w);
    el.style.visibility = '';
    el.style.left = (lo + ((i * 29) % 100) / 100 * (hi - lo)) + 'px';
    el.style.top = sp.y + 'px';
  });
}

/* 스크롤로 들어오는 섹션을 부드럽게 띄운다(모션 최소화 설정은 CSS 에서 무시됨) */
let io;
function reveal() {
  const els = app.querySelectorAll('.reveal');
  if (!els.length) return;
  if (!io && 'IntersectionObserver' in window) {
    io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: 0.12 });
  }
  els.forEach(el => io ? io.observe(el) : el.classList.add('in'));
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
  if (S.scrollTarget) {
    const t = S.scrollTarget; S.scrollTarget = null;
    requestAnimationFrame(() => scrollTo(t, 'center'));
  } else if (S.screen !== 'intro') {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  reveal();
  if (S.screen === 'intro') requestAnimationFrame(placeDrift);
}

if (app) {
  app.addEventListener('click', onClick);
  app.addEventListener('input', e => { if (e.target.id === 'note') S.note = e.target.value; });
  let rt;
  addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { relaxChips(); if (S.screen === 'intro') placeDrift(); }, 120);
  });
  reset();
  render();
  // 로컬 모델이 있는지 미리 확인해 안내 문구를 맞춘다(실패해도 흐름에 영향 없음)
  probeLocal().then(up => { S.localUp = up; if (S.screen === 'intro' && !S.busy) render(); });
}
