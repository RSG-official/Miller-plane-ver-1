# Miller Plane 3D — C++ (WASM) + HTML, on GitHub Pages

A browser version of the Miller-index / intercept calculator, with the actual
math running as compiled C++ (via WebAssembly) and the 3D view drawn with
three.js.

Why WASM and not just JavaScript: GitHub Pages only serves static files — it
can't run a C++ program on a server. The standard way to "run C++ on a
webpage" is to compile it to WebAssembly (a `.wasm` binary the browser's JS
engine can execute directly) using the **Emscripten** toolchain. This repo's
GitHub Actions workflow does that compilation for you on every push, so you
never need Emscripten installed on your own machine.

## Project layout

```
.
├── src/
│   └── miller.cpp          # C++ core: gcd/lcm + intercepts <-> Miller indices
├── index.html              # page shell
├── style.css
├── app.js                  # three.js scene + UI, calls into the WASM module
└── .github/workflows/
    └── deploy.yml          # builds miller.cpp -> miller.wasm/js, deploys to Pages
```

`miller.js` / `miller.wasm` are **generated**, not checked into the repo —
the workflow builds them fresh from `src/miller.cpp` each time you push.

## 1. Push this to a new GitHub repo

```bash
cd miller-wasm-pages
git init
git add .
git commit -m "Miller plane visualizer: C++/WASM + three.js"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## 2. Turn on GitHub Pages (Actions-based)

In your repo on GitHub:
1. **Settings → Pages**
2. Under **Build and deployment → Source**, choose **GitHub Actions**.

That's it — you don't pick a branch/folder here, because the workflow itself
publishes the built `dist/` folder.

## 3. Let the workflow run

Go to the **Actions** tab. On push to `main`, `deploy.yml` will:
1. Install Emscripten (`mymindstorm/setup-emsdk`)
2. Run `emcc src/miller.cpp -O2 -o dist/miller.js ...` to produce
   `dist/miller.wasm` + `dist/miller.js`
3. Copy `index.html`, `app.js`, `style.css` into `dist/`
4. Upload `dist/` as a Pages artifact and deploy it

When it finishes, your site is live at:

```
https://<your-username>.github.io/<your-repo>/
```

(the exact URL is also shown at the top of the workflow run, and under
Settings → Pages once deployed).

## Building locally instead (optional)

If you'd rather compile on your own machine and skip Actions:

```bash
# one-time setup
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install latest && ./emsdk activate latest
source ./emsdk_env.sh
cd ..

# build
emcc src/miller.cpp -O2 -o miller.js \
  -s EXPORTED_FUNCTIONS="['_compute_gcd','_compute_lcm','_intercepts_to_miller','_miller_axis_intercept','_malloc','_free']" \
  -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap','getValue','setValue']" \
  -s MODULARIZE=1 -s EXPORT_NAME=MillerModule -s ENVIRONMENT=web -s ALLOW_MEMORY_GROWTH=1

# then just open index.html via a local static server, e.g.:
python3 -m http.server 8000
```

Note: opening `index.html` directly via `file://` will NOT work — browsers
block WASM/fetch from `file://` URLs. Always serve it over http(s), which is
exactly what GitHub Pages (and the local server command above) do.

## What's C++ vs what's JavaScript

- **C++ (`src/miller.cpp`, compiled to WASM)**: `gcd`, `lcm`, and the
  intercept ⇄ Miller-index conversion — the actual "app logic" from the
  original Android app.
- **JavaScript (`app.js`)**: three.js 3D scene setup, mouse/touch camera
  controls, and wiring the HTML form to the WASM calls. Doing full 3D
  rendering in C++ on the web would mean hand-rolling WebGL bindings for
  little benefit — three.js is the standard tool for that layer.

## Customizing

- Change the plane/axis colors in `style.css` (`--a-axis`, `--b-axis`, `--c-axis`, `--plane`).
- Add more exported C++ functions in `src/miller.cpp`, then add their names
  to `EXPORTED_FUNCTIONS` in `.github/workflows/deploy.yml` and `cwrap` them
  in `app.js`.
