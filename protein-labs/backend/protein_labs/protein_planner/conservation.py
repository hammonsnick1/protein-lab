"""ConSurf evolutionary conservation: grades-file parser and ConSurf-DB client.

ConSurf reports one conservation grade per residue on a 1-9 scale, where 9 is
the most conserved and 1 the most variable, plus a confidence interval and the
number of aligned homologues behind each estimate. Sites estimated from too few
homologues, or whose interval spans four or more grades, are marked with a `*`
in the COLOR column and must be shown as insufficient data rather than as a
trustworthy grade.

Two file layouts are in circulation and this module parses both:

* The ConSurf server writes `consurf_grades.txt` / `*.grades` with separate
  `CONFIDENCE INTERVAL` and `CONFIDENCE INTERVAL COLORS` columns, a `3LATOM`
  column formatted `MET1:A`, and a `FUNCTION` column.
* ConSurf-DB writes `consurf_summary.txt` with the interval and its grades
  merged into one tab-delimited field, an `ATOM` column formatted `MET:1:A`,
  and an `F/S` column.

Rather than trusting the column count, which varies with whether a structure
was used and whether optional columns are blank, rows are read with one regex
built around the invariants every layout shares: position, residue letter, the
PDB atom label, the normalized score, the grade, the interval and its grades,
then the optional burial/function flags, the MSA fraction and the variety.
"""

from __future__ import annotations

import json
import re
from typing import Any, Iterable

from .integrations import HttpClient, RemoteServiceError

# ConSurf's published 1-9 conservation scale plus the insufficient-data colour.
# Kept here so the engine can state the colours it means and the UI does not
# have to be the only place that knows them.
CONSURF_COLORS: dict[str, str] = {
    "1": "#10C8D1",
    "2": "#8CFFFF",
    "3": "#D7FFFF",
    "4": "#EAFFFF",
    "5": "#FFFFFF",
    "6": "#FCEDF4",
    "7": "#FAC9DE",
    "8": "#F07DAB",
    "9": "#A02560",
    "insufficient": "#FFFF96",
}

MIN_GRADE = 1
MAX_GRADE = 9

# One data row. Every group after the grade is optional because a sequence-only
# ConSurf run has no structure columns and a residue may have no variety list.
_ROW = re.compile(
    r"""^\s*
    (?P<pos>\d+)\s+
    (?P<seq>[A-Za-z*-])\s+
    (?P<atom>\S+)\s+
    (?P<score>[-+]?\d+(?:\.\d+)?)\s*(?P<score_star>\*?)\s+
    (?P<grade>\d+)\s*(?P<grade_star>\*?)
    (?P<rest>.*)$""",
    re.VERBOSE,
)
# The interval and its two grades, however they are separated.
_INTERVAL = re.compile(
    r"^\s*(?P<low>[-+]?\d+(?:\.\d+)?)\s*,\s*(?P<high>[-+]?\d+(?:\.\d+)?)"
    r"(?:\s*,?\s*(?P<low_grade>\d+)\s*,\s*(?P<high_grade>\d+))?"
)
# Burial, function, MSA fraction, then whatever variety text remains.
_TAIL = re.compile(
    r"^\s*(?:(?P<burial>[beBE])\b\s*)?(?:(?P<function>[fsFS])\b\s*)?"
    r"(?:(?P<aligned>\d+)\s*/\s*(?P<total>\d+))?\s*(?P<variety>.*)$"
)
_LAYER = re.compile(
    r"from\s+([-+]?\d+(?:\.\d+)?)\s+to\s+([-+]?\d+(?:\.\d+)?)\s+the\s+grade\s+is\s+(\d+)",
    re.IGNORECASE,
)
_DATA_CANDIDATE = re.compile(r"^\d+[\s\t]")
# `MET:1:A` (ConSurf-DB) or `MET1:A` (ConSurf server), with an optional
# insertion code on the author residue number.
_ATOM = re.compile(
    r"^(?P<residue>[A-Za-z]{1,3})\s*:?\s*(?P<number>-?\d+[A-Za-z]?)\s*:\s*(?P<chain>\S+)$"
)
_VARIETY_ITEM = re.compile(r"^(?P<residue>[A-Za-z*-])(?:\s+(?P<percent><?\s*\d+(?:\.\d+)?)\s*%)?$")

