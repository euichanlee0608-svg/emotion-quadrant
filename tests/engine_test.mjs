/* 엔진 회귀 테스트 — 브라우저 없이 의미 트리 탐색만 검증.
   실행: node tests/engine_test.mjs  (레포 루트에서) */
import { WORDS, FAMS } from '../data.js';
import { FAMILIES, LEVELS, levelOf, layout, axisLabels, localMatch } from '../engine.js';

let fail = 0;
const ok = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); fail++; } };

/* 1. 데이터 무결성 */
console.log('1. 데이터');
ok(WORDS.length === 434, `단어 434개여야 함 (실제 ${WORDS.length})`);
ok(new Set(WORDS.map(w => w.w)).size === 434, '단어 중복 없어야 함');
ok(WORDS.every(w => w.d && w.d.length > 2), '모든 단어에 뜻풀이가 있어야 함');
ok(WORDS.every(w => w.v >= 1 && w.v <= 7 && w.a >= 1 && w.a <= 7), '평정값이 1~7 범위여야 함');
ok(WORDS.every((w, i) => i === 0 || WORDS[i-1].p >= w.p), 'WORDS는 원형성 내림차순이어야 함');
// 논문 표 4 체크섬 — 추출이 틀어지면 여기서 걸린다
const bucket = k => { const b = [0,0,0,0,0,0]; for (const w of WORDS) b[Math.floor(w[k]) - 1]++; return b.join(','); };
ok(bucket('v') === '39,216,57,44,75,3', `쾌-불쾌 분포가 논문 표4와 같아야 함 (${bucket('v')})`);
ok(bucket('a') === '1,42,129,143,111,8', `활성화 분포가 논문 표4와 같아야 함 (${bucket('a')})`);

/* 2. 의미 계층 */
console.log('2. 의미 계층');
ok(FAMILIES.length === FAMS.length && FAMILIES.length >= 8,
   `대분류가 충분해야 함 (실제 ${FAMILIES.length})`);
ok(FAMILIES.every(f => f.kick && f.kick.length > 2), '모든 대분류에 한 줄 설명이 있어야 함');
ok(FAMILIES.every(f => f.subs.length >= 1), '모든 대분류에 중분류가 있어야 함');
ok(FAMILIES.every(f => f.subs.every(s => s.words.length >= 1)), '빈 중분류가 없어야 함');

const totalInTree = FAMILIES.reduce((t, f) => t + f.subs.reduce((u, s) => u + s.words.length, 0), 0);
ok(totalInTree === 434, `트리에 담긴 단어가 434개여야 함 (실제 ${totalInTree})`);
const nSub = FAMILIES.reduce((t, f) => t + f.subs.length, 0);

// 대분류가 v/a 평면에 고르게 퍼져 있어야 첫 화면이 한쪽으로 쏠리지 않는다
const q0 = new Set(FAMILIES.map(f => (f.v >= 4 ? 1 : 0) + (f.a >= 4 ? 2 : 0)));
ok(q0.size >= 3, `첫 화면 대분류가 최소 세 사분면에 퍼져야 함 (실제 ${q0.size})`);

/* 3. 배치 — 화면 안에 있고 서로 안 겹치는가 */
console.log('3. 배치');
function checkLayout(items, xk, yk, label) {
  const placed = layout(items, xk, yk);
  ok(placed.length === items.length, `${label}: 놓인 개수가 다름`);
  for (const q of placed)
    ok(q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1,
       `${label}: ${q.item.name || q.item.w} 좌표가 [0,1] 밖 (${q.x.toFixed(3)},${q.y.toFixed(3)})`);
  // 완전히 같은 자리에 겹치면 칩 하나가 다른 칩을 통째로 가린다
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++) {
      const d = Math.abs(placed[i].x - placed[j].x) + Math.abs(placed[i].y - placed[j].y);
      ok(d > 0.02, `${label}: ${placed[i].item.name || placed[i].item.w} / ${placed[j].item.name || placed[j].item.w} 가 같은 자리`);
    }
  return placed;
}

/* 4. 전 경로 순회 — 434개가 정확히 3단계 만에 전부 닿는가 */
console.log('4. 전 경로 순회');
const reached = new Set();
let screens = 0, emptyQuadTotal = 0, minItems = 999, maxItems = 0;

