# Archive preservation proposal

Read-only inventory on 2026-10-13 using `du -h -d 2 archive` and immediate-child listing. Sizes are allocated disk usage, rounded; totals need not add exactly. No file contents were altered, compressed, moved, or deleted. This is a proposal for the owner, not authorization to execute cleanup.

| Path under archive/ | Size | Recommendation | Reason and conditions |
| --- | ---: | --- | --- |
| builds/ | 590 MiB | Keep | Three historical runnable builds provide rollback/reference value. Already packaged; compression is unlikely to recover much space. |
| prototype-data-2026-09/ | 103 MiB | Keep | Contains experiment SQLite database and sidecars, AlphaFold submissions directory, and a 103 MiB backend environment. Preserve the complete snapshot and provenance; do not delete user material. |
| codex-outputs-2026-09-06/chromatogram-studio/ | 181 MiB | Compress | Historical prototype source/build snapshot. Owner may approve lossless archival only after checking for unique experiments and verifying a restorable backup. |
| codex-outputs-2026-09-06/chromatogram_studio_ui/ | 875 MiB | Compress | Same preservation conditions; do not assume duplication from the name alone. |
| codex-outputs-2026-09-06/protein-labs/ | 1.3 GiB | Compress | Preserve historical source and any embedded data together. Compression ratio has not been measured. |
| codex-outputs-2026-09-06/protein-labs-web/ | 2.6 GiB | Compress | Largest snapshot; first candidate for an owner-approved lossless archive and restore verification. |
| codex-outputs-2026-09-06/protein-labs-video/ | 956 MiB | Keep | Media may already be compressed and may represent unique user work. |
| codex-outputs-2026-09-06/*.zip (3 files) | 9.56 MiB apparent total | Keep | Already compressed historical distributions/source. No content equivalence was proven. |
| **Total archive/** | **6.6 GiB** | **Keep pending owner decision** | No deletions proposed or performed. |

Build filenames: `Protein-Labs-2026-10-08.AppImage`, `Protein-Labs-2026-10-09.AppImage`, and `protein-labs-2026-10-07.bin`. Prototype data includes `protein_labs.sqlite3`, `protein_labs.sqlite3-shm`, and `protein_labs.sqlite3-wal`; treat the database and sidecars as one preservation unit.

Next action: owner decides whether to commission compression of selected source snapshots. Any future work must preserve all experiment material and verify checksums/restore before considering an owner-managed relocation. Compression without removing originals needs additional free space and does not immediately reclaim disk space. No deletion or deduplication is justified by this inventory.