THREE_TO_ONE: dict[str, str] = {
    "ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C", "GLN": "Q",
    "GLU": "E", "GLY": "G", "HIS": "H", "ILE": "I", "LEU": "L", "LYS": "K",
    "MET": "M", "PHE": "F", "PRO": "P", "SER": "S", "THR": "T", "TRP": "W",
    "TYR": "Y", "VAL": "V", "SEC": "U", "PYL": "O", "ASX": "B", "GLX": "Z",
    "XAA": "X", "UNK": "X", "MSE": "M",
}

MALFORMED_MESSAGE = (
    "This file is not a ConSurf grades file. Protein Lab expects the "
    "\"Amino Acid Conservation Scores\" table that ConSurf writes as "
    "consurf_grades.txt, consurf_summary.txt or <name>.grades, with one row "
    "per residue holding the position, residue letter, normalized score and "
    "the 1-9 conservation grade."
)


class ConSurfParseError(ValueError):
    """A grades file that cannot be read, with an explanation for the user."""


def parse_consurf_grades(text: str, *, query_sequence: str = "") -> dict[str, Any]:
    """Read a ConSurf grades file into per-residue conservation data.

    Raises `ConSurfParseError` when no residue row can be read, so the user is
    told what was expected instead of being handed an empty result.
    """
    if not text or not text.strip():
        raise ConSurfParseError(f"The ConSurf file is empty. {MALFORMED_MESSAGE}")

    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    columns = _header_columns(lines)

    residues: list[dict[str, Any]] = []
    rejected = 0
    out_of_range: list[str] = []
    for line in lines:
        stripped = line.strip()
        # A residue row opens with the position and then whitespace. The
        # narrower test keeps legend lines such as "3LATOM: ..." from being
        # counted as rows this parser failed to read.
        if not _DATA_CANDIDATE.match(stripped):
            continue
        row = _parse_row(stripped)
        if row is None:
            rejected += 1
            continue
        if not MIN_GRADE <= row["grade"] <= MAX_GRADE:
            out_of_range.append(f"position {row['position']} has grade {row['grade']}")
            continue
        residues.append(row)

    if not residues:
        if out_of_range:
            raise ConSurfParseError(
                "Every row in this ConSurf file has a conservation grade outside "
                f"the 1-9 scale ({out_of_range[0]}). The file may be truncated or "
                "from a different tool."
            )
        detail = (
            "Its header looks like a ConSurf table but no residue rows could be read."
            if columns
            else MALFORMED_MESSAGE
        )
        raise ConSurfParseError(f"No conservation grades were found in this file. {detail}")
    if out_of_range:
        raise ConSurfParseError(
            "This ConSurf file has conservation grades outside the 1-9 scale "
            f"({', '.join(out_of_range[:3])}). Protein Lab will not guess what "
            "they mean; re-download the grades file from ConSurf."
        )

    chains = sorted({str(row["pdbChain"]) for row in residues if row["pdbChain"]})
    insufficient = sum(1 for row in residues if row["insufficientData"])
    graded = [row for row in residues if not row["insufficientData"]]
    sequence = "".join(row["residue"] for row in residues)
    # The two layouts name the structure column differently, which is the one
    # reliable way to tell them apart from the file alone.
    if "3LATOM" in columns:
        layout = "consurf-server"
    elif "ATOM" in columns:
        layout = "consurf-db"
    else:
        layout = "unknown"
    return {
        "residues": residues,
        "residueCount": len(residues),
        "insufficientDataCount": insufficient,
        "gradedCount": len(graded),
        "meanGrade": round(sum(row["grade"] for row in graded) / len(graded), 3) if graded else None,
        "chains": chains,
        "sequence": sequence,
        "layout": layout,
        "columns": columns,
        "gradeScale": _grade_scale(text),
        "skippedRowCount": rejected,
        "sequenceMatch": _sequence_match(sequence, query_sequence),
        "colors": dict(CONSURF_COLORS),
    }


