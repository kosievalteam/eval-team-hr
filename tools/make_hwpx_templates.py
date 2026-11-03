"""주간업무 한글(HWPX) 양식 → 내용을 비운 웹 다운로드용 템플릿(static/templates/).

한글에서 '다른 이름으로 저장 → HWPX'로 저장한 실제 주간 문서를 넣으면, 서식·표 구조는 그대로 두고
글자만 표시자({{...}})로 바꾼다. 실제 업무 내용은 템플릿에 남지 않는다(저장소가 공개라서).
양식이 바뀌면 새 HWPX로 다시 실행: python tools/make_hwpx_templates.py <주간업무계획.hwpx> <주간핵심업무계획.hwpx>

주간업무계획 템플릿 (본문 표 3열: 주요업무 | 진행 | 계획)
  - 1행 2·3열 제목: {{PROG_LABEL}} {{PLAN_LABEL}} / 상단 표: {{HEADING}}
  - 3행 = 일반 업무영역 견본, 4행 = 사전협의 견본(<사전협의 진행현황> 표 포함). 나머지 행은 지운다.
  - 업무 칸에는 문단 견본 3개만 남긴다: 빈 줄, {{L1}}(- 항목), {{L2}}( * 세부항목)
  - 진행현황 표 숫자: {{wait}} {{reject}} {{kosi}} {{office}} {{done}} {{total}}
주간핵심업무계획 템플릿
  - 제목: {{TITLE}} / 정책평가팀 칸: {{KEY}}(- 항목) 견본과 빈 줄 견본
"""
import copy
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

BASE = Path(__file__).resolve().parent.parent
OUT = BASE / "static" / "templates"
HP = "{http://www.hancom.co.kr/hwpml/2011/paragraph}"
STATS = ["wait", "reject", "kosi", "office", "done", "total"]


def register_namespaces(xml):
    """ElementTree가 접두어를 ns0 등으로 바꾸지 않도록 원본 접두어를 등록한다."""
    for _, (prefix, uri) in ET.iterparse(__import__("io").BytesIO(xml), events=["start-ns"]):
        ET.register_namespace(prefix, uri)


def text(el):
    return "".join(t.text or "" for t in el.iter(HP + "t"))


def set_text(p, value):
    """문단의 첫 글자 run에 value를 넣고 나머지 글자는 지운다. 줄 배치 정보(linesegarray)는 한글이 다시 계산한다."""
    ts = list(p.iter(HP + "t"))
    if ts:
        ts[0].text = value
        for t in ts[1:]:
            t.text = ""
    else:
        run = p.find(HP + "run")
        ET.SubElement(run, HP + "t").text = value
    for ls in p.findall(HP + "linesegarray"):
        p.remove(ls)


def cells(tbl):
    return {(int(tc.find(HP + "cellAddr").get("rowAddr")), int(tc.find(HP + "cellAddr").get("colAddr"))): tc
            for tr in tbl.findall(HP + "tr") for tc in tr.findall(HP + "tc")}


def paras(tc):
    return tc.find(HP + "subList").findall(HP + "p")


def usual(ps):
    """가장 흔한 글자 모양(검정)의 문단. 파란 글자(지난주와 달라진 내용 표시)는 웹에서 같은 모양의 파란색으로 바꾼다."""
    ps = list(ps)
    first = lambda p: next(r.get("charPrIDRef") for r in p.findall(HP + "run") if r.find(HP + "t") is not None)
    ids = [first(p) for p in ps]
    black = [i for i in ids if COLORS.get(i, "#000000") == "#000000"] or ids
    common = max(set(black), key=black.count)
    return ps[ids.index(common)]


COLORS = {}  # charPr id → 글자색 (header.xml)


def load_colors(z):
    COLORS.clear()
    head = ET.fromstring(z.read("Contents/header.xml"))
    for cp in head.iter("{http://www.hancom.co.kr/hwpml/2011/head}charPr"):
        COLORS[cp.get("id")] = cp.get("textColor", "#000000").upper()


def keep_protos(tc, extra_after=()):
    """업무 칸을 빈 줄·{{L1}}·{{L2}} 견본 3개(+ extra_after 문단)로 줄인다."""
    sub = tc.find(HP + "subList")
    ps = sub.findall(HP + "p")
    spacer = next(p for p in ps if not text(p).strip() and p.find(".//" + HP + "tbl") is None)
    l1 = usual(p for p in ps if text(p).lstrip().startswith("-"))
    l2 = usual(p for p in ps if text(p).lstrip().startswith("*"))
    keep = [copy.deepcopy(spacer), copy.deepcopy(l1), copy.deepcopy(l2)] + [copy.deepcopy(p) for p in extra_after]
    set_text(keep[1], "{{L1}}")
    set_text(keep[2], "{{L2}}")
    for p in ps:
        sub.remove(p)
    for p in keep:
        sub.append(p)


