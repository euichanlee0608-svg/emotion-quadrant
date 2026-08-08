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
        # 첫 화면에서 스크롤 없이 '시작하기'가 보여야 한다
        btn_bottom = c.js("Math.round(document.querySelector('[data-act=start]').getBoundingClientRect().bottom)")
        check(btn_bottom <= h, f"시작 버튼이 첫 화면 안에 보임 (버튼 하단 {btn_bottom}px ≤ 화면 {h}px)")
        check("434" in (c.js("document.body.innerText") or ""), "인트로에 434개 표기")
        check(c.js("!!document.querySelector('footer .backlink')"), "푸터 포트폴리오 백링크 있음")
        check("박인조" in (c.js("document.body.innerText") or ""), "푸터에 논문 출처 표기")

        # --- 지도 0단계 ---
        c.js("document.querySelector('[data-act=start]').click()")
        time.sleep(0.6)
        chips = c.js("document.querySelectorAll('.chip').length")
        check(chips >= 8, f"0단계 칩 {chips}개 (>=8)")
        axes = c.js("[...document.querySelectorAll('.axl')].map(e=>e.textContent)")
        check(any("안 좋음" in a for a in axes) and any("심함" in a for a in axes),
              f"0단계 축 라벨이 모호한 틀: {axes}")
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
        check(c.js("!!document.querySelector('[data-act=dive]') && !!document.querySelector('[data-act=stop]')"),
              "뜻 카드에 '좁히기'와 '내 감정이에요' 선택지 있음")
        # 지도 화면엔 프로젝트 설명 푸터를 두지 않는다(스크롤만 잡아먹음)
        check(not c.js("!!document.querySelector('footer')"), "지도 화면에 푸터 없음")
        # 뜻 카드가 스크롤 없이 보여야 UX가 산다
        sb = c.js("Math.round(document.querySelector('.sheet').getBoundingClientRect().bottom)")
        pd = c.js("document.documentElement.scrollHeight - document.documentElement.clientHeight")
        check(sb <= h, f"뜻 카드가 화면 안에 들어옴 (카드 하단 {sb}px ≤ {h}px, 페이지 넘침 {pd}px)")

        # --- 좁히기 3회: 축이 세분화되는가 ---
        prev_axes = axes
        for step in range(1, 4):
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
            check(c.js("!!document.querySelector('.origin-label')"), f"{step}단계 원점에 고른 단어 표시")
            check(c.js("document.querySelectorAll('.trail span').length") == step,
                  f"{step}단계 여정 표시 {step}개")
            label_checks(c, f"{step}단계")
            # 뜻 카드를 열지 않아도 바로 멈출 수 있어야 한다
            check(c.js("!!document.querySelector('[data-act=stopHere]')"),
                  f"{step}단계 지도에 '여기서 멈추기' 있음")
            prev_axes = new_axes
            nchips = c.js("document.querySelectorAll('.chip').length")
            check(nchips >= 3, f"{step}단계 칩 {nchips}개 (>=3)")
            ov = c.js("""(()=>{const b=document.querySelector('.board').getBoundingClientRect();
              return [...document.querySelectorAll('.chip')].filter(c=>{const r=c.getBoundingClientRect();
              return r.left<b.left-1||r.right>b.right+1;}).map(c=>c.textContent);})()""")
            check(not ov, f"{step}단계 칩이 보드 가로 범위 안 (밖: {ov})")
            c.js("document.querySelector('.chip').click()")
            time.sleep(0.4)

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
        check(c.js("!!document.querySelector('[data-act=reset]')"), "결과에 다시하기 버튼")

        # '여기서 멈추기'만으로도 결과에 닿는가
        c.js("document.querySelector('[data-act=reset]').click()"); time.sleep(0.6)
        c.js("document.querySelector('.chip').click()"); time.sleep(0.4)
        c.js("document.querySelector('[data-act=dive]').click()"); time.sleep(0.7)
        if c.js("!!document.querySelector('[data-act=stopHere]')"):
            c.js("document.querySelector('[data-act=stopHere]').click()"); time.sleep(0.6)
            check(c.js("!!document.querySelector('.final-word')"), "'여기서 멈추기'로 결과 화면 도달")
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
