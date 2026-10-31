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
| RDKit (https://github.com/rdkit/rdkit) | BSD-3-Clause | Allowed with notice | Backend dependency for 2D ligand drawing and R/S, E/Z labels; notice below. |
| LEGOLAS (https://github.com/roitberg-group/legolas) | MIT | Allowed with notice | Method studied and cited; no code copied yet. |
| UCBShift 2.0 (https://github.com/THGLab/CSpred) | UC Regents, not-for-profit only | Restricted | Method studied and cited; no code shipped. |
| Shoebill (https://github.com/KJ-Liao/Shoebill) | No licence file | Cite only | Method studied and cited; no code copied. |
| UCL space-group diagrams (http://img.chem.ucl.ac.uk/sgp/mainmenu.htm) | © 1997–1999 Birkbeck College | Cite only | Visual model only; the app draws its own diagrams. |

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
