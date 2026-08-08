/* 감정의 사분면 — 재귀 줌 엔진
   가로축 = v(쾌-불쾌, 1 불쾌 ~ 7 쾌), 세로축 = p(원형성, 낮을수록 잘 안 쓰는 정확한 말).
   화면 배치는 논문 평정값 그대로다(임의 배치 아님).
   단어를 고르면 그 단어가 새 원점이 되고, 남은 후보 수를 기준으로 보는 범위가 좁아진다.

   **가로축은 고정이 아니다.** 단어를 고를 때마다 남은 후보에서 쾌-불쾌와 활성화 중
   실제로 더 잘 갈리는 쪽을 골라 다시 세운다(chooseAxis). 축을 획일화하면 막히기 때문 —
   기쁨 계열(v>=5.0, 78개) 안에서 쾌-불쾌 폭은 1.24뿐인데 활성화 폭은 4.76이다
   (편안하다 1.90 ~ 열광하다 6.66). '기쁘다'보다 쾌-불쾌가 높은 단어는 434개 중 6개지만
   활성화가 높은 단어는 44개다. 계속 쾌-불쾌로만 가르면 "더 센 기쁨"으로 갈 길이 없다.
   전체(434개)에서는 쾌-불쾌가 가장 잘 갈리므로 0단계는 자연히 '안 좋음 ↔ 좋음'이 된다.
   화면에 안 쓰인 축은 앵커 기준 밴드로 붙잡아, 고른 감정 방향에서 벗어나지 않게 한다.

   세로축은 늘 원형성(p)이다. 어떤 단어를 골라도 그 아래엔 늘 단어가 남아 막히지 않고,
   '점점 정확한 말로 내려간다'는 이 앱의 목적이 축에 그대로 드러난다. */
import { WORDS } from './data.js';

// 가로는 척도 중립값 4.0이 원점(좋음/안 좋음의 경계), 세로는 원형성 범위(2.35~5.98)의 한가운데.
// 반경은 실제 데이터를 딱 덮을 만큼만 — 넓게 잡으면 데이터 없는 가장자리가 빈 채로 남는다.
const V0 = { xk: 'v', cx: 4.0, cy: 4.17, rx: 2.75, ry: 1.85 };
// 가로축 후보. sd = 434개 전체의 표준편차(퍼짐을 이 값으로 정규화해 공평하게 비교한다).
// band = 이 축이 화면에 안 쓰일 때 앵커 기준으로 붙잡아 둘 폭.
const X_AXES = [
  { k:'v', sd:1.280, band:1.8, tag:'기분의 좋고 나쁨' },
  { k:'a', sd:0.977, band:2.1, tag:'감정의 세기' },
];
// 시야는 고정 비율이 아니라 "남은 후보 수"에 맞춰 좁힌다.
// 434개는 불쾌 쪽에 71.9%(312개)가 쏠려 있어(쾌·저활성은 35개뿐) 고정 비율로 좁히면
// 어느 방향을 골랐느냐에 따라 세분화 깊이가 딴판이 된다. 후보 수를 목표로 삼으면
// 밀도와 무관하게 매 단계 비슷한 만큼씩 좁혀진다.
const POOL_DECAY = 0.28;  // 한 단계 내려갈 때 남길 후보 비율(고정 개수로 잡으면 여정이 안 끝난다)
const MIN_SHRINK = 0.18;  // 한 번에 이보다 더 급히 좁히지 않는다
const MAX_SHRINK = 0.85;  // 한 번에 최소 이만큼은 좁힌다(항상 줌인 보장)
const MIN_R = 0.10;       // 더는 좁힐 수 없는 하한
// 앵커를 세로축 어디에 둘지(0=맨 위, 0.5=한가운데). 맨 위에 두면 심화는 확실하지만
// 위 두 사분면이 자주 비어 화면이 반쪽만 쓰인다. 살짝 내려 위쪽에도 단어가 들어오게 한다.
const ANCHOR_Y = 0.26;
const ANCHOR_TOP = (8 + ANCHOR_Y * 84).toFixed(1);  // 앵커 마커의 화면상 세로 위치(%)
const MAX_CHIPS = 12;     // 화면에 띄울 최대 단어 수
const MIN_POOL = 3;       // 후보가 이보다 적으면 여정 종료
// 세로축이 원형성이 된 뒤로는 '덜 흔한 말만' 하드 제약이 없어, 아래로 안 내려가고
// 옆으로만 돌면 여정이 15단계까지 늘어질 수 있다. 지치기 전에 끊는다.
const MAX_DEPTH = 7;
const SEP_X = 0.19, SEP_Y = 0.085; // 칩 겹침 방지 최소 간격(정규화 좌표)

