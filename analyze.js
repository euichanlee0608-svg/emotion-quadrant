/* 자연어 입력 → 감정 후보 찾기.

   세 단계로 내려간다. 앞이 안 되면 조용히 다음으로 넘어간다.
     1) 로컬 모델(Ollama, exaone3.5) — 페이지를 로컬에서 열었을 때만. 토큰 0, 글이 밖으로 안 나감.
     2) Supabase Edge Function(Gemini)  — 공개 사이트에서 쓰는 길. 키는 서버에만 있다.
     3) engine.localMatch                — 순수 클라이언트 글자 매칭. 오프라인에서도 늘 동작.

   어느 쪽이든 **반드시 434개 안의 단어만** 돌려준다. 모델이 목록에 없는 말을 지어내면 버린다.
   그래야 결과 화면의 논문 평정값과 앞뒤가 맞는다. */

const OLLAMA = 'http://127.0.0.1:11434';
const OLLAMA_MODEL = 'exaone3.5:7.8b';
const FN = 'https://kjlknxwzpmdzawwrurva.supabase.co/functions/v1/emoquad-analyze';

const isLocal = () =>
  typeof location !== 'undefined' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:');

let localOllama = null;   // null=아직 모름, true/false=확인됨

export function backendName() {
  if (localOllama === true) return `로컬 모델(${OLLAMA_MODEL}) · 글이 이 컴퓨터 밖으로 나가지 않습니다`;
  if (isLocal() && localOllama === null) return '로컬 모델을 먼저 찾아봅니다';
  return '입력한 글은 분석에만 쓰이고 저장하지 않습니다';
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

/* 모델이 뭘 어떻게 감싸 놓든 JSON 객체 하나만 뽑아낸다 */
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
  const read = typeof parsed.read === 'string' ? parsed.read.trim().slice(0, 120) : '';
  return { read, words: out };
}

async function withTimeout(p, ms, label) {
  let t;
  try {
    return await Promise.race([
      p,
      new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} 응답이 없습니다`)), ms); }),
    ]);
  } finally { clearTimeout(t); }
}

async function tryOllama(text, list) {
  const r = await withTimeout(fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL, prompt: PROMPT(text, list), stream: false,
      format: 'json', options: { temperature: 0.2, num_predict: 300 },
    }),
  }), 90000, '로컬 모델');
  if (!r.ok) throw new Error(`로컬 모델 오류 ${r.status}`);
  return parseJSON((await r.json()).response);
}

async function tryEdge(text) {
  const r = await withTimeout(fetch(FN, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  }), 30000, '서버');
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && j.error) || `서버 오류 ${r.status}`);
  return j;
}

export async function analyze(text, { WORDS, localMatch }) {
  const list = WORDS.map(w => w.w).join(', ');

  // 1) 로컬 모델 — 로컬에서 열었을 때만 시도한다
  if (isLocal() && localOllama !== false) {
    try {
      const got = toWords(await tryOllama(text, list), WORDS);
      localOllama = true;
      if (got) return { ...got, via: 'local' };
    } catch {
      localOllama = false;    // 한 번 실패하면 이후엔 건너뛴다
    }
  }

  // 2) Edge Function
  let edgeErr = '';
  try {
    const got = toWords(await tryEdge(text), WORDS);
    if (got) return { ...got, via: 'edge' };
  } catch (e) { edgeErr = String((e && e.message) || e); }

  // 3) 순수 클라이언트 매칭 — 여기까지 오면 늘 뭔가는 돌려준다
  const fb = localMatch(text);
  if (fb.length) {
    return {
      read: '', words: fb, via: 'local-match',
      note: '글자가 겹치는 정도로만 찾은 결과입니다' + (edgeErr ? ` (${edgeErr})` : ''),
    };
  }
  throw new Error(edgeErr || '맞는 단어를 찾지 못했습니다. 조금 더 자세히 적어 보세요.');
}
