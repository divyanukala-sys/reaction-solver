/* setup.js - the setup page. Collects inputs and opens solver.html with them as URL parameters. */
(function () {
  "use strict";
  const db = Thermo.loadSpecies(THERMO_DATA.species);
  const REACTIONS = THERMO_DATA.reactions;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------------------------------------------------------------- state (same URL parameters as solver.html)
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

  // ---------------------------------------------------------------- reaction buttons, grouped by type
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
  const current = REACTIONS.find(r => r.equation === state.eq);
  $("presets").innerHTML = GROUPS.map(g => {
    const items = REACTIONS.map((r, i) => [r, i]).filter(([r]) => groupOf(r) === g);
    if (!items.length) return "";
    const open = current && groupOf(current) === g;
    return `<details class="preset-group"${open ? " open" : ""}><summary>${g} <span class="count">${items.length}</span></summary><div class="quick">` +
      items.map(([r, i]) => `<button type="button" class="chip" data-i="${i}" title="${esc(r.equation)}">${esc(r.name)}</button>`).join("") +
      `</div></details>`;
  }).join("");
  $("species-list").innerHTML = [...db.values()]
    .map(s => `<div><code>${esc(s.id)}</code> ${esc(s.name)}</div>`).join("");

  // ---------------------------------------------------------------- sync controls with state
  function syncPreset() {
    $("presets").querySelectorAll("button").forEach(b =>
      b.setAttribute("aria-pressed", String(REACTIONS[+b.dataset.i].equation === state.eq)));
  }
  function syncQuick() {
    for (const id of ["T", "P"]) {
      $(`${id}-quick`).querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.v === state[id])));
    }
  }
  function setSeg(id, value) {
    $(id).querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === value)));
  }
  $("eq").value = state.eq; $("T").value = state.T; $("P").value = state.P;
  $("tlo").value = state.tlo; $("thi").value = state.thi;
  syncPreset(); syncQuick(); setSeg("cp", state.cp); setSeg("sroute", state.s);

  // ---------------------------------------------------------------- live check
  function check() {
    let ok = true, html;
    try {
      const r = new Thermo.Reaction(Thermo.parseReaction(state.eq, db), db);
      if (r.isBalanced()) {
        html = `<div class="msg ok"><span class="check-eq">${esc(r.equation())}</span><span>✓ Balanced</span></div>`;
      } else {
        ok = false;
        const off = Object.entries(r.elementBalance()).filter(([, v]) => Math.abs(v) > 1e-9);
        html = `<div class="msg err"><span class="check-eq">${esc(r.equation())}</span>` +
          `<span>Not balanced. Net atoms (products − reactants): ${off.map(([el, v]) => `${el} ${v > 0 ? "+" : "−"}${+Math.abs(v).toFixed(4)}`).join(", ")}.</span></div>`;
      }
    } catch (e) {
      ok = false;
      html = `<div class="msg err">Can’t read this reaction. ${esc(e.message)}</div>`;
    }
    $("eq-check").innerHTML = html;

    const { T, P, tlo, thi } = state, bad = [];
    if (!ok) bad.push("Fix the reaction first.");
    if (!(T >= 200 && T <= 3000)) bad.push("Temperature must be 200–3000 K.");
    if (!(P >= 0.01 && P <= 1000)) bad.push("Pressure must be 0.01–1000 bar.");
    if (!(tlo >= 200 && thi <= 3000 && thi - tlo >= 10)) bad.push("Plot range must lie within 200–3000 K and span at least 10 K.");
    $("calc").disabled = bad.length > 0;
    $("calc-msg").textContent = bad.join(" ");
    return bad.length === 0;
  }

  // ---------------------------------------------------------------- events
  $("presets").addEventListener("click", e => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    state.eq = REACTIONS[+b.dataset.i].equation; $("eq").value = state.eq; syncPreset(); check();
  });
  $("eq").addEventListener("input", () => { state.eq = $("eq").value; syncPreset(); check(); });
  for (const id of ["T", "P", "tlo", "thi"]) {
    $(id).addEventListener("input", () => { state[id] = parseFloat($(id).value); syncQuick(); check(); });
  }
  for (const id of ["T", "P"]) {
    $(`${id}-quick`).addEventListener("click", e => {
      const v = e.target.closest("button")?.dataset.v;
      if (v === undefined) return;
      state[id] = +v; $(id).value = v; syncQuick(); check();
    });
  }
  $("cp").addEventListener("click", e => { const v = e.target.closest("button")?.dataset.v; if (v) { state.cp = v; setSeg("cp", v); } });
  $("sroute").addEventListener("click", e => { const v = e.target.closest("button")?.dataset.v; if (v) { state.s = v; setSeg("sroute", v); } });

  $("setup-form").addEventListener("submit", e => {
    e.preventDefault();
    if (!check()) return;
    const p = new URLSearchParams();
    for (const k of KEYS) p.set(k, state[k]);
    location.href = `solver.html?${p.toString()}`;
  });

  check();
})();
