/* 감정의 사분면 — 의미 트리 탐색 엔진 (화면과 분리해 테스트 가능하게 둔다)

   왜 좌표 줌이 아니라 트리인가 —
   쾌-불쾌·활성화 좌표만으로 이웃을 잡으면 의미가 섞인다. '외롭다'와 '지루하다'는
   좌표 거리가 0.72로 붙어 있지만 전혀 다른 감정이다. 좌표를 계속 좁히면
   "점점 정확한 말"이 아니라 "좌표만 가까운 남의 감정"이 나온다.
   그래서 434개에 의미 계층(대분류 16 → 중분류 74 → 단어)을 직접 붙이고, 그 트리를 탄다.
   논문도 같은 방식이었다(225개를 87범주로 묶어 대표어 선정) — 다만 구성원 목록이 미공개다.

   세 걸음이면 끝난다.
     0. 어떤 갈래인가        16개 대분류      축: 기분(쾌-불쾌) × 세기(활성화)
     1. 그 안에서 어떤 결인가  그 대분류의 중분류  축: 기분 × 세기 (그 갈래 안에서 다시 스케일)
     2. 그중 어떤 말인가      그 중분류의 단어들  축: 세기 × 흔한 말 ↔ 잘 안 쓰는 말

   좌표는 매 화면 그 화면에 놓인 것들의 min~max로 다시 스케일한다.
   그래서 사분면이 통째로 비지 않는다 — 예전 좌표 줌 방식의 고질병이었다. */
import { WORDS, FAMS } from './data.js';

export const LEVELS = 3;
const PAD = 0.08;            // 정규화 좌표에서 가장자리에 남기는 여백
const SEP_X = 0.16, SEP_Y = 0.11;   // 칩이 서로 너무 붙지 않게 하는 최소 간격

const mean = (a, f) => a.reduce((s, x) => s + f(x), 0) / a.length;

/* 대분류·중분류를 '단어들의 평균 좌표를 가진 하나의 덩어리'로 만든다 */
function group(name, kick, words, extra = {}) {
  return {
    name, kick, words,
    v: mean(words, w => w.v),
    a: mean(words, w => w.a),
    p: mean(words, w => w.p),
    n: words.length,
    ...extra,
  };
}

export const FAMILIES = FAMS.map((f, i) => {
  const fw = WORDS.filter(w => w.F === i);
  return group(f.n, f.k, fw, {
    fi: i,
    subs: f.s.map((sn, j) => group(sn, '', fw.filter(w => w.S === j), { fi: i, si: j })),
  });
});

/* 지금 화면에 놓일 것들과, 그것들을 어떤 축으로 볼지 */
export function levelOf(path) {
  if (path.length === 0) {
    return { kind: 'family', items: FAMILIES, xk: 'v', yk: 'a' };
  }
  if (path.length === 1) {
    return { kind: 'sub', items: path[0].subs, xk: 'v', yk: 'a' };
  }
  // 한 중분류 안에서는 기분이 이미 정해졌다. 남는 건 세기와, 얼마나 정확한 말이냐다.
  return { kind: 'word', items: path[1].words, xk: 'a', yk: 'p' };
}

/* 화면에 놓인 것들의 실제 범위로 정규화한다(항상 화면을 꽉 채운다).
   하나뿐이거나 값이 모두 같으면 가운데. */
export function layout(items, xk, yk) {
  const span = k => {
    const vs = items.map(i => i[k]);
    const lo = Math.min(...vs), hi = Math.max(...vs);
    return hi - lo < 1e-9 ? [lo - 0.5, hi + 0.5] : [lo, hi];
  };
  const [xlo, xhi] = span(xk), [ylo, yhi] = span(yk);
  const norm = (v, lo, hi) => PAD + (1 - 2 * PAD) * (v - lo) / (hi - lo);

  const placed = items.map(it => ({
    item: it,
    x: norm(it[xk], xlo, xhi),
    y: 1 - norm(it[yk], ylo, yhi),   // 값이 클수록 위로
  }));

  // 겹치는 것들만 살짝 벌린다(순서·좌표 의미는 유지)
  for (let iter = 0; iter < 60; iter++) {
    let moved = false;
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const A = placed[i], B = placed[j];
        const dx = B.x - A.x, dy = B.y - A.y;
        const ox = SEP_X - Math.abs(dx), oy = SEP_Y - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (oy / SEP_Y <= ox / SEP_X) {
          const s = (dy >= 0 ? 1 : -1) * oy / 2;
          A.y -= s; B.y += s;
        } else {
          const s = (dx >= 0 ? 1 : -1) * ox / 2;
          A.x -= s; B.x += s;
        }
      }
    if (!moved) break;
  }
  for (const q of placed) {
    q.x = Math.min(0.99, Math.max(0.01, q.x));
    q.y = Math.min(0.99, Math.max(0.01, q.y));
  }
  return placed;
}

