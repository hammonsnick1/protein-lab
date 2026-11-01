# Third-party notices

<!--
How to add a section (one per upstream whose code is copied or bundled):

## <Project name>

<What Protein Labs uses it for, and which file(s) adapt or bundle it.>
Version or commit: `<tag or full SHA>`

Source: <repository URL>
Licence: <SPDX id, e.g. MIT, BSD-3-Clause, Apache-2.0>

<Copyright line exactly as upstream writes it>

<Full licence text, copied verbatim from upstream's LICENSE file>

Then add or update the matching entry in protein-labs-web/lib/citations.ts
(its `license` field), so the in-app Licences list and the register below agree.
Code that is only studied or cited needs a register row, not a full section.
-->

## Licence register

Upstream tools and resources the app cites, studies or bundles. The in-app
Licences list reads the same data from `protein-labs-web/lib/citations.ts`.

| Source | Licence | Reuse | How the app uses it |
| --- | --- | --- | --- |
| Mol* (https://github.com/molstar/molstar) | MIT | Allowed with notice | Bundled as the 3D structure viewer; notice below. |
| OpenCloning backend (https://github.com/OpenCloning/OpenCloning_backend) | MIT | Allowed with notice | Vector builder conventions adapted; notice below. |
| RDKit (https://github.com/rdkit/rdkit) | BSD-3-Clause | Allowed with notice | Bundled in the engine for 2D ligand drawing and R/S, E/Z labels, with the native libraries its wheel carries; notices below. |
| Biopython (https://github.com/biopython/biopython) | Biopython License Agreement | Allowed with notice | Bundled in the engine; reads mmCIF files, including ligand definitions for 2D drawing; notice below. |
| LEGOLAS (https://github.com/roitberg-group/legolas) | MIT | Allowed with notice | Method studied and cited; no code copied yet. |
| UCBShift 2.0 (https://github.com/THGLab/CSpred) | UC Regents, not-for-profit only | Restricted | Method studied and cited; no code shipped. Wishart 1995 random-coil values read from its transcription; see below. |
| SHIFTX2 (http://www.shiftx2.ca) | No licence published | Cite only | Optional operator-installed HSQC predictor; not bundled or installed. |
| Shoebill (https://github.com/KJ-Liao/Shoebill) | No licence file | Cite only | Method studied and cited; no code copied. |
| UCL space-group diagrams (http://img.chem.ucl.ac.uk/sgp/mainmenu.htm) | © 1997–1999 Birkbeck College | Cite only | Visual model only; the app draws its own diagrams. |
| gemmi (https://github.com/project-gemmi/gemmi) | MPL-2.0 | Allowed with notice | Space-group table generated from gemmi 0.7.5; notice below. |

## RDKit

The backend 2D ligand depiction (`protein-labs/backend/protein_labs/protein_planner/ligand_depiction.py`)
calls RDKit to perceive stereochemistry and draw the SVG; no RDKit source is copied.
Version or commit: `Release_2025_09_6` (requirement `rdkit>=2024.3,<2026`)

Source: https://github.com/rdkit/rdkit
Licence: BSD-3-Clause

Copyright (c) 2006-2015, Rational Discovery LLC, Greg Landrum, and Julie Penzotti and others
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

### Libraries bundled inside the RDKit wheel

The engine is built with PyInstaller from the PyPI `rdkit` wheel, so the
packaged engine carries every native library that wheel ships, not only RDKit
itself. Versions below are for `rdkit` 2025.9.6 (`Release_2025_09_6`, read from
`External/*/CMakeLists.txt` and the wheel's own file list and SBOM).

Compiled into the RDKit libraries on every platform:

| Component | Version | Licence | Copyright | Source |
| --- | --- | --- | --- | --- |
| Boost (`libboost_*`, `boost_*.dll`) | 1.85.0 on Linux; Windows and macOS wheels do not state it | BSL-1.0 | Boost contributors (per file) | https://www.boost.org |
| InChI | 1.07.3 | MIT | Copyright (c) 2024 InChI Project | https://github.com/IUPAC-InChI/InChI |
| Avalon Toolkit | 2.0.5-pre.3 | BSD-3-Clause | Copyright 2001-2011 Novartis Pharma AG. All rights reserved. | https://github.com/rdkit/ava-formake |
| coordgenlibs | 3.0.2 | BSD-3-Clause | Copyright (c) 2017, Schrödinger, Inc. | https://github.com/schrodinger/coordgenlibs |
| maeparser | 1.3.3 | MIT | Copyright 2017 Schrödinger, LLC | https://github.com/schrodinger/maeparser |
| FreeSASA | 2.0.3 | MIT | Copyright (c) 2016 Simon Mitternacht | https://github.com/mittinatten/freesasa |
| RingDecomposerLib | 1.1.3_rdkit | BSD-3-Clause | Copyright (c) 2016 University of Hamburg, ZBH - Center for Bioinformatics, Niek Andresen, Florian Flachsenberg, Matthias Rarey. All rights reserved. | https://github.com/rareylab/RingDecomposerLib |
| YAeHMOP | 2025.03.2 | BSD-2-Clause | Copyright (C) 1995 Greg Landrum. All rights reserved. | https://github.com/greglandrum/yaehmop |
| Revvity ChemDraw reader (with bundled expat/expatpp) | 1.0.12 | BSD-3-Clause | Copyright (c) 1986-2025, Revvity Inc, CambridgeSoft Corp and others. | https://github.com/Glysade/chemdraw |
| pubchem-align3d | RDKit-pinned commit | Public domain (United States Government Work, NCBI) | none | https://github.com/ncbi/pubchem-align3d |
| Eigen (header-only, compiled in) | RDKit-pinned | MPL-2.0 | Eigen contributors | https://gitlab.com/libeigen/eigen |
| rdkit-pypi wheel build scripts | 2025.9.6 | MIT | Copyright (c) 2022 Christopher Kuenneth | https://github.com/kuelumbus/rdkit-pypi |

Shared libraries the wheel adds on Linux (manylinux_2_28, from its auditwheel SBOM):

| Component | Version | Licence |
| --- | --- | --- |
| cairo | 1.15.12 | LGPL-2.1-only OR MPL-1.1; Protein Labs uses it under MPL-1.1 |
| fontconfig | 2.13.1 | HPND-sell-variant (MIT-style), Copyright © 2000-2007 Keith Packard and others |
| FreeType | 2.9.1 | FTL OR GPL-2.0-or-later; used under the FreeType License (FTL) |
| pixman | 0.38.4 | MIT |
| libpng | 1.6.34 | Libpng |
| bzip2 (`libbz2`) | 1.0.6 | bzip2-1.0.6, Copyright (C) 1996-2010 Julian R Seward |
| libquadmath (GCC) | 8.5.0 | LGPL-2.1-or-later |
| libuuid (util-linux) | 2.32.1 | BSD-3-Clause |
| libxcb, libxcb-render, libxcb-shm | 1.13.1 | X11 |
| libXau | 1.0.9 | MIT-open-group |

On Windows the wheel adds cairo, fontconfig, FreeType, libpng, pixman and bzip2
(licences as above), plus brotli (MIT), expat (MIT), zlib (Zlib) and the
Microsoft Visual C++ runtime `msvcp140.dll` (Microsoft Visual C++
Redistributable licence). The macOS wheels add only Boost and the RDKit
libraries.

FreeType credit, as its licence requires: Portions of this software are
copyright © The FreeType Project (www.freetype.org). All rights reserved.

The BSD-3-Clause components carry the same licence text as RDKit above, with
their own copyright line from the table. The MIT and BSL-1.0 texts are:

MIT: Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions: The above copyright
notice and this permission notice shall be included in all copies or
substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT
WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR
THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Boost Software License - Version 1.0 - August 17th, 2003

Permission is hereby granted, free of charge, to any person or organization
obtaining a copy of the software and accompanying documentation covered by
this license (the "Software") to use, reproduce, display, distribute,
execute, and transmit the Software, and to prepare derivative works of the
Software, and to permit third-parties to whom the Software is furnished to
do so, all subject to the following:

The copyright notices in the Software and this entire statement, including
the above license grant, this restriction and the following disclaimer,
must be included in all copies of the Software, in whole or in part, and
all derivative works of the Software, unless such copies or derivative
works are solely in the form of machine-executable object code generated by
a source language processor.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT. IN NO EVENT
SHALL THE COPYRIGHT HOLDERS OR ANYONE DISTRIBUTING THE SOFTWARE BE LIABLE
FOR ANY DAMAGES OR OTHER LIABILITY, WHETHER IN CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.

The full texts of the other licences named above are at
https://spdx.org/licenses/ under each SPDX identifier.

## Biopython

The engine imports Biopython throughout, and `protein-labs-backend.spec` bundles
it with `collect_all('Bio')`. The 2D ligand depiction
(`protein-labs/backend/protein_labs/protein_planner/ligand_depiction.py`) reads
Chemical Component Dictionary records with `Bio.PDB.MMCIF2Dict`. No Biopython
source is copied.
Version: `1.88` (requirement `biopython>=1.85,<2`)

Source: https://github.com/biopython/biopython
Licence: Biopython License Agreement (some files dual-licensed BSD-3-Clause)

Biopython is currently released under the "Biopython License Agreement"
(given in full below). Unless stated otherwise in individual file headers,
all Biopython's files are under the "Biopython License Agreement".

Some files are explicitly dual licensed under your choice of the
"Biopython License Agreement" or the "BSD 3-Clause License" (both given
in full below). This is with the intention of later offering all of
Biopython under this dual licensing approach.

Biopython License Agreement

Permission to use, copy, modify, and distribute this software and its
documentation with or without modifications and for any purpose and
without fee is hereby granted, provided that any copyright notices
appear in all copies and that both those copyright notices and this
permission notice appear in supporting documentation, and that the
names of the contributors or copyright holders not be used in
advertising or publicity pertaining to distribution of the software
without specific prior permission.

THE CONTRIBUTORS AND COPYRIGHT HOLDERS OF THIS SOFTWARE DISCLAIM ALL
WARRANTIES WITH REGARD TO THIS SOFTWARE, INCLUDING ALL IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS, IN NO EVENT SHALL THE
CONTRIBUTORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY SPECIAL, INDIRECT
OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE
OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE
OR PERFORMANCE OF THIS SOFTWARE.

BSD 3-Clause License

Copyright (c) 1999-2025, The Biopython Contributors
All rights reserved.

The remaining BSD-3-Clause conditions and disclaimer are identical to the
RDKit text above.

## Shoebill (not distributed)

Protein Labs does not copy, redistribute, or execute Shoebill code or model
weights. The public repository was examined on 2026-10-31 and has no license
file, so it is unavailable pending an explicit usable license from its authors.
Source: https://github.com/KJ-Liao/Shoebill

## UCBShift 2.0 / CSpred (optional external NMR predictor)

Protein Labs does not distribute, install, or bundle CSpred or UCBShift 2.0.
The external-command adapter is available only to an operator who has separately
obtained the predictor and verified that the intended deployment is within the
upstream license's educational, research, and not-for-profit grant. The source
license is non-commercial and has no SPDX identifier; it is not suitable for
general commercial redistribution without permission from UC Berkeley's Office
of Technology Licensing.

Random-coil values: the HSQC random-coil fallback (`protein-labs/backend/protein_labs/nmr.py`)
uses the measured amide ¹H/¹⁵N values of Wishart et al., J Biomol NMR 5:67-81 (1995).
That paper is paywalled, so the numbers were read from its transcription in
CSpred's `ucbshifty.py`. Only those published measurements are reused; no
CSpred code, structure or other data is copied.

Source and license: https://github.com/THGLab/CSpred/blob/master/LICENSE.txt

Copyright © 2020 The Regents of the University of California. Permission to
use, copy, modify, and distribute the software and documentation for
educational, research, and not-for-profit purposes, without fee and without a
signed licensing agreement, is granted provided the required notices are
retained. The software is provided "AS IS" without warranty.

## LEGOLAS (optional external NMR predictor)

Protein Labs does not distribute LEGOLAS. When an operator installs it for the
HSQC adapter, the adapter consumes its documented CSV output. LEGOLAS source is
MIT licensed, Copyright (c) 2024 Roitberg Group:
https://github.com/roitberg-group/legolas

Permission is hereby granted, free of charge, to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software, subject to
including the copyright notice and this permission notice in all copies or
substantial portions. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND.

## SHIFTX2 (optional external NMR predictor)

Protein Labs does not distribute, install, or bundle SHIFTX2. The upstream
download page provides standalone Linux/macOS archives (latest listed Linux
release: 1.13, 2018) but does not publish a license or redistribution grant on
that page. Therefore the adapter may only consume an operator-supplied command;
no automatic installation or redistribution is offered. The operator must
obtain permission or verify applicable terms before enabling it.

Source: http://www.shiftx2.ca/download.html (checked 2026-10-31)

## OpenCloning

Protein Labs' Expression Planning vector builder adapts sequence/source model
conventions, GenBank handling patterns, and restriction-enzyme workflows from
OpenCloning backend 1.9.5, commit
`6f49b70bd2d2caf790f5226e4625629fc0eab427`.

Source: https://github.com/OpenCloning/OpenCloning_backend

Copyright 2022 Manuel Lera Ramirez

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Mol*

Protein Labs bundles the Mol* library (npm package `molstar`, 5.13.x) as the
3D structure viewer in the Structure Viewer job.

Source: https://github.com/molstar/molstar
Licence: MIT

Copyright (c) 2017 - now, Mol* contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## gemmi

`protein-labs-web/lib/space-group-table.ts` is generated from gemmi's
space-group tables by `protein-labs-web/scripts/generate-space-groups.py`: the
230 reference settings with their Hermann-Mauguin and Hall symbols, crystal
systems, centrings and coordinate triplets. The Crystallize job's space-group
selector and its symmetry diagrams read that file. No gemmi code is bundled;
the generated data is covered by the licence below and the generator records
the version it came from.
Version: `0.7.5` (PyPI wheel, read 2026-10-31)

Source: https://github.com/project-gemmi/gemmi
Licence: MPL-2.0

Copyright 2017-2019 Global Phasing Ltd.

Mozilla Public License Version 2.0
==================================

1. Definitions
--------------

1.1. "Contributor"
    means each individual or legal entity that creates, contributes to
    the creation of, or owns Covered Software.

1.2. "Contributor Version"
    means the combination of the Contributions of others (if any) used
    by a Contributor and that particular Contributor's Contribution.

1.3. "Contribution"
    means Covered Software of a particular Contributor.

1.4. "Covered Software"
    means Source Code Form to which the initial Contributor has attached
    the notice in Exhibit A, the Executable Form of such Source Code
    Form, and Modifications of such Source Code Form, in each case
    including portions thereof.

1.5. "Incompatible With Secondary Licenses"
    means

    (a) that the initial Contributor has attached the notice described
        in Exhibit B to the Covered Software; or

    (b) that the Covered Software was made available under the terms of
        version 1.1 or earlier of the License, but not also under the
        terms of a Secondary License.

1.6. "Executable Form"
    means any form of the work other than Source Code Form.

1.7. "Larger Work"
    means a work that combines Covered Software with other material, in 
    a separate file or files, that is not Covered Software.

1.8. "License"
    means this document.

1.9. "Licensable"
    means having the right to grant, to the maximum extent possible,
    whether at the time of the initial grant or subsequently, any and
    all of the rights conveyed by this License.

1.10. "Modifications"
    means any of the following:

    (a) any file in Source Code Form that results from an addition to,
        deletion from, or modification of the contents of Covered
        Software; or

    (b) any new file in Source Code Form that contains any Covered
        Software.

1.11. "Patent Claims" of a Contributor
    means any patent claim(s), including without limitation, method,
    process, and apparatus claims, in any patent Licensable by such
    Contributor that would be infringed, but for the grant of the
    License, by the making, using, selling, offering for sale, having
    made, import, or transfer of either its Contributions or its
    Contributor Version.

1.12. "Secondary License"
    means either the GNU General Public License, Version 2.0, the GNU
    Lesser General Public License, Version 2.1, the GNU Affero General
    Public License, Version 3.0, or any later versions of those
    licenses.

1.13. "Source Code Form"
    means the form of the work preferred for making modifications.

1.14. "You" (or "Your")
    means an individual or a legal entity exercising rights under this
    License. For legal entities, "You" includes any entity that
    controls, is controlled by, or is under common control with You. For
    purposes of this definition, "control" means (a) the power, direct
    or indirect, to cause the direction or management of such entity,
    whether by contract or otherwise, or (b) ownership of more than
    fifty percent (50%) of the outstanding shares or beneficial
    ownership of such entity.

2. License Grants and Conditions
--------------------------------

2.1. Grants

Each Contributor hereby grants You a world-wide, royalty-free,
non-exclusive license:

(a) under intellectual property rights (other than patent or trademark)
    Licensable by such Contributor to use, reproduce, make available,
    modify, display, perform, distribute, and otherwise exploit its
    Contributions, either on an unmodified basis, with Modifications, or
    as part of a Larger Work; and

(b) under Patent Claims of such Contributor to make, use, sell, offer
    for sale, have made, import, and otherwise transfer either its
    Contributions or its Contributor Version.

2.2. Effective Date

The licenses granted in Section 2.1 with respect to any Contribution
become effective for each Contribution on the date the Contributor first
distributes such Contribution.

2.3. Limitations on Grant Scope

The licenses granted in this Section 2 are the only rights granted under
this License. No additional rights or licenses will be implied from the
distribution or licensing of Covered Software under this License.
Notwithstanding Section 2.1(b) above, no patent license is granted by a
Contributor:

(a) for any code that a Contributor has removed from Covered Software;
    or

(b) for infringements caused by: (i) Your and any other third party's
    modifications of Covered Software, or (ii) the combination of its
    Contributions with other software (except as part of its Contributor
    Version); or

(c) under Patent Claims infringed by Covered Software in the absence of
    its Contributions.

This License does not grant any rights in the trademarks, service marks,
or logos of any Contributor (except as may be necessary to comply with
the notice requirements in Section 3.4).

2.4. Subsequent Licenses

No Contributor makes additional grants as a result of Your choice to
distribute the Covered Software under a subsequent version of this
License (see Section 10.2) or under the terms of a Secondary License (if
permitted under the terms of Section 3.3).

2.5. Representation

Each Contributor represents that the Contributor believes its
Contributions are its original creation(s) or it has sufficient rights
to grant the rights to its Contributions conveyed by this License.

2.6. Fair Use

This License is not intended to limit any rights You have under
applicable copyright doctrines of fair use, fair dealing, or other
equivalents.

2.7. Conditions

Sections 3.1, 3.2, 3.3, and 3.4 are conditions of the licenses granted
in Section 2.1.

3. Responsibilities
-------------------

3.1. Distribution of Source Form

All distribution of Covered Software in Source Code Form, including any
Modifications that You create or to which You contribute, must be under
the terms of this License. You must inform recipients that the Source
Code Form of the Covered Software is governed by the terms of this
License, and how they can obtain a copy of this License. You may not
attempt to alter or restrict the recipients' rights in the Source Code
Form.

3.2. Distribution of Executable Form

If You distribute Covered Software in Executable Form then:

(a) such Covered Software must also be made available in Source Code
    Form, as described in Section 3.1, and You must inform recipients of
    the Executable Form how they can obtain a copy of such Source Code
    Form by reasonable means in a timely manner, at a charge no more
    than the cost of distribution to the recipient; and

(b) You may distribute such Executable Form under the terms of this
    License, or sublicense it under different terms, provided that the
    license for the Executable Form does not attempt to limit or alter
    the recipients' rights in the Source Code Form under this License.

3.3. Distribution of a Larger Work

You may create and distribute a Larger Work under terms of Your choice,
provided that You also comply with the requirements of this License for
the Covered Software. If the Larger Work is a combination of Covered
Software with a work governed by one or more Secondary Licenses, and the
Covered Software is not Incompatible With Secondary Licenses, this
License permits You to additionally distribute such Covered Software
under the terms of such Secondary License(s), so that the recipient of
the Larger Work may, at their option, further distribute the Covered
Software under the terms of either this License or such Secondary
License(s).

3.4. Notices

You may not remove or alter the substance of any license notices
(including copyright notices, patent notices, disclaimers of warranty,
or limitations of liability) contained within the Source Code Form of
the Covered Software, except that You may alter any license notices to
the extent required to remedy known factual inaccuracies.

3.5. Application of Additional Terms

You may choose to offer, and to charge a fee for, warranty, support,
indemnity or liability obligations to one or more recipients of Covered
Software. However, You may do so only on Your own behalf, and not on
behalf of any Contributor. You must make it absolutely clear that any
such warranty, support, indemnity, or liability obligation is offered by
You alone, and You hereby agree to indemnify every Contributor for any
liability incurred by such Contributor as a result of warranty, support,
indemnity or liability terms You offer. You may include additional
disclaimers of warranty and limitations of liability specific to any
jurisdiction.

4. Inability to Comply Due to Statute or Regulation
---------------------------------------------------

If it is impossible for You to comply with any of the terms of this
License with respect to some or all of the Covered Software due to
statute, judicial order, or regulation then You must: (a) comply with
the terms of this License to the maximum extent possible; and (b)
describe the limitations and the code they affect. Such description must
be placed in a text file included with all distributions of the Covered
Software under this License. Except to the extent prohibited by statute
or regulation, such description must be sufficiently detailed for a
recipient of ordinary skill to be able to understand it.

5. Termination
--------------

5.1. The rights granted under this License will terminate automatically
if You fail to comply with any of its terms. However, if You become
compliant, then the rights granted under this License from a particular
Contributor are reinstated (a) provisionally, unless and until such
Contributor explicitly and finally terminates Your grants, and (b) on an
ongoing basis, if such Contributor fails to notify You of the
non-compliance by some reasonable means prior to 60 days after You have
come back into compliance. Moreover, Your grants from a particular
Contributor are reinstated on an ongoing basis if such Contributor
notifies You of the non-compliance by some reasonable means, this is the
first time You have received notice of non-compliance with this License
from such Contributor, and You become compliant prior to 30 days after
Your receipt of the notice.

5.2. If You initiate litigation against any entity by asserting a patent
infringement claim (excluding declaratory judgment actions,
counter-claims, and cross-claims) alleging that a Contributor Version
directly or indirectly infringes any patent, then the rights granted to
You by any and all Contributors for the Covered Software under Section
2.1 of this License shall terminate.

5.3. In the event of termination under Sections 5.1 or 5.2 above, all
end user license agreements (excluding distributors and resellers) which
have been validly granted by You or Your distributors under this License
prior to termination shall survive termination.

************************************************************************
*                                                                      *
*  6. Disclaimer of Warranty                                           *
*  -------------------------                                           *
*                                                                      *
*  Covered Software is provided under this License on an "as is"       *
*  basis, without warranty of any kind, either expressed, implied, or  *
*  statutory, including, without limitation, warranties that the       *
*  Covered Software is free of defects, merchantable, fit for a        *
*  particular purpose or non-infringing. The entire risk as to the     *
*  quality and performance of the Covered Software is with You.        *
*  Should any Covered Software prove defective in any respect, You     *
*  (not any Contributor) assume the cost of any necessary servicing,   *
*  repair, or correction. This disclaimer of warranty constitutes an   *
*  essential part of this License. No use of any Covered Software is   *
*  authorized under this License except under this disclaimer.         *
*                                                                      *
************************************************************************

************************************************************************
*                                                                      *
*  7. Limitation of Liability                                          *
*  --------------------------                                          *
*                                                                      *
*  Under no circumstances and under no legal theory, whether tort      *
*  (including negligence), contract, or otherwise, shall any           *
*  Contributor, or anyone who distributes Covered Software as          *
*  permitted above, be liable to You for any direct, indirect,         *
*  special, incidental, or consequential damages of any character      *
*  including, without limitation, damages for lost profits, loss of    *
*  goodwill, work stoppage, computer failure or malfunction, or any    *
*  and all other commercial damages or losses, even if such party      *
*  shall have been informed of the possibility of such damages. This   *
*  limitation of liability shall not apply to liability for death or   *
*  personal injury resulting from such party's negligence to the       *
*  extent applicable law prohibits such limitation. Some               *
*  jurisdictions do not allow the exclusion or limitation of           *
*  incidental or consequential damages, so this exclusion and          *
*  limitation may not apply to You.                                    *
*                                                                      *
************************************************************************

8. Litigation
-------------

Any litigation relating to this License may be brought only in the
courts of a jurisdiction where the defendant maintains its principal
place of business and such litigation shall be governed by laws of that
jurisdiction, without reference to its conflict-of-law provisions.
Nothing in this Section shall prevent a party's ability to bring
cross-claims or counter-claims.

9. Miscellaneous
----------------

This License represents the complete agreement concerning the subject
matter hereof. If any provision of this License is held to be
unenforceable, such provision shall be reformed only to the extent
necessary to make it enforceable. Any law or regulation which provides
that the language of a contract shall be construed against the drafter
shall not be used to construe this License against a Contributor.

10. Versions of the License
---------------------------

10.1. New Versions

Mozilla Foundation is the license steward. Except as provided in Section
10.3, no one other than the license steward has the right to modify or
publish new versions of this License. Each version will be given a
distinguishing version number.

10.2. Effect of New Versions

You may distribute the Covered Software under the terms of the version
of the License under which You originally received the Covered Software,
or under the terms of any subsequent version published by the license
steward.

10.3. Modified Versions

If you create software not governed by this License, and you want to
create a new license for such software, you may create and use a
modified version of this License if you rename the license and remove
any references to the name of the license steward (except to note that
such modified license differs from this License).

10.4. Distributing Source Code Form that is Incompatible With Secondary
Licenses

If You choose to distribute Source Code Form that is Incompatible With
Secondary Licenses under the terms of this version of the License, the
notice described in Exhibit B of this License must be attached.

Exhibit A - Source Code Form License Notice
-------------------------------------------

  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.

If it is not possible or desirable to put the notice in a particular
file, then You may include the notice in a location (such as a LICENSE
file in a relevant directory) where a recipient would be likely to look
for such a notice.

You may add additional accurate notices of copyright ownership.

Exhibit B - "Incompatible With Secondary Licenses" Notice
---------------------------------------------------------

  This Source Code Form is "Incompatible With Secondary Licenses", as
  defined by the Mozilla Public License, v. 2.0.