def _parse_row(line: str) -> dict[str, Any] | None:
    match = _ROW.match(line)
    if match is None:
        return None
    rest = match.group("rest")
    interval = _INTERVAL.match(rest)
    low = high = low_grade = high_grade = None
    if interval is not None:
        low, high = float(interval.group("low")), float(interval.group("high"))
        if interval.group("low_grade"):
            low_grade = int(interval.group("low_grade"))
            high_grade = int(interval.group("high_grade"))
        rest = rest[interval.end():]
    tail = _TAIL.match(rest)
    burial = function = ""
    aligned = total = None
    variety_text = ""
    if tail is not None:
        burial = (tail.group("burial") or "").lower()
        function = (tail.group("function") or "").lower()
        if tail.group("aligned"):
            aligned, total = int(tail.group("aligned")), int(tail.group("total"))
        variety_text = tail.group("variety").strip().rstrip("*").strip()

    atom = match.group("atom").strip()
    pdb_residue_number, pdb_chain, atom_residue = _atom_label(atom)
    letter = match.group("seq").upper()
    if letter in {"*", "-"} and atom_residue:
        letter = atom_residue
    insufficient = bool(match.group("grade_star") or match.group("score_star"))
    return {
        "position": int(match.group("pos")),
        "residue": letter,
        "grade": int(match.group("grade")),
        "score": float(match.group("score")),
        "insufficientData": insufficient,
        "confidenceInterval": None if low is None else [low, high],
        "confidenceGrades": None if low_grade is None else [low_grade, high_grade],
        "alignedSequences": aligned,
        "totalSequences": total,
        "msaData": None if aligned is None else f"{aligned}/{total}",
        "burialState": burial,
        "functionalState": function,
        "residueVariety": variety_text,
        "varietyResidues": _variety(variety_text),
        "atomLabel": "" if atom in {"-", ""} else atom,
        "pdbResidueNumber": pdb_residue_number,
        "pdbChain": pdb_chain,
        "modelled": bool(pdb_residue_number),
    }


def _atom_label(atom: str) -> tuple[str, str, str]:
    """Split `MET:1:A` or `MET1:A` into author residue number, chain, letter."""
    if atom in {"-", ""}:
        return "", "", ""
    match = _ATOM.match(atom)
    if match is None:
        return "", "", ""
    residue = match.group("residue").upper()
    letter = THREE_TO_ONE.get(residue, residue if len(residue) == 1 else "")
    return match.group("number"), match.group("chain"), letter


def _variety(text: str) -> list[dict[str, Any]]:
    """Split a RESIDUE VARIETY cell into its residues, with percentages if given."""
    items: list[dict[str, Any]] = []
    for part in text.split(","):
        candidate = part.strip()
        if not candidate:
            continue
        match = _VARIETY_ITEM.match(candidate)
        if match is None:
            continue
        raw = (match.group("percent") or "").replace("<", "").strip()
        items.append({
            "residue": match.group("residue").upper(),
            # `<1%` is ConSurf's own rounding, so it is reported as the bound
            # it states rather than invented as a smaller number.
            "percent": float(raw) if raw else None,
            "belowOnePercent": bool(match.group("percent") and "<" in match.group("percent")),
        })
    return items


def _header_columns(lines: Iterable[str]) -> list[str]:
    """The column names, from the one line that is the table's own header.

    Matched on the tab-delimited field values rather than on the text, because
    both files carry prose legend lines that also begin with "POS" and mention
    the SEQRES sequence.
    """
    for line in lines:
        names = [part.strip().upper() for part in line.split("\t") if part.strip()]
        if len(names) > 2 and names[0] == "POS" and "SEQ" in names:
            return names
    return []


def _grade_scale(text: str) -> list[dict[str, Any]]:
    """The score window ConSurf assigned to each grade, when the file states it."""
    found = {
        int(grade): {"grade": int(grade), "from": float(low), "to": float(high)}
        for low, high, grade in _LAYER.findall(text)
    }
    return [found[grade] for grade in sorted(found, reverse=True)]


def _sequence_match(parsed: str, query_sequence: str) -> dict[str, Any]:
    """How the graded residues line up with the project's own sequence."""
    query = re.sub(r"\s+", "", query_sequence or "").upper()
    if not query:
        return {"compared": False, "queryLength": 0, "identical": None, "coverage": None}
    overlap = min(len(parsed), len(query))
    same = sum(1 for index in range(overlap) if parsed[index] == query[index])
    return {
        "compared": True,
        "queryLength": len(query),
        "gradedLength": len(parsed),
        "identical": len(parsed) == len(query) and same == len(query),
        "matchingResidues": same,
        "coverage": round(overlap / len(query), 4) if query else None,
    }


def parse_consurf_msa(text: str) -> dict[str, Any]:
    """Summarise a ConSurf MSA FASTA without keeping every aligned sequence."""
    if not text or not text.strip():
        return {"available": False, "sequenceCount": 0, "alignmentLength": 0, "queryId": "", "ids": []}
    ids: list[str] = []
    lengths: list[int] = []
    current = 0
    for line in text.replace("\r\n", "\n").split("\n"):
        if line.startswith(">"):
            if ids:
                lengths.append(current)
            current = 0
            ids.append(line[1:].strip())
        elif ids:
            current += len(line.strip())
    if ids:
        lengths.append(current)
    return {
        "available": bool(ids),
        "sequenceCount": len(ids),
        "alignmentLength": max(lengths) if lengths else 0,
        "queryId": ids[0] if ids else "",
        # The first few names are enough to show provenance in the UI; the
        # whole alignment stays available from its own endpoint.
        "ids": ids[:25],
    }