/* 축 이름 — 그 화면에 실제로 놓인 것들의 범위를 읽어 붙인다 */
const VB = [[2.2,'참담한 쪽'],[2.8,'괴로운 쪽'],[3.4,'언짢은 쪽'],[3.9,'떨떠름한 쪽'],
            [4.3,'덤덤한 쪽'],[4.9,'괜찮은 쪽'],[5.5,'좋은 쪽'],[99,'아주 좋은 쪽']];
const AB = [[2.4,'축 가라앉은'],[3.0,'잔잔한'],[3.6,'차분한'],[4.2,'보통'],
            [4.8,'들썩이는'],[5.4,'달아오른'],[6.0,'거세게 치미는'],[99,'터질 듯한']];
const PB = [[3.2,'거의 안 쓰는 말'],[3.7,'드문 말'],[4.2,'덜 쓰는 말'],
            [4.7,'익숙한 말'],[5.3,'흔한 말'],[99,'누구나 쓰는 말']];

const band = (t, v) => { for (const [th, l] of t) if (v < th) return l; return t[t.length-1][1]; };
const TABLE = { v: VB, a: AB, p: PB };
const AXIS_NAME = { v: '기분', a: '세기', p: '얼마나 쓰는 말인지' };

export function axisLabels(items, xk, yk, depth) {
  const ends = k => {
    const vs = items.map(i => i[k]);
    return [band(TABLE[k], Math.min(...vs)), band(TABLE[k], Math.max(...vs))];
  };
  const [xl, xr] = ends(xk), [yb, yt] = ends(yk);
  const same = (a, b, k) => a === b ? { lo: `조금 더 ${LESS[k]}`, hi: `조금 더 ${MORE[k]}` } : { lo: a, hi: b };
  const LESS = { v: '무거운', a: '잔잔한', p: '낯선' };
  const MORE = { v: '가벼운', a: '거센', p: '익숙한' };
  const X = same(xl, xr, xk), Y = same(yb, yt, yk);
  const hint = { v: ['← 덜 좋은 쪽', '더 좋은 쪽 →'], a: ['← 여린 쪽', '더 센 쪽 →'], p: ['← 낯선 쪽', '더 익숙한 쪽 →'] };
  const vhint = { v: ['덜 좋은 쪽', '더 좋은 쪽'], a: ['더 여린 쪽', '더 센 쪽'], p: ['더 정확한 말 ↓', '더 익숙한 말'] };
  return {
    left:  { main: X.lo, sub: hint[xk][0] },
    right: { main: X.hi, sub: hint[xk][1] },
    bottom:{ main: Y.lo, sub: vhint[yk][0] },
    top:   { main: Y.hi, sub: vhint[yk][1] },
    xName: AXIS_NAME[xk], yName: AXIS_NAME[yk],
  };
}

/* 자연어 입력을 붙이기 전에도 쓸 수 있는, 순수 로컬 매칭.
   단어·뜻풀이·분류 이름을 글자 단위로 훑어 겹치는 정도를 센다. 토큰 0, 오프라인 동작.
   LLM 이 붙으면 이건 폴백으로 남는다. */
export function localMatch(text, topN = 6) {
  const q = (text || '').replace(/\s+/g, '');
  if (q.length < 2) return [];
  const grams = new Set();
  for (let n = 2; n <= 3; n++)
    for (let i = 0; i + n <= q.length; i++) grams.add(q.slice(i, i + n));
  if (!grams.size) return [];

  const scored = WORDS.map(w => {
    const hay = `${w.w} ${w.d} ${FAMILIES[w.F].name} ${FAMILIES[w.F].subs[w.S].name}`.replace(/\s+/g, '');
    let hit = 0;
    for (const g of grams) if (hay.includes(g)) hit++;
    if (q.includes(w.w.replace(/다$/, ''))) hit += 6;   // 단어 자체가 문장에 들어 있으면 크게
    return { w, score: hit / grams.size + w.p / 60 };   // 동점이면 더 흔한 말을 앞에
  }).filter(s => s.score > 0.02);

  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, topN).map(s => s.w);
}
