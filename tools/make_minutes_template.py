"""회의록 한글(HWPX) 견본 만들기 → static/templates/minutes.hwpx

주간업무계획 견본(static/templates/weekly_plan.hwpx)의 쪽 설정(A4 세로)·글꼴 목록을 그대로 쓰고,
회의록용 글자 모양·문단 모양을 header.xml 끝에 덧붙인다. 본문은 {{BODY}} 문단 하나만 남긴다.
웹(app.js buildMinutesHwpx)이 이 문단 자리에 제목·정보 표·안건·내용·결정 사항·후속 조치 표를 채운다.

덧붙이는 번호(app.js의 HX_MIN과 같아야 함)
  글자 모양 charPr(기존 0~33 뒤): 제목 34, 소제목 35, 본문 36, 본문 굵게 37, 표 38, 표 굵게 39, 작은 글씨 40
  문단 모양 paraPr(기존 0~36 뒤): 가운데 37, 소제목 38, 단계0~3 39~42(내어쓰기), 표 왼쪽 43, 표 가운데 44, 기본 45
  (한글은 번호가 0부터 빈틈없이 이어져야 하므로 기존 개수 바로 다음 번호를 쓴다)
  테두리 borderFill: 기존 3(실선), 13(실선+회색 바탕)을 그대로 쓴다.
다시 만들기: python tools/make_minutes_template.py
"""
import re
import zipfile
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
SRC = BASE / "static" / "templates" / "weekly_plan.hwpx"
OUT = BASE / "static" / "templates" / "minutes.hwpx"

BODY_FONT, HEAD_FONT = 4, 1  # 휴먼명조, 함초롬돋움 (weekly_plan header.xml의 글꼴 번호)


def char_pr(i, height, font, bold=False, color="#000000"):
    fr = f'hangul="{font}" latin="{font}" hanja="{font}" japanese="{font}" other="{font}" symbol="{font}" user="{font}"'
    same = lambda v: " ".join(f'{k}="{v}"' for k in ("hangul", "latin", "hanja", "japanese", "other", "symbol", "user"))
    return (f'<hh:charPr id="{i}" height="{height}" textColor="{color}" shadeColor="none" useFontSpace="0" useKerning="0" '
            f'symMark="NONE" borderFillIDRef="1"><hh:fontRef {fr}/><hh:ratio {same(100)}/><hh:spacing {same(0)}/>'
            f'<hh:relSz {same(100)}/><hh:offset {same(0)}/>{"<hh:bold/>" if bold else ""}</hh:charPr>')


def para_pr(i, align="JUSTIFY", left=0, intent=0, prev=0, nxt=0, line=160):
    m = (f'<hh:margin><hc:intent value="{intent}" unit="HWPUNIT"/><hc:left value="{left}" unit="HWPUNIT"/>'
         f'<hc:right value="0" unit="HWPUNIT"/><hc:prev value="{prev}" unit="HWPUNIT"/><hc:next value="{nxt}" unit="HWPUNIT"/>'
         f'</hh:margin><hh:lineSpacing type="PERCENT" value="{line}" unit="HWPUNIT"/>')
    return (f'<hh:paraPr id="{i}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">'
            f'<hh:align horizontal="{align}" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/>'
            f'<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" '
            f'keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/><hh:autoSpacing eAsianEng="0" eAsianNum="0"/>'
            f'<hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar">{m}</hp:case>'
            f'<hp:default>{m}</hp:default></hp:switch>'
            f'<hh:border borderFillIDRef="1" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>'
            f'</hh:paraPr>')


CHARS = [char_pr(34, 1800, HEAD_FONT, True), char_pr(35, 1250, HEAD_FONT, True), char_pr(36, 1150, BODY_FONT),
         char_pr(37, 1150, BODY_FONT, True), char_pr(38, 1050, HEAD_FONT), char_pr(39, 1050, HEAD_FONT, True),
         char_pr(40, 950, HEAD_FONT, color="#555555")]
# 단계별 내어쓰기: 왼쪽 여백 + 첫 줄을 기호 폭만큼 내어 쓴다(줄이 넘어가면 기호 뒤 글자에 맞춤)
PARAS = [para_pr(37, "CENTER", nxt=600), para_pr(38, "LEFT", prev=1000, nxt=300),
         para_pr(39, left=1300, intent=-1300, prev=400), para_pr(40, left=2600, intent=-1300, prev=200),
         para_pr(41, left=3900, intent=-1200), para_pr(42, left=5100, intent=-1100),
         para_pr(43, "LEFT", line=140), para_pr(44, "CENTER", line=140), para_pr(45, left=1300)]


def add(header, tag, group, items, first):
    n = int(re.search(rf'<hh:{group} itemCnt="(\d+)"', header).group(1))
    assert n == first, f"{group}: 기존 {n}개 — 새 번호는 {n}부터여야 합니다(app.js HX_MIN도 함께 고칠 것)"
    header = re.sub(rf"(<hh:{group} itemCnt=\")(\d+)", lambda m: m.group(1) + str(int(m.group(2)) + len(items)), header, count=1)
    return header.replace(f"</hh:{group}>", "".join(items) + f"</hh:{group}>", 1)


def main():
    zin = zipfile.ZipFile(SRC)
    header = zin.read("Contents/header.xml").decode("utf-8")
    header = add(header, "charPr", "charProperties", CHARS, 34)
    header = add(header, "paraPr", "paraProperties", PARAS, 37)

    sec = zin.read("Contents/section0.xml").decode("utf-8")
    first = sec.index("<hp:p ")
    sec_pr = re.search(r"<hp:secPr .*?</hp:secPr>", sec, re.S).group(0)
    col_pr = re.search(r"<hp:ctrl><hp:colPr .*?/></hp:ctrl>", sec, re.S).group(0)
    page_num = '<hp:ctrl><hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar="-" /></hp:ctrl>'
    body = (f'<hp:p id="0" paraPrIDRef="45" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
            f'<hp:run charPrIDRef="36">{sec_pr}{col_pr}</hp:run><hp:run charPrIDRef="36">{page_num}</hp:run></hp:p>'
            f'<hp:p id="0" paraPrIDRef="45" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
            f'<hp:run charPrIDRef="36"><hp:t>{{{{BODY}}}}</hp:t></hp:run></hp:p>')
    sec = sec[:first] + body + "</hs:sec>"

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT, "w") as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename == "Contents/header.xml":
                data = header.encode("utf-8")
            elif info.filename == "Contents/section0.xml":
                data = sec.encode("utf-8")
            elif info.filename == "Preview/PrvText.txt":
                data = b""
            zout.writestr(info, data, compress_type=zipfile.ZIP_STORED if info.filename == "mimetype" else zipfile.ZIP_DEFLATED)
    print("만듦:", OUT)


if __name__ == "__main__":
    main()
