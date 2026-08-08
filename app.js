/* 감정의 사분면 — 재귀 줌 엔진
   좌표계: v = 쾌-불쾌(1 불쾌 ~ 7 쾌), a = 활성화(1 비활성 ~ 7 활성).
   화면 배치는 단어의 실제 평정값 그대로다(임의 배치 아님).
   단어를 고르면 그 단어가 새 원점이 되고, 남은 후보 수를 기준으로 보는 범위가 좁아진다. */
import { WORDS } from './data.js';

// 원점은 7점 척도의 중립값 4.0에 두되, 반경은 실제 데이터(v 1.29~6.24, a 1.90~6.66)를
// 딱 덮을 만큼만 잡는다 — 전체 1~7로 잡으면 데이터가 없는 가장자리가 빈 채로 남는다.
const V0 = { cx: 4.0, cy: 4.0, rx: 2.75, ry: 2.7 };
// 시야는 고정 비율이 아니라 "남은 후보 수"에 맞춰 좁힌다.
// 434개는 불쾌 쪽에 71.9%(312개)가 쏠려 있어(쾌·저활성은 35개뿐) 고정 비율로 좁히면
// 어느 방향을 골랐느냐에 따라 세분화 깊이가 딴판이 된다. 후보 수를 목표로 삼으면
// 밀도와 무관하게 매 단계 비슷한 만큼씩 좁혀진다.
const POOL_DECAY = 0.35;  // 한 단계 내려갈 때 남길 후보 비율(고정 개수로 잡으면 여정이 안 끝난다)
const MIN_SHRINK = 0.30;  // 한 번에 이보다 더 급히 좁히지 않는다
const MAX_SHRINK = 0.85;  // 한 번에 최소 이만큼은 좁힌다(항상 줌인 보장)
const MIN_R = 0.10;       // 더는 좁힐 수 없는 하한
const MAX_CHIPS = 12;     // 화면에 띄울 최대 단어 수
const MIN_POOL = 3;       // 후보가 이보다 적으면 여정 종료
const SEP_X = 0.19, SEP_Y = 0.085; // 칩 겹침 방지 최소 간격(정규화 좌표)

const VB = [[2.2,'참담함'],[2.8,'괴로움'],[3.4,'언짢음'],[3.9,'떨떠름함'],
            [4.3,'덤덤함'],[4.9,'괜찮음'],[5.5,'좋음'],[99,'벅참']];
const AB = [[2.4,'축 처진'],[3.0,'잔잔한'],[3.6,'차분한'],[4.2,'보통'],
            [4.8,'들썩이는'],[5.4,'달아오른'],[6.0,'치미는'],[99,'터질 듯한']];

const app = typeof document !== 'undefined' ? document.getElementById('app') : null;
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const band = (t, v) => { for (const [th, l] of t) if (v < th) return l; return t[t.length-1][1]; };

let S;
function reset() {
  S = { screen:'intro', view:{...V0}, depth:0, path:[], visited:new Set(), open:null, history:[] };
}

/* --- 좌표 --- */
function pos(w, view) {
  return {
    x: (w.v - (view.cx - view.rx)) / (2 * view.rx),
    y: 1 - (w.a - (view.cy - view.ry)) / (2 * view.ry),
  };
}
const inView = (w, view) =>
  Math.abs(w.v - view.cx) <= view.rx && Math.abs(w.a - view.cy) <= view.ry;

function farEnough(c, picked, view) {
  const p = pos(c, view);
  return picked.every(o => {
    const q = pos(o, view);
    return Math.abs(p.x - q.x) > SEP_X || Math.abs(p.y - q.y) > SEP_Y;
  });
}

/* 시야 안의 단어를 사분면별로 고르게, 원형성(대표성) 높은 순으로 집는다.
   WORDS는 원형성 내림차순으로 정렬되어 있으므로 재정렬하지 않는다. */
