# Protein Lab Desktop

The offline React + TypeScript desktop interface for Protein Lab. The packaged
application starts its bundled Python scientific engine automatically and saves
projects in the user's local application-data directory. No browser or manually
started web server is required.

## Running and building

Installing, launching and rebuilding are covered in the
[top-level README](../README.md): `./build-and-install.sh` builds and installs
the app, and `./protein-lab` runs it with its data kept in `data/`.

Protein Lab uses native Wayland on Omarchy (X11 on X11 desktops), with Vulkan
disabled. To choose a different display platform, set
`PROTEIN_LABS_OZONE_PLATFORM=wayland` or `PROTEIN_LABS_OZONE_PLATFORM=x11`.

The UI connects to the engine at `http://127.0.0.1:8770`. Set
`NEXT_PUBLIC_PROTEIN_LABS_API` before building to use another API origin; the
value is baked into the bundle and added to the page's `connect-src` policy, so
it must be set for the build, not only at runtime.

## Development checks

With Node.js 22.13 or newer, run `npm ci` in this directory, then:

```sh
npm run lint
npm run typecheck
npm test
```

Node's built-in test runner runs `lib/*.test.ts`. The initial tests cover the
shared class-name helper, including Tailwind conflict resolution. Add tests
beside the code they exercise. Backend checks run separately from
`protein-labs/backend/`: install `requirements-dev.txt`, then run
`python -m pytest`.

GitHub Actions runs each of these four checks on every pull request to `main`.

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
