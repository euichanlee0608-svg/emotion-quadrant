// emoquad-analyze — 자연어 입력에서 감정 단어 후보를 찾는다.
// 키는 app_secrets 에만 있고 프론트로 나가지 않는다. 비로그인 공개 함수라 일일 캡을 건다.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

const DAILY_CAP = 300;

// 434개 감정단어(박인조·민경환 2005 부록 1). 이 목록 밖의 답은 버린다.
const WORDS = `기쁘다, 좋다, 행복하다, 즐겁다, 반갑다, 신나다, 사랑스럽다, 홀가분하다, 재미있다, 그립다, 호감, 설레다, 흥겹다, 상쾌하다, 편안하다, 후련하다, 고맙다, 만족하다, 뿌듯하다, 쾌감, 황홀하다, 정겹다, 흐뭇하다, 감동하다, 부럽다, 편하다, 속시원하다, 아쉽다, 신바람나다, 떳떳하다, 유쾌하다, 경쾌하다, 슬프다, 감격하다, 흥미진진하다, 무섭다, 자랑스럽다, 흥미롭다, 들뜨다, 싫다, 통쾌하다, 미안하다, 외롭다, 공감하다, 정답다, 영광스럽다, 동감하다, 부끄럽다, 자신만만하다, 정감, 서럽다, 상큼하다, 평화롭다, 우울하다, 감미롭다, 흥분, 얄밉다, 보람차다, 섭섭하다, 찡하다, 흡족하다, 걱정하다, 열광하다, 밉다, 화나다, 평온하다, 놀라다, 쓸쓸하다, 안타깝다, 애틋하다, 안정되다, 평안하다, 감탄하다, 열정, 반하다, 겁나다, 놀랍다, 억울하다, 괴롭다, 분노하다, 지겹다, 창피하다, 두렵다, 황당하다, 불쌍하다, 불쾌하다, 후회하다, 답답하다, 이뻐하다, 짜증내다, 흥나다, 서글프다, 즐기다, 지루하다, 뭉클하다, 시원섭섭하다, 신명나다, 서운하다, 불안하다, 귀찮다, 매료되다, 역겹다, 속상하다, 초조하다, 의기양양하다, 동정하다, 심란하다, 소름끼치다, 실망하다, 서러워하다, 샘내다, 살맛나다, 애정, 쑥스럽다, 안쓰럽다, 무안하다, 뉘우치다, 분하다, 안도하다, 고독하다, 조마조마하다, 안락하다, 가엾다, 증오하다, 따분하다, 기막히다, 성취감, 비참하다, 허전하다, 민망하다, 환희, 희열, 질투하다, 망설이다, 당황하다, 우습다, 긴장하다, 낯뜨겁다, 섬뜩하다, 사모하다, 싫증나다, 안심, 죄송스럽다, 눈물겹다, 덤덤하다, 심심하다, 약오르다, 달가워하다, 불만, 속타다, 애타다, 원망하다, 허무하다, 연민, 괘씸하다, 교감하다, 어처구니없다, 성내다, 불행하다, 질리다, 허탈하다, 씁쓸하다, 혐오하다, 처참하다, 지긋지긋하다, 담담하다, 아련하다, 공포, 동경하다, 울적하다, 성나다, 감개무량하다, 꺼림직하다, 짝사랑하다, 향수, 발끈하다, 불편하다, 시무룩하다, 거부감, 충족감, 애지중지하다, 처량하다, 끔찍하다, 뜨끔하다, 도취하다, 반감, 신경질, 아니꼽다, 아찔하다, 비장하다, 언짢다, 애달프다, 갈등하다, 토라지다, 선호하다, 상실감, 암담하다, 주눅들다, 절망하다, 치욕스럽다, 막막하다, 당혹하다, 착잡하다, 측은하다, 무덤덤하다, 서먹하다, 희희낙락하다, 고민하다, 염려하다, 싱숭생숭하다, 곤혹스럽다, 긍지, 경멸하다, 자부하다, 절박감, 흠모하다, 분개하다, 사무치다, 시큰둥하다, 어이없다, 유감, 의기소침하다, 가증스럽다, 기겁하다, 순정, 의심, 시기하다, 죄책감, 체념하다, 감명, 격동되다, 낙, 멋쩍다, 무료하다, 원통하다, 격분하다, 맘놓다, 열등감, 조바심, 공허하다, 기죽다, 낯간지럽다, 무시무시하다, 식상하다, 자만심, 참담하다, 맥빠지다, 애끓다, 우쭐하다, 수치, 온정, 자족하다, 한맺히다, 배신감, 경악하다, 근심하다, 박진감, 연정, 울분, 처절하다, 패배감, 허망하다, 감회, 아슬아슬하다, 친애하다, 격하다, 딱하다, 진저리나다, 자긍, 겸연쩍다, 가련하다, 고무되다, 거북하다, 노심초사하다, 머쓱하다, 동요하다, 한스럽다, 경외하다, 노하다, 애석하다, 소외감, 상심하다, 구슬프다, 권태롭다, 근심걱정, 적적하다, 가소롭다, 경애하다, 애처럽다, 열애, 기절초풍하다, 무력감, 애잔하다, 애통하다, 영예롭다, 꺼리다, 한, 노발대발, 매혹, 동병상련, 남부끄럽다, 격정, 낙담하다, 반항심, 께름직하다, 좌절하다, 자책하다, 태평스럽다, 안달하다, 암울하다, 격노하다, 불만족하다, 야속하다, 감개, 한탄하다, 치떨리다, 경탄하다, 낙심하다, 희비, 울화통, 애도하다, 침통하다, 기고만장하다, 애착, 질색하다, 뾰로통하다, 신물나다, 원한, 굴욕, 애수, 비통하다, 우려하다, 우수, 연모하다, 애닯다, 떨떠름하다, 침울하다, 분통, 비애, 죄스럽다, 켕기다, 풀죽다, 희, 망연자실하다, 황송하다, 위압감, 통탄하다, 번민하다, 심통, 마땅찮다, 정욕, 고뇌하다, 고립감, 비련, 황공하다, 골나다, 떫다, 무색하다, 애환, 아연실색하다, 애련, 비탄하다, 뼈아프다, 환멸, 감흥, 숙연하다, 감복하다, 가책, 아리다, 죄의식, 질겁하다, 혼비백산하다, 노엽다, 안달복달하다, 울화, 흥취, 노파심, 위화감, 가뜬하다, 절절하다, 개탄하다, 애, 모멸, 역정, 의혹, 전전긍긍, 코웃음, 위축감, 의아하다, 적의, 설워하다, 비분강개하다, 애증, 회한, 낙망하다, 연연하다, 남부럽다, 심려하다, 음울하다, 실의, 망연하다, 샐쭉하다, 선뜩하다, 심드렁하다, 회개, 여한, 지리하다, 자기혐오, 격앙하다, 낭패스럽다, 수심, 통한, 번뇌하다, 송구하다, 고깝다, 스산하다, 진노하다, 정한, 자괴, 뜨악하다, 아연하다, 노기, 무감동하다, 고적하다, 통분, 부아, 처연하다, 허허롭다, 기껍다, 의분, 떠름하다, 송연하다, 시름겹다, 회오`;
const ALLOWED = new Set(WORDS.split(",").map((s) => s.trim()).filter(Boolean));