function pickWords(view, visited, n = MAX_CHIPS) {
  const cands = WORDS.filter(w => inView(w, view) && !visited.has(w.w));
  const q = [[], [], [], []];
  for (const w of cands) q[(w.v >= view.cx ? 1 : 0) + (w.a >= view.cy ? 2 : 0)].push(w);

  const picked = [];
  const per = Math.ceil(n / 4);
  for (let i = 0; i < per; i++) {
    for (const b of q) {
      if (picked.length >= n) break;
      while (b.length) {
        const c = b.shift();
        if (farEnough(c, picked, view)) { picked.push(c); break; }
      }
    }
  }
  // 사분면이 비어 채우지 못했으면 남은 후보로 보충
  if (picked.length < n) {
    for (const b of q) for (const c of b) {
      if (picked.length >= n) break;
      if (farEnough(c, picked, view)) picked.push(c);
    }
  }
  return picked;
}

function poolSize(view, visited) {
  return WORDS.filter(w => inView(w, view) && !visited.has(w.w)).length;
}

/* 고른 단어를 새 원점으로 두고, 남은 후보가 직전의 POOL_DECAY 배가 되도록 시야를 좁힌다.
   단어가 빽빽한 쪽(불쾌)은 많이, 성긴 쪽(쾌·저활성 35개)은 적게 좁아져서
   어느 방향을 골라도 비슷한 단계 수로 세분화된다.
   가로세로 비율은 그대로 유지해 좌표가 왜곡되지 않게 한다. */
function fitView(w, prev, visited, prevPool) {
  const target = Math.max(MIN_POOL, Math.round(prevPool * POOL_DECAY));
  const baseX = prev.rx * MAX_SHRINK, baseY = prev.ry * MAX_SHRINK;
  const center = { cx: w.v, cy: w.a };
  let rx = baseX, ry = baseY;
  for (let s = 1; s >= MIN_SHRINK / MAX_SHRINK; s -= 0.02) {
    const tx = baseX * s, ty = baseY * s;
    if (tx < MIN_R || ty < MIN_R) break;
    rx = tx; ry = ty;
    if (poolSize({ ...center, rx, ry }, visited) <= target) break;
  }
  return { ...center, rx: Math.max(rx, MIN_R), ry: Math.max(ry, MIN_R) };
}

/* --- 축 라벨: 깊어질수록 좁은 구간의 이름으로 바뀐다 --- */
function axisLabels(view, depth) {
  if (depth === 0) return {
    left:  { main:'안 좋음', sub:'불쾌한 쪽' },
    right: { main:'좋음',   sub:'기분 좋은 쪽' },
    top:   { main:'심함',   sub:'센 감정' },
    bottom:{ main:'약함',   sub:'여린 감정' },
  };
  const l = band(VB, view.cx - view.rx), r = band(VB, view.cx + view.rx);
  const b = band(AB, view.cy - view.ry), t = band(AB, view.cy + view.ry);
  return {
    left:  l !== r ? { main:l, sub:'← 덜 좋은 쪽' } : { main:'조금 더 무거운', sub:l },
    right: l !== r ? { main:r, sub:'더 좋은 쪽 →' } : { main:'조금 더 가벼운', sub:r },
    top:   t !== b ? { main:t, sub:'더 센 쪽' }     : { main:'조금 더 북받치는', sub:t },
    bottom:t !== b ? { main:b, sub:'더 여린 쪽' }   : { main:'조금 더 가라앉은', sub:b },
  };
}

/* --- 화면 --- */
function viewIntro() {
  return `
  <div class="intro">
    <h1>지금 내 마음에<br><em>이름을 붙여 볼까요</em></h1>
    <p>“기분이 안 좋다”로는 잘 안 잡히는 감정이 있습니다.
       고를 때마다 더 좁은 자리로 들어갑니다.</p>
    <div class="steps">
      <div class="step"><i>1</i><b>네 갈래에서 고르기</b><span>지금에 가까운 단어를 누릅니다.</span></div>
      <div class="step"><i>2</i><b>뜻을 보고 정하기</b><span>읽어 보고 맞으면 그쪽으로 좁힙니다.</span></div>
      <div class="step"><i>3</i><b>점점 가까이</b><span>고른 단어가 한가운데가 되고, 몰랐던 단어가 나타납니다.</span></div>
    </div>
    <button class="btn" data-act="start">시작하기</button>
    <p style="margin-top:26px;font-size:.8rem;color:var(--ink-faint)">
      한국어 감정단어 <b>434개</b>로 만들었습니다.</p>
  </div>`;
}

