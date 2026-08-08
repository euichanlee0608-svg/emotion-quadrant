/* 엔진 회귀 테스트 — 브라우저 없이 사분면 줌 로직만 검증.
   실행: node tests/engine_test.mjs  (레포 루트에서) */
import { WORDS, V0, POOL_DECAY, MAX_SHRINK, MAX_CHIPS, MIN_POOL, SEP_X, SEP_Y,
         pos, inView, pickWords, poolSize, fitView, axisLabels } from '../app.js';

let fail = 0;
const ok = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); fail++; } };

/* 1. 데이터 무결성 */
console.log('1. 데이터');
ok(WORDS.length === 434, `단어 434개여야 함 (실제 ${WORDS.length})`);
ok(new Set(WORDS.map(w => w.w)).size === 434, '단어 중복 없어야 함');
ok(WORDS.every(w => w.d && w.d.length > 2), '모든 단어에 뜻풀이가 있어야 함');
ok(WORDS.every(w => w.v >= 1 && w.v <= 7 && w.a >= 1 && w.a <= 7), '평정값이 1~7 범위여야 함');
ok(WORDS.every((w, i) => i === 0 || WORDS[i-1].p >= w.p), 'WORDS는 원형성 내림차순이어야 함');
// 논문 표 4 체크섬
const bucket = k => { const b = [0,0,0,0,0,0]; for (const w of WORDS) b[Math.floor(w[k]) - 1]++; return b.join(','); };
ok(bucket('v') === '39,216,57,44,75,3', `쾌-불쾌 분포가 논문 표4와 같아야 함 (${bucket('v')})`);
ok(bucket('a') === '1,42,129,143,111,8', `활성화 분포가 논문 표4와 같아야 함 (${bucket('a')})`);

/* 2. 배치 규칙 — 칩은 항상 시야 안에 있고 서로 겹치지 않는다 */
console.log('2. 배치 규칙');
function checkLayout(view, words, label) {
  for (const w of words) {
    const p = pos(w, view);
    ok(p.x >= -1e-9 && p.x <= 1 + 1e-9 && p.y >= -1e-9 && p.y <= 1 + 1e-9,
       `${label}: ${w.w} 정규화 좌표가 [0,1] 밖 (${p.x.toFixed(3)},${p.y.toFixed(3)})`);
    ok(inView(w, view), `${label}: ${w.w} 가 시야 밖`);
  }
  for (let i = 0; i < words.length; i++)
    for (let j = i + 1; j < words.length; j++) {
      const a = pos(words[i], view), b = pos(words[j], view);
      ok(Math.abs(a.x - b.x) > SEP_X || Math.abs(a.y - b.y) > SEP_Y,
         `${label}: ${words[i].w} / ${words[j].w} 칩이 겹침`);
    }
  ok(words.length <= MAX_CHIPS, `${label}: 칩 ${words.length}개 (최대 ${MAX_CHIPS})`);
}

/* 3. 순회 — 얕은 깊이는 전수, 깊은 곳은 무작위 표본으로 종료성 확인 */
console.log('3. 경로 순회');
let paths = 0, maxDepth = 0, minChips = 99, endWords = new Set(), depthHist = {};
const START = pickWords({...V0}, new Set());
checkLayout({...V0}, START, 'depth0');
ok(START.length >= 8, `첫 화면 칩이 최소 8개는 나와야 함 (실제 ${START.length})`);
ok(new Set(START.map(w => (w.v >= 4 ? 1 : 0) + (w.a >= 4 ? 2 : 0))).size === 4,
   '첫 화면은 네 사분면이 모두 채워져야 함');

// 사분면별로 첫 선택을 나눠 담아, 어느 방향을 골라도 세분화 깊이가 비슷한지 본다
const byQuad = { 좌상: [], 우상: [], 좌하: [], 우하: [] };
const quadOf = w => (w.v >= V0.cx ? '우' : '좌') + (w.a >= V0.cy ? '상' : '하');

function finish(path, depth) {
  paths++; maxDepth = Math.max(maxDepth, depth);
  depthHist[depth] = (depthHist[depth] || 0) + 1;
  endWords.add(path[path.length - 1]);
  ok(path.length === new Set(path).size, `경로에 같은 단어 반복: ${path.join(' › ')}`);
}

