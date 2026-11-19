// 브라우저 스모크 테스트: 이미 설치된 Edge/Chrome을 headless로 실행 (추가 패키지 없음)
// 360px(모바일)·1280px(데스크톱) 너비에서 실제 렌더링 결과와 가로 넘침을 확인한다.
// 브라우저가 없으면 건너뛴다. 이미지 링크 확인은 네트워크가 필요하다 (SKIP_NETWORK=1로 생략).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

const candidates = [
  process.env.BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", // 이 PC에선 headless 실행 시 크래시(0xC0000409) → 후순위
  "/usr/bin/google-chrome", "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean);
const browser = candidates.find(p => existsSync(p));
const page = pathToFileURL(fileURLToPath(new URL("../index.html", import.meta.url))).href;

// headless Chrome은 창 너비를 최소 약 500px로 잡는다. 그래서 정확한 너비의 iframe 안에
// 페이지를 띄우고, 페이지가 postMessage로 보낸 selftest 결과를 바깥 문서에 기록해 읽는다.
function dump(width, extra = "") {
  const dir = mkdtempSync(path.join(tmpdir(), "travel-smoke-"));
  const wrapper = path.join(dir, "frame.html");
  writeFileSync(wrapper, `<!doctype html><body style="margin:0">
<iframe src="${page}?selftest=1${extra}" style="width:${width}px;height:900px;border:0"></iframe>
<script>addEventListener("message",e=>{if(e.data&&e.data.selftest)document.body.setAttribute("data-selftest",JSON.stringify(e.data.selftest))});</script>`);
  const out = execFileSync(browser, [
    "--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${path.join(dir, "profile")}`,
    `--window-size=${Math.max(width, 600) + 40},1000`, "--virtual-time-budget=5000", "--dump-dom",
    pathToFileURL(wrapper).href
  ], { encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "ignore"] });
  const m = out.match(/data-selftest="([^"]+)"/);
  assert.ok(m, "selftest 결과 없음 (스크립트 실행 실패)");
  return { dom: out, r: JSON.parse(m[1].replace(/&quot;/g, '"')) };
}

for (const width of [360, 1280]) {
  test(`${width}px: 렌더링되고 가로로 넘치지 않는다`, { skip: !browser && "브라우저 없음" }, () => {
    const { r } = dump(width);
    console.log(`viewport=${r.vw}px`);
    assert.ok(r.vw <= width + 20, `실제 뷰포트(${r.vw}px)가 요청 너비보다 큼 → 모바일 검사 무효`);
    assert.equal(r.overflow, false, `페이지 가로 넘침: ${JSON.stringify(r.wide)}`);
    assert.deepEqual(r.wide, [], "화면 밖으로 나간 요소");
    assert.equal(r.cards, 3);
    assert.ok(r.spots >= 4);
    assert.equal(r.heatCells, 36);
    assert.equal(r.compareRows, 8);
    assert.ok(r.sources > 10);
  });
}

test("URL 해시로 월과 탭을 지정하면 그대로 열린다", { skip: !browser && "브라우저 없음" }, () => {
  const { r } = dump(1280, "#month=1&tab=nz");
  assert.equal(r.tab, "nz");
  assert.equal(r.monthLabel, "1월 기준");
});

test("이미지 링크(기본·계절 사진)가 모두 응답한다", { skip: process.env.SKIP_NETWORK === "1" && "SKIP_NETWORK" }, async () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const urls = [...new Set(html.match(/https:\/\/(?:upload|thumb)\.wikimedia\.org\/[^"]+/g))];
  assert.ok(urls.length >= 70, `이미지 URL ${urls.length}개`); // 기본 18 + 계절 사진
  const bad = [];
  for (const u of urls) {
    let status = 0;
    for (let a = 0; a < 3 && status !== 200; a++) {
      if (a) await new Promise(r => setTimeout(r, 3000));
      const res = await fetch(u, { method: "GET", headers: { "User-Agent": "travel-guide-linkcheck/1.0" } });
      status = res.status;
      await res.arrayBuffer();
    }
    if (status !== 200) bad.push(`${status} ${u}`);
    await new Promise(r => setTimeout(r, 600));
  }
  assert.deepEqual(bad, []);
});
