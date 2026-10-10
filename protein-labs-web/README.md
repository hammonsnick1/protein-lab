# Protein Lab Desktop

The offline React + TypeScript desktop interface for Protein Lab. The packaged
application starts its bundled Python scientific engine automatically and saves
projects in the user's local application-data directory. No browser or manually
started web server is required.

## Run the portable Arch Linux build

```bash
cd ~/protein-labs-web/release
chmod +x Protein-Labs-0.2.0-x86_64.AppImage
APPIMAGE_EXTRACT_AND_RUN=1 ./Protein-Labs-0.2.0-x86_64.AppImage
```

The extraction flag runs without FUSE. Protein Lab uses native Wayland on
Arch Linux (X11 on X11 desktops), with Vulkan disabled. The window appears while
the bundled engine starts. Reopening the app focuses its existing window.
To explicitly choose a different display platform, set
`PROTEIN_LABS_OZONE_PLATFORM=wayland` or `PROTEIN_LABS_OZONE_PLATFORM=x11`.

The installed launcher opens `~/Applications/Protein-Labs.AppImage`. Local
projects remain in `~/.config/protein-labs/data/protein_labs.sqlite3`, and
startup diagnostics are in `~/.config/protein-labs/logs/desktop.log`.

## Install the native Arch Linux package

```bash
cd ~/protein-labs-web/release
sudo pacman -U ./protein-labs-0.2.0-1-x86_64.pkg.tar.zst
```

After installation, launch **Protein Lab** from the application menu or run
`protein-labs`.

## Development mode

Run both the Python engine and React frontend from the suite directory:

```bash
cd ../protein-labs
./run-web.sh
```

Open `http://127.0.0.1:5173`. The frontend connects to
`http://127.0.0.1:8770` by default. Set `NEXT_PUBLIC_PROTEIN_LABS_API` before
building or starting the frontend to use another API origin; the value is baked
into the bundle and added to the page's `connect-src` policy, so it must be set
for the build, not only at runtime.

## Expression vector design

A backbone is always loaded from a named source, and the vector keeps the
provenance it came from:

| Source | What it provides |
| --- | --- |
| SnapGene plasmid files | Curated commercial backbones with complete feature annotation. One file is fetched per explicit selection, as the plasmid page's download button does. |
| NCBI Nucleotide | Open GenBank records, searched by vector name or accession. |
| Addgene vector database | Backbone sequences without features, annotated locally after download. |
| Your own files | `.gb`, `.gbk`, `.genbank`, `.fasta` and SnapGene `.dna` files. |

The **Clone** tab lists the places the loaded backbone can take an insert —
annotated cloning sites, fusion junctions after a tag or cleavage site, and
unique restriction sites — and states for each whether an insert would land in
frame with the upstream tag. The target can be back-translated with the host's
preferred codons (optionally respelling codons to avoid chosen restriction
sites) or pasted as DNA. After insertion the report records the frame, any
padding added, and whether internal stop codons appeared.

## Construct mass and extinction coefficient

Choosing an affinity tag and a protease in the purification planner assembles
the real construct and recalculates its properties with the same ProtParam code
used for the native protein: the expressed fusion, the product left after tag
cleavage (including any scar residues the protease leaves behind), and the
released tag fragment. Short peptide tags carry their published sequences;
large fusion partners such as GST, MBP and SUMO are resolved from the selected
vector's annotated CDS or from a pasted sequence, never from a built-in guess.

## Acceptance verification

The reproducible 8U0I workflow check is in
`../protein-labs/backend/scripts/verify_8u0i_workflow.py`; the latest result is
recorded in `docs/verification-8u0i.json`.
