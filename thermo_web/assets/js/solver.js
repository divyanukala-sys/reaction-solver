/* solver.js - wires the solver page to the engine in thermo.js. No thermodynamics in here. */
(function () {
  "use strict";
  const { T0, P0, R, pretty } = Thermo;
  const db = Thermo.loadSpecies(THERMO_DATA.species);
  const REACTIONS = THERMO_DATA.reactions;
  const COL = { H: "#c2730a", G: "#1f5f99", S: "#2c7c65", grey: "#8a97a3", ink: "#14273a" };

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (x, d = 2) => Number.isFinite(x)
    ? x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/^-/, "−")
    : "—";
  const kj = x => x / 1000;
  function fmtK(lnK) {
    const l10 = lnK / Math.LN10;
    if (Math.abs(l10) < 4) return String(Number((10 ** l10).toPrecision(4)));
    const e = Math.floor(l10);
    return `${(10 ** (l10 - e)).toFixed(2)} × 10<sup>${e < 0 ? "−" + (-e) : e}</sup>`;
  }
  const linspace = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));
  const logspace = (a, b, n) => linspace(a, b, n).map(v => 10 ** v);

  // ---------------------------------------------------------------- state
  const DEFAULTS = { eq: REACTIONS[0].equation, T: 800, P: 1, tlo: 298.15, thi: 1500, cp: "variable", s: "gibbs", tab: "trends" };
  const state = { ...DEFAULTS };
  const params = new URLSearchParams(location.search);
  for (const k of Object.keys(DEFAULTS)) {
    if (!params.has(k)) continue;
    const v = params.get(k);
    state[k] = typeof DEFAULTS[k] === "number" ? (Number.isFinite(+v) ? +v : DEFAULTS[k]) : v;
  }
  if (!["variable", "constant"].includes(state.cp)) state.cp = "variable";
  if (!["gibbs", "third_law"].includes(state.s)) state.s = "gibbs";
  if (!["trends", "cp", "sens", "pressure", "method", "data"].includes(state.tab)) state.tab = "trends";

  function writeURL() {
    const p = new URLSearchParams();
    for (const k of Object.keys(DEFAULTS)) if (state[k] !== DEFAULTS[k]) p.set(k, state[k]);
    const qs = p.toString();
    try { history.replaceState(null, "", qs ? `?${qs}` : location.pathname); } catch (e) { /* not allowed when opened from disk in some browsers */ }
  }

  // ---------------------------------------------------------------- controls
  const preset = $("preset");
  preset.innerHTML = `<option value="">Your own reaction</option>` +
    REACTIONS.map((r, i) => `<option value="${i}">${esc(r.name)}</option>`).join("");
  $("species-list").innerHTML = [...db.values()]
    .map(s => `<div><code>${esc(s.id)}</code> ${esc(s.name)}</div>`).join("");

  function syncPreset() {
    const i = REACTIONS.findIndex(r => r.equation === state.eq);
    preset.value = i >= 0 ? String(i) : "";
  }
  $("eq").value = state.eq; $("T").value = state.T; $("P").value = state.P;
  $("tlo").value = state.tlo; $("thi").value = state.thi;
  syncPreset();

  function setSeg(id, value) {
    $(id).querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === value)));
  }
  setSeg("cp", state.cp); setSeg("sroute", state.s);

  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(update, 250); };

  preset.addEventListener("change", () => {
    if (preset.value === "") return;
    state.eq = REACTIONS[+preset.value].equation; $("eq").value = state.eq; update();
  });
  $("eq").addEventListener("input", () => { state.eq = $("eq").value; syncPreset(); later(); });
  for (const id of ["T", "P", "tlo", "thi"]) {
    $(id).addEventListener("input", () => { state[id] = parseFloat($(id).value); later(); });
  }
  $("cp").addEventListener("click", e => { const v = e.target.closest("button")?.dataset.v; if (v) { state.cp = v; setSeg("cp", v); update(); } });
  $("sroute").addEventListener("click", e => { const v = e.target.closest("button")?.dataset.v; if (v) { state.s = v; setSeg("sroute", v); update(); } });

  $("tablist").addEventListener("click", e => {
    const t = e.target.closest("button")?.dataset.tab;
    if (t) { state.tab = t; showTab(); writeURL(); renderTab(); }
  });
  $("tablist").addEventListener("keydown", e => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const tabs = [...$("tablist").querySelectorAll("button")];
    const i = tabs.findIndex(b => b.dataset.tab === state.tab);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    state.tab = next.dataset.tab; showTab(); next.focus(); writeURL(); renderTab();
  });
  function showTab() {
    $("tablist").querySelectorAll("button").forEach(b => {
      const on = b.dataset.tab === state.tab;
      b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
      $(`panel-${b.dataset.tab}`).hidden = !on;
    });
  }

  // ---------------------------------------------------------------- charts
  const charts = {};
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = "#566878";

  const series = (xs, f) => xs.map(x => ({ x, y: f(x) }));
  function line(label, data, color, extra = {}) {
    return { label, data, borderColor: color, backgroundColor: color, borderWidth: 3, pointRadius: 0, ...extra };
  }
  function vline(x, datasets, label) {
    const ys = datasets.flatMap(d => d.data.map(p => p.y)).filter(Number.isFinite);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    return { label, helper: true, data: [{ x, y: lo }, { x, y: hi }], borderColor: COL.grey,
      borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 };
  }
  function draw(id, datasets, { xTitle, yTitle, xLog = false, yMin, yMax, legend = true, xMin, xMax } = {}) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart($(id), {
      type: "line",
      data: { datasets },
      options: {
        maintainAspectRatio: false, animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: legend, labels: { filter: (item, data) => !data.datasets[item.datasetIndex].helper } },
          tooltip: {
            filter: item => !item.dataset.helper,
            callbacks: {
              title: items => items.length ? `${num(items[0].parsed.x, xLog ? 2 : 0)} ${xLog ? "bar" : "K"}` : "",
              label: c => `${c.dataset.label}: ${num(c.parsed.y, 2)}`,
            },
          },
        },
        scales: {
          x: { type: xLog ? "logarithmic" : "linear", min: xMin, max: xMax, title: { display: true, text: xTitle } },
          y: { min: yMin, max: yMax, title: { display: true, text: yTitle },
               grid: { color: c => (c.tick.value === 0 ? "#9aa8b4" : "#e3e9ee") } },
        },
      },
    });
  }

  // ---------------------------------------------------------------- render
  let rx = null;

  function update() {
    writeURL();
    const msgs = [];
    const area = { numbers: $("numbers"), tabs: $("tab-area") };
    rx = null;

    let stoich;
    try {
      stoich = Thermo.parseReaction(state.eq, db);
    } catch (e) {
      $("eq-title").textContent = "Reaction not recognised";
      $("eq-note").textContent = "";
      $("messages").innerHTML = `<div class="msg err">Can’t read this reaction. ${esc(e.message)}</div>`;
      area.numbers.innerHTML = ""; area.tabs.hidden = true;
      return;
    }
    const r = new Thermo.Reaction(stoich, db);
    $("eq-title").textContent = r.equation();
    const pre = REACTIONS.find(x => x.equation === state.eq);
    $("eq-note").textContent = pre ? pre.note : "";

    const bal = r.elementBalance();
    if (!r.isBalanced()) {
      const off = Object.entries(bal).filter(([, v]) => Math.abs(v) > 1e-9);
      $("messages").innerHTML =
        `<div class="msg err">This reaction is not balanced, so no thermodynamic results are shown. ` +
        `Net atoms (products − reactants): ${off.map(([el, v]) => `${el} ${v > 0 ? "+" : "−"}${+Math.abs(v).toFixed(4)}`).join(", ")}.</div>` +
        `<div class="table-wrap"><table class="data"><thead><tr><th>Element</th><th>Products − reactants</th></tr></thead><tbody>` +
        Object.entries(bal).map(([el, v]) => `<tr><td>${el}</td><td>${num(v, 2)}</td></tr>`).join("") +
        `</tbody></table></div>`;
      area.numbers.innerHTML = ""; area.tabs.hidden = true;
      return;
    }

    const { T, P, tlo, thi } = state;
    const bad = [];
    if (!(T >= 200 && T <= 3000)) bad.push("Temperature must be between 200 and 3000 K.");
    if (!(P >= 0.01 && P <= 1000)) bad.push("Pressure must be between 0.01 and 1000 bar.");
    if (!(tlo >= 200 && thi <= 3000 && thi - tlo >= 10)) bad.push("Plot range must lie within 200–3000 K and span at least 10 K.");
    if (bad.length) {
      $("messages").innerHTML = bad.map(b => `<div class="msg err">${b}</div>`).join("");
      area.numbers.innerHTML = ""; area.tabs.hidden = true;
      return;
    }

    rx = r;
    msgs.push(`<div class="msg ok">Element balance checked: ${Object.keys(bal).map(el => `${el} 0`).join(", ")}.</div>`);
    r.warnings(Math.min(tlo, T), Math.max(thi, T), state.cp).forEach(w => msgs.push(`<div class="msg warn">${esc(w)}</div>`));
    if (state.cp === "constant") {
      msgs.push(`<div class="msg info">Constant-Cp mode: ΔCp° is frozen at its 298.15 K value. Switch to Cp°(T) to see how much this matters at high temperature.</div>`);
    }
    $("messages").innerHTML = msgs.join("");

    // headline numbers
    const m = state.cp, s = state.s;
    const dH = r.dH(T, m), dS = r.dS(T, m, s), dG = r.dG(T, m, s), lnK = r.lnK(T, m, s);
    const X = r.equilibriumConversion(T, P, m, s);
    const tag = h => `<div class="m-tag ${h < 0 ? "exo" : "endo"}">${h < 0 ? "Exothermic" : "Endothermic"}</div>`;
    const metric = (cls, label, value, extra = "") =>
      `<div class="metric ${cls}"><div class="m-label">${label}</div><div class="m-value">${value}</div>${extra}</div>`;

    const lines = [];
    if (dG < 0) lines.push(`<strong>Products favoured at ${T} K.</strong> ΔG° &lt; 0, so K &gt; 1.`);
    else if (dG < 40e3) lines.push(`<strong>Equilibrium-limited at ${T} K.</strong> ΔG° is positive but below about +40 kJ/mol, so useful conversion may still be possible by changing T or P or removing products.`);
    else lines.push(`<strong>Strongly unfavourable at ${T} K.</strong> ΔG° &gt; +40 kJ/mol, so K is tiny.`);
    lines.push(dH < 0 ? "Exothermic, so K falls as temperature rises (van ’t Hoff)."
                      : "Endothermic, so K rises as temperature rises (van ’t Hoff).");
    const dn = r.dnGas;
    if (Math.abs(dn) < 1e-12) lines.push("Δn(gas) = 0, so pressure does not shift the ideal-gas equilibrium.");
    else lines.push(`Δn(gas) = ${dn > 0 ? "+" : "−"}${+Math.abs(dn).toFixed(4)}: ${dn < 0 ? "higher" : "lower"} pressure raises conversion (Le Chatelier).`);
    const roots = r.crossovers(tlo, thi, m, s);
    if (roots.length) lines.push(`ΔG° = 0 (K = 1) at ${roots.map(x => Math.round(x) + " K").join(", ")} within the plotted range.`);

    area.numbers.innerHTML =
      `<div class="metrics-label">At 298.15 K and 1 bar</div><div class="metrics">` +
      metric("h", "ΔH°<sub>298</sub> (kJ/mol)", num(kj(r.dH0)), tag(r.dH0)) +
      metric("g", "ΔG°<sub>298</sub> (kJ/mol)", num(kj(r.dG(T0, m, s)))) +
      metric("s", "ΔS°<sub>298</sub> (J/mol·K)", num(r.dS0(s))) +
      metric("k", "K<sub>298</sub>", fmtK(r.lnK(T0, m, s))) +
      `</div><div class="metrics-label">At T = ${T} K and P = ${P} bar</div><div class="metrics">` +
      metric("h", "ΔH°(T) (kJ/mol)", num(kj(dH)), tag(dH)) +
      metric("s", "ΔS°(T) (J/mol·K)", num(dS)) +
      metric("g", "ΔG°(T) (kJ/mol)", num(kj(dG))) +
      metric("k", "K(T)", fmtK(lnK)) +
      metric("k", "Equilibrium conversion", X === null ? "n/a" : `${num(100 * X)} %`) +
      `</div><div class="verdict">${lines.map(l => `<p>${l}</p>`).join("")}</div>` +
      `<p class="small">ΔG° refers to every species at 1 bar. The actual driving force is ΔG = ΔG° + RT ln Q, which depends on composition. ` +
      `Conversion assumes a stoichiometric feed with no products or inerts, an ideal-gas mixture, and pure solids and liquids.</p>`;
    area.tabs.hidden = false;
    renderAllStatic();
    showTab();
    renderTab();
  }

  // Tabs without charts are rebuilt on every update; chart tabs are drawn when visible.
  function renderAllStatic() {
    const r = rx, T = state.T, m = state.cp;
    // sensible heat
    const path = r.pathBreakdown(T, m);
    const sp = r.speciesTable(T, m);
    $("panel-sens").innerHTML =
      `<p>ΔH°(T) built from a three-step path at T = ${T} K (${m === "constant" ? "constant" : "temperature-dependent"} Cp°):</p>` +
      `<div class="table-wrap"><table class="data"><thead><tr><th>Step</th><th>ΔH (kJ/mol)</th></tr></thead><tbody>` +
      path.map(([step, v], i) => `<tr${i === 3 ? ' class="total"' : ""}><td>${step}</td><td>${num(kj(v), 3)}</td></tr>`).join("") +
      `</tbody></table></div><p>Sensible enthalpy and entropy of each species between 298.15 K and T:</p>` +
      `<div class="table-wrap"><table class="data"><thead><tr><th>Species</th><th>ν</th><th>Cp(298) J/mol·K</th><th>Cp(T) J/mol·K</th><th>H(T) − H(298) kJ/mol</th><th>S(T) − S(298) J/mol·K</th></tr></thead><tbody>` +
      sp.map(x => `<tr><td>${pretty(x.id)}</td><td>${num(x.nu, 2)}</td><td>${num(x.cp298, 2)}</td><td>${num(x.cpT, 2)}</td><td>${num(kj(x.dHsens), 3)}</td><td>${num(x.dSsens, 3)}</td></tr>`).join("") +
      `</tbody></table></div><p class="small">ν is negative for reactants and positive for products. Step 1 is the negative of the reactants’ sensible heat because they go from T down to 298.15 K.</p>`;

    // method
    $("panel-method").innerHTML = `
      <h3>Heat capacity (Smith, Van Ness &amp; Abbott form, T in K)</h3>
      <div class="eqn">C<sub>P</sub>°/R = A + B<var>T</var> + C<var>T</var><sup>2</sup> + D<var>T</var><sup>−2</sup>,&nbsp;&nbsp; ΔA = Σ ν<sub>i</sub>A<sub>i</sub> (same for B, C, D)</div>
      <h3>Standard heat of reaction at T</h3>
      <div class="eqn">ΔH°(<var>T</var>) = ΔH°<sub>0</sub> + R[ΔA(<var>T</var> − <var>T</var><sub>0</sub>) + (ΔB/2)(<var>T</var><sup>2</sup> − <var>T</var><sub>0</sub><sup>2</sup>) + (ΔC/3)(<var>T</var><sup>3</sup> − <var>T</var><sub>0</sub><sup>3</sup>) + ΔD(1/<var>T</var><sub>0</sub> − 1/<var>T</var>)]</div>
      <h3>Standard entropy of reaction at T</h3>
      <div class="eqn">ΔS°(<var>T</var>) = ΔS°<sub>0</sub> + R[ΔA ln(<var>T</var>/<var>T</var><sub>0</sub>) + ΔB(<var>T</var> − <var>T</var><sub>0</sub>) + (ΔC/2)(<var>T</var><sup>2</sup> − <var>T</var><sub>0</sub><sup>2</sup>) + (ΔD/2)(1/<var>T</var><sub>0</sub><sup>2</sup> − 1/<var>T</var><sup>2</sup>)]</div>
      <div class="eqn">ΔS°<sub>0</sub> = (ΔH°<sub>0</sub> − ΔG°<sub>0</sub>)/<var>T</var><sub>0</sub> &nbsp;or&nbsp; ΔS°<sub>0</sub> = Σ ν<sub>i</sub>S°<sub>i</sub></div>
      <h3>Gibbs energy, equilibrium constant and pressure</h3>
      <div class="eqn">ΔG°(<var>T</var>) = ΔH°(<var>T</var>) − <var>T</var>ΔS°(<var>T</var>),&nbsp;&nbsp; ln K = −ΔG°/R<var>T</var>,&nbsp;&nbsp; d ln K/d<var>T</var> = ΔH°/R<var>T</var><sup>2</sup></div>
      <div class="eqn">Π<sub>gas</sub> y<sub>i</sub><sup>ν<sub>i</sub></sup> = K (P/P°)<sup>−Δn<sub>gas</sub></sup></div>
      <p>T<sub>0</sub> = ${T0} K, P° = ${P0} bar, R = ${R} J/(mol·K). With constant Cp°, ΔCp° is held at its 298.15 K value in both integrals. Pure solids and liquids have activity 1.</p>
      <h3>Numbers for this reaction</h3>
      <div class="table-wrap"><table class="data"><thead><tr><th>ΔA</th><th>ΔB</th><th>ΔC</th><th>ΔD</th><th>ΔH°<sub>0</sub> (J/mol)</th><th>ΔG°<sub>0</sub> (J/mol)</th><th>ΔS°<sub>0</sub> from ΔG° (J/mol·K)</th><th>ΔS°<sub>0</sub> from S° (J/mol·K)</th><th>Δn(gas)</th></tr></thead>
      <tbody><tr><td>${num(r.dA, 3)}</td><td>${r.dB.toExponential(4)}</td><td>${r.dC.toExponential(4)}</td><td>${r.dD.toExponential(4)}</td><td>${num(r.dH0, 0)}</td><td>${num(r.dG0, 0)}</td><td>${num(r.dS0FromG, 3)}</td><td>${num(r.dS0ThirdLaw, 3)}</td><td>${num(r.dnGas, 2)}</td></tr></tbody></table></div>`;

    // species data
    const row = (s, nu) => `<tr><td>${pretty(s.id)}</td><td class="left">${esc(s.name)}</td>${nu === undefined ? "" : `<td>${num(nu, 2)}</td>`}` +
      `<td>${num(s.dHf, 0)}</td><td>${num(s.dGf, 0)}</td><td>${num(s.S0, 2)}</td><td>${num(s.A, 3)}</td><td>${num(s.B * 1e3, 3)}</td><td>${num(s.C * 1e6, 3)}</td><td>${num(s.D * 1e-5, 3)}</td>` +
      `<td>${s.Tmin}–${s.Tmax}</td><td class="left">${esc(s.cpSource)}</td><td class="left">${esc(s.formationSource)}</td><td class="left">${esc(s.entropySource)}</td></tr>`;
    const head = withNu => `<thead><tr><th>Species</th><th class="left">Name</th>${withNu ? "<th>ν</th>" : ""}<th>ΔH°f (J/mol)</th><th>ΔG°f (J/mol)</th><th>S° (J/mol·K)</th><th>A</th><th>10³B</th><th>10⁶C</th><th>10⁻⁵D</th><th>Cp valid (K)</th><th class="left">Cp source</th><th class="left">ΔH°f, ΔG°f source</th><th class="left">S° source</th></tr></thead>`;
    $("panel-data").innerHTML =
      `<p>Data used for this reaction. Cp coefficients are shown exactly as printed in SVA Appendix C.</p>` +
      `<div class="table-wrap"><table class="data">${head(true)}<tbody>${[...r.stoich].map(([k, nu]) => row(db.get(k), nu)).join("")}</tbody></table></div>` +
      `<p class="small">SVA = Smith, Van Ness &amp; Abbott, Introduction to Chemical Engineering Thermodynamics, Appendix C. Reference state 298.15 K and 1 bar.</p>` +
      `<details><summary><strong>Full species database (${db.size} species)</strong></summary><div class="table-wrap"><table class="data">${head(false)}<tbody>${[...db.values()].map(s => row(s)).join("")}</tbody></table></div></details>`;
  }

  function renderTab() {
    if (!rx) return;
    const r = rx, { T, P, tlo, thi } = state, m = state.cp, s = state.s;
    const Ts = linspace(tlo, thi, 300);

    if (state.tab === "trends") {
      $("panel-trends").innerHTML =
        `<div class="chart-box"><canvas id="c-main" aria-label="Enthalpy, Gibbs energy and T times entropy of reaction against temperature"></canvas></div>` +
        `<div class="two"><div class="chart-box short"><canvas id="c-lnk" aria-label="ln K against temperature"></canvas></div>` +
        `<div class="chart-box short"><canvas id="c-ds" aria-label="Entropy of reaction against temperature"></canvas></div></div>` +
        `<p style="margin-top:1rem"><button class="btn btn-secondary" type="button" id="dl">Download these values (CSV)</button></p>`;
      const ds = [
        line("ΔH° (kJ/mol)", series(Ts, t => kj(r.dH(t, m))), COL.H),
        line("ΔG° (kJ/mol)", series(Ts, t => kj(r.dG(t, m, s))), COL.G),
        line("TΔS° (kJ/mol)", series(Ts, t => kj(t * r.dS(t, m, s))), COL.S, { borderDash: [2, 4], borderWidth: 2.5 }),
      ];
      const roots = r.crossovers(tlo, thi, m, s);
      const all = [...ds, vline(T, ds, `T = ${T} K`)];
      if (roots.length) all.push({ label: "K = 1", helper: true, type: "scatter", data: roots.map(x => ({ x, y: 0 })),
        pointRadius: 6, pointBackgroundColor: COL.G, pointBorderColor: "#fff", pointBorderWidth: 2 });
      draw("c-main", all, { xTitle: "Temperature (K)", yTitle: "kJ per mol of reaction", xMin: tlo, xMax: thi });
      const lk = [line("ln K", series(Ts, t => r.lnK(t, m, s)), COL.G)];
      draw("c-lnk", [...lk, vline(T, lk, "T")], { xTitle: "Temperature (K)", yTitle: "ln K", legend: false, xMin: tlo, xMax: thi });
      const dsS = [line("ΔS° (J/mol·K)", series(Ts, t => r.dS(t, m, s)), COL.S)];
      draw("c-ds", [...dsS, vline(T, dsS, "T")], { xTitle: "Temperature (K)", yTitle: "ΔS° (J/mol·K)", legend: false, xMin: tlo, xMax: thi });
      $("dl").addEventListener("click", () => {
        const rows = ["T_K,dH_kJ_mol,dS_J_molK,dG_kJ_mol,lnK"].concat(Ts.map(t =>
          [t, kj(r.dH(t, m)), r.dS(t, m, s), kj(r.dG(t, m, s)), r.lnK(t, m, s)].map(v => +v.toPrecision(10)).join(",")));
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
        a.download = "reaction_sweep.csv"; a.click(); URL.revokeObjectURL(a.href);
      });
    }

    if (state.tab === "cp") {
      const Tcs = [...new Set([500, 1000, 1500, T])].sort((a, b) => a - b);
      $("panel-cp").innerHTML =
        `<p>How much does assuming a constant heat capacity change the answer?</p>` +
        `<div class="chart-box"><canvas id="c-cp" aria-label="Constant versus temperature-dependent heat capacity"></canvas></div>` +
        `<div class="table-wrap" style="margin-top:1rem"><table class="data"><thead><tr><th>T (K)</th><th>ΔH° Cp(T)</th><th>ΔH° constant</th><th>ΔH difference</th><th>ΔG° Cp(T)</th><th>ΔG° constant</th><th>ΔG difference</th><th>K constant ÷ K Cp(T)</th></tr></thead><tbody>` +
        Tcs.map(t => {
          const hv = r.dH(t, "variable"), hc = r.dH(t, "constant"), gv = r.dG(t, "variable", s), gc = r.dG(t, "constant", s);
          return `<tr><td>${t}</td><td>${num(kj(hv))}</td><td>${num(kj(hc))}</td><td>${num(kj(hc - hv))}</td><td>${num(kj(gv))}</td><td>${num(kj(gc))}</td><td>${num(kj(gc - gv))}</td><td>${num(Math.exp(-(gc - gv) / (R * t)), 3)}</td></tr>`;
        }).join("") +
        `</tbody></table></div><p class="small">All energies in kJ/mol. ΔCp°(298.15 K) = ${num(r.dCp(T0))} J/(mol·K); ΔCp°(${T} K) = ${num(r.dCp(T))} J/(mol·K).</p>`;
      draw("c-cp", [
        line("ΔH°, Cp°(T)", series(Ts, t => kj(r.dH(t, "variable"))), COL.H),
        line("ΔH°, constant Cp°", series(Ts, t => kj(r.dH(t, "constant"))), COL.H, { borderDash: [7, 5], borderWidth: 2.5 }),
        line("ΔG°, Cp°(T)", series(Ts, t => kj(r.dG(t, "variable", s))), COL.G),
        line("ΔG°, constant Cp°", series(Ts, t => kj(r.dG(t, "constant", s))), COL.G, { borderDash: [7, 5], borderWidth: 2.5 }),
      ], { xTitle: "Temperature (K)", yTitle: "kJ per mol of reaction", xMin: tlo, xMax: thi });
    }

    if (state.tab === "pressure") {
      if (r.equilibriumConversion(T, P, m, s) === null) {
        $("panel-pressure").innerHTML = `<div class="msg info">No gas-phase species take part, so pressure has no ideal-gas effect.</div>`;
        return;
      }
      $("panel-pressure").innerHTML =
        `<div class="two" style="margin-top:0"><div class="chart-box"><canvas id="c-p" aria-label="Equilibrium conversion against pressure"></canvas></div>` +
        `<div class="chart-box"><canvas id="c-t" aria-label="Equilibrium conversion against temperature"></canvas></div></div>` +
        `<p class="small" style="margin-top:0.8rem">Ideal-gas mixture (fugacity coefficients = 1), stoichiometric feed, no inerts. Real-gas corrections at high pressure are the optional extension.</p>`;
      const Ps = logspace(-1, 3, 120);
      const cp = [line(`Conversion at ${T} K (%)`, series(Ps, p => 100 * r.equilibriumConversion(T, p, m, s)), COL.G)];
      draw("c-p", [...cp, vline(P, [{ data: [{ y: 0 }, { y: 100 }] }], `P = ${P} bar`)],
        { xTitle: "Pressure (bar, log scale)", yTitle: "Equilibrium conversion (%)", xLog: true, yMin: 0, yMax: 100, xMin: 0.1, xMax: 1000 });
      const Tc = linspace(tlo, thi, 150);
      const ct = [line(`Conversion at ${P} bar (%)`, series(Tc, t => 100 * r.equilibriumConversion(t, P, m, s)), COL.H)];
      draw("c-t", [...ct, vline(T, [{ data: [{ y: 0 }, { y: 100 }] }], `T = ${T} K`)],
        { xTitle: "Temperature (K)", yTitle: "Equilibrium conversion (%)", yMin: 0, yMax: 100, xMin: tlo, xMax: thi });
    }
  }

  update();
})();
