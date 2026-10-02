async page => {
  // TDD spec for the DET-view title treatment (v1.23; run via
  //   playwright-cli run-code --filename=tests/title-wrap.spec.js
  // against a local server on :8123).
  //
  // Covers: the tile title is case-faithful (no CSS uppercase), wraps
  // instead of truncating, breaks long unbroken tokens, and never overflows
  // its card — verified against a real 138-character Louvre painting title
  // (Category:Paintings in the Louvre), the worst case found when the
  // change was designed.
  //
  // Layout note: placeCard() measures card.offsetHeight, so wrapped titles
  // are absorbed by the masonry by construction; this spec guards the CSS
  // contract (case + wrap + no overflow) that the design depends on.
  const results = [];
  let failed = 0;
  const t = (name, ok, extra = "") => {
    results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failed++;
  };
  const BASE = "http://127.0.0.1:8123";
  const LOUVRE = BASE + "/?cat=Category%3APaintings%20in%20the%20Louvre&size=m";

  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());

  await page.goto(LOUVRE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".group", { timeout: 30000 });
  await page.waitForTimeout(2600);
  // two more batches — the 138-char König title lands around card #31
  for (let i = 0; i < 2; i++) {
    await page.mouse.move(640, 500);
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(1500);
  }

  const m = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".group")];
    let idx = 0;
    let bestN = -1;
    cards.forEach((c, i) => {
      const n = (c.querySelector(".card-info-wrapper h3").textContent || "").length;
      if (n > bestN) { bestN = n; idx = i; }
    });
    const card = cards[idx];
    const h3 = card.querySelector(".card-info-wrapper h3");
    const cs = getComputedStyle(h3);
    const lh = parseFloat(cs.lineHeight) || 12;
    return {
      cards: cards.length,
      nameLen: bestN,
      text: h3.textContent,
      dataFile: card.dataset.file,
      transform: cs.textTransform,
      spacing: cs.letterSpacing,
      whiteSpace: cs.whiteSpace,
      wrap: cs.overflowWrap || cs.wordWrap,
      textOverflow: cs.textOverflow,
      h3h: Math.round(h3.offsetHeight),
      lines: +(h3.offsetHeight / lh).toFixed(1),
      overflowX: h3.scrollWidth - h3.clientWidth,
      titleAttr: h3.getAttribute("title"),
    };
  });

  t("found a long-title sample", m.nameLen > 100 && m.cards >= 20, `${m.cards} cards, longest title ${m.nameLen} chars`);
  t("case-faithful: no CSS uppercase", m.transform === "none", `text-transform: ${m.transform}`);
  t("case-faithful: no letter-spacing tracking", m.spacing === "normal" || m.spacing === "0px", `letter-spacing: ${m.spacing}`);
  t("wraps instead of truncating", m.whiteSpace === "normal", `white-space: ${m.whiteSpace}`);
  t("long tokens can break", m.wrap === "break-word" || m.wrap === "anywhere", `overflow-wrap: ${m.wrap}`);
  t("no ellipsis truncation", m.textOverflow === "clip", `text-overflow: ${m.textOverflow}`);
  t("full filename rendered (no ellipsis in text)", !m.text.includes("…") && m.text === m.dataFile.replace("File:", ""), `${m.text.slice(0, 60)}…`);
  t("long title occupies 2+ lines", m.lines >= 2, `${m.h3h}px ≈ ${m.lines} lines`);
  t("title does not overflow its card", m.overflowX <= 1, `scrollWidth-clientWidth = ${m.overflowX}px`);
  t("native tooltip keeps the full name", m.titleAttr === m.text, "h3[title] === text");

  if (failed) throw `${failed} failed\n${results.join("\n")}`;
  console.log(results.join("\n"));
  return `title-wrap spec: all ${results.length} assertions pass (${m.nameLen}-char title wraps to ${m.lines} lines)`;
}