const VB = [[2.2,'참담함'],[2.8,'괴로움'],[3.4,'언짢음'],[3.9,'떨떠름함'],
            [4.3,'덤덤함'],[4.9,'괜찮음'],[5.5,'좋음'],[99,'벅참']];
const AB = [[2.4,'축 가라앉은'],[3.0,'잔잔한'],[3.6,'차분한'],[4.2,'보통'],
            [4.8,'들썩이는'],[5.4,'달아오른'],[6.0,'거세게 치미는'],[99,'터질 듯한']];
// 원형성 구간 이름 — 위로 갈수록 흔한 말, 아래로 갈수록 잘 안 쓰는 말
const PB = [[3.2,'거의 안 쓰는 말'],[3.7,'드문 말'],[4.2,'덜 쓰는 말'],
            [4.7,'익숙한 말'],[5.3,'흔한 말'],[99,'누구나 쓰는 말']];

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
    x: (w[view.xk] - (view.cx - view.rx)) / (2 * view.rx),
    y: 1 - (w.p - (view.cy - view.ry)) / (2 * view.ry),
  };
}
/* 쾌-불쾌·활성화 범위는 화면에 보이든 아니든 **누적해서 좁아지기만** 한다.
   가로축이 바뀌었다고 이전에 좁혀 둔 범위가 풀리면, 기쁨 계열을 파고들다가
   갑자기 '무섭다·화나다'가 튀어나온다(실제로 그랬다). */
const inView = (w, view) => {
  if (Math.abs(w.p - view.cy) > view.ry) return false;
  if (!view.lim) return Math.abs(w[view.xk] - view.cx) <= view.rx;   // 0단계
  for (const ax of X_AXES) {
    const [lo, hi] = view.lim[ax.k];
    if (w[ax.k] < lo || w[ax.k] > hi) return false;
  }
  return Math.abs(w[view.xk] - view.cx) <= view.rx;
};

function farEnough(c, picked, view) {
  const p = pos(c, view);
  return picked.every(o => {
    const q = pos(o, view);
    return Math.abs(p.x - q.x) > SEP_X || Math.abs(p.y - q.y) > SEP_Y;
  });
}

/* 시야 안의 단어를 사분면별로 고르게 집는다. WORDS는 원형성 내림차순이라 재정렬하지 않는다.
   원형성이 세로축이 된 뒤로는 "덜 흔한 말만 남긴다"는 숨은 제약이 필요 없다 —
   아래쪽 두 사분면이 곧 더 정확한 말이라 방향이 화면에 그대로 보이고,
   위로 갈지 아래로 갈지는 사용자가 보고 고른다. */
function pickWords(view, visited, n = MAX_CHIPS) {
  const cands = WORDS.filter(w => inView(w, view) && !visited.has(w.w));
  const q = [[], [], [], []];
  for (const w of cands) q[(w[view.xk] >= view.cx ? 1 : 0) + (w.p >= view.cy ? 2 : 0)].push(w);

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

/* 남은 후보에서 어느 축이 더 잘 갈리는지 고른다 — "단어 의미에 맞게 사분면을 다시 세우는" 부분.
   점수 = 퍼짐(전체 표준편차로 정규화) × 균형. 균형을 함께 보는 이유는, 앵커가 그 축의 극단에
   있으면 아무리 퍼져 있어도 한쪽 사분면이 통째로 비기 때문이다(기쁘다의 쾌-불쾌가 그랬다). */
function chooseAxis(cands, anchor) {
  let best = X_AXES[0], bestScore = -1;
  for (const ax of X_AXES) {
    if (cands.length < 2) continue;
    const vals = cands.map(w => w[ax.k]);
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((t, x) => t + (x - m) ** 2, 0) / vals.length);
    const lo = vals.filter(v => v < anchor[ax.k]).length, hi = vals.length - lo;
    const balance = Math.min(lo, hi) / Math.max(lo, hi, 1);
    const score = (sd / ax.sd) * (0.05 + 0.95 * balance);
    if (score > bestScore) { bestScore = score; best = ax; }
  }
  return best;
}

/* 고른 단어를 가로축 한가운데 · 세로축 맨 위에 두고, 남은 후보가 직전의 POOL_DECAY 배가
   되도록 세로를 좁힌 뒤, 그 후보들에 맞는 가로축을 새로 고른다.
   세로에서 앵커를 위 끝에 두는 이유 — 원형성 1위인 '기쁘다'를 고르면 그보다 흔한 말이 없어
   위 두 사분면이 통째로 빈다. 위 끝에 두면 화면은 늘 '앵커보다 정확한 말'로 채워진다. */
