#!/usr/bin/env python3
"""data.js 재생성 — 논문 부록 추출값 + 뜻풀이를 합친다.

실행: python3 source/build_data.py   (레포 루트에서)

appendix434.json 은 논문 PDF(부록 1)에서 뽑은 원자료다. 뽑는 방법:
    pdftotext -layout <논문>.pdf out.txt
    정규식 r"([가-힣]+)(\\*?)\\s+(\\d\\.\\d\\d)\\s+(\\d\\.\\d\\d)\\s+(\\d\\.\\d\\d)\\s+(\\d\\.\\d\\d)"
    로 '단어[*] 원형성 친숙성 쾌-불쾌 활성화' 를 순서대로 수집.
정확도는 아래 CHECKSUM(논문 표 4의 구간별 빈도)으로 검증한다.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT.parent / "data.js"

# 논문 원문 오식 교정 — 부록에 '감홍'으로 인쇄돼 있으나 感興(감흥)이다.
FIX = {"감홍": "감흥"}

# 논문 표 4: 쾌-불쾌 / 활성화 값의 1점 구간별 단어 수 (434개 기준)
CHECKSUM = {"v": [39, 216, 57, 44, 75, 3], "a": [1, 42, 129, 143, 111, 8]}

rows = json.loads((ROOT / "appendix434.json").read_text(encoding="utf-8"))
defs = {}
for f in ["_defs_a.json", "_defs_b.json", "_defs_c.json"]:
    defs.update(json.loads((ROOT / f).read_text(encoding="utf-8")))

for r in rows:
    if r["w"] in FIX:
        r["orig"], r["w"] = r["w"], FIX[r["w"]]

words = {r["w"] for r in rows}
assert len(rows) == 434, f"단어가 434개가 아님: {len(rows)}"
assert len(words) == 434, "단어 중복 있음"
missing = words - set(defs)
assert not missing, f"뜻풀이 없는 단어: {sorted(missing)}"
assert not (set(defs) - words), f"쓰이지 않는 뜻풀이: {sorted(set(defs) - words)}"

for key, src in (("v", "val"), ("a", "aro")):
    b = [0] * 6
    for r in rows:
        b[int(r[src]) - 1] += 1
    assert b == CHECKSUM[key], f"{key} 분포가 논문 표4와 다름: {b} != {CHECKSUM[key]}"

out = [
    {"w": r["w"], "d": defs[r["w"]], "v": r["val"], "a": r["aro"],
     "p": r["proto"], "f": r["fam"], "r": 1 if r["rep"] else 0}
    for r in sorted(rows, key=lambda x: -x["proto"])   # 원형성 내림차순
]

header = '''/* 한국어 감정단어 434개 — 박인조·민경환(2005), "한국어 감정단어의 목록 작성과 차원 탐색",
   한국심리학회지: 사회 및 성격 19(1), 109-129. 부록 1에서 추출.
   v=쾌-불쾌(1 불쾌~7 쾌), a=활성화(1 비활성~7 활성), p=원형성, f=친숙성 (모두 7점 척도 평균)
   r=1 은 논문이 MDS 분석에 쓴 대표단어 표시(*).
   d=뜻풀이는 이 앱에서 별도로 붙인 것으로 논문 내용이 아님.
   검증: 434개 전수 및 쾌-불쾌/활성화 구간별 빈도가 논문 표 4와 정확히 일치.
   교정: 원문 표기 '감홍' → '감흥'(感興) 1건.
   ※ 직접 고치지 말 것 — source/build_data.py 로 재생성한다. */
export const WORDS = [
'''
body = ",\n".join(json.dumps(o, ensure_ascii=False, separators=(",", ":")) for o in out)
OUT.write_text(header + body + "\n];\n", encoding="utf-8")

n_rep = sum(o["r"] for o in out)
print(f"data.js 생성 — 단어 {len(out)}개, 대표단어 표시 {n_rep}개, 체크섬 일치")
if n_rep != 87:
    print(f"  주의: 논문 본문은 대표단어를 87개라 하는데 부록의 * 표는 {n_rep}개다(원문 불일치).",
          file=sys.stderr)
