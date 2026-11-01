#!/usr/bin/env python3
"""Write `lib/space-group-table.ts` from gemmi's space-group tables.

gemmi (MPL-2.0) carries the International Tables Vol. A settings with Hall
symbols in the sgtbx convention. Running this script needs gemmi, which the app
itself does not depend on:

    python3 -m venv /tmp/gemmi && /tmp/gemmi/bin/pip install gemmi==0.7.5
    /tmp/gemmi/bin/python protein-labs-web/scripts/generate-space-groups.py

One row per ITA number: the reference setting, which is the setting the
diagrams and the operator lists are drawn in. Operators are stored the way
gemmi (and CCP4) store them — coset representatives without the centring
translations, plus the centring translations themselves — so the file stays
small and the runtime multiplies the two lists back together.

The 11 enantiomorphic pairs are from International Tables Vol. A (2016),
Table 3.1.1.1; gemmi flags a group as enantiomorphic but does not name its
partner.
"""

from __future__ import annotations

import sys
from fractions import Fraction
from pathlib import Path

import gemmi

OUTPUT = Path(__file__).resolve().parent.parent / "lib" / "space-group-table.ts"

ENANTIOMORPHIC_PAIRS = [
    (76, 78), (91, 95), (92, 96), (144, 145), (151, 153), (152, 154),
    (169, 170), (171, 172), (178, 179), (180, 181), (212, 213),
]

CRYSTAL_SYSTEMS = {
    "triclinic", "monoclinic", "orthorhombic", "tetragonal", "trigonal", "hexagonal", "cubic",
}


def partner_of(number: int) -> int | None:
    for left, right in ENANTIOMORPHIC_PAIRS:
        if number == left:
            return right
        if number == right:
            return left
    return None


def short_symbol(table: gemmi.SpaceGroup) -> str:
    """"P212121", "P21", "R3" — the form a crystallographer writes by hand.

    gemmi returns the CCP4 spelling, which writes the rhombohedral groups in
    their hexagonal setting as "H…"; protein crystallography says "R…".
    """
    name = table.short_name()
    if table.centring_type() == "R" and name.startswith("H"):
        return "R" + name[1:]
    return name


def triplet(op: gemmi.Op) -> str:
    return op.triplet()


def centring_triplets(group_ops: gemmi.GroupOps) -> list[str]:
    out = []
    for translation in group_ops.cen_ops:
        parts = []
        for value in translation:
            fraction = Fraction(value, gemmi.Op.DEN)
            parts.append(str(fraction))
        out.append(",".join(parts))
    return out


def ts_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def main() -> int:
    rows = [table for table in gemmi.spacegroup_table() if table.is_reference_setting()]
    if len(rows) != 230:
        raise SystemExit(f"expected 230 reference settings, got {len(rows)}")
    sohncke = [table for table in rows if table.is_sohncke()]
    if len(sohncke) != 65:
        raise SystemExit(f"expected 65 Sohncke groups, got {len(sohncke)}")

    lines: list[str] = []
    for table in rows:
        group_ops = table.operations()
        system = table.crystal_system_str()
        if system not in CRYSTAL_SYSTEMS:
            raise SystemExit(f"unexpected crystal system {system!r} for {table.hm}")
        fields = [
            f"n:{table.number}",
            f"hm:{ts_string(table.hm.strip())}",
            f"short:{ts_string(short_symbol(table))}",
            f"hall:{ts_string(table.hall.strip())}",
            f"system:{ts_string(system)}",
            f"pointGroup:{ts_string(table.point_group_hm())}",
            f"laue:{ts_string(table.laue_str())}",
            f"centring:{ts_string(table.centring_type())}",
            f"sohncke:{'true' if table.is_sohncke() else 'false'}",
            f"pair:{partner_of(table.number) or 'null'}",
            "ops:[" + ",".join(ts_string(triplet(op)) for op in group_ops.sym_ops) + "]",
            "cen:[" + ",".join(ts_string(value) for value in centring_triplets(group_ops)) + "]",
        ]
        lines.append("  { " + ", ".join(fields) + " },")

    header = f"""// Generated file — do not edit by hand.
// Written by `scripts/generate-space-groups.py` from gemmi {gemmi.__version__}
// (https://github.com/project-gemmi/gemmi, MPL-2.0), whose tables follow
// International Tables for Crystallography Vol. A and the sgtbx Hall symbols.
// Re-run the script to regenerate; see `lib/space-groups.ts` for the readers.
//
// One row per ITA space-group number, in its reference setting:
// `ops` are the coset representatives without the centring translations and
// `cen` the centring translations, so the full group is every `ops` entry
// combined with every `cen` entry ({sum(len(t.operations().sym_ops) * len(t.operations().cen_ops) for t in rows)} operations across the 230 groups).

/** A row of the generated table. Field names are short to keep the file small. */
export type SpaceGroupRow = {{
  /** ITA space-group number, 1–230. */
  n: number;
  /** Hermann–Mauguin symbol with spaces, as the PDB writes it, e.g. "P 21 21 21". */
  hm: string;
  /** The same symbol written short, e.g. "P212121". */
  short: string;
  /** Hall symbol of this setting. */
  hall: string;
  system: "triclinic" | "monoclinic" | "orthorhombic" | "tetragonal" | "trigonal" | "hexagonal" | "cubic";
  /** Point group in Hermann–Mauguin form, e.g. "222". */
  pointGroup: string;
  /** Laue class, e.g. "mmm". */
  laue: string;
  /** Lattice centring letter: P, A, B, C, I, F or R. */
  centring: string;
  /** True for the 65 groups without any operation that mirrors the structure. */
  sohncke: boolean;
  /** The other member of an enantiomorphic pair (e.g. 76 ↔ 78), else null. */
  pair: number | null;
  /** Coset representatives as "x,y,z" triplets, the identity first. */
  ops: string[];
  /** Centring translations as "0,0,0" triplets, the origin first. */
  cen: string[];
}};

export const SPACE_GROUP_ROWS: readonly SpaceGroupRow[] = [
"""
    OUTPUT.write_text(header + "\n".join(lines) + "\n];\n", encoding="utf-8")
    print(f"wrote {OUTPUT} ({len(rows)} groups, {len(sohncke)} Sohncke)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