function fitView(w, prev, visited, prevPool) {
  const target = Math.max(MIN_POOL, Math.round(prevPool * POOL_DECAY));

  // 두 축 범위를 앵커 기준으로 한 번 더 좁힌다(기존 범위와 교집합 — 넓어지는 일은 없다)
  const lim = {};
  for (const a of X_AXES) {
    const [plo, phi] = prev.lim ? prev.lim[a.k] : [-Infinity, Infinity];
    lim[a.k] = [Math.max(plo, w[a.k] - a.band), Math.min(phi, w[a.k] + a.band)];
  }
  const within = x => X_AXES.every(a => x[a.k] >= lim[a.k][0] && x[a.k] <= lim[a.k][1]);

  // 세로(원형성)를 좁히면서, 매 후보 집합마다 가로축을 새로 고른다
  let ry = prev.ry * MAX_SHRINK, cands = [], ax = X_AXES[0];
  for (let s = 1; s >= MIN_SHRINK / MAX_SHRINK; s -= 0.02) {
    const ty = prev.ry * MAX_SHRINK * s;
    if (ty < MIN_R) break;
    ry = ty;
    const top = w.p + 2 * ty * ANCHOR_Y;   // 앵커 위로 남기는 여유
    cands = WORDS.filter(x => !visited.has(x.w) && x.p <= top && x.p >= top - 2 * ty && within(x));
    ax = chooseAxis(cands, w);
    if (cands.length <= target) break;
  }

  // 3) 가로 반경은 그 후보들을 딱 덮을 만큼
  const spread = cands.length
    ? Math.max(...cands.map(x => Math.abs(x[ax.k] - w[ax.k]))) : MIN_R;
  const rx = Math.max(MIN_R, spread * 1.06);

  return { xk: ax.k, cx: w[ax.k], rx, cy: w.p + ry * (2 * ANCHOR_Y - 1), ry, lim };
}

/* --- 축 라벨: 깊어질수록 좁은 구간의 이름으로 바뀐다 --- */
function axisLabels(view, depth) {
  if (depth === 0) return {
    left:  { main:'안 좋음',        sub:'불쾌한 쪽' },
    right: { main:'좋음',          sub:'기분 좋은 쪽' },
    top:   { main:'누구나 쓰는 말',  sub:'흔한 표현' },
    bottom:{ main:'잘 안 쓰는 말',  sub:'더 정확한 표현 ↓' },
  };
  const isV = view.xk === 'v';
  const l = band(isV ? VB : AB, view.cx - view.rx);
  const r = band(isV ? VB : AB, view.cx + view.rx);
  const b = band(PB, view.cy - view.ry), t = band(PB, view.cy + view.ry);
  return {
    left:  l !== r ? { main:l, sub: isV ? '← 덜 좋은 쪽' : '← 더 여린 쪽' }
                   : { main: isV ? '조금 더 무거운' : '조금 더 잔잔한', sub:l },
    right: l !== r ? { main:r, sub: isV ? '더 좋은 쪽 →' : '더 센 쪽 →' }
                   : { main: isV ? '조금 더 가벼운' : '조금 더 거센', sub:r },
    top:   t !== b ? { main:t, sub:'더 익숙한 쪽' } : { main:'조금 더 익숙한', sub:t },
    bottom:t !== b ? { main:b, sub:'더 정확한 쪽 ↓' } : { main:'조금 더 낯선', sub:b },
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
  const anchor = S.path[S.path.length - 1];
  const words = pickWords(S.view, S.visited);
  const ax = axisLabels(S.view, S.depth);

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
    ? '가로축은 기분의 좋고 나쁨, 세로축은 그 말을 얼마나 흔히 쓰는지입니다. <b>아래로 갈수록 잘 안 쓰는, 더 정확한 말</b>이 나옵니다.'
    : `「${esc(anchor.w)}」이(가) 한가운데이고 <b>아래쪽이 더 정확한 말</b>입니다. 이 언저리는 가로로 <b>${X_AXES.find(a => a.k === S.view.xk).tag}</b>가 가장 잘 갈려서 그걸 가로축으로 세웠습니다. 남은 ${poolSize(S.view, S.visited)}개 가운데 ${words.length}개를 띄웠습니다.`;

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
      ${S.depth ? `<button class="btn sm here" data-act="stopHere">여기서 멈추기</button>` : ''}
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
        <div class="origin"${anchor ? ` style="top:${ANCHOR_TOP}%"` : ''}></div>
        ${anchor ? `<div class="origin-label" style="top:${ANCHOR_TOP}%">${esc(anchor.w)}</div>` : ''}
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
  if (S.depth >= MAX_DEPTH || pickWords(S.view, S.visited).length < MIN_POOL) S.screen = 'final';
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
  else if (act === 'stopHere') { S.screen = 'final'; render(); }
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
export { WORDS, V0, POOL_DECAY, MAX_SHRINK, MAX_CHIPS, MIN_POOL, MAX_DEPTH, SEP_X, SEP_Y,
         pos, inView, pickWords, poolSize, fitView, axisLabels };
