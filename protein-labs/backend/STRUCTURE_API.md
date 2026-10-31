# Structure Viewer API

The Structure Viewer contract is under the existing Protein Planner v1 API.
All sequence positions are one-based. A value that cannot be mapped is JSON
`null`; clients must not infer it from neighbouring residues.

## List structures

`GET /v1/protein-planner/proteins/{proteinId}/structures?limit=10`

```json
{
  "proteinId": "...",
  "referenceAccession": "P01542",
  "structures": [
    {
      "id": "1CRN",
      "source": "pdb",
      "format": "cif",
      "title": "...",
      "method": "X-RAY DIFFRACTION",
      "resolutionAngstrom": 1.5,
      "chains": [
        {"chainId": "A", "labelChainId": "A", "residueCount": 46, "modeledResidueCount": 46}
      ],
      "ligands": [],
      "accession": "P01542",
      "siftsAvailable": true,
      "mappedChains": ["A"],
      "sourceUrl": "https://www.rcsb.org/structure/1CRN"
    }
  ],
  "errors": []
}
```

The list combines RCSB accession search and metadata with PDBe SIFTS mappings.
AlphaFold DB models already fetched for the project are included as
`source: "alphafold_db"`. Ligands are individual instances, not CCD-level
aggregates. Water and common crystallisation additives remain in `ligands`.

External requests have finite timeouts and a 15-minute in-process cache. A
failed optional source adds an error and leaves all usable results intact:

```json
{"source": "PDBe SIFTS", "code": "RemoteServiceError", "message": "...", "retryable": true}
```

## Fetch coordinates and mapping

`GET /v1/protein-planner/proteins/{proteinId}/structures/{source}/{structureId}`

`source` is `pdb` or `alphafold_db`. The response includes the full mmCIF in
`structureText`, `format: "cif"`, structure metadata, and:

```json
{
  "mapping": {
    "numbering": {
      "positionsAreOneBased": true,
      "construct": "user construct residue position",
      "uniprot": "UniProt reference residue position",
      "labelSeqId": "mmCIF label_seq_id",
      "authSeqId": "mmCIF auth_seq_id; insertionCode is separate",
      "unmappedValues": null
    },
    "residues": [
      {
        "constructPosition": 7,
        "uniprotPosition": 1,
        "chainId": "A",
        "labelChainId": "A",
        "labelSeqId": 1,
        "authSeqId": "1",
        "insertionCode": null,
        "constructResidue": "M",
        "uniprotResidue": "M",
        "structureResidue": "M",
        "modeled": true,
        "mismatch": false
      }
    ]
  }
}
```

Construct-to-UniProt numbering comes from a protein alignment with free
terminal gaps, so affinity tags remain unmapped and substitutions are flagged.
PDB-to-UniProt numbering comes only from explicit SIFTS segments. AlphaFold DB
uses its documented one-to-one UniProt model numbering. The mmCIF polymer
scheme preserves unmodelled residues and insertion codes.

## Regions of interest

`GET /v1/protein-planner/proteins/{proteinId}/structures/{source}/{structureId}/regions`

```json
{
  "numbering": {"positionsAreOneBased": true},
  "parameters": {
    "disulfideSgCutoffAngstrom": 2.3,
    "ligandContactCutoffAngstrom": 5.0,
    "lowPlddtThreshold": 50.0,
    "hydrophobicity": {"scale": "Kyte-Doolittle", "window": 9, "threshold": 1.6},
    "surfaceHydrophobicity": {"method": "ca_neighbor_proxy", "contactRadiusAngstrom": 10.0, "maxNeighbors": 16}
  },
  "groups": [
    {
      "id": "ligand:A:262::ZN:1",
      "type": "ligand_binding_site",
      "label": "ZN A 262",
      "description": "Protein residues within 5.0 Å of this ligand instance.",
      "defaultVisible": true,
      "residues": [],
      "metadata": {
        "name": "ZINC ION",
        "ccdId": "ZN",
        "chainId": "A",
        "labelChainId": "B",
        "authSeqId": "262",
        "insertionCode": null,
        "classification": "ligand",
        "minimumDistanceAngstrom": 1.91
      }
    }
  ],
  "errors": []
}
```

Every region residue uses the same mapping row shape as the structure endpoint.
Only modelled residues are returned for highlighting. Sequence-derived groups
(`hydrophobic_sequence`, `disorder_uniprot`, and the `reference_*` types) are
still returned when some or all of their positions cannot be highlighted. Their
`metadata.unmappedPositions` is the sorted list of one-based UniProt positions
that have no modelled structure residue; it is `[]` when the region is fully
mapped. A fully unmapped group therefore has `residues: []` rather than being
omitted. Region `type` values are:

- `cysteines` and `disulfide` (geometry, SG–SG ≤ 2.3 Å)
- `hydrophobic_sequence` and `hydrophobic_surface`
- `disorder_uniprot` and `disorder_low_plddt` (never merged; pLDDT is only
  interpreted for AlphaFold DB structures)
- `ligand_binding_site`, one per ligand instance; `water` and
  `common_additive` classifications default off
- `reference_ptm`, `reference_binding_site`, `reference_domain`, and
  `reference_transmembrane` from the selected UniProt match

The surface group uses a documented fast Cα-neighbour exposure proxy, not a
solvent-accessible surface-area calculation.

## Conservation

Per-residue ConSurf conservation grades live under
`/v1/protein-planner/proteins/{proteinId}/conservation` and are documented in
[CONSERVATION_API.md](CONSERVATION_API.md). Residue identity there is the
author residue number plus chain (`pdbResidueNumber`, `pdbChain`), the same
pair this contract uses, so a viewer can colour a structure by conservation
without going back through sequence positions. Residues with
`modelled: false` have a grade but no coordinates and must be skipped.
