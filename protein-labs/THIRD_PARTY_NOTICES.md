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
| RDKit (https://github.com/rdkit/rdkit) | BSD-3-Clause | Allowed with notice | Candidate for 2D ligand drawing; not bundled yet. |
| LEGOLAS (https://github.com/roitberg-group/legolas) | MIT | Allowed with notice | Method studied and cited; no code copied yet. |
| UCBShift 2.0 (https://github.com/THGLab/CSpred) | UC Regents, not-for-profit only | Restricted | Method studied and cited; no code shipped. |
| Shoebill (https://github.com/KJ-Liao/Shoebill) | No licence file | Cite only | Method studied and cited; no code copied. |
| UCL space-group diagrams (http://img.chem.ucl.ac.uk/sgp/mainmenu.htm) | © 1997–1999 Birkbeck College | Cite only | Visual model only; the app draws its own diagrams. |

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
