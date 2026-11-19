// 단위 테스트: Node 내장 test runner만 사용 (추가 의존성 없음)
// 실행: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = id => {
  const m = html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`));
  assert.ok(m, `script#${id} 없음`);
  return m[1];
};
const ctx = vm.createContext({ URLSearchParams });
vm.runInContext(script("data") + "\n;globalThis.__d={REGIONS,SOURCES,COMPARE_ROWS,CHECKED};", ctx);
vm.runInContext(script("app"), ctx);
const { REGIONS, SOURCES, COMPARE_ROWS } = ctx.__d;
const App = ctx.TravelApp;
const srcIds = new Set(SOURCES.map(s => s.id));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

test("후보지 3곳이 모두 있다", () => {
  assert.deepEqual([...REGIONS.map(r => r.id)], ["banff", "nz", "dolo"]);
});

test("명소는 지역마다 4~6곳이고, 사진·작성자·라이선스·원본 링크가 있다", () => {
  for (const r of REGIONS) {
    assert.ok(r.spots.length >= 4 && r.spots.length <= 6, r.id);
    for (const s of r.spots) {
      assert.match(s.img, /^https:\/\/(upload|thumb)\.wikimedia\.org\//, s.name);
      assert.match(s.page, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/, s.name);
      assert.ok(s.credit && s.credit.length > 1, `작성자 누락: ${s.name}`);
      assert.match(s.license, /^(CC BY|CC0|Public domain)/, s.name);
    }
  }
});

test("모든 출처에 확인일이 있고, URL은 https다 (추정 항목 제외)", () => {
  for (const s of SOURCES) {
    assert.match(s.checkedAt, DATE, s.id);
    assert.equal(typeof s.official, "boolean");
    if (s.id !== "estimate") assert.match(s.url, /^https:\/\//, s.id);
  }
});

test("유의사항·비교값·날씨가 모두 존재하는 출처를 참조한다", () => {
  for (const r of REGIONS) {
    const items = [...r.cautions, ...Object.values(r.compare), r.weatherSep,
      ...r.seasons.flatMap(se => [...se.cautions, ...Object.values(se.compare)])];
    for (const it of items) {
      assert.ok(it.src && it.src.length, `${r.id}: 출처 없음 → ${it.text || it.value}`);
      for (const id of it.src) assert.ok(srcIds.has(id), `${r.id}: 없는 출처 ${id}`);
      if (it.src.includes("estimate")) assert.equal(it.estimate, true, `${r.id}: estimate 출처면 estimate 플래그 필요`);
    }
  }
});

test("출처끼리 값이 다른 항목에 conflict 표시가 있다 (브라이에스·IVL·ETIAS)", () => {
  const find = (rid, kw) => { const r = REGIONS.find(x => x.id === rid); return [...r.cautions, ...r.seasons.flatMap(se => se.cautions)].find(c => c.text.includes(kw)); };
  assert.equal(find("dolo", "브라이에스").conflict, true);
  assert.equal(find("nz", "MBIE").conflict, true);
  assert.equal(find("dolo", "ETIAS").conflict, true);
});

test("Explore 단계에서 확인한 사실이 반영되어 있다", () => {
  const all = JSON.stringify(REGIONS);
  assert.ok(all.includes("개인 차량 통행 금지"));
  assert.ok(all.includes("NZD 100"));
  assert.ok(all.includes("€40"));
  assert.ok(all.includes("비공식 요금"));
});

test("월별 데이터는 12개, 추천도는 1~5이고, 남반구 계절이 반대로 반영된다", () => {
  for (const r of REGIONS) {
    for (const k of ["monthly", "season", "peak"]) assert.equal(r[k].length, 12, `${r.id}.${k}`);
    r.monthly.forEach(v => assert.ok(v >= 1 && v <= 5));
    r.peak.forEach(p => assert.ok(["peak", "shoulder", "off"].includes(p)));
  }
  const nz = REGIONS.find(r => r.id === "nz");
  assert.equal(nz.hemisphere, "S");
  assert.ok(nz.monthly[0] > nz.monthly[6], "뉴질랜드는 1월 추천도가 7월보다 높아야 함");
  const banff = REGIONS.find(r => r.id === "banff");
  assert.ok(banff.monthly[6] > banff.monthly[0], "밴프는 7월 추천도가 1월보다 높아야 함");
});

test("URL 해시: 정상 값을 읽고 쓰며, 잘못된 값은 기본값(9월·첫 탭)으로 돌아간다", () => {
  assert.deepEqual({ ...App.parseHash("#month=3&tab=nz", REGIONS) }, { month: 3, tab: "nz" });
  assert.deepEqual({ ...App.parseHash("", REGIONS) }, { month: 9, tab: "banff" });
  assert.deepEqual({ ...App.parseHash("#month=13&tab=<x>", REGIONS) }, { month: 9, tab: "banff" });
  assert.deepEqual({ ...App.parseHash("#month=abc", REGIONS) }, { month: 9, tab: "banff" });
  const h = App.buildHash({ month: 11, tab: "dolo" });
  assert.equal(h, "#month=11&tab=dolo");
  assert.deepEqual({ ...App.parseHash(h, REGIONS) }, { month: 11, tab: "dolo" });
});

test("비교표: 8개 행, 월을 바꾸면 날씨와 성수기 값이 바뀐다", () => {
  const sep = App.renderCompare(REGIONS, 9, COMPARE_ROWS, SOURCES);
  const jan = App.renderCompare(REGIONS, 1, COMPARE_ROWS, SOURCES);
  assert.equal((sep.match(/<tr><th scope="row">/g) || []).length, 8);
  assert.notEqual(sep, jan);
  assert.ok(sep.includes("9월 기준") && jan.includes("1월 기준"));
  assert.ok(sep.includes("낮 13~18°C"), "9월엔 수집한 기온을 표시");
  assert.ok(jan.includes("한여름 성수기, 해가 김"), "1월 뉴질랜드는 한여름");
});

test("요약 카드: 월에 따라 추천도 별점이 바뀐다", () => {
  const html1 = App.renderSummary(REGIONS, 1, SOURCES);
  assert.equal((html1.match(/<article class="card/g) || []).length, 3);
  assert.ok(html1.includes('aria-label="5점 중 5점"'), "1월 뉴질랜드 5점");
  assert.ok(html1.includes('aria-label="5점 중 2점"'));
});

test("히트맵: 36칸이고 선택한 월만 강조된다", () => {
  const h = App.renderHeatmap(REGIONS, 4);
  assert.equal((h.match(/data-month=/g) || []).length, 36);
  assert.equal((h.match(/<td class="sel">/g) || []).length, 3);
});

test("지역 패널: 명소, 장단점, 유의사항, 팁, 각주, 배지가 모두 나온다", () => {
  for (const r of REGIONS) {
    const p = App.renderPanel(r, 9, SOURCES);
    for (const h of ["주요 명소", "장단점", "유의할 점", "현지 팁"]) assert.ok(p.includes(h), `${r.id}: ${h}`);
    assert.ok(/<sup><a href="#src-/.test(p), `${r.id}: 각주 링크`);
    assert.equal((p.match(/class="ph"/g) || []).length, r.spots.length);
  }
  const dolo = App.renderPanel(REGIONS[2], 9, SOURCES);
  assert.ok(dolo.includes("출처마다 다름"));
  assert.ok(dolo.includes("추정"));
  assert.ok(App.renderPanel(REGIONS[1], 9, SOURCES).includes("남반구"));
});

test("외부 링크는 모두 새 탭으로 열리고 noopener가 붙는다", () => {
  const out = App.renderPanel(REGIONS[0], 9, SOURCES) + App.renderSources(SOURCES) + App.renderSummary(REGIONS, 9, SOURCES);
  const ext = out.match(/<a href="https?:[^>]*>/g) || [];
  assert.ok(ext.length > 10);
  for (const a of ext) assert.ok(a.includes('target="_blank"') && a.includes('rel="noopener noreferrer"'), a);
});

test("출처 목록: 공식/비공식/추정 배지가 붙는다", () => {
  const s = App.renderSources(SOURCES);
  assert.equal((s.match(/<li id="src-/g) || []).length, SOURCES.length);
  assert.ok(s.includes("b-official") && s.includes("b-unofficial") && s.includes("b-estimate"));
});

test("HTML 이스케이프: 데이터에 태그가 있어도 그대로 실행되지 않는다", () => {
  assert.equal(App.esc('<img src=x onerror="a">'), "&lt;img src=x onerror=&quot;a&quot;&gt;");
  const evil = { ...REGIONS[0], name: "<script>x</script>", checklist: ["<b>y</b>"] };
  const out = App.renderChecklists([evil], {});
  assert.ok(!out.includes("<script>") && !out.includes("<b>y"));
});

test("체크리스트: 저장된 체크 상태가 반영된다", () => {
  const out = App.renderChecklists(REGIONS, { "nz:0": true });
  assert.ok(/data-key="nz:0" checked/.test(out));
  assert.ok(!/data-key="nz:1" checked/.test(out));
});

test("localStorage를 쓸 수 없어도 오류 없이 기본값을 쓴다", () => {
  const broken = App.makeStore(() => { throw new Error("blocked"); });
  assert.equal(broken.get("k", "fallback"), "fallback");
  assert.equal(broken.set("k", 1), false);
  const mem = new Map();
  const ok = App.makeStore(() => ({ getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) }));
  assert.equal(ok.set("k", { a: 1 }), true);
  assert.deepEqual({ ...ok.get("k") }, { a: 1 });
});

test("의존성 규약: 외부 스크립트 없음, 스타일시트는 Google Fonts만", () => {
  assert.ok(!/<script[^>]+src=/i.test(html), "외부 <script src> 금지");
  const links = html.match(/<link[^>]*rel="stylesheet"[^>]*>/g) || [];
  for (const l of links) assert.match(l, /href="https:\/\/fonts\.googleapis\.com\//);
  assert.ok(!/import\s*\(|\bimport\s+[\w{]/.test(script("app")), "ES 모듈 import 금지");
});

test("테마: 라이트/다크 토큰이 모두 정의되어 있다", () => {
  assert.ok(html.includes("@media (prefers-color-scheme:dark)"));
  assert.ok(html.includes(':root:not([data-theme="light"])'));
  assert.ok(html.includes(':root[data-theme="dark"]'));
  assert.match(html, /body\{[^}]*background:var\(--bg\)/);
});

test("계절 구분: 지역마다 1~12월이 정확히 한 계절에 속한다", () => {
  for (const r of REGIONS) {
    // vm 컨텍스트에서 만든 배열이라 spread로 현재 realm 배열로 바꿔 비교한다
    const all = [...r.seasons.flatMap(se => [...se.months])].sort((a, b) => a - b);
    assert.deepEqual(all, [1,2,3,4,5,6,7,8,9,10,11,12], r.id);
    for (const se of r.seasons) {
      assert.ok(se.id && se.label, r.id);
      for (const k of ["cost", "drive", "trek", "lodging"]) assert.ok(se.compare[k], `${r.id}.${se.id}.compare.${k}`);
      assert.ok(se.pros.length && se.cons.length && se.tips.length, `${r.id}.${se.id}`);
    }
    assert.ok(r.compare.flight, `${r.id}: 항공은 연중 공통`);
  }
});

test("경비: 현지 통화 + 원화 + 기준 환율로 표시된다", () => {
  const FX = vm.runInContext("FX", ctx);
  assert.deepEqual({ ...FX.krw }, { CAD: 960, NZD: 740, EUR: 1480 });
  assert.match(FX.asOf, /2026-11/);
  for (const id of FX.src) assert.ok(srcIds.has(id), id);
  const cur = { banff: "CAD", nz: "NZD", dolo: "EUR" };
  for (const r of REGIONS) {
    assert.equal(r.currency, cur[r.id]);
    for (const se of r.seasons) {
      const c = se.compare.cost;
      assert.ok(Array.isArray(c.amount) && c.amount[0] < c.amount[1], `${r.id}.${se.id}`);
      assert.ok(!("value" in c), "원화 문자열을 직접 저장하지 않음 (환율로 계산)");
    }
  }
  assert.equal(App.formatCost({ amount: [4700, 7300] }, "CAD", FX), "1인 약 CAD 4,700~7,300 (약 451~701만원)");
  assert.equal(App.formatCost({ amount: [2000, 3400], note: "x" }, "EUR", FX), "1인 약 EUR 2,000~3,400 (약 296~503만원) · x");
  const table = App.renderCompare(REGIONS, 9, COMPARE_ROWS, SOURCES);
  assert.ok(table.includes("CAD 4,700~7,300") && table.includes("NZD 4,700~7,400") && table.includes("EUR 2,700~4,400"));
  const fx = App.renderFx(FX, SOURCES);
  assert.ok(fx.includes("1 CAD ≈ 960원") && fx.includes("1 NZD ≈ 740원") && fx.includes("1 EUR ≈ 1,480원"));
  assert.ok(/<sup><a href="#src-fx-hana">/.test(fx), "환율 출처 각주");
});

test("계절 구분: 월 범위 라벨 (연도를 넘는 구간 포함)", () => {
  assert.equal(App.monthsLabel([6,7,8,9]), "6~9월");
  assert.equal(App.monthsLabel([4,5,10]), "4~5·10월");
  assert.equal(App.monthsLabel([11,12,1,2,3]), "11~3월");
  assert.equal(App.monthsLabel([12,1,2]), "12~2월");
  assert.equal(App.monthsLabel([9]), "9월");
});

test("계절 구분: 연중 공통 항목에는 특정 월 표현이 없다", () => {
  const monthWord = /\d{1,2}월/;
  for (const r of REGIONS) {
    for (const t of [r.summary, ...r.pros, ...r.cons, ...r.tips, ...r.cautions.map(c => c.text)]) {
      assert.ok(!monthWord.test(t), `${r.id} 공통 항목에 월 표현: ${t}`);
    }
  }
});

test("계절 구분: 월을 바꾸면 경비·숙소·장단점·유의사항이 계절에 맞게 바뀐다", () => {
  const banff = REGIONS.find(r => r.id === "banff");
  const jul = App.viewFor(banff, 7), jan = App.viewFor(banff, 1);
  assert.equal(jul.season.id, "summer");
  assert.equal(jan.season.id, "winter");
  assert.notEqual(jul.compare.cost.value, jan.compare.cost.value);
  assert.notEqual(jul.compare.lodging.value, jan.compare.lodging.value);
  assert.ok(jul.cautions.some(c => c.text.includes("셔틀 예약")));
  assert.ok(!jan.cautions.some(c => c.text.includes("셔틀 예약")));
  assert.equal(jan.compare.flight.value, jul.compare.flight.value, "항공은 계절과 무관");

  const nz = REGIONS.find(r => r.id === "nz");
  assert.equal(App.seasonOf(nz, 1).id, "summer", "남반구 1월 = 여름");
  assert.equal(App.seasonOf(nz, 7).id, "winter", "남반구 7월 = 겨울");

  const dolo = REGIONS.find(r => r.id === "dolo");
  const dJan = App.renderPanel(dolo, 1, SOURCES), dSep = App.renderPanel(dolo, 9, SOURCES);
  assert.ok(dSep.includes("브라이에스") && !dJan.includes("브라이에스 호수는 7/1"), "여름 예약제 안내는 겨울에 안 나옴");
  assert.ok(dJan.includes("겨울 스키 시즌 (12~3월)"));
  assert.ok(dJan.includes("b-season"), "계절 항목에 계절 배지");
  assert.ok(dJan.includes("ETIAS"), "공통 항목은 계절과 무관하게 표시");
});

test("계절 구분: 비교표에 해당 시즌 행이 있고 월에 따라 바뀐다", () => {
  const jan = App.renderCompare(REGIONS, 1, COMPARE_ROWS, SOURCES);
  const jul = App.renderCompare(REGIONS, 7, COMPARE_ROWS, SOURCES);
  assert.ok(jan.includes("해당 시즌"));
  assert.ok(jan.includes("여름 성수기 (12~2월)") && jan.includes("겨울 스키 시즌 (11~3월)"));
  assert.ok(jul.includes("겨울 스키 시즌 (6~8월)") && jul.includes("여름 성수기 (6~9월)"));
});

test('계절 사진: 월·반구에 맞는 계절 사진이 선택되고, 없으면 기본 사진 + 안내', () => {
  assert.equal(App.photoKind(1, 'N'), 'winter');
  assert.equal(App.photoKind(4, 'N'), 'spring');
  assert.equal(App.photoKind(7, 'N'), 'summer');
  assert.equal(App.photoKind(10, 'N'), 'autumn');
  assert.equal(App.photoKind(1, 'S'), 'summer', '남반구 1월 = 여름');
  assert.equal(App.photoKind(7, 'S'), 'winter', '남반구 7월 = 겨울');
  assert.equal(App.photoKind(10, 'S'), 'spring');
  const louise = REGIONS[0].spots[0];
  const jan = App.photoFor(louise, 1, 'N'), jul = App.photoFor(louise, 7, 'N');
  assert.notEqual(jan.img, jul.img, '겨울과 여름 사진이 다름');
  assert.equal(jul.img, louise.img, 'default 표시는 기본 사진 사용');
  assert.equal(jan.fallback, false);
  const maligne = REGIONS[0].spots.find(s => s.name.includes('말린'));
  const mw = App.photoFor(maligne, 1, 'N');
  assert.equal(mw.fallback, true, '말린 호수 겨울 사진 없음');
  assert.equal(mw.img, maligne.img);
  const panel = App.renderPanel(REGIONS[0], 1, SOURCES);
  assert.ok(panel.includes('사진 없음 · 기본 사진'));
  assert.ok(panel.includes('❄️ 겨울'));
});

test('계절 사진: 모든 사진에 작성자·라이선스·원본 링크가 있고 계절 4개 중 3개 이상 갖춘다', () => {
  for (const r of REGIONS) for (const s of r.spots) {
    const kinds = Object.keys(s.photos);
    assert.ok(kinds.length >= 3, s.name + ': ' + kinds);
    for (const k of kinds) {
      assert.ok(['spring','summer','autumn','winter'].includes(k));
      const p = s.photos[k];
      if (p === 'default') continue;
      assert.match(p.img, /^https:\/\/(upload|thumb)\.wikimedia\.org\//, s.name + k);
      assert.match(p.page, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      assert.ok(p.credit && !/Feel fre/.test(p.credit), s.name + k + ' credit');
      assert.match(p.license, /^(CC BY|CC0|Public domain)/);
      assert.match(p.date, /^\d{4}-\d{2}$/);
    }
  }
});
