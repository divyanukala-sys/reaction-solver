/* slides.js - AI error challenge deck. Numbers come from thermo.js, so they always match the solver. */
(function () {
  "use strict";
  const { R, T0, pretty } = Thermo;
  const db = Thermo.loadSpecies(THERMO_DATA.species);
  const COL = { H: "#c2730a", G: "#1f5f99", S: "#2c7c65", grey: "#8a97a3" };
  const rx = eq => new Thermo.Reaction(Thermo.parseReaction(eq, db), db);
  const kj = x => x / 1000;
  const num = (x, d = 2) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/^-/, "−");
  const sgn = (x, d = 2) => (x > 0 ? "+" : "") + num(x, d);
  const link = (p, text = "Open this in the solver") =>
    `<a href="solver.html?${new URLSearchParams(p).toString()}">${text}</a>`;
  const linspace = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));
  const foot = (left, right) => `<div class="foot"><span>${left}</span><span>${right}</span></div>`;

  // ------------------------------------------------------------- check 1
  const unbalancedEq = "CH4 + O2 -> CO2 + H2O(g)";
  const ub = rx(unbalancedEq).elementBalance();
  const ubText = Object.entries(ub).filter(([, v]) => Math.abs(v) > 1e-9)
    .map(([el, v]) => `${el} ${v > 0 ? "+" : "−"}${Math.abs(v)}`).join(", ");
  const inputTests = [
    ["CH4 + Xe -> CO2", "unknown species"],
    ["H2 + 1/2 O2 -> H2O", "fraction as coefficient"],
    ["CH₄ + 2 O₂ → CO₂ + 2 H₂O", "pasted subscripts and arrow"],
    ["methane + 2 O2 -> CO2 + 2 H2O", "species typed by name"],
  ].map(([eq, what]) => {
    try {
      const r = rx(eq);
      return [eq, what, r.isBalanced() ? `Read as ${r.equation()}` : "Refused: not balanced"];
    } catch (e) { return [eq, what, `Refused: ${e.message}`]; }
  });

  // ------------------------------------------------------------- check 2
  const cpRows = [
    ["Steam reforming", "CH4 + H2O(g) -> CO + 3 H2"],
    ["Dry reforming", "CH4 + CO2 -> 2 CO + 2 H2"],
    ["Methanol synthesis", "CO + 2 H2 -> CH3OH(g)"],
    ["Ammonia synthesis", "N2 + 3 H2 -> 2 NH3"],
    ["Sabatier", "CO2 + 4 H2 -> CH4 + 2 H2O(g)"],
  ].map(([name, eq]) => {
    const r = rx(eq), T = 1000;
    const hv = r.dH(T), hc = r.dH(T, "constant"), gv = r.dG(T), gc = r.dG(T, "constant");
    return { name, eq, dcp298: r.dCp(T0), dcp1000: r.dCp(T), hv, hc, dH: hc - hv, dG: gc - gv, kr: Math.exp(-(gc - gv) / (R * T)) };
  });
  const absErr = cpRows.map(x => Math.abs(kj(x.dH)));
  const kFactor = Math.max(...cpRows.map(x => Math.max(x.kr, 1 / x.kr)));
  const shrink = cpRows.map(x => x.dcp298 / x.dcp1000);

  // ------------------------------------------------------------- check 3
  const comb = { l: rx("CH4 + 2 O2 -> CO2 + 2 H2O(l)"), g: rx("CH4 + 2 O2 -> CO2 + 2 H2O(g)") };
  const stateRows = [298.15, 373.15, 800].map(T => ({
    T, hl: comb.l.dH(T), hg: comb.g.dH(T), gl: comb.l.dG(T), gg: comb.g.dG(T),
  }));
  const hvap298 = kj(stateRows[0].hg - stateRows[0].hl) / 2;
  const gGap373 = Math.abs(kj(stateRows[1].gl - stateRows[1].gg));

  // ------------------------------------------------------------- check 4
  const etoh = db.get("C2H5OH(g)").cp(T0);
  const ETOH_TRC = 65.3;   // J/(mol K), TRC ideal-gas Cp at 298.15 K
  const warnExamples = [
    ["Ethylene epoxidation", "C2H4 + 1/2 O2 -> C2H4O", 1500],
    ["CH₄ combustion, liquid water", "CH4 + 2 O2 -> CO2 + 2 H2O(l)", 800],
    ["H₂O₂ decomposition", "2 H2O2(l) -> 2 H2O(l) + O2", 400],
  ].map(([name, eq, T]) => [name, eq, T, rx(eq).warnings(T0, T, "variable")]);

  // ------------------------------------------------------------- check 5
  const pub = [
    { name: "Water-gas shift", eq: "CO + H2O(g) -> CO2 + H2", src: "Moe (1962)", lnK: T => 4577.8 / T - 4.33 },
    { name: "Methanol synthesis", eq: "CO + 2 H2 -> CH3OH(g)", src: "Graaf et al. (1986)", lnK: T => Math.LN10 * (5139 / T - 12.621) },
    { name: "Reverse water-gas shift", eq: "CO2 + H2 -> CO + H2O(g)", src: "Graaf et al. (1986)", lnK: T => Math.LN10 * (-2073 / T + 2.029) },
  ].map(p => ({ ...p, r: rx(p.eq) }));
  const pubTs = [500, 600, 700, 800];
  const pubCells = pub.map(p => pubTs.map(T => {
    const ours = p.r.lnK(T), theirs = p.lnK(T);
    return { pct: 100 * (Math.exp(ours - theirs) - 1), dG: kj(R * T * (ours - theirs)) };   // dG: ΔG°(published) − ΔG°(ours)
  }));
  const maxDG = Math.max(...pubCells.flat().map(c => Math.abs(c.dG)));
  const moeVsGraaf = 100 * (Math.exp(pub[0].lnK(500) + pub[2].lnK(500)) - 1);   // K_WGS(Moe) × K_RWGS(Graaf) should be 1

  // ------------------------------------------------------------- slides
  const S = [];

  // Title
  const smr = rx("CH4 + H2O(g) -> CO + 3 H2");
  const gl = linspace(300, 1500, 60).map(T => kj(smr.dG(T)));
  const gmin = Math.min(...gl), gmax = Math.max(...gl);
  const path = gl.map((g, i) => `${i ? "L" : "M"}${(i / 59 * 340).toFixed(1)},${(170 - (g - gmin) / (gmax - gmin) * 160 - 5).toFixed(1)}`).join(" ");
  const y0 = (170 - (0 - gmin) / (gmax - gmin) * 160 - 5).toFixed(1);
  S.push(`<section class="slide title">
    <div class="kicker" style="color:#9fb2c2">Assignment 2: Thermodynamic Solver for Reaction Energetics</div>
    <h1>Stress-testing an AI-built reaction solver</h1>
    <p>Five required checks, a comparison with published equilibrium data, and the data errors the AI made while building it.</p>
    <svg class="gline" viewBox="0 0 340 170" aria-hidden="true">
      <line x1="0" y1="${y0}" x2="340" y2="${y0}" stroke="#5b7790" stroke-width="1.5" stroke-dasharray="5 5"/>
      <path d="${path}" fill="none" stroke="#ffffff" stroke-width="3"/>
      <text x="340" y="${(+y0 - 8).toFixed(1)}" fill="#9fb2c2" font-size="13" text-anchor="end" font-family="Public Sans, sans-serif">ΔG° = 0</text>
    </svg>
  </section>`);

  // Check 1
  S.push(`<section class="slide">
    <div class="kicker">Check 1 of 5: stoichiometry</div>
    <h2>An unbalanced reaction is refused, not calculated</h2>
    <div class="body cols">
      <div>
        <p>Input, with the oxygen and water coefficients left out:</p>
        <div class="inputbox">${rx(unbalancedEq).equation()}</div>
        <div class="refusal">Solver response: “This reaction is not balanced, so no thermodynamic results are shown.” Net atoms (products − reactants): ${ubText}.</div>
        <p style="margin-top:1em"><span class="verdict-chip v-pass">Pass</span></p>
      </div>
      <div>
        <p>Other inputs tried:</p>
        <table class="data"><thead><tr><th class="left">Input</th><th class="left">Tests</th><th class="left">Result</th></tr></thead><tbody>
        ${inputTests.map(([eq, what, res]) => `<tr><td class="left">${eq.replace(/</g, "&lt;")}</td><td class="left">${what}</td><td class="left">${res}</td></tr>`).join("")}
        </tbody></table>
      </div>
    </div>
    ${foot("Every reaction is checked atom by atom before any calculation.", link({ eq: unbalancedEq }))}
  </section>`);

  // Check 2
  S.push(`<section class="slide">
    <div class="kicker">Check 2 of 5: heat-capacity assumption</div>
    <h2>Constant Cp° at 1000 K is off by ${num(Math.min(...absErr), 0)}–${num(Math.max(...absErr), 0)} kJ/mol</h2>
    <div class="body cols-wide">
      <div>
        <table class="data"><thead><tr><th class="left">Reaction</th><th>ΔCp° 298 K</th><th>ΔCp° 1000 K</th><th>ΔH° Cp(T)</th><th>ΔH° const.</th><th>Error in ΔH°</th><th>K ratio</th></tr></thead><tbody>
        ${cpRows.map(x => `<tr><td class="left">${x.name}</td><td>${num(x.dcp298, 1)}</td><td>${num(x.dcp1000, 1)}</td><td>${num(kj(x.hv), 1)}</td><td>${num(kj(x.hc), 1)}</td><td>${sgn(kj(x.dH), 1)}</td><td>${num(x.kr, 2)}</td></tr>`).join("")}
        </tbody></table>
        <p class="small" style="font-size:1.05cqw;margin-top:.5em">ΔCp° in J/(mol·K), ΔH° in kJ/mol. K ratio = K(constant Cp°) ÷ K(Cp°(T)).</p>
        <p style="margin-top:.8em">ΔCp° itself shrinks by a factor of ${num(Math.min(...shrink), 0)} to ${num(Math.max(...shrink), 0)} between 298 and 1000 K, so freezing it at its 298 K value overshoots the sensible-heat correction. The equilibrium constant moves by up to a factor of ${num(kFactor, 1)}.</p>
      </div>
      <div class="chart"><canvas id="ch-cp" aria-label="Steam reforming heat of reaction, constant versus temperature-dependent Cp"></canvas></div>
    </div>
    ${foot('<span class="verdict-chip v-warn">Large effect: use Cp°(T) above about 500 K</span>', link({ eq: "CH4 + H2O(g) -> CO + 3 H2", T: 1000, tab: "cp" }))}
  </section>`);

  // Check 3
  S.push(`<section class="slide">
    <div class="kicker">Check 3 of 5: physical state</div>
    <h2>Methane combustion: H₂O(l) versus H₂O(g)</h2>
    <div class="body cols">
      <div>
        <table class="data"><thead><tr><th>T (K)</th><th>ΔH°, H₂O(l)</th><th>ΔH°, H₂O(g)</th><th>ΔG°, H₂O(l)</th><th>ΔG°, H₂O(g)</th></tr></thead><tbody>
        ${stateRows.map(x => `<tr><td>${x.T}</td><td>${num(kj(x.hl))}</td><td>${num(kj(x.hg))}</td><td>${num(kj(x.gl))}</td><td>${num(kj(x.gg))}</td></tr>`).join("")}
        </tbody></table>
        <p class="small" style="font-size:1.05cqw;margin-top:.5em">kJ per mol CH₄, CH₄ + 2 O₂ → CO₂ + 2 H₂O.</p>
      </div>
      <ul>
        <li><strong>298 K:</strong> the two answers differ by ${num(2 * hvap298)} kJ, which is 2 × ${num(hvap298)} kJ/mol, the enthalpy of vaporisation of water. This is the HHV versus LHV gap.</li>
        <li><strong>373 K:</strong> the two ΔG° values agree to ${num(gGap373, 2)} kJ/mol, as they must at the normal boiling point. A built-in consistency check that passes.</li>
        <li><strong>800 K:</strong> the liquid route still returns a number, but liquid water cannot exist above its critical point (647 K). The solver flags the liquid above 373 K; the number should not be used.</li>
      </ul>
    </div>
    ${foot('<span class="verdict-chip v-pass">Pass, with a warning shown for the liquid case</span>', link({ eq: "CH4 + 2 O2 -> CO2 + 2 H2O(l)", T: 800 }))}
  </section>`);

  // Check 4
  S.push(`<section class="slide">
    <div class="kicker">Check 4 of 5: validity of the Cp correlations</div>
    <h2>Warnings appear when a correlation is stretched</h2>
    <div class="body cols-wide">
      <table class="data"><thead><tr><th class="left">Case</th><th>T (K)</th><th class="left">Warning shown</th></tr></thead><tbody>
      ${warnExamples.map(([name, eq, T, ws]) => `<tr><td class="left">${name}</td><td>${T}</td><td class="left">${ws.map(w => w.replace(/ Results outside.*$| A liquid at 1 bar.*$/, "").replace(/, so its Cp is held.*$/, ".")).join("<br>")}</td></tr>`).join("")}
      </tbody></table>
      <div>
        <p><strong>A limit warnings cannot catch.</strong></p>
        <p class="big">${num(etoh, 1)} vs ${num(ETOH_TRC, 1)}</p>
        <p>Cp of ethanol vapour at 298 K, J/(mol·K): textbook correlation versus TRC data. The correlation is ${num(100 * (etoh / ETOH_TRC - 1), 0)}% high at the bottom of its own valid range, so “inside the range” does not mean “accurate”.</p>
        <p>The solver also cross-checks ΔG°f against ΔH°f and S° and warns if they disagree by more than 1 kJ/mol.</p>
      </div>
    </div>
    ${foot('<span class="verdict-chip v-pass">Pass, with one blind spot</span>', link({ eq: "C2H4 + 1/2 O2 -> C2H4O", T: 1200 }))}
  </section>`);

  // Check 5
  S.push(`<section class="slide">
    <div class="kicker">Check 5 of 5: comparison with published work</div>
    <h2>K agrees with published correlations to within ${num(maxDG, 1)} kJ/mol in ΔG°</h2>
    <div class="body cols-wide">
      <div>
        <table class="data"><thead><tr><th class="left">Reaction (source)</th>${pubTs.map(T => `<th>${T} K</th>`).join("")}</tr></thead><tbody>
        ${pub.map((p, i) => `<tr><td class="left">${p.name}<br><span class="small" style="font-size:1cqw">${p.src}</span></td>${pubCells[i].map(c => `<td>${sgn(c.pct, 0)}%<br><span class="small" style="font-size:1cqw">${sgn(c.dG, 2)} kJ</span></td>`).join("")}</tr>`).join("")}
        </tbody></table>
        <p class="small" style="font-size:1.05cqw;margin-top:.5em">Top: K(solver) ÷ K(published) − 1. Below: the same gap as ΔG°(published) − ΔG°(solver), kJ/mol.</p>
        <p style="margin-top:.6em;font-size:1.32cqw">A gap of 25% in K is only about 1 kJ/mol in ΔG°. Graaf and Winkelman (2016) report that a 0.5% change in methanol’s ΔG°f moves its K by about 33%. The published correlations also disagree with each other: Moe’s water-gas shift and Graaf’s reverse shift differ by ${num(Math.abs(moeVsGraaf), 0)}% at 500 K.</p>
      </div>
      <div class="chart"><canvas id="ch-pub" aria-label="ln K versus temperature, solver against published correlations"></canvas></div>
    </div>
    <div class="refs">Moe, J. M. (1962) Chem. Eng. Prog. 58, 33–36. Graaf, G. H. et al. (1986) Chem. Eng. Sci. 41, 2883–2890. Graaf, G. H. &amp; Winkelman, J. G. M. (2016) Ind. Eng. Chem. Res., doi:10.1021/acs.iecr.6b00815.</div>
    ${foot('<span class="verdict-chip v-pass">Agrees within the spread of the literature</span>', link({ eq: "CO + H2O(g) -> CO2 + H2", T: 700 }))}
  </section>`);

  // Errors made during the build
  S.push(`<section class="slide">
    <div class="kicker">What went wrong while building it</div>
    <h2>Five errors the AI made, and what caught them</h2>
    <div class="body">
      <table class="data"><thead><tr><th class="left">Item</th><th class="left">AI’s first answer</th><th class="left">How it was caught</th><th class="left">Correction</th></tr></thead><tbody>
        <tr><td class="left">Textbook check case</td><td class="left">Methanol-synthesis example taken as 800 K</td><td class="left">Test failed: −102.21 vs −103.57 kJ/mol</td><td class="left">The example is at 800 °C = 1073.15 K</td></tr>
        <tr><td class="left">Cp of H₂O₂(g) and CH₃COOH(g)</td><td class="left">Left as zero (not in SVA Table C.1)</td><td class="left">Cp = 0 is physically impossible</td><td class="left">Fitted to TRC data, max error 1.1% and 0.6%</td></tr>
        <tr><td class="left">ΔG°f of CH₃CHO(g)</td><td class="left">−128.86 kJ/mol</td><td class="left">Off by 4.1 kJ/mol from ΔH°f − TΔS°f</td><td class="left">−133.0 kJ/mol (CRC Handbook)</td></tr>
        <tr><td class="left">ΔH°f of CH₃COOH(g)</td><td class="left">−432.8 kJ/mol</td><td class="left">Off by 0.6 kJ/mol from ΔG°f and S°</td><td class="left">−432.2 kJ/mol (CRC Handbook)</td></tr>
        <tr><td class="left">S° of 1-butene</td><td class="left">305.6 J/(mol·K)</td><td class="left">ΔG°f check off by 0.7 kJ/mol</td><td class="left">307.9 J/(mol·K)</td></tr>
      </tbody></table>
      <p>Lesson: property values recalled by an AI need a second source. The identity ΔG°f = ΔH°f − TΔS°f caught three of the five slips automatically.</p>
    </div>
    ${foot("Every species row in the solver lists its source.", link({ eq: "C2H5OH(g) -> CH3CHO + H2", tab: "data" }, "See the data table"))}
  </section>`);

  // Summary
  S.push(`<section class="slide">
    <div class="kicker">Summary</div>
    <h2>What the checks showed</h2>
    <div class="body">
      <table class="data"><thead><tr><th class="left">Check</th><th class="left">Result</th><th class="left">What the solver does about it</th></tr></thead><tbody>
        <tr><td class="left">1. Stoichiometry</td><td class="left"><span class="verdict-chip v-pass">Pass</span></td><td class="left">Refuses unbalanced or unknown input and shows the atom imbalance</td></tr>
        <tr><td class="left">2. Constant vs Cp°(T)</td><td class="left"><span class="verdict-chip v-warn">Large effect</span></td><td class="left">Side-by-side comparison; errors of ${num(Math.min(...absErr), 0)}–${num(Math.max(...absErr), 0)} kJ/mol at 1000 K</td></tr>
        <tr><td class="left">3. Physical state</td><td class="left"><span class="verdict-chip v-pass">Pass</span></td><td class="left">Reproduces the ${num(2 * hvap298, 0)} kJ HHV–LHV gap; flags liquids above their boiling point</td></tr>
        <tr><td class="left">4. Correlation validity</td><td class="left"><span class="verdict-chip v-warn">One blind spot</span></td><td class="left">Warns outside each Cp range; cannot detect error inside a range</td></tr>
        <tr><td class="left">5. Published work</td><td class="left"><span class="verdict-chip v-pass">Pass</span></td><td class="left">Within ${num(maxDG, 1)} kJ/mol of Moe (1962) and Graaf et al. (1986)</td></tr>
        <tr><td class="left">Data built by the AI</td><td class="left"><span class="verdict-chip v-fix">5 errors fixed</span></td><td class="left">Consistency check between ΔG°f, ΔH°f and S° now runs on every reaction</td></tr>
      </tbody></table>
    </div>
    ${foot("All numbers on these slides are computed live by the solver’s own engine.", link({}, "Open the solver"))}
  </section>`);

  // ------------------------------------------------------------- deck mechanics
  const stage = document.getElementById("stage");
  stage.innerHTML = S.join("");
  const slides = [...stage.querySelectorAll(".slide")];
  slides.forEach((s, i) => { s.setAttribute("aria-roledescription", "slide"); s.setAttribute("aria-label", `${i + 1} of ${slides.length}`); });
  let cur = Math.min(Math.max(parseInt(location.hash.slice(1), 10) - 1 || 0, 0), slides.length - 1);

  function go(i) {
    cur = Math.min(Math.max(i, 0), slides.length - 1);
    slides.forEach((s, j) => { s.classList.toggle("active", j === cur); s.setAttribute("aria-hidden", String(j !== cur)); });
    document.getElementById("count").textContent = `${cur + 1} / ${slides.length}`;
    try { history.replaceState(null, "", `#${cur + 1}`); } catch (e) { /* file:// in some browsers */ }
  }
  document.getElementById("prev").addEventListener("click", () => go(cur - 1));
  document.getElementById("next").addEventListener("click", () => go(cur + 1));
  document.getElementById("fs").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.();
  });
  document.addEventListener("keydown", e => {
    if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(cur + 1); }
    else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); go(cur - 1); }
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(slides.length - 1);
    else if (e.key === "f" || e.key === "F") document.getElementById("fs").click();
  });
  stage.addEventListener("click", e => {
    if (e.target.closest("a, button, canvas")) return;
    const box = stage.getBoundingClientRect();
    go(e.clientX - box.left > box.width * 0.3 ? cur + 1 : cur - 1);
  });

  // ------------------------------------------------------------- charts
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = "#566878";
  const base = (xTitle, yTitle) => ({
    maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: { legend: { position: "bottom" } },
    scales: { x: { type: "linear", title: { display: true, text: xTitle } },
              y: { title: { display: true, text: yTitle }, grid: { color: "#e3e9ee" } } },
  });
  const Ts = linspace(298.15, 1200, 120);
  new Chart(document.getElementById("ch-cp"), {
    type: "line",
    data: { datasets: [
      { label: "Steam reforming ΔH°, Cp°(T)", data: Ts.map(T => ({ x: T, y: kj(smr.dH(T)) })), borderColor: COL.H, borderWidth: 3, pointRadius: 0 },
      { label: "Constant Cp°", data: Ts.map(T => ({ x: T, y: kj(smr.dH(T, "constant")) })), borderColor: COL.H, borderDash: [7, 5], borderWidth: 2.5, pointRadius: 0 },
    ] },
    options: base("Temperature (K)", "ΔH° (kJ/mol)"),
  });
  const Tp = linspace(450, 900, 60);
  const pubColors = [COL.G, COL.H, COL.S];
  new Chart(document.getElementById("ch-pub"), {
    type: "line",
    data: { datasets: pub.flatMap((p, i) => [
      { label: `${p.name}, solver`, data: Tp.map(T => ({ x: T, y: p.r.lnK(T) })), borderColor: pubColors[i], borderWidth: 3, pointRadius: 0 },
      { label: `${p.src}`, data: Tp.map(T => ({ x: T, y: p.lnK(T) })), borderColor: pubColors[i], borderDash: [6, 5], borderWidth: 2, pointRadius: 0 },
    ]) },
    options: { ...base("Temperature (K)", "ln K"), plugins: { legend: { position: "bottom", labels: { boxWidth: 18, font: { size: 11 } } } } },
  });

  go(cur);
})();
