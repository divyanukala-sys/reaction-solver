/* solver.js - values page (plots are on plots.html). Wires the engine in thermo.js to the page. No thermodynamics in here. */
(function () {
  "use strict";
  const { T0, P0, R, pretty } = Thermo;
  const db = Thermo.loadSpecies(THERMO_DATA.species);
  const REACTIONS = THERMO_DATA.reactions;

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
    return `${(10 ** (l10 - e)).toFixed(2)} × 10<sup>${e < 0 ? "−" + (-e) : e}</sup>`;
  }

  // ---------------------------------------------------------------- state (same URL parameters as setup.html)
  const DEFAULTS = { eq: REACTIONS[0].equation, T: 800, P: 1, tlo: 298.15, thi: 1500, cp: "variable", s: "gibbs" };
  const KEYS = Object.keys(DEFAULTS);
  const state = { ...DEFAULTS };
  const params = new URLSearchParams(location.search);
  for (const k of KEYS) {
    if (!params.has(k)) continue;
    const v = params.get(k);
    state[k] = typeof DEFAULTS[k] === "number" ? (Number.isFinite(+v) ? +v : DEFAULTS[k]) : v;
  }
  if (!["variable", "constant"].includes(state.cp)) state.cp = "variable";
  if (!["gibbs", "third_law"].includes(state.s)) state.s = "gibbs";
  const startTab = params.get("tab"); // older links (slides) may ask for a section (plot tabs are sent to plots.html)

  function queryString() {
    const p = new URLSearchParams();
    for (const k of KEYS) p.set(k, state[k]);
    return p.toString();
  }
  function writeURL() {
    const qs = queryString();
    $("act-edit").href = `setup.html?${qs}`;
    $("act-plots").href = $("act-plots-2").href = `plots.html?${qs}`;
    try { history.replaceState(null, "", `?${qs}`); } catch (e) { /* not allowed when opened from disk in some browsers */ }
  }

  // ---------------------------------------------------------------- summary bar controls
  const GROUPS = ["Combustion", "Syngas and reforming", "Synthesis", "Dehydrogenation", "Other"];
  function groupOf(r) {
    const n = r.name;
    if (/unbalanced/i.test(n)) return "Other"; // deliberately unbalanced example, not a real process
    if (/combustion/i.test(n)) return "Combustion";
    if (/reforming|shift|partial oxidation/i.test(n)) return "Syngas and reforming";
    if (/dehydrogenation/i.test(n)) return "Dehydrogenation";
    if (/synthesis|hydrogenation|methanation|sabatier|hydration|carbonylation/i.test(n)) return "Synthesis";
    return "Other";
  }
  $("q-preset").innerHTML = `<option value="">Custom reaction</option>` + GROUPS.map(g =>
    `<optgroup label="${g}">` +
    REACTIONS.map((r, i) => [r, i]).filter(([r]) => groupOf(r) === g)
      .map(([r, i]) => `<option value="${i}">${esc(r.name)}</option>`).join("") +
    `</optgroup>`).join("");

  function syncControls() {
    const i = REACTIONS.findIndex(r => r.equation === state.eq);
    $("q-preset").value = i >= 0 ? String(i) : "";
    $("q-T").value = state.T; $("q-P").value = state.P;
  }
  syncControls();

  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(update, 300); };
  $("q-preset").addEventListener("change", () => {
    const v = $("q-preset").value;
    if (v === "") return;
    state.eq = REACTIONS[+v].equation; update();
  });
  $("q-T").addEventListener("input", () => { state.T = parseFloat($("q-T").value); later(); });
  $("q-P").addEventListener("input", () => { state.P = parseFloat($("q-P").value); later(); });

  // ---------------------------------------------------------------- actions
  let statusTimer = null;
  function flash(msg) {
    $("act-status").textContent = msg;
    clearTimeout(statusTimer); statusTimer = setTimeout(() => { $("act-status").textContent = ""; }, 3000);
  }
  $("act-link").addEventListener("click", async () => {
    const url = `${location.href.split(/[?#]/)[0]}?${queryString()}`;
    try {
      await navigator.clipboard.writeText(url);
      flash("Link copied.");
    } catch (e) {
      // Clipboard API unavailable (e.g. page opened from disk): fall back to a hidden text box.
      const ta = document.createElement("textarea");
      ta.value = url; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e2) { /* ignore */ }
      ta.remove();
      flash(ok ? "Link copied." : `Copy this link: ${url}`);
    }
  });
  $("act-reset").addEventListener("click", () => {
    Object.assign(state, DEFAULTS);
    syncControls(); update();
    flash("Reset to defaults.");
  });

  // ---------------------------------------------------------------- render
  let rx = null;

  function update() {
    writeURL();
    syncControls();
    const msgs = [];
    const body = $("result-body");
    rx = null;
    const { T, P, tlo, thi } = state;
    $("sb-meta").textContent =
      `T = ${T} K · P = ${P} bar · ${state.cp === "variable" ? "Cp°(T)" : "Constant Cp° at 298 K"} · ` +
      `ΔS°₂₉₈ from ${state.s === "gibbs" ? "ΔH°f and ΔG°f" : "third-law S°"} · plots ${tlo}–${thi} K`;

    const fail = html => { $("messages").innerHTML = html; $("numbers").innerHTML = ""; body.hidden = true; };

    let stoich;
    try {
      stoich = Thermo.parseReaction(state.eq, db);
    } catch (e) {
      $("eq-title").textContent = "Reaction not recognised";
      $("eq-note").textContent = ""; $("eq-note").hidden = true;
      return fail(`<div class="msg err">Can’t read this reaction. ${esc(e.message)}</div>`);
    }
    const r = new Thermo.Reaction(stoich, db);
    $("eq-title").textContent = r.equation();
    const pre = REACTIONS.find(x => x.equation === state.eq);
    const note = (pre && pre.note || "").trim();
    $("eq-note").textContent = note; $("eq-note").hidden = !note; // no empty line when a reaction has no note

    const bal = r.elementBalance();
    if (!r.isBalanced()) {
      const off = Object.entries(bal).filter(([, v]) => Math.abs(v) > 1e-9);
      return fail(
        `<div class="msg err">This reaction is not balanced, so no thermodynamic results are shown. ` +
        `Net atoms (products − reactants): ${off.map(([el, v]) => `${el} ${v > 0 ? "+" : "−"}${+Math.abs(v).toFixed(4)}`).join(", ")}.</div>` +
        `<div class="table-wrap narrow"><table class="data"><thead><tr><th>Element</th><th>Products − reactants</th></tr></thead><tbody>` +
        Object.entries(bal).map(([el, v]) => `<tr><td>${el}</td><td>${num(v, 2)}</td></tr>`).join("") +
        `</tbody></table></div>`);
    }

    const bad = [];
    if (!(T >= 200 && T <= 3000)) bad.push("Temperature must be between 200 and 3000 K.");
    if (!(P >= 0.01 && P <= 1000)) bad.push("Pressure must be between 0.01 and 1000 bar.");
    if (!(tlo >= 200 && thi <= 3000 && thi - tlo >= 10)) bad.push("Plot range must lie within 200–3000 K and span at least 10 K.");
    if (bad.length) return fail(bad.map(b => `<div class="msg err">${b}</div>`).join(""));

    rx = r;
    msgs.push(`<div class="msg ok">✓ Element balance checked: ${Object.keys(bal).map(el => `${el} 0`).join(", ")}</div>`);
    const warns = r.warnings(Math.min(tlo, T), Math.max(thi, T), state.cp);
    if (warns.length) msgs.push(`<div class="msg warn"><ul>${warns.map(w => `<li>${esc(w)}</li>`).join("")}</ul></div>`);
    if (state.cp === "constant") {
      msgs.push(`<div class="msg info">Constant-Cp mode: ΔCp° is frozen at its 298.15 K value. Switch to Cp°(T) in Edit setup to see how much this matters at high temperature.</div>`);
    }
    $("messages").innerHTML = msgs.join("");

    // headline values
    const m = state.cp, s = state.s;
    const dH = r.dH(T, m), dS = r.dS(T, m, s), dG = r.dG(T, m, s), lnK = r.lnK(T, m, s);
    const X = r.equilibriumConversion(T, P, m, s);
    const tag = h => `<div class="v-tag ${h < 0 ? "exo" : "endo"}">${h < 0 ? "Exothermic" : "Endothermic"}</div>`;
    const val = (cls, label, value, extra = "") =>
      `<div class="val ${cls}"><div class="v-label"><span>${label}</span></div><div class="v-num">${value}</div>${extra}</div>`;

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

    $("numbers").innerHTML =
      `<section class="values" aria-label="Results">` +
      `<h2 class="values-title">At 298.15 K, 1 bar</h2><div class="values-row">` +
      val("h", "ΔH°<sub>298</sub> (kJ/mol)", num(kj(r.dH0)), tag(r.dH0)) +
      val("s", "ΔS°<sub>298</sub> (J/mol·K)", num(r.dS0(s))) +
      val("g", "ΔG°<sub>298</sub> (kJ/mol)", num(kj(r.dG(T0, m, s)))) +
      val("k", "K<sub>298</sub>", fmtK(r.lnK(T0, m, s))) +
      `</div><h2 class="values-title">At T = ${T} K, P = ${P} bar</h2><div class="values-row">` +
      val("h", "ΔH°(T) (kJ/mol)", num(kj(dH)), tag(dH)) +
      val("s", "ΔS°(T) (J/mol·K)", num(dS)) +
      val("g", "ΔG°(T) (kJ/mol)", num(kj(dG))) +
      val("k", "K(T)", fmtK(lnK)) +
      val("k conv", "Equilibrium conversion (%)", X === null ? "n/a" : num(100 * X)) +
      `</div></section>` +
      `<ul class="verdict">${lines.map(l => `<li>${l}</li>`).join("")}</ul>` +
      `<p class="small">ΔG° refers to every species at 1 bar. The actual driving force is ΔG = ΔG° + RT ln Q, which depends on composition. ` +
      `Conversion assumes a stoichiometric feed with no products or inerts, an ideal-gas mixture, and pure solids and liquids.</p>`;
    body.hidden = false;
    renderAllStatic();
  }

  // Tables in the collapsible sections below the values.
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

  update();

  // Older links (e.g. from the slides) may name a section with ?tab=...; open it once on arrival.
  if (rx && startTab) {
    const section = { sens: "sec-sens", method: "sec-method", data: "sec-data" }[startTab];
    if (section) {
      $(section).open = true;
      $(section).scrollIntoView({ block: "start" });
    }
  }
})();