const lv0 = levelOf([]);
ok(lv0.kind === 'family' && lv0.items.length === FAMILIES.length, '0단계는 대분류 전체');
checkLayout(lv0.items, lv0.xk, lv0.yk, 'depth0');

for (const fam of FAMILIES) {
  const lv1 = levelOf([fam]);
  ok(lv1.kind === 'sub', `${fam.name}: 1단계는 중분류여야 함`);
  ok(lv1.items === fam.subs, `${fam.name}: 1단계 항목이 그 대분류의 중분류여야 함`);
  checkLayout(lv1.items, lv1.xk, lv1.yk, `1단계/${fam.name}`);

  for (const sub of fam.subs) {
    const lv2 = levelOf([fam, sub]);
    ok(lv2.kind === 'word', `${fam.name}/${sub.name}: 2단계는 단어여야 함`);
    const placed = checkLayout(lv2.items, lv2.xk, lv2.yk, `2단계/${sub.name}`);
    for (const w of lv2.items) reached.add(w.w);

    // 화면이 한쪽으로만 쏠리지 않는지(예전 좌표 줌 방식의 고질병)
    if (placed.length >= 4) {
      const qs = new Set(placed.map(q => (q.x >= 0.5 ? 1 : 0) + (q.y >= 0.5 ? 2 : 0)));
      emptyQuadTotal += 4 - qs.size;
      screens++;
    }
    minItems = Math.min(minItems, lv2.items.length);
    maxItems = Math.max(maxItems, lv2.items.length);
  }
}
ok(reached.size === 434, `434개 전부 도달 가능해야 함 (실제 ${reached.size})`);
ok(LEVELS === 3, `여정은 3단계 (실제 ${LEVELS})`);

const avgEmpty = screens ? emptyQuadTotal / screens : 0;
ok(avgEmpty < 0.6, `단어 화면의 빈 사분면 평균이 0.6개 미만이어야 함 (실제 ${avgEmpty.toFixed(2)})`);

/* 5. 축 라벨 */
console.log('5. 축 라벨');
for (const [items, xk, yk, tag] of [
  [FAMILIES, 'v', 'a', '0단계'],
  [FAMILIES[0].subs, 'v', 'a', '1단계'],
  [FAMILIES[0].subs[0].words, 'a', 'p', '2단계'],
]) {
  const ax = axisLabels(items, xk, yk, 0);
  for (const k of ['left','right','top','bottom'])
    ok(ax[k] && ax[k].main && ax[k].sub, `${tag} ${k} 축 라벨이 비어 있음`);
  ok(ax.left.main !== ax.right.main, `${tag} 좌우 축 라벨이 같으면 안 됨`);
  ok(ax.top.main !== ax.bottom.main, `${tag} 상하 축 라벨이 같으면 안 됨`);
  ok(ax.xName && ax.yName, `${tag} 축 이름이 있어야 함`);
}

/* 6. 자연어 로컬 매칭 — 백엔드 없이도 뭔가는 나와야 한다 */
console.log('6. 로컬 매칭');
for (const text of [
  '시험에 떨어져서 너무 속상하고 눈물이 난다',
  '오랜만에 친구를 만나서 정말 반가웠다',
  '남들은 다 잘 되는데 나만 뒤처지는 것 같다',
]) {
  const got = localMatch(text);
  ok(got.length > 0, `"${text.slice(0, 14)}…" 에서 후보가 나와야 함`);
  ok(got.every(w => WORDS.includes(w)), '결과는 434개 안의 단어여야 함');
  console.log(`     "${text.slice(0, 18)}…" → ${got.slice(0, 4).map(w => w.w).join(', ')}`);
}
ok(localMatch('').length === 0, '빈 입력은 빈 결과');
ok(localMatch('ㅋ').length === 0, '너무 짧은 입력은 빈 결과');

console.log('\n--- 결과 ---');
console.log(`대분류 ${FAMILIES.length} · 중분류 ${nSub} · 단어 434 (전부 3단계로 도달)`);
console.log(`마지막 화면 단어 수 ${minItems}~${maxItems}개 · 빈 사분면 평균 ${avgEmpty.toFixed(2)}개`);
console.log(fail === 0 ? '✅ 전부 통과' : `❌ 실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
