# Protein Lab

Protein Lab is a private, offline desktop workspace for planning protein expression and purification, designing expression vectors, and analysing chromatograms and gels. The Electron/React interface talks only to a local Python engine; project data stays on the computer running the app.

![Protein Lab dashboard](protein-labs-web/desktop/public/manual/dashboard.webp)

> **Repository status:** this repository is currently private. This README describes the project in preparation for a future public release; it does not change repository visibility.

## Install a release

Download the installer for your operating system from [GitHub Releases](https://github.com/hammonsnick1/protein-lab/releases).

| Platform | Install |
| --- | --- |
| Windows | Download the `.exe` installer, run it, and follow Windows' prompts. |
| macOS | Download the `.dmg`, open it, then drag Protein Lab to Applications. |
| Ubuntu/Debian | Download the `.deb`, then install it with `sudo apt install ./Protein-Lab_*.deb`. An AppImage is also available. |
| Arch Linux | Install the release package with `sudo pacman -U protein-lab-*.pkg.tar.zst`, or use the AppImage. |

Unsigned desktop builds can trigger an operating-system warning on first launch. Only install artifacts downloaded from this repository's Releases page.

## Build from source

Prerequisites: Node.js 22+, Python 3.11+, and a platform supported by Electron Builder.

```sh
git clone https://github.com/hammonsnick1/protein-lab.git
cd protein-lab/protein-labs-web
npm ci
npm run lint
npm run typecheck
npm test
```

In a second terminal, set up and test the local engine:

```sh
cd protein-lab/protein-labs/backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest
```

See [the web-app README](protein-labs-web/README.md) for development and desktop build commands.

## Project layout

- `protein-labs-web/` — Electron desktop shell and React UI.
- `protein-labs/backend/` — local Python purification and analysis engine.
- `app/`, `data/`, and `archive/` — legacy or local-support paths; these are not published as source material.

## Contributing and security

Please read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the [Code of Conduct](CODE_OF_CONDUCT.md) before opening an issue or pull request.

## License

**TODO: a license has not yet been selected.** Until a license is added, no grant of rights is implied.
