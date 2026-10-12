# Protein Lab

Offline protein expression, purification, and analysis workspace. The app is an
Electron desktop shell around a React UI, with a local Python engine that does
every calculation on this computer. Nothing is sent to a server.

## Everything in this folder

    protein-lab                Launcher: runs the installed app against data/
    build-and-install.sh       Fresh dependencies → tests → build → install
    app/                       The installed app (not in git)
      Protein-Labs.AppImage
      Protein-Labs.previous.AppImage   the build it replaced, for rollback
    data/                      Your projects database, settings and logs (not in git)
      data/protein_labs.sqlite3
    archive/                   Old builds, the September prototype data and the
                               original sources (not in git)

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

The relative position of the two source directories matters: the Electron main
process looks for the engine at `../../../protein-labs/backend/dist/protein-labs-backend`
when running unpackaged.

## Using the app

Open **Protein Lab** from the app menu, or run `protein-labs` in a terminal.
Both go through `./protein-lab`, which starts `app/Protein-Labs.AppImage` with
`--user-data-dir=data`, so your projects stay in this folder. Back up `data/`
to back up everything you have made.

## Rebuilding and installing

    ./build-and-install.sh

This recreates the engine's Python environment, runs the engine tests, builds
the engine, does a clean `npm ci`, lints and type-checks the UI, packages the
AppImage, and installs it into `app/` (keeping the previous build as
`Protein-Labs.previous.AppImage`). It also points the app-menu entry and
`~/.local/bin/protein-labs` at this folder, so rerun it after moving the folder.
Close the app first; the script stops if the engine is still running.
`data/` is never touched.

## Developing

    cd protein-labs-web
    npm run desktop:run       # builds the UI bundle and opens the app

`desktop:run` uses Electron's default data directory (`~/.config/protein-labs`,
which now only holds the copy your data was moved from). To try changes on a
throwaway database, pass a scratch directory:

    npm run desktop:build:web && npx electron . --user-data-dir=/tmp/protein-lab-scratch

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

`node_modules/`, `.venv/`, build output, `app/`, `data/` and `archive/` are
kept out of git, and so is the built engine binary — it is 76 MB and reproducible from
`protein_labs/` with one PyInstaller command.

Dependencies are limited to what the app imports. The UI needs 3dmol,
class-variance-authority, clsx, lucide-react, radix-ui, react, react-dom and
tailwind-merge; everything else in `devDependencies` builds, type-checks, lints
or packages it. The Next.js, Cloudflare, Drizzle and Wrangler stack the project
started from is gone, which took the installed tree from 1.4 GB to 598 MB (287 MB of what
remains is the Electron runtime itself).
