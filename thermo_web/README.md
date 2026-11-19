# Reaction Energy Solver (website version)

A static website: a homepage, the solver, and the AI error challenge slides.
Everything runs in the browser, so it can be hosted free on Vercel or opened straight from disk.

| Page | File |
|---|---|
| Homepage with a live ΔG° example | `index.html` |
| Solver | `solver.html` (logic in `assets/js/solver.js`) |
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

## Sharing a specific setup

The solver's address updates as you change inputs (for example
`solver.html?eq=CH4+%2B+H2O(g)+-%3E+CO+%2B+3+H2&T=1000&tab=cp`), so you can bookmark the exact
reactions you want to demonstrate. The slides link to the solver the same way.
