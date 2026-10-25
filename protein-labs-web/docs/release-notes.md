**Warning, project is in beta testing. There may be incorrect information or inaccessable features.**

Protein Lab runs entirely on your computer: the desktop app starts its own
scientific engine, and your projects never leave the machine.

## New in this beta

- Sequence research: BLAST results window with pairwise alignments, a
  multiple sequence alignment viewer, and live search progress.
- Protein properties: click a residue to see its details; N→C sequence labels
  and the oligomeric state.
- Protein readiness: a clear verdict with grouped checks.
- Structure Viewer: load any PDB hit from Sequence research or type a PDB ID;
  legends and PNG export.
- Vector and protein library: one dashboard tile, two tabs.
- Purification: buffer composer with a component library, lysis buffer
  suggestion, and an expression host catalog.
- Gels: integrated density shows its units; auto lane detection keeps sparse
  lanes apart.

## Which file to download

| System | File |
| --- | --- |
| Windows 10/11 (64-bit) | `Protein-Labs-<version>-x64.exe` |
| macOS, Apple silicon (M1 and later) | `Protein-Labs-<version>-arm64.dmg` |
| macOS, Intel | `Protein-Labs-<version>-x64.dmg` |
| Ubuntu / Debian | `Protein-Labs-<version>-amd64.deb` |
| Arch Linux | `protein-labs-<version>-1-x86_64.pkg.tar.zst` |
| Any other Linux | `Protein-Labs-<version>-x86_64.AppImage` |

## Installing

Step-by-step guides for macOS, Windows, Ubuntu and Arch Linux are in the
[README](https://github.com/hammonsnick1/protein-lab#download-and-install).

**Windows.** Run the `.exe` and follow the installer. It installs for your
user only, so no administrator rights are needed. Windows SmartScreen may warn
that the publisher is unknown, because the installer is not code-signed:
choose **More info → Run anyway**.

**macOS.** Open the `.dmg` and drag **Protein Lab** into **Applications**.
The app is not notarized by Apple, so the first launch is blocked:

1. Open Protein Lab once; macOS says it cannot verify the developer. Click **Done**.
2. Open **System Settings → Privacy & Security**, scroll to *Security*, and
   click **Open Anyway** next to the Protein Lab message.
3. Confirm with **Open Anyway** and your password. Later launches open normally.

**Ubuntu / Debian.**

```sh
sudo apt install ./Protein-Labs-<version>-amd64.deb
```

**Arch Linux.**

```sh
sudo pacman -U protein-labs-<version>-1-x86_64.pkg.tar.zst
```

**AppImage (any distribution).**

```sh
chmod +x Protein-Labs-<version>-x86_64.AppImage
./Protein-Labs-<version>-x86_64.AppImage
```

If your system has no FUSE 2, run it with `APPIMAGE_EXTRACT_AND_RUN=1`.

The packaged apps start **Protein Lab** from the app menu or Start menu, and
`protein-labs` from a terminal on Linux. Projects are stored in your user
profile, and **File → Set project directory…** moves them anywhere you like.