function viewMap() {
  const words = pickWords(S.view, S.visited);
  const ax = axisLabels(S.view, S.depth);
  const anchor = S.path[S.path.length - 1];

  const chips = words.map((w, i) => {
    const p = pos(w, S.view);
    const left = (6 + p.x * 88).toFixed(2), top = (8 + p.y * 84).toFixed(2);
    const s = (0.86 + (w.p - 2.25) / (5.98 - 2.25) * 0.22).toFixed(3); // 원형성 → 크기
    const on = S.open && S.open.w === w.w ? ' on' : '';
    // data-nx/ny 를 남겨 두면 리사이즈 때 픽셀 배치를 처음부터 다시 계산할 수 있다
    return `<button class="chip${on}" data-w="${esc(w.w)}" data-nx="${p.x.toFixed(5)}" data-ny="${p.y.toFixed(5)}"
      style="left:${left}%;top:${top}%;--s:${s};animation-delay:${(i*45)}ms,${(i*310)%2400}ms">${esc(w.w)}</button>`;
  }).join('');

  const trail = S.path.length
    ? `<div class="trail">${S.path.map(p => `<span>${esc(p.w)}</span>`).join('<b>›</b>')}</div>` : '';

  const prompt = S.depth === 0
    ? `지금 마음에 가장 <em>가까운 쪽</em>은 어디인가요?`
    : `<em>${esc(anchor.w)}</em> 언저리를 더 들여다봅니다.`;
  const sub = S.depth === 0
    ? '가로축은 기분의 좋고 나쁨, 세로축은 감정의 세기입니다. 단어를 누르면 뜻이 보입니다.'
    : `축이 한 겹 더 촘촘해졌습니다. 「${esc(anchor.w)}」이(가) 한가운데입니다. 이 언저리에 남은 단어 ${poolSize(S.view, S.visited)}개 가운데 가까운 ${words.length}개를 띄웠습니다.`;

  const sheet = S.open ? `
    <div class="sheet">
      <h3>${esc(S.open.w)}</h3>
      <p class="def">${esc(S.open.d)}</p>
      <p class="meta">쾌-불쾌 ${S.open.v.toFixed(2)} · 활성화 ${S.open.a.toFixed(2)} · 원형성 ${S.open.p.toFixed(2)} (7점 척도)</p>
      <div class="acts">
        <button class="btn sm" data-act="dive" data-w="${esc(S.open.w)}">이쪽으로 좁히기 →</button>
        <button class="btn sm ghost" data-act="stop" data-w="${esc(S.open.w)}">이게 지금 내 감정이에요</button>
        <button class="btn sm ghost" data-act="close">다시 고르기</button>
      </div>
    </div>`
    : `<p class="hint">단어를 눌러 뜻을 확인해 보세요.</p>`;

  return `
    <div class="topbar">
      <span class="depth-pill">${S.depth + 1}단계</span>
      ${trail}
      <span class="spacer"></span>
      ${S.history.length ? `<button class="btn sm ghost" data-act="back">뒤로</button>` : ''}
      <button class="btn sm ghost" data-act="reset">처음부터</button>
    </div>
    <p class="prompt">${prompt}</p>
    <p class="sub">${sub}</p>
    <div class="board-outer">
      <div class="axl left">${esc(ax.left.main)}<small>${esc(ax.left.sub)}</small></div>
      <div class="axl right">${esc(ax.right.main)}<small>${esc(ax.right.sub)}</small></div>
      <div class="axl top">${esc(ax.top.main)}<small>${esc(ax.top.sub)}</small></div>
      <div class="axl bottom">${esc(ax.bottom.main)}<small>${esc(ax.bottom.sub)}</small></div>
      <div class="board">
        <div class="quad tl"></div><div class="quad tr"></div>
        <div class="quad bl"></div><div class="quad br"></div>
        <div class="axis h"></div><div class="axis v"></div>
        <div class="origin"></div>
        ${anchor ? `<div class="origin-label">${esc(anchor.w)}</div>` : ''}
        ${chips}
      </div>
    </div>
    ${sheet}`;
}