const PROMPT = (text: string) =>
`너는 한국어 감정 어휘 도우미다. 아래 '감정 단어 목록'에만 있는 단어로만 답한다.

[사용자 글]
${text}

[감정 단어 목록]
${WORDS}

지시:
1. 사용자 글에서 읽히는 마음을 한 문장(40자 이내)으로 담담하게 적는다. 위로나 조언은 하지 않는다.
2. 목록에서 이 상황에 가장 맞는 단어를 3~5개 고른다. 반드시 목록에 있는 단어 그대로 쓴다.
3. 뻔한 말(좋다, 싫다)보다 상황을 더 정확히 짚는 말을 우선한다.
4. 아래 JSON만 출력한다. 다른 말은 붙이지 않는다.

{"read":"한 문장","words":["단어1","단어2","단어3"]}`;

function pickJSON(raw: string) {
  const s = (raw || "").replace(/```json|```/g, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST 만 받습니다" }, 405);

  let text = "";
  try { text = String((await req.json())?.text ?? "").trim(); } catch { /* 아래에서 걸린다 */ }
  if (text.length < 4) return json({ error: "글이 너무 짧습니다" }, 400);
  if (text.length > 400) text = text.slice(0, 400);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: ok, error: capErr } = await db.rpc("emoquad_hit", { cap: DAILY_CAP });
  if (capErr) return json({ error: "사용량 확인 실패" }, 500);
  if (ok === false) return json({ error: "오늘 무료 사용량을 다 썼습니다. 내일 다시 시도해 주세요." }, 429);

  const { data: secrets } = await db.from("app_secrets").select("key,value")
    .in("key", ["gemini_keys", "gemini_models", "gemini_model"]);
  const get = (k: string) => secrets?.find((s: { key: string }) => s.key === k)?.value ?? "";

  const keys = get("gemini_keys").split(",").map((s: string) => s.trim()).filter(Boolean);
  const models = (get("gemini_models") || get("gemini_model")).split(",").map((s: string) => s.trim()).filter(Boolean);
  if (!keys.length || !models.length) return json({ error: "서버 설정이 비어 있습니다" }, 500);

  let lastErr = "";
  for (const model of models) {           // 모델 × 키 2중 폴백
    for (const key of keys) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: PROMPT(text) }] }],
              generationConfig: { temperature: 0.2, maxOutputTokens: 400, responseMimeType: "application/json" },
            }),
          },
        );
        if (!r.ok) { lastErr = `${model} ${r.status}`; continue; }
        const out = await r.json();
        const raw = out?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        const parsed = pickJSON(raw);
        const words = Array.isArray(parsed?.words)
          ? parsed.words.map((w: unknown) => String(w).trim()).filter((w: string) => ALLOWED.has(w)).slice(0, 6)
          : [];
        if (!words.length) { lastErr = `${model} 목록 밖 응답`; continue; }
        return json({ read: String(parsed?.read ?? "").slice(0, 120), words, model });
      } catch (e) {
        lastErr = String(e);
      }
    }
  }
  return json({ error: `분석에 실패했습니다 (${lastErr})` }, 502);
});
