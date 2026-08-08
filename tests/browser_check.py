#!/usr/bin/env python3
"""감정의 사분면 — 헤드리스 크롬 CDP 검증.
실제 뷰포트(데스크톱/모바일 390px)를 Emulation으로 강제하고, 인트로→지도→줌→결과까지
클릭으로 몰아본 뒤 DOM·가로스크롤·레이아웃을 확인한다.
사용: cdpvenv/bin/python cdp_check.py <url>
"""
import json
import subprocess
import sys
import time
import urllib.request

import websocket

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8777/index.html"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = 9222
VIEWPORTS = [("데스크톱", 1280, 900), ("모바일", 390, 844)]

fails = []


def check(cond, msg):
    print(("  ✓ " if cond else "  ✗ ") + msg)
    if not cond:
        fails.append(msg)


class CDP:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=30)
        self.i = 0

    def send(self, method, **params):
        self.i += 1
        self.ws.send(json.dumps({"id": self.i, "method": method, "params": params}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == self.i:
                if "error" in m:
                    raise RuntimeError(f"{method}: {m['error']}")
                return m.get("result", {})

    def js(self, expr):
        r = self.send("Runtime.evaluate", expression=expr,
                      returnByValue=True, awaitPromise=True)
        if r.get("exceptionDetails"):
            raise RuntimeError(f"JS 예외: {r['exceptionDetails'].get('text')} / {expr[:80]}")
        return r["result"].get("value")


HIT = ("const hit=(a,b)=>a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1;")


def label_checks(c, tag):
    """축 라벨이 본문 글자와 겹치거나 본문 폭 밖으로 나가지 않는지 — 기하로 확인."""
    bad = c.js("""(()=>{%s
      const R=s=>[...document.querySelectorAll(s)].map(e=>[e.textContent.trim().slice(0,10),e.getBoundingClientRect()]);
      const A=R('.axl'), B=[...R('.prompt'),...R('.sub'),...R('.hint'),...R('.topbar'),...R('.sheet')];
      const o=[]; for(const[na,ra]of A)for(const[nb,rb]of B)if(hit(ra,rb))o.push(na+'↔'+nb);
      return o;})()""" % HIT)
    check(not bad, f"{tag}: 축 라벨이 본문과 안 겹침 ({bad})")

    off = c.js("""(()=>{const w=document.querySelector('.wrap').getBoundingClientRect();
      return [...document.querySelectorAll('.axl')].filter(e=>{const r=e.getBoundingClientRect();
      return r.left<w.left-1||r.right>w.right+1;}).map(e=>e.textContent.trim().slice(0,10));})()""")
    check(not off, f"{tag}: 축 라벨이 본문 폭 안 (밖: {off})")

    ov = c.js("""(()=>{%s
      const R=s=>[...document.querySelectorAll(s)].map(e=>[e.textContent.trim().slice(0,10),e.getBoundingClientRect()]);
      const A=R('.axl'), o=[];
      for(let i=0;i<A.length;i++)for(let j=i+1;j<A.length;j++)if(hit(A[i][1],A[j][1]))o.push(A[i][0]+'↔'+A[j][0]);
      return o;})()""" % HIT)
    check(not ov, f"{tag}: 축 라벨끼리 안 겹침 ({ov})")

    # 라벨이 보드 위로 올라타면 잘려 보인다(--padY 와 padding 이 어긋나면 발생)
    onb = c.js("""(()=>{%s
      const b=document.querySelector('.board').getBoundingClientRect();
      return [...document.querySelectorAll('.axl')].filter(e=>hit(e.getBoundingClientRect(),b))
        .map(e=>e.textContent.trim().slice(0,10));})()""" % HIT)
    check(not onb, f"{tag}: 축 라벨이 보드와 안 겹침 ({onb})")

    # 라벨 전체가 잘리지 않고 다 보이는지(주라벨 + 보조라벨 두 줄)
    cut = c.js("""[...document.querySelectorAll('.axl')].filter(e=>{
      const s=e.querySelector('small'); if(!s) return true;
      const r=e.getBoundingClientRect(), sr=s.getBoundingClientRect();
      return r.height < 20 || sr.height < 8 || sr.bottom > r.bottom + 1;
    }).map(e=>e.textContent.trim().slice(0,10))""")
    check(not cut, f"{tag}: 축 라벨 두 줄이 온전히 보임 (잘림: {cut})")


proc = subprocess.Popen(
    [CHROME, "--headless=new", f"--remote-debugging-port={PORT}", "--remote-allow-origins=*",
     "--no-first-run", "--no-default-browser-check", "--disable-gpu",
     "--user-data-dir=/tmp/cdp_emomap_profile", "about:blank"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    ws_url = None
    for _ in range(40):
        time.sleep(0.5)
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
            pages = [t for t in tabs if t.get("type") == "page"]   # 확장 background page 회피
            if pages:
                ws_url = pages[0]["webSocketDebuggerUrl"]
                break
        except Exception:
            pass
    if not ws_url:
        sys.exit("크롬 CDP 연결 실패")

    for name, w, h in VIEWPORTS:
        print(f"\n=== {name} {w}x{h} ===")
        c = CDP(ws_url)
        c.send("Page.enable")
        c.send("Runtime.enable")
        c.send("Emulation.setDeviceMetricsOverride", width=w, height=h,
               deviceScaleFactor=1, mobile=(w < 500))
        c.send("Page.navigate", url=URL)
        time.sleep(3.0)

        vw = c.js("innerWidth")
        check(vw == w, f"뷰포트 폭이 실제 {w}px로 잡힘 (측정 {vw})")

        # --- 인트로 ---
        check(c.js("!!document.querySelector('[data-act=start]')"), "인트로에 시작 버튼 있음")
        # 첫 화면은 '왜 만들었나' — 문구와 내려가는 버튼이 스크롤 없이 보여야 한다
        r = c.js("""(()=>{const a=document.querySelector('.why-h'),b=document.querySelector('[data-act=toHero]');
          if(!a||!b) return null; return {h:Math.round(a.getBoundingClientRect().bottom),
          c:Math.round(b.getBoundingClientRect().bottom)};})()""")
        check(r is not None, "첫 화면에 제목과 안내 버튼이 있음")
        # 배경 단어가 한 곳에 겹쳐 뭉치지 않는지(CSS calc 에 나머지 연산자가 없어 실제로 겹쳤었다)
        spread = c.js("""(()=>{const es=[...document.querySelectorAll('.drift span')];
          if(es.length<4) return -1;
          const xs=new Set(es.map(e=>Math.round(e.getBoundingClientRect().left/20)));
          const ys=new Set(es.map(e=>Math.round(e.getBoundingClientRect().top/20)));
          return Math.min(xs.size,ys.size);})()""")
        shown = c.js("[...document.querySelectorAll('.drift span')].filter(e=>getComputedStyle(e).visibility!=='hidden').length")
        check(spread >= 5, f"배경 단어가 흩어져 있음 (구분 위치 {spread}곳)")
        check(shown >= 6, f"배경 단어가 충분히 보임 ({shown}개)")
        # 배경 단어끼리도 겹치면 지저분하다
        selfov = c.js("""(()=>{const hit=(a,b)=>a.left<b.right-2&&b.left<a.right-2&&a.top<b.bottom-2&&b.top<a.bottom-2;
          const es=[...document.querySelectorAll('.drift span')]
            .filter(e=>getComputedStyle(e).visibility!=='hidden').map(e=>[e.textContent,e.getBoundingClientRect()]);
          const o=[];for(let i=0;i<es.length;i++)for(let j=i+1;j<es.length;j++)if(hit(es[i][1],es[j][1]))o.push(es[i][0]+'/'+es[j][0]);
          return o;})()""")
        check(not selfov, f"배경 단어끼리 안 겹침 ({selfov})")
        # 본문 글자 위로 겹치지 않아야 읽힌다
        over = c.js("""(()=>{const hit=(a,b)=>a.left<b.right-2&&b.left<a.right-2&&a.top<b.bottom-2&&b.top<a.bottom-2;
          const T=[...document.querySelectorAll('.why-h,.why-quote,.why-p,.why-kick')].map(e=>e.getBoundingClientRect());
          return [...document.querySelectorAll('.drift span')]
            .filter(e=>getComputedStyle(e).visibility!=='hidden')
            .filter(e=>{const r=e.getBoundingClientRect();return T.some(t=>hit(r,t));})
            .map(e=>e.textContent);})()""")
        check(not over, f"배경 단어가 본문을 가리지 않음 (겹침: {over})")
        if r:
            check(r["h"] <= h and r["c"] <= h,
                  f"첫 화면이 스크롤 없이 다 보임 (제목 {r['h']}px, 버튼 {r['c']}px ≤ {h}px)")
        # 한 번 내려가면 '시작하기'가 화면 안에 온다
        c.js("document.querySelector('[data-act=toHero]').click()"); time.sleep(1.3)
        sb = c.js("Math.round(document.querySelector('[data-act=start]').getBoundingClientRect().bottom)")
        check(0 < sb <= h, f"내려가면 시작 버튼이 화면 안 (하단 {sb}px ≤ {h}px)")
        check("434" in (c.js("document.body.innerText") or ""), "인트로에 434개 표기")
        # 자연어 입력 — 실제 분석 호출은 하지 않는다(유료 경로). UI 존재만 확인.
        # 첫 화면은 '왜 만들었나', 그다음이 시작하기, 그다음이 자연어 입력
        check(c.js("!!document.querySelector('.why .why-h')"), "첫 화면에 '왜 만들었나'가 있음")
        # 순서는 문서 기준으로 잰다(스크롤 위치에 흔들리지 않게)
        offs = c.js("""(()=>{const y=e=>e?Math.round(e.getBoundingClientRect().top+scrollY):-1;
          return {why:y(document.querySelector('.why')), hero:y(document.querySelector('#herosec')),
                  nl:y(document.querySelector('#nlsec'))};})()""")
        check(offs["why"] < offs["hero"] < offs["nl"],
              f"왜 → 시작하기 → 글쓰기 순서 (why {offs['why']}, hero {offs['hero']}, nl {offs['nl']})")
        check(offs["hero"] >= h - 80, f"시작하기 화면은 첫 화면 아래 (문서 {offs['hero']}px, 화면 {h}px)")
        check(offs["nl"] - offs["hero"] >= h - 100, f"자연어 섹션은 또 한 화면 아래 (간격 {offs['nl']-offs['hero']}px)")
        check(c.js("!!document.querySelector('.hero .steps .step')"), "시작 화면에 설명 박스 있음")
        # 출처는 히어로가 아니라 맨 아래 푸터 한 곳에 모은다(랜딩이 번잡해지지 않게)
        check(not c.js("!!document.querySelector('.src-note')"), "히어로에 출처 블록이 없음")
        cite = c.js("(e=>e?e.textContent:'')(document.querySelector('footer .cite'))") or ""
        check("박인조" in cite and "민경환" in cite, "푸터에 논문 출처 명시")
        check("서울대" in cite, "푸터에 연구 소개(소속) 포함")
        check("이 사이트에서 붙인" in cite, "내가 붙인 부분을 구분해 명시")
        # 첫 화면 인용
        q = c.js("(e=>e?e.textContent:'')(document.querySelector('.why-quote'))") or ""
        check("언어의 한계" in q and "비트겐슈타인" in q, "첫 화면에 인용과 출처")
        check(c.js("!!document.querySelector('[data-act=toNL]')")
              and c.js("!!document.querySelector('[data-act=toHero]')"), "아래로 내려가는 안내 버튼들")
        check(c.js("!!document.querySelector('#note')"), "자연어 입력칸 있음")
        check(c.js("!!document.querySelector('[data-act=analyze]')"), "'감정 찾아보기' 버튼 있음")
        # 사용자에게는 진행중/완료/실패만 — 어떤 모델이 처리했는지, 중간 실패는 보여주지 않는다
        body_txt = c.js("document.body.innerText") or ""
        for banned in ["Gemini", "exaone", "로컬 모델로 읽는 중", "글자 겹침"]:
            check(banned not in body_txt, f"화면에 내부 경로 노출 없음 ({banned})")
        check(not c.js("!!document.querySelector('.steps-live')"), "단계별 진행 목록은 노출하지 않음")
        fs = c.js("parseFloat(getComputedStyle(document.querySelector('#note')).fontSize)")
        check(w > 500 or fs >= 16, f"모바일 입력 글자 16px 이상 (iOS 자동 확대 방지) — 실제 {fs}px")
        check(c.js("!!document.querySelector('footer .backlink')"), "푸터 포트폴리오 백링크 있음")
        check("박인조" in (c.js("document.body.innerText") or ""), "푸터에 논문 출처 표기")

        # --- 지도 0단계 ---
        c.js("document.querySelector('[data-act=start]').click()")
        time.sleep(0.6)
        chips = c.js("document.querySelectorAll('.chip').length")
        check(chips >= 8, f"0단계 칩 {chips}개 (>=8)")
        axes = c.js("[...document.querySelectorAll('.axl')].map(e=>e.textContent)")
        check(len(axes) == 4 and all(a.strip() for a in axes), f"0단계 축 라벨 4개: {axes}")
        check(c.js("document.querySelectorAll('.chip.grp').length") >= 8,
              "0단계는 대분류 칩(설명 달린 큰 칩)이어야 함")
        check("1/3단계" in (c.js("document.querySelector('.depth-pill').textContent") or ""),
              "3단계 여정임을 표시")
        label_checks(c, "0단계")

        # 칩이 보드 밖으로 안 나가는지
        overflow = c.js("""(()=>{const b=document.querySelector('.board').getBoundingClientRect();
          return [...document.querySelectorAll('.chip')].filter(c=>{const r=c.getBoundingClientRect();
          return r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1;}).map(c=>c.textContent);})()""")
        check(not overflow, f"칩이 전부 보드 안에 있음 (밖: {overflow})")

        # 칩끼리 실제 픽셀 겹침
        overlap = c.js("""(()=>{const cs=[...document.querySelectorAll('.chip')].map(c=>[c.textContent,c.getBoundingClientRect()]);
          const o=[];for(let i=0;i<cs.length;i++)for(let j=i+1;j<cs.length;j++){const a=cs[i][1],b=cs[j][1];
          if(a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom)o.push(cs[i][0]+'/'+cs[j][0]);}return o;})()""")
        check(not overlap, f"칩 픽셀 겹침 없음 (겹침: {overlap})")

        # --- 단어 탭 → 뜻 표시 ---
        first = c.js("document.querySelector('.chip').textContent")
        c.js("document.querySelector('.chip').click()")
        time.sleep(0.5)
        check(c.js("!!document.querySelector('.sheet .def')"), f"「{first}」 탭하니 뜻 카드 뜸")
        check(c.js("!!document.querySelector('[data-act=dive]')"),
              "대분류 카드에 '이 갈래로' 버튼 있음")
        # 지도 화면엔 프로젝트 설명 푸터를 두지 않는다(스크롤만 잡아먹음)
        check(not c.js("!!document.querySelector('footer')"), "지도 화면에 푸터 없음")

        # ★ 핵심 UX — 칩을 누른 직후, 스크롤 없이 액션 버튼이 화면 안에 보여야 한다.
        #    (예전엔 시트가 문서 흐름에 있어서 스크롤해야 '이 갈래로'가 보였다)
        c.js("window.scrollTo(0,0)"); time.sleep(0.35)
        r = c.js("""(()=>{const b=document.querySelector('.sheet [data-act=dive],.sheet [data-act=stop]');
          if(!b) return null; const q=b.getBoundingClientRect();
          return {top:Math.round(q.top),bottom:Math.round(q.bottom)};})()""")
        check(r is not None, "시트에 진행 버튼이 있음")
        if r:
            check(0 <= r["top"] and r["bottom"] <= h,
                  f"스크롤 없이 진행 버튼이 보임 (버튼 {r['top']}~{r['bottom']}px, 화면 {h}px)")
        # 시트가 보드를 완전히 가리지도 않아야 한다
        cov = c.js("""(()=>{const s=document.querySelector('.sheet'),b=document.querySelector('.board');
          if(!s||!b) return 0; const S=s.getBoundingClientRect(),B=b.getBoundingClientRect();
          const o=Math.max(0,Math.min(S.bottom,B.bottom)-Math.max(S.top,B.top));
          return Math.round(o/B.height*100);})()""")
        check(cov <= 40, f"시트가 보드를 40% 넘게 가리지 않음 (실제 {cov}%)")
        hid = c.js("""(()=>{const s=document.querySelector('.sheet'); if(!s) return [];
          const S=s.getBoundingClientRect();
          return [...document.querySelectorAll('.axl')].filter(e=>{const r=e.getBoundingClientRect();
            return r.left<S.right&&S.left<r.right&&r.top<S.bottom&&S.top<r.bottom;})
            .map(e=>e.textContent.trim().slice(0,10));})()""")
        check(not hid, f"시트가 축 라벨을 가리지 않음 (가림: {hid})")

        # --- 좁히기 3회: 축이 세분화되는가 ---
        prev_axes = axes
        for step in range(1, 3):
            btn = c.js("!!document.querySelector('[data-act=dive]')")
            if not btn:
                break
            c.js("document.querySelector('[data-act=dive]').click()")
            time.sleep(0.6)
            if c.js("!!document.querySelector('.final-word')"):
                print(f"  · {step}단계에서 여정 종료")
                break
            new_axes = c.js("[...document.querySelectorAll('.axl')].map(e=>e.textContent)")
            check(new_axes != prev_axes, f"{step}단계에서 축 라벨이 이전과 달라짐")
            check(c.js("document.querySelectorAll('.trail span').length") == step,
                  f"{step}단계 여정 표시 {step}개")
            if step == 2:
                check(c.js("document.querySelectorAll('.chip.grp').length") == 0,
                      "마지막 단계는 단어 칩이어야 함")
                check(c.js("!!document.querySelector('[data-act=stop]')")
                      or not c.js("!!document.querySelector('.sheet')"),
                      "단어 카드엔 '이게 내 감정이에요' 버튼")
            label_checks(c, f"{step}단계")
            prev_axes = new_axes
            nchips = c.js("document.querySelectorAll('.chip').length")
            check(nchips >= 3, f"{step}단계 칩 {nchips}개 (>=3)")
            ov = c.js("""(()=>{const b=document.querySelector('.board').getBoundingClientRect();
              return [...document.querySelectorAll('.chip')].filter(c=>{const r=c.getBoundingClientRect();
              return r.left<b.left-1||r.right>b.right+1;}).map(c=>c.textContent);})()""")
            check(not ov, f"{step}단계 칩이 보드 가로 범위 안 (밖: {ov})")
            if c.js("!!document.querySelector('.chip')"):
                c.js("document.querySelector('.chip').click()")
                time.sleep(0.45)
                # 모든 액션은 시트 안에 모여 있어야 한다(상단바에 흩어 두면 못 찾는다)
                check(c.js("!!document.querySelector('.sheet [data-act=dive],.sheet [data-act=stop]')"),
                      f"{step}단계 시트 안에 진행 버튼 있음")
                c.js("window.scrollTo(0,0)"); time.sleep(0.3)
                rr = c.js("""(()=>{const b=document.querySelector('.sheet [data-act=dive],.sheet [data-act=stop]');
                  if(!b) return null; const q=b.getBoundingClientRect();
                  return {top:Math.round(q.top),bottom:Math.round(q.bottom)};})()""")
                if rr:
                    check(0 <= rr["top"] and rr["bottom"] <= h,
                          f"{step}단계도 스크롤 없이 버튼이 보임 ({rr['top']}~{rr['bottom']}px)")

        # --- 결과 화면 ---
        if not c.js("!!document.querySelector('.final-word')"):
            if c.js("!!document.querySelector('[data-act=stop]')"):
                c.js("document.querySelector('[data-act=stop]').click()")
            else:
                c.js("document.querySelector('.chip').click()")
                time.sleep(0.4)
                c.js("document.querySelector('[data-act=stop]').click()")
            time.sleep(0.6)
        check(c.js("!!document.querySelector('.final-word')"), "결과 화면 도달")
        check(c.js("document.querySelectorAll('.journey span').length") >= 1, "결과에 여정 경로 표시")
        check(c.js("!!document.querySelector('.bar i')"), "결과에 쾌-불쾌/활성화 막대 표시")
        check(c.js("!!document.querySelector('.card .note.mine')"),
              "결과에 '이 사이트가 붙인 것' 구분 표기")
        txt = c.js("document.body.innerText") or ""
        check("논문" in txt and "이 사이트" in txt, "논문 값과 사이트 분류를 구분해 표기")
        check(c.js("!!document.querySelector('[data-act=again]')"), "결과에 '다시 해보기' 버튼")
        check(c.js("!!document.querySelector('.result .nl.compact #note')"),
              "결과 화면에도 글로 적는 칸이 있음")
        # '다시 해보기' 는 인트로가 아니라 첫 사분면으로 가야 한다
        c.js("document.querySelector('[data-act=again]').click()"); time.sleep(0.7)
        check(c.js("!!document.querySelector('.board')") and not c.js("!!document.querySelector('.why')"),
              "'다시 해보기' → 첫 사분면으로 이동")
        check(c.js("document.querySelectorAll('.trail span').length") == 0, "첫 사분면이라 경로가 비어 있음")
        check(c.js("!!document.querySelector('[data-act=reset]')"), "지도에 '처음부터' 있음")

        # 시트의 '여기서 멈추기'만으로도 결과에 닿는가 (이미 첫 사분면에 있다)
        c.js("document.querySelector('.chip').click()"); time.sleep(0.5)
        if c.js("!!document.querySelector('.sheet [data-act=stop]')"):
            c.js("document.querySelector('.sheet [data-act=stop]').click()"); time.sleep(0.6)
            check(c.js("!!document.querySelector('.final-word')"), "시트의 '여기서 멈추기'로 결과 도달")
            check(c.js("document.querySelectorAll('.journey span').length") == 1,
                  "멈춘 시점까지의 여정만 결과에 남음")

        # --- 가로 스크롤 금지 (전 화면 공통) ---
        hs = c.js("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(hs <= 0, f"가로 스크롤 없음 (초과 {hs}px)")

        c.js("document.querySelector('[data-act=reset]').click()")
        time.sleep(0.5)
        hs2 = c.js("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(hs2 <= 0, f"리셋 후에도 가로 스크롤 없음 (초과 {hs2}px)")

        shot = c.send("Page.captureScreenshot", format="png", captureBeyondViewport=False)
        import base64
        open(f"shot_{name}.png", "wb").write(base64.b64decode(shot["data"]))
        print(f"  · 스크린샷 shot_{name}.png")
        c.ws.close()
finally:
    proc.terminate()

print("\n--- 결과 ---")
print("✅ 전부 통과" if not fails else f"❌ 실패 {len(fails)}건:\n  - " + "\n  - ".join(fails))
sys.exit(0 if not fails else 1)
