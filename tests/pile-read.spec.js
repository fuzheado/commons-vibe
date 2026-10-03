async page => {
  // TDD spec for the PagePile list read path (v1.27.2 regression; run via
  //   playwright-cli run-code --filename=tests/pile-read.spec.js
  // against a local server on :8123).
  //
  // Why this exists: loadList() used to send a custom `Api-User-Agent` header.
  // PagePile answers with access-control-allow-origin: * but sends NO
  // access-control-allow-headers, so that header forced a CORS preflight that
  // failed and every `?pile=` feed died with
  //   "Couldn't load the PagePile list: Failed to fetch"
  // (found 2026-10-03; PetScan tolerates the header — it allows headers: * — but
  // PagePile does not, which is why only this path broke).
  //
  // The fixture is a static PagePile snapshot on commonswiki holding two real
  // files (created 2026-10-03 for exactly this purpose). Piles are immutable
  // snapshots, so this stays valid; if it ever 404s, create a new 2-file pile
  // and update PILE below.
  const PILE = 116948;
  const results = [];
  let failed = 0;
  const t = (name, ok, extra = "") => {
    results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failed++;
  };
  const BASE = "http://127.0.0.1:8123";

  const dialogs = [];
  const errors = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|tailwind/i.test(m.text())) errors.push(m.text().slice(0, 120)); });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());

  await page.goto(BASE + "/?pile=" + PILE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll(".group").length >= 2, null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const st = await page.evaluate(() => ({
    tiles: document.querySelectorAll(".group").length,
    titles: window.__cvState.list ? window.__cvState.list.titles : [],
    label: document.querySelector("#vibe-select") ? document.querySelector("#vibe-select").selectedOptions[0].textContent.trim() : "",
    listMode: !!window.__cvState.list,
  }));

  t("pile feed: list mode active", st.listMode === true);
  t("pile feed: both files resolved", st.titles.length === 2, JSON.stringify(st.titles));
  t("pile feed: dropdown shows the pile", /^PagePile \d+/.test(st.label), st.label);
  t("pile feed: tiles render", st.tiles === 2, `${st.tiles} tiles`);
  t("pile feed: no failure alert", dialogs.length === 0, dialogs[0] || "none");
  t("pile feed: no console errors", errors.length === 0, errors[0] || "clean");

  if (failed) throw `${failed} failed\n${results.join("\n")}`;
  console.log(results.join("\n"));
  return `pile-read spec: all ${results.length} assertions pass`;
}