class ConSurfDbClient:
    """Pre-calculated ConSurf-DB lookups for a PDB chain or a bare sequence.

    ConSurf-DB publishes no documented API. These are the endpoints its own web
    pages call, so every method is best-effort: callers are expected to fall
    back to the guided upload flow when a lookup fails.
    """

    base_url = "https://consurfdb.tau.ac.il"
    service = "ConSurf-DB"

    def __init__(self, http: HttpClient | None = None):
        self.http = http or HttpClient(timeout=45.0)

    def chains(self, pdb_id: str) -> list[str]:
        response = self.http.request(
            "GET",
            f"{self.base_url}/find_chains/",
            params={"pdb_ID": pdb_id.strip().upper()},
            service=self.service,
        )
        value = _json_list(response.text, self.service)
        return [str(item) for item in value if str(item).strip()]

    def identical_chain(self, pdb_id: str, chain: str) -> tuple[str, str]:
        """Map a PDB chain onto the representative chain ConSurf-DB stores."""
        response = self.http.json(
            "GET",
            f"{self.base_url}/get_identical_chain/",
            params={"unique_pdb": pdb_id.strip().upper(), "unique_chain": chain.strip()},
            service=self.service,
        )
        identical_pdb = str(response.get("identical_pdb") or "").strip()
        identical_chain = str(response.get("identical_chain") or "").strip()
        if not identical_pdb or not identical_chain:
            raise RemoteServiceError(
                self.service,
                f"has no pre-calculated entry for {pdb_id.upper()} chain {chain}",
            )
        return identical_pdb, identical_chain

    def sequence_entry(self, sequence: str) -> tuple[str, str]:
        """Find the ConSurf-DB chain whose sequence matches this one exactly."""
        token, cookie = self._csrf()
        response = self.http.json(
            "POST",
            f"{self.base_url}/check_seq/",
            json_body={"sequence": re.sub(r"\s+", "", sequence).upper()},
            service=self.service,
            extra_headers={
                "X-CSRFToken": token,
                "Cookie": cookie,
                "Referer": f"{self.base_url}/",
            },
        )
        error = str(response.get("error") or "").strip()
        if error:
            raise RemoteServiceError(self.service, error)
        pdb_id = str(response.get("pdb") or "").strip()
        chain = str(response.get("chain") or "").strip()
        if not pdb_id or not chain:
            raise RemoteServiceError(
                self.service, "holds no pre-calculated analysis for this sequence"
            )
        return pdb_id, chain

    def grades(self, identical_pdb: str, identical_chain: str) -> str:
        response = self.http.json(
            "GET",
            f"{self.base_url}/Get_Score_File/",
            params={"identical_pdb": identical_pdb, "identical_chain": identical_chain},
            service=self.service,
        )
        text = str(response.get("Score_File") or "")
        if not text.strip():
            raise RemoteServiceError(
                self.service,
                f"returned no conservation scores for {identical_pdb} chain {identical_chain}",
            )
        return text

    def msa(self, identical_pdb: str, identical_chain: str) -> str:
        """The alignment ConSurf-DB used, as FASTA. Missing MSAs are not fatal."""
        try:
            response = self.http.request(
                "GET",
                f"{self.base_url}/Show_Fasta/",
                params={"identical_pdb": identical_pdb, "identical_chain": identical_chain},
                accept="text/plain",
                service=self.service,
            )
        except RemoteServiceError:
            return ""
        text = response.text.strip()
        return text if text.startswith(">") else ""

    def _csrf(self) -> tuple[str, str]:
        """ConSurf-DB's sequence lookup is a Django POST, so it needs a token."""
        response = self.http.request(
            "GET", f"{self.base_url}/", accept="text/html", service=self.service
        )
        token = response.cookies.get("csrftoken", "")
        if not token:
            raise RemoteServiceError(
                self.service, "did not issue the token its sequence lookup requires"
            )
        cookie = "; ".join(f"{name}={value}" for name, value in response.cookies.items())
        return token, cookie


def _json_list(text: str, service: str) -> list[Any]:
    try:
        value = json.loads(text)
    except json.JSONDecodeError as error:
        raise RemoteServiceError(service, "returned invalid JSON") from error
    if not isinstance(value, list):
        raise RemoteServiceError(service, "returned an unexpected response")
    return value
