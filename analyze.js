/* 자연어 입력 → 감정 후보 찾기.

   순서는 앞이 안 되면 조용히 다음으로 넘어간다.
     1) Supabase Edge Function(Gemini `gemini-3.1-flash-lite`) — 공개 사이트의 기본 경로.
        키는 서버에만 있고, 서버가 싼 모델부터 순차로 시도한다.
     2) engine.localMatch — 순수 클라이언트 글자 매칭. 오프라인·서버 장애에도 늘 동작.

   로컬 모델(Ollama)은 **페이지를 로컬에서 열었을 때만** 먼저 시도한다. 두 가지 이유 —
     · https 페이지에서 http://127.0.0.1 로의 요청은 크롬이 막는다(mixed content / Private
       Network Access). OLLAMA_ORIGINS 를 열어 줘도 브라우저 단에서 차단되므로,
       공개 사이트에서 사용자의 로컬 모델을 부르는 건 구조적으로 불가능하다.
     · 같은 문장으로 재 보면 품질도 떨어졌다. exaone3.5 는 "아쉽다, 슬프다, 부럽다"에 그쳤고
       gemini-3.1-flash-lite 는 "속상하다, 부럽다, 열등감, 답답하다, 착잡하다"를 짚었다.

   어느 쪽이든 **반드시 434개 안의 단어만** 돌려준다. 모델이 목록에 없는 말을 지어내면 버린다.
   그래야 결과 화면의 논문 평정값과 앞뒤가 맞는다.

   결과가 나오면 어느 경로로 처리했든 텔레그램으로 한 줄 알린다(동작 확인용, 실패해도 무시). */

const OLLAMA = 'http://127.0.0.1:11434';
const OLLAMA_MODEL = 'exaone3.5:7.8b';
const FN = 'https://kjlknxwzpmdzawwrurva.supabase.co/functions/v1/emoquad-analyze';

const PROBE_MS = 1500;    // 로컬 모델이 떠 있는지 확인하는 시간
const LOCAL_MS = 75000;   // 로컬 생성은 느릴 수 있다
const EDGE_MS  = 30000;

/* 사용자에게는 '어떤 모델이 처리했는지'를 알리지 않는다.
   진행중 / 완료 / 실패만 보이면 되고, 그 외는 콘솔·텔레그램으로만 남긴다. */

/* 로컬에서 연 페이지일 때만 로컬 모델을 시도한다(위 주석 참고) */
const isLocalPage = () =>
  typeof location !== 'undefined' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:');

let localUp = null;   // null=아직 모름, true/false=확인됨

/* 로컬 모델이 떠 있는지 짧게 찔러 본다 */
export async function probeLocal() {
  if (localUp !== null) return localUp;
  if (!isLocalPage()) { localUp = false; return false; }
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), PROBE_MS);
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: c.signal });
    clearTimeout(t);
    const j = await r.json();
    localUp = !!(j.models || []).some(m => String(m.name).startsWith(OLLAMA_MODEL.split(':')[0]));
  } catch {
    localUp = false;
  }
  return localUp;
}

const PROMPT = (text, list) =>
`너는 한국어 감정 어휘 도우미다. 아래 '감정 단어 목록'에만 있는 단어로만 답한다.

[사용자 글]
${text}

[감정 단어 목록]
${list}

지시:
1. 사용자 글에서 읽히는 마음을 한 문장(40자 이내)으로 담담하게 적는다. 위로나 조언은 하지 않는다.
2. 목록에서 이 상황에 가장 맞는 단어를 3~5개 고른다. 반드시 목록에 있는 단어 그대로 쓴다.
3. 뻔한 말(좋다, 싫다)보다 상황을 더 정확히 짚는 말을 우선한다.
4. 아래 JSON만 출력한다. 다른 말은 붙이지 않는다.

{"read":"한 문장","words":["단어1","단어2","단어3"]}`;