// 3-a. 깊이 3까지 전수 순회 (배치 규칙을 넓게 훑는다)
const EXHAUSTIVE = 3;
function walk(view, visited, depth, path) {
  const words = pickWords(view, visited);
  checkLayout(view, words, `depth${depth}`);
  minChips = Math.min(minChips, words.length);
  if (depth >= EXHAUSTIVE) return;
  for (const w of words) {
    const nvis = new Set(visited).add(w.w);
    const nv = fitView(w, view, nvis, poolSize(view, visited));
    ok(nv.rx <= view.rx * MAX_SHRINK + 1e-9 && nv.ry <= view.ry * MAX_SHRINK + 1e-9,
       `depth${depth}: ${w.w} 선택 후 시야가 충분히 줄지 않음`);
    ok(Math.abs(nv.rx / nv.ry - view.rx / view.ry) < 1e-6,
       `depth${depth}: ${w.w} 선택 후 가로세로 비율이 틀어짐`);
    if (pickWords(nv, nvis).length < MIN_POOL) finish([...path, w.w], depth + 1);
    else walk(nv, nvis, depth + 1, [...path, w.w]);
  }
}
walk({...V0}, new Set(), 0, []);

// 3-b. 끝까지 가는 무작위 강하 — 항상 유한 단계에 멈추는가
let seed = 20050228;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let t = 0; t < 800; t++) {
  let view = {...V0}, visited = new Set(), path = [], depth = 0, quad = null;
  for (;;) {
    if (depth > 14) { ok(false, `종료 안 됨: ${path.join(' › ')}`); break; }
    const words = pickWords(view, visited);
    checkLayout(view, words, `rand-depth${depth}`);
    minChips = Math.min(minChips, words.length);
    if (!words.length) { ok(false, `칩이 0개인 화면: ${path.join(' › ')}`); break; }
    const w = words[Math.floor(rnd() * words.length)];
    if (depth === 0) quad = quadOf(w);
    const prevPool = poolSize(view, visited);
    visited.add(w.w); view = fitView(w, view, visited, prevPool); path.push(w.w); depth++;
    if (pickWords(view, visited).length < MIN_POOL) {
      finish(path, depth); byQuad[quad].push(depth); break;
    }
  }
}

// 사분면 편중 검사 — 단어 수가 175개(좌상)~35개(우하)로 5배 차이나도
// 적응적 줌 덕에 평균 도달 깊이가 크게 벌어지면 안 된다
console.log('   첫 선택 사분면별 평균 도달 단계:');
const means = {};
for (const [k, arr] of Object.entries(byQuad)) {
  means[k] = arr.length ? arr.reduce((a, b) => a + b) / arr.length : 0;
  const n = WORDS.filter(w => quadOf(w) === k).length;
  console.log(`     ${k} (단어 ${String(n).padStart(3)}개, 표본 ${String(arr.length).padStart(3)}) → 평균 ${means[k].toFixed(2)}단계`);
}
const ms = Object.values(means).filter(x => x > 0);
ok(Math.max(...ms) - Math.min(...ms) < 2.0,
   `사분면별 평균 깊이 편차가 2단계 미만이어야 함 (실제 ${(Math.max(...ms) - Math.min(...ms)).toFixed(2)})`);

/* 4. 축 라벨 */
console.log('4. 축 라벨');
const a0 = axisLabels({...V0}, 0);
ok(a0.left.main === '안 좋음' && a0.right.main === '좋음', '0단계 가로축은 안 좋음/좋음');
ok(a0.top.main === '심함' && a0.bottom.main === '약함', '0단계 세로축은 심함/약함');
for (const d of [1, 2, 3, 4]) {
  const r = V0.rx * 0.7 ** d;
  const ax = axisLabels({ cx: 3.0, cy: 4.5, rx: r, ry: r }, d);
  for (const k of ['left','right','top','bottom'])
    ok(ax[k].main && ax[k].sub, `depth${d} ${k} 축 라벨 비어 있음`);
  ok(ax.left.main !== ax.right.main, `depth${d} 좌우 축 라벨이 같으면 안 됨`);
  ok(ax.top.main !== ax.bottom.main, `depth${d} 상하 축 라벨이 같으면 안 됨`);
}

console.log('\n--- 결과 ---');
console.log(`도달 가능 경로 ${paths.toLocaleString()}개 · 최대 ${maxDepth}단계 · 종착 단어 ${endWords.size}종`);
console.log(`단계별 종료 분포: ${JSON.stringify(depthHist)}`);
console.log(`한 화면 최소 칩 수: ${minChips}`);
console.log(fail === 0 ? '✅ 전부 통과' : `❌ 실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