function viewFinal() {
  const w = S.path[S.path.length - 1];
  const pct = x => ((x - 1) / 6 * 100).toFixed(1);
  const journey = S.path.map(p => `<span>${esc(p.w)}</span>`).join('<b>›</b>');
  const rank = WORDS.filter(x => x.p > w.p).length + 1;

  return `
  <div class="result">
    <p class="kick">${S.path.length}단계를 지나 닿은 단어</p>
    <div class="final-word">${esc(w.w)}</div>
    <p class="def">${esc(w.d)}</p>

    <div class="card">
      <h4>내가 지나온 길</h4>
      <div class="journey">${journey}</div>
    </div>

    <div class="card">
      <h4>이 단어의 자리 (논문 평정값, 7점 척도)</h4>
      <div class="coords">
        <div class="co">
          <div class="lab">쾌-불쾌 &nbsp;<span style="color:var(--ink-soft)">1 불쾌 → 7 쾌</span></div>
          <div class="val">${w.v.toFixed(2)}</div>
          <div class="bar"><i style="width:${pct(w.v)}%"></i></div>
        </div>
        <div class="co">
          <div class="lab">활성화 &nbsp;<span style="color:var(--ink-soft)">1 가라앉음 → 7 치솟음</span></div>
          <div class="val">${w.a.toFixed(2)}</div>
          <div class="bar"><i style="width:${pct(w.a)}%"></i></div>
        </div>
      </div>
      <p style="font-size:.76rem;color:var(--ink-faint);margin-top:14px;line-height:1.7">
        원형성 ${w.p.toFixed(2)} — 434개 가운데 ${rank}번째로 “감정단어답다”고 평정된 말입니다.
        ${w.r ? '논문이 구조 분석에 쓴 대표 단어 87개에 듭니다.' : ''}
      </p>
    </div>

    <div class="acts">
      <button class="btn" data-act="reset">다시 해보기</button>
      <button class="btn ghost" data-act="back">한 단계 뒤로</button>
    </div>
  </div>`;
}

/* 지도 화면에서는 푸터를 아예 빼서 뜻 카드가 화면 안에 들어오게 한다.
   결과 화면에는 논문 수치를 그대로 띄우므로 출처 한 줄은 반드시 남긴다. */
function viewFooterSlim() {
  return `
  <footer class="slim">
    <p>평정값 출처 — 박인조·민경환 (2005), 「한국어 감정단어의 목록 작성과 차원 탐색」,
       <i>한국심리학회지: 사회 및 성격</i>, 19(1), 109–129. 뜻풀이는 이 사이트에서 붙였습니다.
       심리 검사나 진단이 아닙니다.</p>
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
      뜻풀이는 이 사이트에서 붙인 것으로 논문 내용이 아닙니다.
      이 앱은 심리 검사나 진단이 아니라, 감정에 이름을 붙여 보는 어휘 도구입니다.
    </p>
    <p class="en">A Korean-only vocabulary tool: it maps the 434 Korean emotion words compiled by
      Park &amp; Min (2005) onto the valence–arousal plane, then recursively re-centers on the word you pick
      so the axes get finer at every step.</p>
    <a class="backlink" href="https://euichanlee0608-svg.github.io/">전체 포트폴리오 보기 →</a>
  </footer>`;
}

/* --- 배치 보정 ---
   칩 폭은 글자 수와 화면 폭에 따라 달라져서 정규화 좌표만으로는 겹침·이탈을 못 막는다.
   그래서 그린 뒤 실제 픽셀로 (1) 보드 안으로 클램프하고 (2) 겹친 쌍을 밀어 떼어 놓는다.
   GAP_Y 가 넉넉한 건 칩이 bob 애니메이션으로 최대 5px 위아래로 흔들리기 때문. */
const GAP_X = 8, GAP_Y = 12, EDGE = 5;