function parseJSON(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/```json|```/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

/* 모델 응답을 434개 안의 단어로만 걸러 낸다 */
function toWords(parsed, WORDS) {
  if (!parsed || !Array.isArray(parsed.words)) return null;
  const seen = new Set(), out = [];
  for (const name of parsed.words) {
    const w = WORDS.find(x => x.w === String(name).trim());
    if (w && !seen.has(w.w)) { seen.add(w.w); out.push(w); }
    if (out.length >= 6) break;
  }
  if (!out.length) return null;
  return { read: typeof parsed.read === 'string' ? parsed.read.trim().slice(0, 120) : '', words: out };
}

async function withTimeout(run, ms, label) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await run(c.signal); }
  catch (e) {
    throw (e && e.name === 'AbortError') ? new Error(`${label} 응답이 없습니다`) : e;
  } finally { clearTimeout(t); }
}

async function tryOllama(text, list) {
  const r = await withTimeout(signal => fetch(`${OLLAMA}/api/generate`, {
    signal, method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL, prompt: PROMPT(text, list), stream: false,
      format: 'json', options: { temperature: 0.2, num_predict: 300 },
    }),
  }), LOCAL_MS, '로컬 모델');
  if (!r.ok) throw new Error(`로컬 모델 오류 ${r.status}`);
  return parseJSON((await r.json()).response);
}

async function tryEdge(text) {
  const r = await withTimeout(signal => fetch(FN, {
    signal, method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  }), EDGE_MS, '서버');
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && j.error) || `서버 오류 ${r.status}`);
  return j;
}

/* 제미나이가 다 떨어지면 서버가 작업을 대기열에 넣고 맥미니 로컬 모델이 처리한다.
   맥미니는 밖에서 부를 수 없으므로 맥미니가 가지러 가고, 브라우저는 결과를 물어보러 온다. */
const QUEUE_TRIES = 40, QUEUE_GAP = 3000;   // 최대 약 2분
async function waitQueued(id, onStep) {
  for (let i = 0; i < QUEUE_TRIES; i++) {
    await new Promise(r => setTimeout(r, QUEUE_GAP));
    onStep('queued');
    let j = null;
    try {
      const r = await fetch(FN, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'job', id }),
      });
      j = await r.json();
    } catch { continue; }
    if (!j || j.error) continue;
    if (j.status === 'done' && Array.isArray(j.words) && j.words.length) return j;
    if (j.status === 'failed') return null;
  }
  return null;
}

/* 동작 확인용 알림 — 실패해도 사용자 흐름을 막지 않는다 */
export function notify(text, words, via) {
  try {
    fetch(FN, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'notify', text, words: words.map(w => w.w), via }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* 알림은 부가 기능이라 조용히 넘어간다 */ }
}

/* onStep(단계이름) 으로 진행 상황을 알려 준다 */
export async function analyze(text, { WORDS, localMatch, onStep = () => {} }) {
  const list = WORDS.map(w => w.w).join(', ');
  const errs = [];

  // 로컬에서 연 페이지라면 로컬 모델 먼저(토큰 0)
  onStep('probe');
  if (await probeLocal()) {
    onStep('local');
    try {
      const got = toWords(await tryOllama(text, list), WORDS);
      if (got) { notify(text, got.words, 'local'); return { ...got, via: 'local' }; }
      errs.push('로컬 모델이 목록 밖의 답을 냈습니다');
    } catch (e) {
      localUp = null;                        // 일시적일 수 있으니 다음 기회에 다시 본다
      errs.push(String((e && e.message) || e));
    }
  }

  // 기본 경로 — Edge Function (서버가 가장 싼 모델부터 순차 시도)
  onStep('edge');
  try {
    const res = await tryEdge(text);
    if (res && res.queued && res.id) {
      // 제미나이 소진 → 맥미니가 처리할 때까지 기다린다
      const done = await waitQueued(res.id, onStep);
      const got = done && toWords(done, WORDS);
      if (got) return { ...got, via: 'worker' };
      errs.push('대기열 처리에 실패했습니다');
    } else {
      const got = toWords(res, WORDS);
      if (got) return { ...got, via: 'edge' };     // 서버가 알림까지 보낸다
      errs.push('서버가 목록 밖의 답을 냈습니다');
    }
  } catch (e) { errs.push(String((e && e.message) || e)); }

  // 마지막 폴백 — 순수 클라이언트 매칭
  const fb = localMatch(text);
  if (fb.length) {
    notify(text, fb, 'match');
    return { read: '', words: fb, via: 'match', errs };
  }
  throw new Error('지금은 분석할 수 없습니다. 잠시 뒤 다시 시도해 주세요.');
}
