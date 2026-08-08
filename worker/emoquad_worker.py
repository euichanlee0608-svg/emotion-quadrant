#!/usr/bin/env python3
"""감정의 사분면 — 맥미니 로컬 모델 워커.

무엇을 하나:
  제미나이 무료 한도가 떨어지면 Edge Function 이 작업을 대기열(emoquad_jobs)에 넣는다.
  이 워커가 그걸 **가지러 와서** 로컬 Ollama 로 처리하고 결과를 돌려준다.

왜 이런 구조인가:
  공개 https 사이트가 맥미니의 127.0.0.1 을 직접 부르는 건 브라우저가 막는다
  (mixed content / Private Network Access). 반대로 맥미니가 밖으로 나가는 건 아무 문제가 없다.
  그래서 방향을 뒤집었다 — 서버가 맥미니를 부르지 않고, 맥미니가 서버에 물어본다.
  덕분에 포트 개방·터널·고정 IP 가 전혀 필요 없다.

인증:
  claim/finish 는 워커 토큰으로만 열린다. 토큰은 app_secrets 의 emoquad_worker_token 과
  이 컴퓨터의 worker/.env 에 있다(레포에는 올리지 않는다).

실행:
  launchctl load ~/Library/LaunchAgents/com.leechan.emoquadworker.plist
"""
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

FN = "https://kjlknxwzpmdzawwrurva.supabase.co/functions/v1/emoquad-analyze"
OLLAMA = "http://127.0.0.1:11434/api/generate"
MODEL = "exaone3.5:7.8b"
POLL_SEC = 5           # 일이 있었던 직후엔 촘촘히 본다
IDLE_SLEEP = 60        # 한동안 조용하면 1분에 한 번만 — 상주 비용을 최소로
DATA = pathlib.Path(__file__).resolve().parent

# 434개 목록 — data.js 에서 읽는다(단일 출처를 두 벌로 만들지 않기 위해)
def load_words():
    src = (DATA.parent / "data.js").read_text(encoding="utf-8")
    words = []
    for line in src.splitlines():
        line = line.strip().rstrip(",")
        if line.startswith('{"w":'):
            try:
                words.append(json.loads(line)["w"])
            except Exception:
                pass
    if len(words) != 434:
        raise SystemExit(f"data.js 에서 434개를 못 읽었다(읽은 수 {len(words)})")
    return words


def env_token():
    f = DATA / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            if line.startswith("EMOQUAD_WORKER_TOKEN="):
                return line.split("=", 1)[1].strip()
    return os.environ.get("EMOQUAD_WORKER_TOKEN", "")


def post(payload, timeout=30):
    req = urllib.request.Request(
        FN, data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


PROMPT = """너는 한국어 감정 어휘 도우미다. 아래 '감정 단어 목록'에만 있는 단어로만 답한다.

[사용자 글]
{text}

[감정 단어 목록]
{words}

지시:
1. 사용자 글에서 읽히는 마음을 한 문장(40자 이내)으로 담담하게 적는다. 위로나 조언은 하지 않는다.
2. 목록에서 이 상황에 가장 맞는 단어를 3~5개 고른다. 반드시 목록에 있는 단어 그대로 쓴다.
3. 뻔한 말(좋다, 싫다)보다 상황을 더 정확히 짚는 말을 우선한다.
4. 아래 JSON만 출력한다. 다른 말은 붙이지 않는다.

{{"read":"한 문장","words":["단어1","단어2","단어3"]}}"""


def run_ollama(text, wordlist):
    body = json.dumps({
        "model": MODEL,
        "prompt": PROMPT.format(text=text, words=", ".join(wordlist)),
        "stream": False, "format": "json",
        "options": {"temperature": 0.2, "num_predict": 300},
    }).encode("utf-8")
    req = urllib.request.Request(OLLAMA, data=body,
                                 headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=180) as r:
        raw = json.loads(r.read().decode("utf-8")).get("response", "")
    a, b = raw.find("{"), raw.rfind("}")
    if a < 0 or b <= a:
        return "", []
    try:
        got = json.loads(raw[a:b + 1])
    except Exception:
        return "", []
    allow = set(wordlist)
    words, seen = [], set()
    for w in got.get("words", []) or []:
        w = str(w).strip()
        if w in allow and w not in seen:
            seen.add(w); words.append(w)
    return str(got.get("read", ""))[:120], words[:6]


def main():
    token = env_token()
    if not token:
        raise SystemExit("EMOQUAD_WORKER_TOKEN 이 없다 (worker/.env 확인)")
    wordlist = load_words()
    print(f"워커 시작 — 단어 {len(wordlist)}개, 모델 {MODEL}", flush=True)

    idle = 0
    while True:
        try:
            got = post({"action": "claim", "token": token}).get("job")
        except Exception as e:
            print(f"[claim 실패] {e}", flush=True)
            time.sleep(IDLE_SLEEP)
            continue

        # emoquad_claim() 은 대기 작업이 없으면 전부 null 인 빈 행을 돌려준다(테이블 타입 반환).
        # 객체 자체는 truthy 라서 id 로 확인해야 한다.
        if not got or not got.get("id"):
            idle += 1
            time.sleep(IDLE_SLEEP if idle > 6 else POLL_SEC)
            continue

        idle = 0
        jid, text = got["id"], got["text"]
        print(f"[작업] {jid} — {text[:40]}…", flush=True)
        try:
            read, words = run_ollama(text, wordlist)
            post({"action": "finish", "token": token, "id": jid,
                  "read": read, "words": words,
                  "err": "" if words else "로컬 모델이 목록 밖의 답을 냈습니다"})
            print(f"  → {'/'.join(words) if words else '실패'}", flush=True)
        except Exception as e:
            print(f"  → 오류 {e}", flush=True)
            try:
                post({"action": "finish", "token": token, "id": jid, "words": [], "err": str(e)[:200]})
            except Exception:
                pass


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