def plan_template(src, dst):
    z = zipfile.ZipFile(src)
    load_colors(z)
    xml = z.read("Contents/section0.xml")
    register_namespaces(xml)
    root = ET.fromstring(xml)
    tbls = list(root.iter(HP + "tbl"))
    main = next(t for t in tbls if t.get("colCnt") == "3")
    head = next(t for t in tbls if any("주요 업무 계획" in text(p) for p in t.iter(HP + "p")))
    c = cells(main)
    set_text(paras(c[(1, 1)])[0], "{{PROG_LABEL}}")
    set_text(paras(c[(1, 2)])[0], "{{PLAN_LABEL}}")
    review_row = next(r for r in range(2, int(main.get("rowCnt"))) if "사전협의" in text(c[(r, 0)]))
    normal_row = next(r for r in range(2, int(main.get("rowCnt"))) if r != review_row)
    for r in (normal_row, review_row):
        set_text(paras(c[(r, 0)])[0], "{{AREA}}")
        keep_protos(c[(r, 2)])
    keep_protos(c[(normal_row, 1)])
    # 사전협의 진행 칸: 견본 뒤에 '<사전협의 진행현황>' 문단과 숫자 표 문단을 남긴다
    rv = paras(c[(review_row, 1)])
    title_p = next(p for p in rv if "진행현황" in text(p))
    stats_p = next(p for p in rv if p.find(".//" + HP + "tbl") is not None)
    st = cells(stats_p.find(".//" + HP + "tbl"))
    for i, key in enumerate(STATS, start=1):
        set_text(paras(st[(1, i)])[0], "{{%s}}" % key)
    keep_protos(c[(review_row, 1)], extra_after=[title_p, stats_p])
    # 견본 2행만 남기고(일반 → 사전협의 순) 행 번호를 다시 매긴다
    trs = main.findall(HP + "tr")
    protos = [tr for tr in trs if int(tr.find(HP + "tc/" + HP + "cellAddr").get("rowAddr")) in (normal_row, review_row)]
    protos.sort(key=lambda tr: 0 if int(tr.find(HP + "tc/" + HP + "cellAddr").get("rowAddr")) == normal_row else 1)
    for tr in trs[2:]:
        main.remove(tr)
    for i, tr in enumerate(protos, start=2):
        for tc in tr.findall(HP + "tc"):  # 칸 안의 진행현황 표 주소는 건드리지 않는다
            tc.find(HP + "cellAddr").set("rowAddr", str(i))
        main.append(tr)
    main.set("rowCnt", "4")
    set_text(next(p for p in head.iter(HP + "p") if "주차" in text(p)), "{{HEADING}}")
    write(z, dst, root)


def key_template(src, dst):
    z = zipfile.ZipFile(src)
    xml = z.read("Contents/section0.xml")
    register_namespaces(xml)
    root = ET.fromstring(xml)
    set_text(next(p for p in root.iter(HP + "p")
                  if "부서별 핵심 업무 계획" in text(p) and p.find(".//" + HP + "tbl") is None), "{{TITLE}}")
    main = max(root.iter(HP + "tbl"), key=lambda t: int(t.get("rowCnt")))
    c = cells(main)
    team = next(k for k, tc in c.items() if text(tc).replace(" ", "") == "정책평가팀")
    tc = next(tc for k, tc in c.items() if k[0] == team[0] and k[1] == team[1] + 1)
    sub = tc.find(HP + "subList")
    ps = sub.findall(HP + "p")
    # 견본 항목: '- '와 본문이 다른 글자 모양으로 나뉜 첫 항목(양식 원본 그대로)
    item = copy.deepcopy(next(p for p in ps if text(p).startswith("- ")))
    spacer = copy.deepcopy(next(p for p in ps if not text(p).strip()))
    runs = [r for r in item.findall(HP + "run") if r.find(HP + "t") is not None]
    runs[-1].find(HP + "t").text = "{{KEY}}"
    for r in runs[:-1]:
        r.find(HP + "t").text = "- "
    for ls in item.findall(HP + "linesegarray"):
        item.remove(ls)
    for p in ps:
        sub.remove(p)
    sub.append(item)
    sub.append(spacer)
    write(z, dst, root)


def write(z, dst, root):
    xml = b'<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' + ET.tostring(root, encoding="utf-8")
    dst.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dst, "w") as out:
        for info in z.infolist():  # mimetype이 맨 앞·무압축이어야 한다(원본 순서·압축 방식 유지)
            data = z.read(info.filename)
            if info.filename == "Contents/section0.xml":
                data = xml
            elif info.filename == "Preview/PrvText.txt":
                data = b""  # 미리보기 글에 실제 내용이 들어 있다
            out.writestr(info, data, compress_type=info.compress_type)
    leftover = [t for t in ET.fromstring(xml).iter(HP + "t") if t.text and t.text.strip()]
    print(f"{dst.name}: 남은 글자 {len(leftover)}개 (양식 고정 문구·표시자)")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    plan_src, key_src = (Path(a) for a in sys.argv[1:3])
    plan_template(plan_src, OUT / "weekly_plan.hwpx")
    key_template(key_src, OUT / "weekly_key.hwpx")
