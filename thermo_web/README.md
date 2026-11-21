# Reaction Energy Solver (website version)

A static website: a homepage, the solver (in three steps: setup, values, plots), and the AI error challenge slides.
Everything runs in the browser, so it can be hosted free on Vercel or opened straight from disk.

| Page | File |
|---|---|
| Homepage with a live ΔG° example | `index.html` |
| Solver, step 1: choose the reaction, T, P, plot range and model | `setup.html` (logic in `assets/js/setup.js`) |
| Solver, step 2: ΔH°, ΔS°, ΔG°, K and conversion, plus tables and method | `solver.html` (logic in `assets/js/solver.js`) |
| Solver, step 3: plots, each with a full-size pop-up and CSV download | `plots.html` (logic in `assets/js/plots.js`) |
| AI error challenge slides | `errors.html` (logic in `assets/js/slides.js`) |
| Calculation engine | `assets/js/thermo.js` (line-for-line port of the Python `thermo.py`) |
| Species and reaction data | `data/species.csv`, `data/reactions.csv` → generated into `assets/js/data.js` |
| Chart library (bundled, works offline) | `assets/vendor/chart.umd.js` (Chart.js 4.4.6, MIT licence) |

## Put it on Vercel (about 5 minutes)

1. Create a free account at github.com and make a new repository (public or private).
2. Upload **the contents** of this folder so that `index.html` sits at the top level of the repository,
   not inside a subfolder. Drag the files and folders onto the repository page and commit.
3. Sign in at vercel.com with your GitHub account, choose **Add New → Project**, and import the repository.
4. Leave the framework preset as **Other**, with no build command and no output directory. Click **Deploy**.
5. You get a link like `https://your-project.vercel.app`. Every later commit to GitHub redeploys automatically.

Alternative with Node.js installed: run `npx vercel` in this folder, then `npx vercel --prod`.

## Use it offline (for the classroom, in case the Wi-Fi fails)

Double-click `index.html`. Everything works except the web fonts, which fall back to system fonts.
In the slides: arrow keys or click to move, F for full screen.

## Change the data

1. Edit `data/species.csv` or `data/reactions.csv`.
2. Run `python tools/build_data.py` to regenerate `assets/js/data.js`.
3. Run `node tests/engine.test.js` and check that every line says PASS.

Before submitting, check each species row against Appendix C of your edition of Smith, Van Ness & Abbott.
The slides recompute every number from the data, so they update automatically.

## How the solver pages fit together

1. **Setup** (`setup.html`): pick a predefined reaction or type your own. A live check shows the
   formatted equation, or the atom imbalance or unknown species. **Calculate** opens the values page.
2. **Values** (`solver.html`): the results at 298.15 K and at your T and P, a plain-language verdict,
   and collapsible sections for the sensible-heat breakdown, method equations and species data.
   The bar at the top lets you change the reaction, T or P in place. **View plots** opens the plots page.
3. **Plots** (`plots.html`): one card per plot. The dashed line on each plot marks your T (or P) and is
   labelled with the values there. **Back to values** and **Edit setup** keep everything you chose.

Opening `solver.html` or `plots.html` with no settings in the address sends you to the setup page.

## Sharing a specific setup

All three pages carry the same settings in the address: `eq`, `T`, `P`, `tlo`, `thi`, `cp` and `s`, for example
`solver.html?eq=CH4+%2B+H2O(g)+-%3E+CO+%2B+3+H2&T=1000&P=1`. **Copy link** on the values page copies the
exact setup, so you can bookmark the reactions you want to demonstrate.

The slides link to the solver the same way. An extra `tab` setting opens a particular view:
`tab=trends`, `tab=cp` or `tab=pressure` go to the plots page with that plot open, and
`tab=sens`, `tab=method` or `tab=data` open that section on the values page.
