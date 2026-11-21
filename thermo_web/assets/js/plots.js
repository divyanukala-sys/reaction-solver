/* plots.js - plots page. Draws plots from the engine in thermo.js. No thermodynamics in here. */
(function () {
  "use strict";
  const { T0, R } = Thermo;
  const db = Thermo.loadSpecies(THERMO_DATA.species);
  const REACTIONS = THERMO_DATA.reactions;
  const COL = { H: "#c2730a", G: "#1f5f99", S: "#2c7c65", grey: "#8a97a3", ink: "#14273a" };
  const TEXT = { H: "#a35f00", G: "#1f5f99", S: "#2c7c65", ink: "#0b1724" }; // darker label colours for contrast

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (x, d = 2) => Number.isFinite(x)
    ? x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/^-/, "−")
    : "—";
  const kj = x => x / 1000;
  const linspace = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));
  const logspace = (a, b, n) => linspace(a, b, n).map(v => 10 ** v);

  // ---------------------------------------------------------------- state (same URL parameters as solver.html and setup.html)
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
  const startTab = params.get("tab"); // slide links: trends, cp, pressure

  const qs = (() => { const p = new URLSearchParams(); for (const k of KEYS) p.set(k, state[k]); return p.toString(); })();
  $("act-back").href = `solver.html?${qs}`;
  $("act-edit").href = `setup.html?${qs}`;
  try { history.replaceState(null, "", `?${qs}`); } catch (e) { /* not allowed from disk in some browsers */ }

  // Which plotted lines are visible (ΔH°, ΔG°, TΔS°). Kept for the session, not in the URL.
  const show = { H: true, G: true, S: true };

  // ---------------------------------------------------------------- line toggles
  const LINES = { H: ["ΔH°", "h"], G: ["ΔG°", "g"], S: ["TΔS°", "s"] };
  const toggles = list => !list.length ? "" :
    `<div class="line-toggles" role="group" aria-label="Show or hide lines"><span class="label">Show lines:</span>` +
    list.map(q => `<button type="button" class="line-toggle ${LINES[q][1]}" data-q="${q}" aria-pressed="${show[q]}">${LINES[q][0]}</button>`).join("") +
    `</div>`;
  function toggleLine(q) {
    show[q] = !show[q];
    for (const c of Object.values(charts)) {
      let touched = false;
      c.data.datasets.forEach((d, i) => { if (d.qty) { c.setDatasetVisibility(i, show[d.qty]); touched = true; } });
      if (touched) c.update();
    }
    document.querySelectorAll(".line-toggle").forEach(b => b.setAttribute("aria-pressed", String(show[b.dataset.q])));
  }
  document.addEventListener("click", e => {
    const q = e.target.closest(".line-toggle")?.dataset.q;
    if (q) toggleLine(q);
  });

  // ---------------------------------------------------------------- charts
  const charts = {};
  const FONT = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.family = FONT;
  Chart.defaults.color = "#33475a";

  // Dashed line at the chosen T (or P), with a heading and the value of each visible series there.
  // Configure per chart with options.plugins.marker = { x, label, points: [{ y, text, color, qty }] }.
  const markerPlugin = {
    id: "marker",
    afterDatasetsDraw(chart, args, o) {
      if (!o || !Number.isFinite(o.x)) return;
      const { ctx, chartArea: a, scales: { x: xs, y: ys } } = chart;
      const px = xs.getPixelForValue(o.x);
      if (!(px >= a.left - 0.5 && px <= a.right + 0.5)) return;
      const fs = o.small ? 10.5 : 13;
      const right = px > (a.left + a.right) / 2; // put text on the side with more room
      const dx = right ? -7 : 7;
      ctx.save();
      ctx.strokeStyle = COL.grey; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.textAlign = right ? "right" : "left"; ctx.textBaseline = "middle";
      // Text on a white pill so it stays readable where it crosses a curve or grid line.
      const text = (t, x, y, color, weight) => {
        ctx.font = `${weight} ${fs}px ${FONT}`;
        const w = ctx.measureText(t).width, padX = 4, h = fs + 5;
        const x0 = right ? x - w - padX : x - padX;
        ctx.fillStyle = "rgba(255,255,255,0.93)";
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x0, y - h / 2, w + 2 * padX, h, 4); else ctx.rect(x0, y - h / 2, w + 2 * padX, h);
        ctx.fill();
        ctx.fillStyle = color; ctx.fillText(t, x, y);
      };
      text(o.label, px + dx, a.top + fs * 0.7, TEXT.ink, 700);
      // points, then labels spread apart so they do not overlap
      const pts = (o.points || [])
        .filter(p => Number.isFinite(p.y) && (!p.qty || show[p.qty]))
        .map(p => ({ ...p, py: ys.getPixelForValue(p.y) }))
        .filter(p => p.py >= a.top - 1 && p.py <= a.bottom + 1)
        .sort((p, q) => p.py - q.py);
      for (const p of pts) {
        ctx.beginPath(); ctx.arc(px, p.py, o.small ? 3.5 : 5, 0, 2 * Math.PI);
        ctx.fillStyle = p.color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
      }
      const gap = fs + 6, minY = a.top + fs * 2.2;
      let ys2 = pts.map(p => Math.max(p.py, minY));
      for (let i = 1; i < ys2.length; i++) ys2[i] = Math.max(ys2[i], ys2[i - 1] + gap);
      const over = ys2.length ? ys2[ys2.length - 1] - (a.bottom - fs * 0.6) : 0;
      if (over > 0) ys2 = ys2.map(y => y - over);
      pts.forEach((p, i) => text(p.text, px + dx * 1.4, ys2[i], p.textColor || p.color, 600));
      ctx.restore();
    },
  };

  const series = (xs, f) => xs.map(x => ({ x, y: f(x) }));
  function line(label, data, color, extra = {}) {
    const d = { label, data, borderColor: color, backgroundColor: color, borderWidth: 3, pointRadius: 0, ...extra };
    if (d.qty) d.hidden = !show[d.qty];
    return d;
  }
  function draw(id, datasets, { xTitle, yTitle, xLog = false, yMin, yMax, legend = true, xMin, xMax, marker, preview = false } = {}) {
    if (charts[id]) charts[id].destroy();
    const small = preview ? { size: 11 } : undefined;
    const options = {
      maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: marker ? (preview ? 4 : 8) : 0 } },
      plugins: {
        marker: marker ? { ...marker, small: preview } : null,
        legend: {
          display: legend,
          labels: { filter: (item, data) => !data.datasets[item.datasetIndex].helper,
                    ...(preview ? { boxWidth: 14, font: small } : {}) },
          // Clicking a legend entry for ΔH°/ΔG°/TΔS° goes through the same toggle as the buttons.
          onClick: (e, item, lg) => {
            const d = lg.chart.data.datasets[item.datasetIndex];
            if (d.qty) toggleLine(d.qty);
            else Chart.defaults.plugins.legend.onClick.call(lg, e, item, lg);
          },
        },
        tooltip: {
          filter: item => !item.dataset.helper,
          callbacks: {
            title: items => items.length ? `${num(items[0].parsed.x, xLog ? 2 : 0)} ${xLog ? "bar" : "K"}` : "",
            label: c => `${c.dataset.label}: ${num(c.parsed.y, 2)}`,
          },
        },
      },
      scales: {
        x: { type: xLog ? "logarithmic" : "linear", min: xMin, max: xMax,
             title: { display: true, text: xTitle, font: small }, ticks: { font: small, maxTicksLimit: preview ? 6 : undefined } },
        y: { min: yMin, max: yMax, title: { display: true, text: yTitle, font: small }, ticks: { font: small, maxTicksLimit: preview ? 6 : undefined },
             grace: marker ? "6%" : undefined,
             grid: { color: c => (c.tick.value === 0 ? "#9aa8b4" : "#e3e9ee") } },
      },
    };
    if (preview) options.events = []; // previews are pictures; the pop-up is for reading values
    charts[id] = new Chart($(id), { type: "line", data: { datasets }, options, plugins: [markerPlugin] });
  }

  // ---------------------------------------------------------------- plot definitions
  // Each plot: title, explanation, optional caveat, which line toggles apply, and a build()
  // that returns Chart.js datasets plus axis options. build() is reused for preview, pop-up and CSV.
  function plotDefs(r) {
    const { T, P, tlo, thi } = state, m = state.cp, s = state.s;
    const Ts = linspace(tlo, thi, 300);
    const hasGas = r.equilibriumConversion(T, P, m, s) !== null;
    const idealGas = "Ideal-gas mixture (fugacity coefficients = 1), stoichiometric feed with no products or inerts, pure solids and liquids. Real-gas effects at high pressure are not included.";
    const atT = `T = ${T} K`;
    return [
      {
        id: "trends", title: "ΔH°, ΔG° and TΔS° vs temperature", toggles: ["H", "G", "S"],
        text: "ΔG° = ΔH° − TΔS°, so this shows how heat and entropy compete as temperature changes. Where ΔG° crosses zero, K = 1; below zero, products are favoured.",
        caveat: "Standard values: every species at 1 bar. Round markers on the zero line show where ΔG° = 0. The dashed line marks the chosen T, labelled with the values there (kJ/mol).",
        build() {
          const ds = [
            line("ΔH° (kJ/mol)", series(Ts, t => kj(r.dH(t, m))), COL.H, { qty: "H" }),
            line("ΔG° (kJ/mol)", series(Ts, t => kj(r.dG(t, m, s))), COL.G, { qty: "G" }),
            line("TΔS° (kJ/mol)", series(Ts, t => kj(t * r.dS(t, m, s))), COL.S, { qty: "S", borderDash: [2, 4], borderWidth: 2.5 }),
          ];
          const roots = r.crossovers(tlo, thi, m, s);
          if (roots.length) ds.push({ label: "K = 1", helper: true, type: "scatter", data: roots.map(x => ({ x, y: 0 })),
            pointRadius: 6, pointBackgroundColor: COL.G, pointBorderColor: "#fff", pointBorderWidth: 2 });
          const h = kj(r.dH(T, m)), g = kj(r.dG(T, m, s)), ts = kj(T * r.dS(T, m, s));
          return { datasets: ds, opts: { xTitle: "Temperature (K)", yTitle: "kJ per mol of reaction", xMin: tlo, xMax: thi,
            marker: { x: T, label: atT, points: [
              { y: h, text: `ΔH° ${num(h)}`, color: COL.H, textColor: TEXT.H, qty: "H" },
              { y: g, text: `ΔG° ${num(g)}`, color: COL.G, textColor: TEXT.G, qty: "G" },
              { y: ts, text: `TΔS° ${num(ts)}`, color: COL.S, textColor: TEXT.S, qty: "S" },
            ] } } };
        },
      },
      {
        id: "lnk", title: "ln K vs temperature", toggles: [],
        text: "The slope of ln K has the sign of ΔH° (van ’t Hoff: d ln K/dT = ΔH°/RT²). ln K falls with temperature for exothermic reactions and rises for endothermic ones.",
        caveat: "K is the ideal-gas equilibrium constant with a 1 bar standard state.",
        build() {
          const v = r.lnK(T, m, s);
          return { datasets: [line("ln K", series(Ts, t => r.lnK(t, m, s)), COL.G)],
            opts: { xTitle: "Temperature (K)", yTitle: "ln K", legend: false, xMin: tlo, xMax: thi,
              marker: { x: T, label: atT, points: [{ y: v, text: `ln K ${num(v)}`, color: COL.G }] } } };
        },
      },
      {
        id: "ds", title: "ΔS° vs temperature", toggles: [],
        text: "ΔS° changes with temperature only through ΔCp° (dΔS°/dT = ΔCp°/T), so the line is nearly flat when ΔCp° is small.",
        caveat: `ΔCp° for this reaction: ${num(r.dCp(T0))} J/(mol·K) at 298.15 K and ${num(r.dCp(T))} J/(mol·K) at ${T} K.`,
        build() {
          const v = r.dS(T, m, s);
          return { datasets: [line("ΔS° (J/mol·K)", series(Ts, t => r.dS(t, m, s)), COL.S)],
            opts: { xTitle: "Temperature (K)", yTitle: "ΔS° (J/mol·K)", legend: false, xMin: tlo, xMax: thi,
              marker: { x: T, label: atT, points: [{ y: v, text: `ΔS° ${num(v)} J/mol·K`, color: COL.S }] } } };
        },
      },
      {
        id: "cp", title: "Constant vs temperature-dependent Cp°", toggles: ["H", "G"],
        text: "Solid lines use Cp°(T); dashed lines freeze ΔCp° at its 298.15 K value. The gap between them is the error of that shortcut, and it grows with temperature.",
        caveat: (() => {
          const Tcs = [...new Set([500, 1000, 1500, T])].sort((a, b) => a - b);
          return `<div class="table-wrap"><table class="data"><thead><tr><th>T (K)</th><th>ΔH° Cp(T)</th><th>ΔH° constant</th><th>ΔH difference</th><th>ΔG° Cp(T)</th><th>ΔG° constant</th><th>ΔG difference</th><th>K constant ÷ K Cp(T)</th></tr></thead><tbody>` +
            Tcs.map(t => {
              const hv = r.dH(t, "variable"), hc = r.dH(t, "constant"), gv = r.dG(t, "variable", s), gc = r.dG(t, "constant", s);
              return `<tr><td>${t}</td><td>${num(kj(hv))}</td><td>${num(kj(hc))}</td><td>${num(kj(hc - hv))}</td><td>${num(kj(gv))}</td><td>${num(kj(gc))}</td><td>${num(kj(gc - gv))}</td><td>${num(Math.exp(-(gc - gv) / (R * t)), 3)}</td></tr>`;
            }).join("") +
            `</tbody></table></div><p class="small">All energies in kJ/mol. ΔCp°(298.15 K) = ${num(r.dCp(T0))} J/(mol·K); ΔCp°(${T} K) = ${num(r.dCp(T))} J/(mol·K).</p>`;
        })(),
        build() {
          const hv = kj(r.dH(T, "variable")), hc = kj(r.dH(T, "constant"));
          const gv = kj(r.dG(T, "variable", s)), gc = kj(r.dG(T, "constant", s));
          return { datasets: [
            line("ΔH°, Cp°(T)", series(Ts, t => kj(r.dH(t, "variable"))), COL.H, { qty: "H" }),
            line("ΔH°, constant Cp°", series(Ts, t => kj(r.dH(t, "constant"))), COL.H, { qty: "H", borderDash: [7, 5], borderWidth: 2.5 }),
            line("ΔG°, Cp°(T)", series(Ts, t => kj(r.dG(t, "variable", s))), COL.G, { qty: "G" }),
            line("ΔG°, constant Cp°", series(Ts, t => kj(r.dG(t, "constant", s))), COL.G, { qty: "G", borderDash: [7, 5], borderWidth: 2.5 }),
          ], opts: { xTitle: "Temperature (K)", yTitle: "kJ per mol of reaction", xMin: tlo, xMax: thi,
            marker: { x: T, label: atT, points: [
              { y: hv, text: `ΔH° Cp(T) ${num(hv)}`, color: COL.H, textColor: TEXT.H, qty: "H" },
              { y: hc, text: `ΔH° const ${num(hc)}`, color: COL.H, textColor: TEXT.H, qty: "H" },
              { y: gv, text: `ΔG° Cp(T) ${num(gv)}`, color: COL.G, textColor: TEXT.G, qty: "G" },
              { y: gc, text: `ΔG° const ${num(gc)}`, color: COL.G, textColor: TEXT.G, qty: "G" },
            ] } } };
        },
      },
      {
        id: "convP", title: `Equilibrium conversion vs pressure (at ${T} K)`, toggles: [], available: hasGas,
        text: `Conversion rises with pressure when the reaction reduces the number of gas moles and falls when it increases them (Le Chatelier). For this reaction Δn(gas) = ${num(r.dnGas, 2)}.`,
        caveat: idealGas,
        build() {
          const Ps = logspace(-1, 3, 120);
          const v = 100 * r.equilibriumConversion(T, P, m, s);
          return { datasets: [line(`Conversion at ${T} K (%)`, series(Ps, p => 100 * r.equilibriumConversion(T, p, m, s)), COL.G)],
            opts: { xTitle: "Pressure (bar, log scale)", yTitle: "Equilibrium conversion (%)", xLog: true, yMin: 0, yMax: 100, xMin: 0.1, xMax: 1000, legend: false,
              marker: { x: P, label: `P = ${P} bar`, points: [{ y: v, text: `${num(v)} %`, color: COL.G }] } } };
        },
      },
      {
        id: "convT", title: `Equilibrium conversion vs temperature (at ${P} bar)`, toggles: [], available: hasGas,
        text: "The most conversion equilibrium allows at each temperature. For exothermic reactions it falls as T rises, so the faster rates at high temperature come at the cost of lower conversion.",
        caveat: idealGas,
        build() {
          const Tc = linspace(tlo, thi, 150);
          const v = 100 * r.equilibriumConversion(T, P, m, s);
          return { datasets: [line(`Conversion at ${P} bar (%)`, series(Tc, t => 100 * r.equilibriumConversion(t, P, m, s)), COL.H)],
            opts: { xTitle: "Temperature (K)", yTitle: "Equilibrium conversion (%)", yMin: 0, yMax: 100, xMin: tlo, xMax: thi, legend: false,
              marker: { x: T, label: atT, points: [{ y: v, text: `${num(v)} %`, color: COL.H, textColor: TEXT.H }] } } };
        },
      },
    ].map(d => ({ available: true, ...d }));
  }

  // ---------------------------------------------------------------- cards
  let defs = [];
  function renderPlots(r) {
    defs = plotDefs(r);
    $("plot-grid").innerHTML = defs.map(d => `
      <article class="plot-card" id="card-${d.id}">
        <h3>${d.title}</h3>
        <p>${d.text}</p>
        ${d.available
          ? `<div class="chart-box preview"><canvas id="pv-${d.id}" role="img" aria-label="${esc(d.title)} (preview)"></canvas></div>
             <button type="button" class="btn btn-secondary btn-sm open-plot" data-plot="${d.id}">Open full size</button>`
          : `<div class="msg info">No gas-phase species take part, so pressure has no ideal-gas effect and there is no conversion to plot.</div>`}
      </article>`).join("");
    for (const d of defs) {
      if (!d.available) continue;
      const b = d.build();
      draw(`pv-${d.id}`, b.datasets, { ...b.opts, preview: true });
    }
  }
  $("plot-grid").addEventListener("click", e => {
    const b = e.target.closest(".open-plot");
    if (b) openPlot(b.dataset.plot, b);
  });

  // ---------------------------------------------------------------- pop-up
  const dlg = $("plot-dialog");
  let opener = null, openDef = null;
  function openPlot(id, from) {
    const d = defs.find(x => x.id === id);
    if (!d || !d.available) return;
    opener = from || null; openDef = d;
    $("dlg-title").textContent = d.title;
    $("dlg-text").textContent = d.text;
    $("dlg-caveat").innerHTML = d.caveat ? (d.caveat.startsWith("<") ? d.caveat : `<p class="small">${esc(d.caveat)}</p>`) : "";
    $("dlg-toggles").innerHTML = toggles(d.toggles);
    $("c-modal").setAttribute("aria-label", d.title);
    dlg.showModal();
    const b = d.build();
    draw("c-modal", b.datasets, b.opts);
  }
  $("dlg-close").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); }); // backdrop
  dlg.addEventListener("close", () => {
    if (charts["c-modal"]) { charts["c-modal"].destroy(); delete charts["c-modal"]; }
    openDef = null;
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
  });
  $("dlg-csv").addEventListener("click", () => {
    if (!openDef) return;
    const { datasets, opts } = openDef.build();
    const cols = datasets.filter(d => !d.helper);
    const q = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const rows = [[opts.xTitle, ...cols.map(d => d.label)].map(q).join(",")].concat(
      cols[0].data.map((p, i) => [p.x, ...cols.map(d => d.data[i].y)].map(v => +Number(v).toPrecision(10)).join(",")));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + rows.join("\n")], { type: "text/csv" }));
    a.download = `${openDef.id}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // ---------------------------------------------------------------- page
  function render() {
    const { T, P, tlo, thi } = state;
    $("sb-meta").textContent =
      `T = ${T} K · P = ${P} bar · ${state.cp === "variable" ? "Cp°(T)" : "Constant Cp° at 298 K"} · ` +
      `ΔS°₂₉₈ from ${state.s === "gibbs" ? "ΔH°f and ΔG°f" : "third-law S°"} · plots ${tlo}–${thi} K`;
    const fail = html => { $("messages").innerHTML = html; $("plots").hidden = true; return null; };
    let r;
    try {
      r = new Thermo.Reaction(Thermo.parseReaction(state.eq, db), db);
    } catch (e) {
      $("eq-title").textContent = "Reaction not recognised";
      return fail(`<div class="msg err">Can’t read this reaction. ${esc(e.message)}</div>`);
    }
    $("eq-title").textContent = r.equation();
    const pre = REACTIONS.find(x => x.equation === state.eq);
    const note = (pre && pre.note || "").trim();
    $("eq-note").textContent = note; $("eq-note").hidden = !note; // no empty line when a reaction has no note
    if (!r.isBalanced()) {
      const off = Object.entries(r.elementBalance()).filter(([, v]) => Math.abs(v) > 1e-9);
      return fail(`<div class="msg err">This reaction is not balanced, so there is nothing to plot. Net atoms (products − reactants): ` +
        `${off.map(([el, v]) => `${el} ${v > 0 ? "+" : "−"}${+Math.abs(v).toFixed(4)}`).join(", ")}.</div>`);
    }
    const bad = [];
    if (!(T >= 200 && T <= 3000)) bad.push("Temperature must be between 200 and 3000 K.");
    if (!(P >= 0.01 && P <= 1000)) bad.push("Pressure must be between 0.01 and 1000 bar.");
    if (!(tlo >= 200 && thi <= 3000 && thi - tlo >= 10)) bad.push("Plot range must lie within 200–3000 K and span at least 10 K.");
    if (bad.length) return fail(bad.map(b => `<div class="msg err">${b}</div>`).join(""));
    if (T < tlo || T > thi) $("messages").innerHTML = `<div class="msg info">T = ${T} K is outside the plot range (${tlo}–${thi} K), so the dashed T line is off the temperature plots. Widen the range in Edit setup to see it.</div>`;
    renderPlots(r);
    return r;
  }

  if (render() && startTab) {
    // Slide links name a plot with ?tab=...; open it once on arrival.
    const id = { trends: "trends", cp: "cp", pressure: "convP" }[startTab];
    const btn = id && document.querySelector(`.open-plot[data-plot="${id}"]`);
    if (btn) { $(`card-${id}`).scrollIntoView({ block: "center" }); openPlot(id, btn); }
  }
})();
