# Protein Lab

Offline protein expression, purification, and analysis workspace. The app is an
Electron desktop shell around a React UI, with a local Python engine that does
every calculation on this computer. Nothing is sent to a server.

## Layout

    protein-labs-web/          Desktop app: Electron shell, React UI, build config
      desktop/electron/        Main process; starts the engine and the window
      desktop/                 Renderer entry, window assets, Vite build config
      app/                     page.tsx and globals.css — the whole UI entry
      components/protein-labs/ The workspace: dashboard, jobs, studios, reports
      components/ui/           Shared button, dialog, tabs, progress primitives
      lib/                     Catalogues, the engine client, workflow model
      hooks/                   Browser-side integration hooks
      vendor/                  Third-party stylesheet imported by globals.css

    protein-labs/backend/      Local engine
      protein_labs/            Python package: server, planner, analysis
      tests/                   Engine test suite (62 tests)
      protein-labs-backend.spec  PyInstaller recipe that builds the engine
      dist/protein-labs-backend  The built engine (present on disk, not in git)
    protein-labs/build-omarchy.sh  Full build: engine + packaged desktop app

The relative position of the two directories matters: the Electron main process
looks for the engine at `../../../protein-labs/backend/dist/protein-labs-backend`
when running unpackaged.

## Running it

    cd protein-labs-web
    npm ci                    # restores dependencies from package-lock.json
    npm install-scripts approve electron   # lets Electron fetch its runtime
    npm run desktop:run       # builds the UI bundle and opens the app

If the engine binary is missing (a fresh clone), build it first — see *Working
on the engine* below.

`desktop:run` launches `dist/protein-labs-backend` automatically and stores data
in the platform user-data directory (`~/.config/protein-labs/data` on Linux).

## Building a distributable

    cd protein-labs
    ./build-omarchy.sh  # rebuilds the engine with PyInstaller, then packages

Or, with the engine already built, `npm run desktop:package` from
`protein-labs-web` produces a Linux AppImage.

## Working on the engine

    cd protein-labs/backend
    python3 -m venv .venv
    .venv/bin/python -m pip install -r requirements-dev.txt
    .venv/bin/python -m pytest tests -q

After changing Python code, rebuild the bundled engine so the desktop app picks
it up:

    .venv/bin/python -m pip install pyinstaller
    .venv/bin/python -m PyInstaller --noconfirm protein-labs-backend.spec

## What is not here

`node_modules/`, `.venv/`, build output and the previous Flutter prototype are
left out, and so is the built engine binary — it is 76 MB and reproducible from
`protein_labs/` with one PyInstaller command.

Dependencies are limited to what the app imports. The UI needs 3dmol,
class-variance-authority, clsx, lucide-react, radix-ui, react, react-dom and
tailwind-merge; everything else in `devDependencies` builds, type-checks, lints
or packages it. The Next.js, Cloudflare, Drizzle and Wrangler stack the project
started from is gone, which took the installed tree from 1.4 GB to 598 MB (287 MB of what
remains is the Electron runtime itself).