function relaxChips() {
  const board = app.querySelector('.board');
  if (!board) return;
  const bw = board.clientWidth, bh = board.clientHeight;
  const items = [...board.querySelectorAll('.chip')].map(el => ({
    el, w: el.offsetWidth, h: el.offsetHeight,
    x: (6 + parseFloat(el.dataset.nx) * 88) / 100 * bw,
    y: (8 + parseFloat(el.dataset.ny) * 84) / 100 * bh,
  }));
  const clamp = it => {
    it.x = Math.min(Math.max(it.x, it.w / 2 + EDGE), bw - it.w / 2 - EDGE);
    it.y = Math.min(Math.max(it.y, it.h / 2 + EDGE), bh - it.h / 2 - EDGE);
  };
  items.forEach(clamp);

  for (let iter = 0; iter < 30; iter++) {
    let moved = false;
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const ox = (a.w + b.w) / 2 + GAP_X - Math.abs(dx);
        const oy = (a.h + b.h) / 2 + GAP_Y - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;         // 안 겹침
        moved = true;
        if (oy <= ox * 0.6) {                      // 세로로 떼는 게 싸다
          const s = (dy >= 0 ? 1 : -1) * oy / 2;
          a.y -= s; b.y += s;
        } else {
          const s = (dx >= 0 ? 1 : -1) * ox / 2;
          a.x -= s; b.x += s;
        }
        clamp(a); clamp(b);
      }
    if (!moved) break;
  }
  for (const it of items) { it.el.style.left = it.x + 'px'; it.el.style.top = it.y + 'px'; }
}

/* --- 동작 --- */
function dive(w) {
  S.history.push({ view: {...S.view}, path: [...S.path], depth: S.depth });
  const prevPool = poolSize(S.view, S.visited);
  S.path.push(w);
  S.visited.add(w.w);
  S.view = fitView(w, S.view, S.visited, prevPool);
  S.depth++;
  S.open = null;
  // 실제로 띄울 칩이 몇 개인지로 종료를 판단한다(후보 총수로 하면 칩 1개짜리 화면이 나온다)
  if (pickWords(S.view, S.visited).length < MIN_POOL) S.screen = 'final';
  render();
}

function back() {
  const h = S.history.pop();
  if (!h) return;
  S.view = h.view; S.path = h.path; S.depth = h.depth;
  S.visited = new Set(h.path.map(p => p.w));
  S.open = null; S.screen = 'map';
  render();
}

function onClick(e) {
  const btn = e.target.closest('[data-act],[data-w]');
  if (!btn) return;
  const act = btn.dataset.act;
  const word = btn.dataset.w ? WORDS.find(x => x.w === btn.dataset.w) : null;

  if (act === 'start') { S.screen = 'map'; render(); }
  else if (act === 'reset') { reset(); S.screen = 'map'; render(); }
  else if (act === 'back') back();
  else if (act === 'close') { S.open = null; render(); }
  else if (act === 'dive') dive(word);
  else if (act === 'stop') { S.path.push(word); S.visited.add(word.w); S.screen = 'final'; render(); }
  else if (word) { S.open = (S.open && S.open.w === word.w) ? null : word; render(); }
}

function render() {
  const body = S.screen === 'intro' ? viewIntro()
             : S.screen === 'final' ? viewFinal()
             : viewMap();
  const foot = S.screen === 'intro' ? viewFooter()
             : S.screen === 'final' ? viewFooterSlim()
             : '';
  app.innerHTML = body + foot;
  relaxChips();
  if (S.screen !== 'intro') window.scrollTo({ top: 0, behavior: 'instant' });
}

if (app) {
  app.addEventListener('click', onClick);
  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(relaxChips, 120); });
  reset();
  render();
}

/* 브라우저 밖(테스트)에서 엔진만 따로 검증하기 위한 노출 */
export { WORDS, V0, POOL_DECAY, MAX_SHRINK, MAX_CHIPS, MIN_POOL, SEP_X, SEP_Y,
         pos, inView, pickWords, poolSize, fitView, axisLabels };
