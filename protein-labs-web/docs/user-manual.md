# Protein Lab user manual

<!--
Authoring notes (not shown in the app):
- This file is rendered by Help > User manual (components/protein-labs/user-manual.tsx).
- Supported Markdown: one "#" title, "##" sections (each becomes a contents entry),
  "###" sub-headings, paragraphs, "-" and "1." lists, "> **Tip:**" / "> **Note:**" /
  "> **Warning:**" callouts, pipe tables, **bold**, *italic*, `code`, <kbd>Keys</kbd>
  and [links](https://…). No raw HTML.
- A figure is an image on its own line, optionally followed by an italic caption line:
  ![Alt text](manual/name.webp)
  *Caption.*
- Images live in desktop/public/manual/. Every figure has a light screenshot (name.webp,
  Graphic novel appearance) and a dark one (name-dark.webp, Monochrome dark); the app
  shows the one that matches the appearance. Take both from the same build and window
  size (1440 × 900 for full-window figures). lib/manual.test.ts fails if either is missing.
- "[text](#anchor)" links jump inside the manual. The anchor is the slug of a "##" or "###"
  title; lib/manual.test.ts fails if it does not exist.
- Section anchors are slugs of the "##" title. Help > Keyboard & mouse controls opens
  the "Keyboard and mouse" section, so keep that title.
-->

Protein Lab is an offline workspace for planning protein expression, recording purification work, analysing chromatograms and gels, and preparing a purification report. The local scientific engine runs on your computer; projects remain in the project directory you choose.

## What's new

This release adds the following. Each item links to its place in the manual.

- **2D ligand drawing** in the Structure Viewer, linked atom for atom to the 3D view, with R/S and E/Z labels. See [Draw a ligand in 2D](#draw-a-ligand-in-2d).
- **Crystallize your protein**, a new job: crystallization propensity, space groups, a lattice and packing builder, and practical advice on screens and drops. See [Crystallize your protein](#crystallize-your-protein).
- **Predict the HSQC spectrum**, a new job: a predicted ¹H–¹⁵N HSQC, linked peak for peak to the 3D structure. See [HSQC spectrum prediction](#hsqc-spectrum-prediction).
- **References on every new screen.** Each method, tool, dataset and rule of thumb has a numbered reference; the list is at the bottom of the screen.
- **Previous job and Next job tabs** at the bottom of every job replace the recommended-next card and banner. See [Move between jobs](#move-between-jobs).
- **Organism search** in Protein sequence looks up UniProt and NCBI Taxonomy as you type. See [Protein sequence](#protein-sequence).
- **Most abundant residue** is highlighted in the amino-acid composition table. See [Protein properties](#protein-properties).
- **ConSurf conservation** in Sequence research grades every residue from 1 (variable) to 9 (conserved). See [Conservation with ConSurf](#conservation-with-consurf).
- **AlphaFold Server JSON export** in Choose reference match, with a preview and checks before you upload. See [Export an AlphaFold Server job](#export-an-alphafold-server-job).
- **A larger Structure Viewer** with a collapsible side panel, **surface opacity**, **chain interface highlighting** and **colour by conservation**. See [Structure Viewer](#structure-viewer).
- **Vector Workbench** on the dashboard: a linked plasmid map and sequence for any vector, outside a project. See [Vector Workbench](#vector-workbench).
- **Lysis method animations** show how each method breaks cells. See [Cell lysis](#cell-lysis).
- **Compile workflow** is now a timeline of bench steps with a compatibility check on each hand-off. See [Compile workflow](#compile-workflow).

## Getting started

### Install and launch

1. To use an installed copy, open **Protein Lab** from your application menu, or run `protein-labs` in a terminal.
2. To build and install from a source checkout, close Protein Lab and run `./build-and-install.sh` from the repository root. The script rebuilds the local engine, runs its tests, installs the desktop app, and leaves your `data/` folder untouched.
3. On the start screen, wait for **Scientific engine ready**. If it instead says **Offline workspace available**, you can still enter the app, but analysis that needs the local engine will not be available until it reconnects.
4. Click **Start** to open the dashboard.

![The Protein Lab start screen with the Start button and the engine status underneath](manual/start-screen.webp)
*The start screen. "Scientific engine ready" means the local engine is running.*

The dashboard is the way back to your local workspace. Use its cards to open a saved project, your project trees, the vector and protein library, the Vector Workbench, or reports. Select the Protein Lab mark at the upper left from another workspace to return here.

![The dashboard with lab statistics, projects, project trees and reports cards](manual/dashboard.webp)
*The dashboard after clicking Start.*

> **Note:** If the engine does not become ready, quit Protein Lab and open it again. See [Troubleshooting](#troubleshooting) before relying on an analysis result.

## The menu bar

The menu bar is always available after you start the workspace. Click a menu name to open it. Once a menu is open, use the arrow keys to move through it or to the next menu.

| Menu | What it holds |
| --- | --- |
| **File** | New project, open a project, save or export its record, share a summary, and choose the project directory |
| **Edit** | Refresh the workspace and open the current project’s report |
| **Settings** | The app's appearance |
| **Tools** | Project gallery, project trees, the vector and protein library, and the current project's workflow, roadmap and report |
| **Help** | This manual, keyboard and mouse controls, and **About Protein Lab**, which shows the app version |

To use it:

1. Open a project first when you need **Save / refresh**, **Save As / Export**, **Share**, **Edit report**, **Project workflow**, **Purification roadmap**, or **Purification report**.
2. Use **File** → **Open…** or **Tools** → **Project gallery** to choose a project.
3. Use **Help** → **User manual** at any time to return to this guide, or **Help** → **Keyboard & mouse controls** to jump directly to [Keyboard and mouse](#keyboard-and-mouse).

> **Note:** A grey menu item is unavailable in the current context; it has not failed. Open a project for project-specific actions. **Set project directory…** and **Show project directory** can also be grey; see [Troubleshooting](#troubleshooting).

## Choosing where projects are saved

Every project, job and report is saved in your **project directory**. To change it:

1. Open **File** → **Set project directory…**.
2. Choose a folder and click **Use this folder**.
3. If the folder is empty, choose **Copy my projects** to bring your existing projects with you, or **Start empty** to create new work there.
4. If the folder already contains Protein Lab projects, choose **Open these projects** to work with them.

![The File menu with Set project directory and the folder projects are saved in](manual/file-menu.webp)
*The File menu shows where projects are currently saved.*

Protein Lab restarts its engine on the selected folder and returns to the dashboard. Your previous folder is never deleted, so you can switch back at any time.

**File** → **Show project directory** opens the folder in your file manager.

> **Tip:** Choose a folder that is backed up, or a shared lab drive, so the whole lab's projects are kept together.

> **Warning:** If the selected drive is unavailable, Protein Lab uses its fallback directory. Read the location shown in the File menu before creating or saving work.

## Creating a project

A project holds one protein: its sequence, workflow, purification roadmap and report.

1. Open **File** → **New project**.
2. Give the project a meaningful name and paste its amino-acid sequence in one-letter code. Whitespace is removed automatically.
3. Click **Create project**.

![The new project dialog with a name and an amino-acid sequence filled in](manual/new-project.webp)
*Protein Lab counts the residues as you paste.*

To reopen a project later, use **File** → **Open…**, select its card, and wait for the project dashboard. The dashboard shows **Resume workflow**, **Purification roadmap**, and **Report** for the selected project.

![The project gallery with a saved project card](manual/project-gallery.webp)

## Project workflow

Each project opens on its dashboard. Use **Resume workflow** to move from the protein sequence through planning jobs and into a bench-facing purification plan.

![The project dashboard with Resume workflow, Purification roadmap and Report](manual/project-dashboard.webp)

![The top of the project workflow with the numbered job cards of the first two sections](manual/workflow.webp)
*Job cards are numbered in the recommended order and show their status.*

To plan a project:

1. Click **Resume workflow** on the project dashboard, or choose **Tools** → **Project workflow**.
2. Select the first job card that is not done. Complete the jobs in order, or open any card when your experiment needs a different path.
3. Save the choices in each planning job before you move on. The roadmap uses the saved planning choices to fill in its steps.
4. Inside a job, use the **Next job** tab at the bottom of the window to continue. See [Move between jobs](#move-between-jobs).
5. When planning is done, the **Purify your protein** card shows **READY**. Click **Open purification roadmap**.

> **Tip:** A workflow card can be opened again to check or revise its saved choices before you start the corresponding bench step.

The workflow page has two sections of numbered jobs, then the **Purify your protein** card, then the **Crystallize your protein** and **Study it by NMR** sections. The table lists the jobs in their recommended order. **Previous job** and **Next job** follow the same order.

| Section | Jobs |
| --- | --- |
| **Understanding your protein** | Protein sequence, Protein properties, Sequence research, Choose reference match, Structure Viewer, Protein readiness check |
| **Plan your purification** | Affinity capture, Subtractive cleanup, SEC polishing, Choose expression system, Expression vector design, Cell lysis, Compile workflow |
| **Purify your protein** (from the roadmap) | Transformation and Expression, Chromatogram Studio, Gel densitometry |
| **Crystallize your protein** | Crystallize your protein |
| **Study it by NMR** | Predict the ¹H–¹⁵N HSQC spectrum |

![The bottom of the project workflow with the Purify your protein card and the Crystallize your protein and Study it by NMR sections](manual/workflow-crystallize-nmr.webp)
*The two newest sections each hold one job. They use what the earlier jobs saved.*

The bench jobs in **Purify your protein** open from the steps of the [purification roadmap](#purification-roadmap), or with **Next job** after **Compile workflow**.

You plan the purification from the protein outwards. First choose the capture, cleanup and polishing steps. Then choose the host, the vector and the lysis that feed them.

### Work in a job

Each job has the same header. The header shows the engine status (**Local engine connected**, **Local engine unavailable** or **Checking engine**) and the **Roadmap** and **Report** buttons. Use the tab at the upper left (**Project planning** or **Purification roadmap**) to go back to where you came from.

### Move between jobs

The bottom of every job has two tabs: **Previous job** at the lower left and **Next job** at the lower right. They follow the order in the table above.

![The bottom of a job with the Skip button, the Next job tab and its tooltip naming the next job](manual/job-nav-tabs.webp)
*Hold the pointer on a tab, or focus it, to see the name of the job it opens.*

- Click **Next job** or **Previous job** to open the neighbouring job. The first job has no **Previous job** tab and the last job has no **Next job** tab.
- Hold the pointer on a tab, or move the keyboard focus to it, to see which job it opens.
- After you save, **Saved** shows next to the tabs for a few seconds.
- To leave out a job that this project does not need, click **Skip**. Protein Lab saves the job as skipped, counts it as done, and opens the next job. **Compile workflow** records that you continued without it.

> **Note:** **Skip** is only offered for unfinished jobs in **Understanding your protein** and **Plan your purification**. **Protein sequence** cannot be skipped.

## Protein sequence and properties

### Protein sequence

1. Open **Protein sequence** in the workflow.
2. Edit the **Construct name** and the **Amino acid sequence**. Spaces and line breaks are ignored.
3. Optionally, fill in **Organism**, **Gene**, **Description** and **Notes** under **Construct metadata**. Later jobs use these values.
4. Click **Save sequence**. Protein Lab saves the sequence and calculates the protein properties again.

To choose the organism:

1. Click **Organism** and type a name, a strain or a taxon ID. After a short pause, Protein Lab searches UniProt and NCBI Taxonomy.
2. Read the suggestions. Each one shows the scientific name, its rank or common name, and its taxon ID.
3. Click a suggestion, or press <kbd>↓</kbd> and <kbd>↑</kbd> to move through the list and <kbd>Enter</kbd> to choose. Press <kbd>Esc</kbd> to close the list.
4. Check the line under the field. **Linked to NCBI taxon** and a number means that the organism is linked to a taxon. **Free text · not linked to a taxon** means that the typed name is kept as text only.

![The Organism field with Escherichia coli typed and a list of matching taxa with their taxon IDs](manual/organism-search.webp)
*Suggestions come from UniProt and NCBI Taxonomy.*

> **Note:** Without an internet connection, the list shows **Offline list** and offers common expression and model organisms only. You can always keep a name as free text.

### Protein properties

The **Protein properties** job uses the local engine to calculate the ProtParam profile of the sequence.

1. Open **Protein properties** in the workflow.
2. Click **Recalculate and save**. The values are calculated and saved in the project.
3. Read the panels. Each value has a one-line explanation.

The job has these panels:

- **Complete ProtParam profile**: molecular weight, monoisotopic mass, theoretical pI, instability index, aliphatic index, GRAVY, aromaticity, chemical formula and total atoms.
- **Extinction coefficient at 280 nm**: molar values and A(0.1%) for reduced cysteines and for oxidized cystines.
- **Estimated half-life**: the N-terminal residue and the half-life estimates in mammalian, yeast and *E. coli* cells.
- **Secondary-structure propensity**: the share of residues in the helix, turn and sheet sets. This is not a structure prediction.
- **Sequence and charge summary**: the N-terminal and C-terminal residues with their positions, the net charge at pH 7, and the counts of acidic and basic residues.
- **Oligomeric state**: the assembly that the protein forms in solution. See below.
- **Amino-acid composition**: the count and percentage of each residue. The bars are coloured by side-chain class. The most abundant residue is highlighted.
- **Calculation assumptions**: the assumptions that the engine used.

In the **Amino-acid composition** table, the row of the most abundant residue is tinted and marked **Most abundant**. If two or more residues share the highest count, each of them is marked.

![The amino-acid composition table with the leucine row highlighted as the most abundant residue](manual/most-abundant.webp)
*Leucine is the most abundant residue in this construct.*

### Residue details

1. In the **Amino-acid composition** table, click a residue row.
2. Read the residue window. It shows a drawing of the residue, its side-chain class, its count in this protein, its mass, its pKa values, its typical location in a folded protein, its hydropathy and its secondary-structure preference.
3. Press <kbd>←</kbd> or <kbd>→</kbd>, or click the buttons at the bottom, to go to the previous or next residue.
4. Press <kbd>Esc</kbd> to close the window.

### Oligomeric state

The ProtParam values describe one polypeptide chain. Use the **Oligomeric state** panel to record the assembly that the protein forms in solution.

1. Under **Assembly**, choose **Monomer**, **Homodimer**, **Homotrimer**, **Homotetramer**, **Higher-order homo-oligomer**, **Hetero-complex** or **Unknown**.
2. For a higher-order homo-oligomer, enter the **Number of identical subunits (5 or more)**. For a hetero-complex, describe it in **Complex composition**.
3. Optionally, enter an **Evidence source (optional)**, for example SEC-MALS or a crystal structure, and **Notes (optional)**.
4. Read the table. For a homo-oligomer, the assembly molecular weight and ε₂₈₀ are the monomer values multiplied by the number of chains. For a hetero-complex, Protein Lab does not calculate assembly values.
5. Click **Save oligomeric state**.

> **Note:** **Recalculate and save** keeps the saved oligomeric state. The purification report includes the oligomeric state.

## Sequence research

**Sequence research** searches public databases with the project sequence and saves the results in the project. Only these searches need an internet connection.

### Run a search

1. Open **Sequence research** in the workflow. Make sure that the project has a sequence.
2. Select a search button. **Find UniProt matches** matches the sequence against UniProt and saves PTMs, maturation features, topology, cellular location and cofactors. **Run protein BLAST** searches Swiss-Prot with NCBI protein BLAST and saves each alignment. **Find PDB structures** finds experimental structures and their crystallization and purification conditions.
3. To look up a record that you know, type in **Optional UniProt text query** and click **Search**, or type in **Optional accession** and click **Fetch**.
4. Wait until the progress panel shows **Done**. Protein Lab saves the results automatically. There is no save button.

### Follow a BLAST job

A BLAST search runs on a remote server and can wait in a queue. The progress panel shows the stages **Submitting**, **Queued**, **Running**, **Parsing hits** and **Done**, and the elapsed time. The bar moves by stage, because the server does not report its queue position.

- Protein Lab checks the job every 5 seconds. Click **Check now** to check immediately.
- Click **Stop** to stop following the job. The remote search can still finish, but Protein Lab does not collect the result.
- If a run fails or stops, click **Run again**.
- **Run history** lists the earlier runs. Click **Show hits** to show the hits of an earlier run.

### Read the BLAST hits

The **BLAST hits** table shows the accession, protein and organism, identity, coverage, E-value, bit score and length of each hit. Click a column heading to sort the table. Click it again to reverse the order. The colours of the identity, coverage and E-value cells show strong, medium and weak matches. If there is more than one run, choose it in **Run**.

To examine the alignments:

1. Click **View BLAST results**, or click **Alignment** on a hit row.
2. On the **Pairwise alignments** tab, type in **Filter hits** to find a hit, and click it. Each alignment shows the query, the match line and the hit in blocks of 60 residues. Identical residues, similar residues, mismatches and gaps have different colours.
3. On the **Multiple sequence alignment** tab, tick the hits to align with the query. Click **Top 10**, **All** or **Clear** to change the selection. The columns follow the query positions.
4. Choose a colouring: **ClustalX**, **Identity to query** or **None**. Hold the pointer on a column to see its conservation.
5. Click **Export FASTA** to save the multiple alignment as a FASTA file.

> **Note:** Some runs do not have saved alignments. Run protein BLAST again to see them.

### Read the saved evidence

- **UniProt matches and PTMs** lists each UniProt match with its review status, identity, coverage, and the number of PTM, transmembrane, disorder and cofactor features. The first match is marked **Best match**.
- **PDB structures and conditions** lists each PDB entry with its method, resolution, identity, similarity and coverage. It also shows the crystallization and purification conditions when the deposition reports them.

### Conservation with ConSurf

ConSurf grades every residue from **1** (highly variable) to **9** (highly conserved) by comparing your protein with its homologues. Conserved residues are often in the active site, a binding site or the folded core. Avoid them when you choose tag positions, truncations and mutations.

To get the grades:

1. In the **ConSurf conservation** card, click **Find ConSurf grades**. Protein Lab looks for a pre-calculated ConSurf-DB analysis of a PDB chain that matches your sequence, and saves it.
2. If ConSurf-DB has no entry, click **Prepare ConSurf server job**. ConSurf has no submission API, so the run happens on their web server. Protein Lab writes the input files and lists the steps. Click **Open the ConSurf server** and follow the steps.
3. When the ConSurf run finishes, download its grades file and, optionally, its alignment. Type the path of each file in **ConSurf grades file** and **Alignment file (optional)**, then click **Import grades**.

![The Evolutionary conservation panel with the grade summary, the grade distribution, the residue strip and the colour legend](manual/consurf.webp)
*Deep magenta residues are highly conserved and turquoise residues are variable.*

To read the **Evolutionary conservation** panel:

- The summary shows **Residues graded**, **Mean grade**, **Grade 9 sites**, **Insufficient data**, the **PDB chain** and the number of sequences in the **Alignment**.
- The bar shows how many residues have each grade. Under it, Protein Lab lists the conserved stretches (grade 8 and higher).
- The strip shows each residue coloured by its grade. Hatched residues have **insufficient data**: too few homologues cover that position for a reliable grade.
- Click a residue in the strip to see its **Score**, **Confidence interval**, **Alignment support**, **Burial**, the **ConSurf call** and the residues seen at that position. Press <kbd>←</kbd> or <kbd>→</kbd> to move one residue, <kbd>↑</kbd> or <kbd>↓</kbd> to move one row, and <kbd>Esc</kbd> to clear the selection.
- Click **Alignment** to show the homologue alignment, **Open in ConSurf-DB** to read the entry on the ConSurf website, or **Delete run** to remove the run. If there is more than one run, choose it in **Run**.

To replace the grades of a run, open **Import another grades file for this run** and import the new file.

> **Tip:** The [Structure Viewer](#colour-by-conservation) can paint the same grades on the 3D model.

## Choosing a reference match

The **Choose reference match** job selects one UniProt record. This record is the source of the cofactor, PTM, location, topology and disorder evidence for the project.

1. In **Sequence research**, run **Find UniProt matches** first. The saved matches are ranked by identity, coverage and review status.
2. Open **Choose reference match** and select a match in the list.
3. Read its evidence: **Cofactors**, **PTM and maturation features**, **Cellular location**, **Membrane regions** and **Disordered regions**. Click **Open UniProt** to read the full record.
4. Click **Save selected reference**. The **Protein readiness check** uses this record.

> **Warning:** A close homolog is supporting evidence. It does not prove that each annotation applies to your construct. Confirm active-site residues, modified positions and construct boundaries before you use the annotations.

### Export an AlphaFold Server job

[AlphaFold Server](https://alphafoldserver.com) predicts the structure of a protein together with its partners, ligands and ions. Protein Lab can write the job file for you from the project's sequence, oligomeric state, cofactors and reference modifications.

1. Open **Choose reference match** and click **Export AlphaFold Server JSON**.
2. Read the token meter. AlphaFold Server accepts up to 5,000 tokens per job: one per residue or base, and one per atom of a ligand, ion or modified residue.
3. Check **Chains**. A homo-oligomer is exported as copies of the chain. Modified residues and glycans from the reference match are listed on the chain.
4. Check **Ligands and ions**. Click the bin button to leave a cofactor out of this job. It moves to **Removed from this job**; click its name there to add it back.
5. Under **Partner chains**, click **Add a partner chain** to model another protein with yours. Enter its **Name**, **Sequence** and **Copies**.
6. Read **What changed on the way out**. Each note is marked **Left out**, **Changed** or **Blocks upload**.
7. Click **Download JSON** to save the file, or **Copy JSON** to copy it. Open **Raw JSON** to read the file first.
8. On AlphaFold Server, use **Load JSON** to load the file, then submit the job.

![The Export an AlphaFold Server job dialog with the token meter, chains, ligands, partner chains and the change notes](manual/af-server-export.webp)
*The export of a single carbonic anhydrase II chain.*

> **Note:** Removing a ligand or adding a partner chain changes only this export. Nothing is written back to the project.

> **Warning:** If the meter shows **Over the per-job limit**, AlphaFold Server will refuse the job. Remove ligands, copies or partner chains until it fits.

When the prediction is ready, import its result in the Structure Viewer. See [Get an AlphaFold model](#get-an-alphafold-model).

## Structure Viewer

The **Structure Viewer** shows the AlphaFold model or an experimental PDB entry in 3D and highlights regions of interest, chain interfaces and conserved residues.

The 3D view fills the window. The tools are in the side panel on the right. The icons on the narrow rail beside it open **Structure**, **Display**, **Regions of interest** and **AlphaFold model**. Click the top rail button to hide or show the side panel and give the 3D view more room. Protein Lab remembers your choice. In windows narrower than 1280 pixels, the panel starts closed and opens over the view; press <kbd>Esc</kbd> to close it.

![The Structure Viewer with haemoglobin 4HHB as a semi-transparent surface, the chain interface highlighted, and the side panel open](manual/structure-viewer.webp)
*Haemoglobin (4HHB) as a 45% surface with its chain interfaces highlighted.*

### Choose a structure

1. Open **Structure Viewer** in the workflow.
2. In the **Structure** panel, select a structure. **Predicted (AlphaFold)** holds the AlphaFold model. **Found by Sequence research** holds the PDB entries from the PDB search, with identity and coverage. **Linked to UniProt** holds the PDB entries of the reference record. **Added by PDB ID** holds the entries that you loaded by ID.
3. To load another entry, type its four-character ID in **Load any PDB entry by ID** and click **Load**.
4. Read the facts list: source, method, resolution, match, chains, mapped chains and ligands.

If no PDB entries are listed, click **Open Sequence research** and run **Find PDB structures**.

> **Note:** A PDB entry needs a UniProt reference match to number its residues and regions. Run **Find UniProt matches** in **Sequence research** first.

### Use the 3D view

- Drag to rotate. Scroll to zoom. Click a residue to identify it.
- In the **Display** panel, choose **Cartoon**, **Surface** or **Ball & stick**.
- With **Surface**, drag **Surface opacity** to see the cartoon through the surface. 100% is fully opaque. Protein Lab remembers the value.
- Under **Colour scheme**, choose **Colour by chain**, **Secondary structure**, **pLDDT confidence** or **Hydrophobicity**. **pLDDT confidence** is available for AlphaFold models only. A legend explains the colours.
- With **Colour by chain**, choose a **Chain palette**.
- Turn **Ligands**, **Waters** and **Spin** on or off.
- Use **Reset view**, **Zoom in** and **Zoom out**. Click **Save image (PNG)** to save the view as a PNG file.
- The sequence strip below the view shows the chain. "···" shows residues that are not in the model.

### Highlight regions of interest

1. In **Regions of interest**, choose a region. The groups include cysteines and disulfides, ligand binding sites, hydrophobic regions, disordered regions and reference match features.
2. Use the arrows to go to the previous or next region. Click **Clear** to remove the highlight.
3. Tick **List waters and crystallisation additives** to add them to the list.

Protein Lab highlights only the residues that the engine maps onto the structure. The panel tells you when positions are outside the model or in an alignment gap.

### Highlight a chain interface

The **Chain interface** panel appears when the structure has two or more protein chains. It finds the residues of each chain that touch another chain.

1. Click **Highlight interface**. Residues with any heavy atom within the **Contact distance** of another chain are coloured; the rest are grey.
2. Drag **Contact distance** between 3 and 6 Å. The default is 4.5 Å.
3. Open a chain pair, for example **Chains A – B**, to see its residues and the closest distance. Click **Focus this interface** to zoom to it, or click a residue to go to it.
4. Click **Hide interface** to return to the colour scheme.

### Colour by conservation

The **Conservation** panel colours each residue by how conserved it is across homologues, on ConSurf's 1–9 scale.

1. Under **Conservation**, choose a source. **ConSurf** uses the newest ConSurf grades from [Sequence research](#conservation-with-consurf). **Alignment** scores each column of the newest protein BLAST alignment.
2. Read the summary: the number of residues graded, with insufficient data, and not mapped. Each chain shows how many positions align to your sequence. A chain of another protein is left grey.
3. Read the legend under the view: from **Variable** to **Conserved**, plus **Insufficient data** and **Not mapped**. The sequence strip uses the same colours.
4. Choose **Off** to return to the colour scheme.

![The Structure Viewer with the carbonic anhydrase II model coloured by ConSurf grades and the Conservation panel open](manual/structure-conservation.webp)
*The AlphaFold model of carbonic anhydrase II coloured by its ConSurf grades.*

> **Note:** Conservation colouring and interface highlighting replace each other. Turning one on turns the other off. A button is grey until its data exists; the panel tells you which job to run first.

### Draw a ligand in 2D

A PDB entry often holds small molecules: substrates, inhibitors, cofactors. The 2D drawing shows one of them as a chemist draws it, next to the 3D view.

1. Load a PDB entry that has ligands. The facts list in the title shows how many, for example **1CNY · X-ray diffraction · 2.30 Å · 3 ligands**.
2. In **Regions of interest**, choose a ligand binding site, for example **EG3 A 555**. The **2D drawing** panel opens beside the 3D view. The first drawing of a ligand can take a few seconds, because the engine reads its chemical definition from the PDB.
3. If the entry has more than one ligand, choose another one in the **Ligand** list of the panel. Its binding site is highlighted too.
4. Click an atom in the drawing. The 3D view turns to that atom and marks it. Click a ligand atom in the 3D view, and the drawing marks it. Point at an atom in either view to see it in the other.
5. Read **Stereocentres (R/S)** and **Double bonds (E/Z)** under the drawing. Click a stereocentre to find it in 3D. Open the list of all drawn atoms to pick any atom by its PDB name.
6. Click **Wider drawing** to give the drawing half of the view. Click **Close the 2D drawing** to hide the panel. Choosing a region that is not a ligand also hides it.

![The Structure Viewer with PDB entry 1CNY, the EG3 inhibitor binding site highlighted in 3D, and the 2D drawing of EG3 beside it with its stereocentre C15 selected](manual/ligand-2d.webp)
*The inhibitor EG3 in carbonic anhydrase II (1CNY). Stereocentre C15 (S) is selected in both views.*

Open **How to read this drawing** in the panel for a short guide: carbon atoms at corners and line ends, wedge and hash bonds, and how R/S and E/Z are assigned.

The engine draws the ligand with RDKit from the PDB Chemical Component Dictionary. It takes the stereochemistry from the coordinates of this instance in this entry. If those coordinates disagree with the dictionary, the panel shows a warning: the ligand may be modelled wrongly in that entry, so check the electron density before you trust it.

> **Note:** The drawing needs an internet connection the first time each ligand is drawn. If it fails, the panel tells you why; click **Try again**.

### Get an AlphaFold model

In the **AlphaFold model** panel, enter a **UniProt accession**, or leave it blank to use the inferred accession. Click **Retrieve AlphaFold DB model**. If there is no model in AlphaFold DB, click **Prepare AlphaFold Server job**, or build a complete job with partners and ligands in [Choose reference match](#export-an-alphafold-server-job). When the server returns the result, click **Import returned result**.

## Protein readiness check

The **Protein readiness check** combines the sequence calculations with the selected UniProt reference. It shows the risks that you must solve before you design expression and purification.

1. Complete **Protein properties** and **Choose reference match** first. The job tells you if one of them is missing.
2. Open **Protein readiness check** in the workflow.
3. Read the verdict under **OVERALL READINESS**. **Ready to plan** means that each check is settled. **Ready with flagged risks** means that some checks need a plan in expression or purification. **Review needed** means that some checks are not answered. **Nothing to review** means that there are no checks.
4. Read the **Checkpoint findings**. They are in the groups **Sequence**, **Expression**, **Purification** and **Quantitation**. Each check is marked **Pass**, **Attention** or **Review**. Click **Why** to read the details.
5. Click **Use detected evidence** to fill the review answers from the saved evidence.
6. In **Researcher review**, confirm or change each answer: **Not reviewed**, **Yes**, **No** or **Needs follow-up**. Fill in the location, cofactor, PTM and notes fields as necessary.
7. Optionally, change the **Low-extinction warning threshold (M⁻¹ cm⁻¹)**. The default is 10,000. Below this value, A₂₈₀ measurement is weak, so plan a dye-based assay or a longer path length.
8. Click **Save readiness check**. If an answer is **Not reviewed** or **Needs follow-up**, the check is saved with follow-up items.

The **Evidence ledger** shows the evidence for each answer. Click **Send this section to journal** to add the readiness section to the project report.

## Planning the purification

The **Plan your purification** jobs choose the columns, buffers, host, vector and lysis. Most jobs show option cards. Click a card to read its details, then click **Use this option** or **Use this choice**. Each job checks compatibility while you change your choices, and shows the result in a **Compatibility check**.

> **Note:** If a finding is blocking, the job saves a draft. The job stays in progress until you solve the blocking finding.

### Affinity capture

1. Open **Affinity capture**. Search the resins or filter them by category.
2. Select a resin and click **Use this option**. The binding, wash and elution buffers change to the presets of that resin.
3. Set the tag position, the linker and the **Vector junction**. The construct preview shows the expressed fusion and the protein after tag cleavage.

   An N-terminal poly-His tag starts from the house layout **M – His tag – DYDIPTT – ENLYFQ↓G (rTEV) – GA – protein of interest**. The DYDIPTT spacer sits between the His tag and the rTEV site, and the **GA** vector junction sits directly before the protein. Both are selectable: pick a different linker, or set the junction to **No junction residues**, when your backbone differs.

   Changing the resin, the tag or the tag position moves the linker and the junction to the default for the new tag, so switching a His resin for GST or MBP drops the DYDIPTT spacer and the GA junction. A linker or junction you picked yourself is left alone. Reopening a saved job always shows the construct as you saved it.

   The junction residues come from the backbone rather than the protease, so they stay on the protein after cleavage. With the house layout, rTEV leaves its own Gly plus the vector's Gly-Ala, so the purified protein begins **GGA**. The construct preview reports that scar, and the mass and pI of the cleaved product include it.
4. Under **Binding, wash and elution buffers**, choose a **Starting preset**. Then edit each buffer in the buffer composer.
5. Click **Save tag, resin and buffers**.

### Subtractive cleanup

1. Open **Subtractive cleanup**.
2. Under **1 · TAG CLEAVAGE**, choose the protease that removes the tag. Record where the site is annotated in **Cleavage-site evidence**.
3. Under **2 · Reverse-affinity cleanup medium**, choose the resin that captures the released tag, the uncleaved fusion and the tagged protease.
4. Under **Buffer starting point**, click a preset and click **Load into composer**. Edit the **Cleavage buffer** in the composer.
5. Read the **Compatibility check**, then click **Save job**.

### SEC polishing

1. Open **SEC polishing**.
2. Enter the **Expected native mass / complex size (kDa)** and the **Injection volume (mL)**. The mass starts at the mass of the cleaved construct.
3. Choose an SEC column. Each card shows the fractionation range and the total volume. Chromatogram Studio uses the same columns.
4. Load a buffer preset into the composer and edit the **Storage buffer**.
5. Read the **Compatibility check**. It compares the mass, the injection volume and the buffer pH with the column, and the buffer pH with the predicted pI.
6. Click **Save job**.

### Buffer composer

Affinity capture, Subtractive cleanup, SEC polishing and Cell lysis use the same buffer composer.

1. Set the **pH** and the **Purpose** of the buffer.
2. Click **Add component**. Type in the component box to search the component library by name, alias or purpose.
3. Select a component. The library fills in a typical concentration and unit. If the name is not in the library, Protein Lab keeps it as a **Custom** component.
4. Enter the **Concentration**, then choose the **Unit** and the **Purpose**. Choose **Custom…** to describe your own purpose.
5. Read the panel for the selected component: other names, typical range, uses, cautions and references.
6. To remove a component, click the bin button on its row.

The composer marks a concentration that is outside the typical range. It also shows cautions for known problems. For example, EDTA removes Ni²⁺ and Co²⁺ from IMAC resins.

### Choose expression system

1. Open **Choose expression system**.
2. In **Host systems**, compare the five families: *E. coli*, yeast, insect, mammalian and cell-free.
3. Use **Side-by-side comparison** to compare yield, time, cost, PTMs, disulfide bonds, scale, uses and limits. Click **Browse strains** to open a family.
4. In the strain list, search by strain, genotype, marker or application. Tick **Compare** on two to four strains to put them in the table.
5. Click **Choose** on a strain. Read **Evidence for this strain** and the compatible vector families.
6. Click **Save cell line**.

### Expression vector design

Click **Load backbone** to load a vector from the library, or **Import GenBank / FASTA / .dna** to import a file. Annotate the vector with **Auto annotate**, **Annotate selection** or **Detect and annotate ORFs**. Click **Save** or press <kbd>Ctrl+S</kbd>. Export the vector as **GenBank**, **SnapGene .dna** or **FASTA**. Press <kbd>?</kbd> in the job to see its keyboard shortcuts.

### Cell lysis

1. Open **Cell lysis**. Each method card shows if it suits the saved host.
2. Click a method card. Its window opens with a short animation of how the method breaks cells, followed by its **Mechanism**, **Best for**, **Advantages**, **Limitations**, **Compatible systems** and **Reference**.
3. Click **Use this choice** to select the method, or **Close** to compare another.
4. In **Lysis buffer**, read the **SUGGESTED FROM YOUR CHOICES** card. The suggestion starts from the binding buffer of your capture column. Each line tells you why a component is added or left out, for example imidazole for IMAC, a detergent for a membrane protein, or lysozyme for *E. coli*.
5. Click **Apply suggestion** to put the suggestion into the composer. Or, under **Or start from a preset**, select a preset and click **Load into the lysis buffer**.
6. Edit the buffer in the composer. If you click **Re-apply suggestion** after you edit, Protein Lab replaces your edits.
7. Read the **Compatibility check**, then click **Save job**.

![The Cell lysis job with the Probe sonication window open, showing the animation of cavitation breaking cells](manual/lysis-animation.webp)
*Each method window starts with an animation of how the method opens cells.*

> **Note:** If your computer is set to reduce motion, the window shows a still picture of intact and broken cells instead of the animation.

> **Note:** A cell-free host has no cells to lyse, so Protein Lab does not suggest a lysis enzyme. Clarify the reaction mix by centrifugation before you load it.

### Compile workflow

**Compile workflow** turns your saved planning choices into a timeline of bench steps, from expression and harvest to QC and storage. It checks each hand-off from one step to the next.

![The Compile workflow timeline with the blocking, warning and passed counts, the overview rail of eight steps and the first step cards](manual/compile-workflow.webp)
*A plan with no blocking issues and one warning, on the hand-off from lysis to affinity capture.*

1. Open **Compile workflow**.
2. Read the counts at the top: **Blocking**, **Warnings** and **Passed**. The chip shows **Ready for review** when nothing blocks, or **Draft** when something does.
3. Read the overview rail. It shows each step with the verdict of the hand-off between steps: a tick, a warning sign or a blocking sign. Click a step to scroll to it.
4. Read each step card: its **Step** number and type, the instruction, and what to **Record** at the bench. Between two cards, the hand-off shows each finding as **Blocking**, **Warning** or **Pass**, and **How to fix** when a change is needed.
5. Read **Across the workflow** for the checks that apply to every step, and **Evidence basis** for the source of the starting conditions.
6. Click **Copy report** to copy the workflow to the clipboard.
7. Click **Save workflow**. If there are blocking findings, the button is **Save draft**. Solve the blocking findings, then save again.

> **Tip:** If nothing is saved yet, the timeline shows **Nothing saved to compile yet** and generic placeholder steps. Save **Affinity capture**, **Subtractive cleanup**, **SEC polishing** and **Cell lysis** first.

## Transformation and Expression

This job records the bench work that makes the protein.

1. Open **Transformation and Expression** from the first step of the purification roadmap, or click **Next job** in **Compile workflow**.
2. Under **1 · Starting material**, choose **Fresh transformation**, **Glycerol / cryo stock** or **Existing culture**.
3. Under **2 · Host system and medium**, choose the host tab and a medium, then click **Use this medium**.
4. Under **3 · Expression record**, enter the **Culture volume**, the **Temperature (°C)**, the **Induction / harvest plan**, the media composition and your notes.
5. Click **Save transformation and expression**.

> **Note:** If the saved expression system is cell-free, there is no transformation or culture step. Record the reaction setup instead.

## Purification roadmap

The roadmap lays out the purification from transformation and expression through polishing, quality control, and storage. Saved workflow choices populate its planned steps automatically.

![The purification roadmap with a column for each purification step](manual/roadmap.webp)

To keep a bench record:

1. Open **Purification roadmap** from the project dashboard or **Tools** menu.
2. Read the instruction and planned details in the relevant step. Select its job button to return to an unfinished planning job.
3. Open the step menu and choose **Add record or data**. Add a saved buffer, yield and purity measurement, image, or note; choose **Chromatogram Studio** or **Quantify a gel** to link the next saved analysis to this step.
4. Click **Save roadmap** when the status says **Unsaved changes**. Use **Export report** for a self-contained HTML record or **Print / PDF** for a print dialog.
5. Right-click empty roadmap space to insert a step. To reorder steps, hold <kbd>Ctrl</kbd>, select the step to move, and—while holding <kbd>Ctrl</kbd>—select its new position.

> **Note:** Linking an analysis does not save the roadmap by itself. Save the roadmap after the result is linked.

## Chromatogram viewer

Chromatogram Studio imports and processes chromatography traces locally. It can overlay traces, find or define peaks, mark fraction regions, make an SEC standard curve, and export data and figures.

![Chromatogram Studio with an imported size-exclusion trace of carbonic anhydrase II and its processing controls](manual/chromatogram.webp)
*An imported size-exclusion run: a small aggregate peak, the main peak and a late peak.*

### Import and inspect a trace

1. From a roadmap step, select **Chromatogram Studio**, or click **Next job** in **Transformation and Expression**.
2. Select **Data**, then **Import CSV / TSV / DAT**. The importer accepts `.csv`, `.tsv`, `.txt`, and `.dat` files.
3. Select a trace in the spectra list. Adjust its name, colour, X shift, Y scale, Y offset, smoothing, baseline correction, or normalization as needed. These processing controls remain reversible in the project.
4. Click **Save project** to keep the trace and its settings with this project.

### Find peaks and capture fractions

1. Select **Analysis** and choose **Find peaks** to detect candidate peaks on the active trace.
2. Select **Drag peak** to draw a peak range yourself, or **Adjust bounds** to refine a selected range. The selected peak reports elution volume, response, integrated area, and—when a valid SEC curve is present—molecular weight.
3. Select **Fraction region**, then drag over the collected region. Rename a fraction and adjust its colour in the inspector.
4. Use **Add text** or **Add arrow** for figure annotations. Select **Zoom** to inspect a region, **Zoom to peak** for a selected peak, and **Reset zoom** to restore the full view.

### Build an SEC standard curve

1. Select **Standard curve**.
2. Choose a prepacked column or enter the measured **Vt** and **Vo** for your column.
3. Enter each protein standard’s molecular weight and elution volume, and leave only appropriate standards checked in **Use**.
4. Check that the fitted curve shows the expected number of standards and its displayed R². Protein Lab requires at least two included standards that elute between Vo and Vt before it calculates a fit.
5. Optionally name and **Save curve** for this computer, or use **Export to share**, **Copy curve**, or **Open .seccurve** to exchange it.

> **Warning:** A curve is only as defensible as the standards and measured column volumes entered. Do not interpret a peak molecular weight when the app says it is outside Vo–Vt or when no valid fit is shown.

### Make and export a figure

1. Select **Figures** to change the plot presentation, including labels, peak callouts, fraction regions, and annotations.
2. Select **Export** to export the chromatogram project, processed data, standards, peak molecular weights, or the figure.
3. Export the figure as SVG, PNG, TIFF, or PDF, or copy a PNG to the clipboard. For the standard-curve figure, choose **SVG**, **PNG**, **TIFF**, or **PDF** under its figure controls.
4. Click **Save project** before leaving so the trace, analysis, curve, and figure settings can be reused.

## Densitometry studio

The gel studio measures lanes and bands from SDS-PAGE or Native PAGE images with the local engine. It records the detection settings, method metadata, quantification limits, and ladder calibration alongside the result.

![The gel densitometry studio with an imported gel image ready for lane detection](manual/gel-studio.webp)
*An imported gel with well-origin and dye-front drawing guides.*

### Detect and review bands

1. Open **Quantify a gel** from a roadmap step, or click **Next job** in **Chromatogram Studio**.
2. In **Setup**, select **Import PNG, JPEG, or TIFF**, then choose the gel image. For TIFF files, the engine supplies a PNG preview after analysis.
3. Under **Gel type**, choose **SDS-PAGE** or **Native PAGE**. Set the band sensitivity and rolling-ball radius if needed; the origin and dye-front guides help orient the image but do not change a measurement.
4. Click **Detect lanes & bands**. Review the detected lanes and bands on the image. Detection keeps lightly loaded lanes separate, also next to a strongly stained ladder. Add or edit a lane when needed, then use **Re-detect in lanes** to measure those lanes again.
5. Select the target band in a sample lane. This labels the selected target; it does not change the underlying band measurement.

### Calibrate and document the method

1. Select **Ladder** and choose the ladder preset. For another ladder, choose **Custom** in the preset list and enter the **Marker masses, top to bottom (kDa)**.
2. Mark the lane containing the ladder. Check the calibration card and residual table before using molecular-weight results.
3. Select **Method** to review the background method, lane geometry, band-integration method, and any quantification warnings.
4. Click the **Export CSV** button to export the band table when you need a tabular record, then click **Save gel job** to retain the image annotations, densities, uncertainties, refusals, calibration, and method metadata with the project.

> **Note:** The integrated density of a band is the background-corrected 8-bit image intensity summed over the band area, in pixels. It has no absolute unit. Compare densities only between bands of the same image.

> **Warning:** Saturated bands and invalid ladder assignments are reported as limitations rather than estimated silently. Reacquire or correct the image and re-run detection if the reported method warning makes the result unsuitable for your conclusion.

## Purification report

The report collects project pages—from protein properties through quality control—into an editable purification record. Saved workflow choices and selected analyses can populate pages, but you should review the text before distributing the report.

![The purification report builder with its page list and the first page](manual/report.webp)

To prepare a report:

1. Open **Report** on the project dashboard or **Tools** → **Purification report**.
2. Edit the title, summary, page headings, and **Record** text directly on the pages. Tick **Show the recorded plan** to include saved planning details where available.
3. Use the page list to include or omit a page, move it up or down, or delete it. Select **Add a page** for a custom page; **Restore standard pages** rebuilds the default set and removes typed notes on removed pages after confirmation.
4. Select **Add chromatogram or gel** on a page to attach a saved analysis, then edit its figure caption.
5. Click **Save report**. Edits also autosave shortly after you stop typing; wait for **All changes saved** before closing the app.
6. Use **Print / PDF** to use your system print dialog, or export a **Standalone HTML** or **Markdown** copy.

The exported **Protein properties** page includes two tables:

- A property table with the molecular weight, ε₂₈₀ for reduced cysteines and for formed cystines, the theoretical pI, the number of residues, the expression host and the oligomeric state. For a recorded oligomer, the table also gives the assembly molecular weight and ε₂₈₀ values.
- An **Expressed construct** table with the residues, molecular weight and ε₂₈₀ of the uncleaved fusion and of the protein after tag cleavage. The affinity tag, the cleavage, the expression vector and the vector length follow the table.

In a Standalone HTML export, a gel figure also includes the gel image and the note for each lane.

## Crystallize your protein

To see a protein's atoms by X-ray crystallography, you first need a crystal. **Crystallize your protein** estimates how likely crystals are, explains the crystal symmetry, lets you build and inspect a crystal lattice, and suggests where to start at the bench.

The job reads what earlier jobs found: size, membrane and disorder answers, ligands and cofactors, PDB homologues, ConSurf grades and the AlphaFold model. You do not type any of it in again. Each fact names the job it came from; open that job to add a fact that is missing.

The job has four tabs. Use the mouse, or <kbd>←</kbd> <kbd>→</kbd> when a tab has the focus.

| Tab | What it shows |
| --- | --- |
| **Propensity and advice** | How likely crystals are, and why |
| **Space groups** | The symmetry the crystal could have |
| **Lattice and packing** | How copies of the protein pack in a crystal |
| **Practical guidance** | Screens, drops and buffers to start with, then how to optimize a hit |

Every tab ends with a numbered reference list. A small number next to a statement, for example [1], points to its reference.

### Propensity and advice

1. Open **Crystallize your protein** in the workflow. The assessment starts by itself.
2. Read **Combined propensity**: the chance, from 0 to 1, that the protein gives crystals good enough to solve its structure. A range shows how sure the predictors are.
3. Read the **Recommendation** and its points. Each point says whether it is a caution, an action, supporting evidence or missing evidence, and where it came from.
4. Read **The predictors**. Each card names a published model and says whether it ran. A predictor that did not run says why. Protein Lab never puts a guess in its place.
5. Read **Space-group suggestions** and **How what you already know changed the advice**. Click the **Open …** button on a missing fact to open the job that fills it in.
6. Click **Save assessment**. This completes the job. Click **Re-run assessment** after you change an earlier job.

![The Propensity and advice tab: the combined propensity scale with no score yet, the recommendation, and the four tabs of the job](manual/crystallize-propensity.webp)
*With no crystallization predictor installed, the job shows **No score yet** and still gives evidence-based advice.*

> **Note:** The propensity predictors are not included with every installation. Without them the score shows **No score yet**, and the advice comes from the saved evidence only. A low score does not mean the protein will never crystallise, and a high score does not promise crystals.

> **Warning:** Membrane proteins need detergents or lipids to crystallise. The predictors do not model them, so treat their scores with extra care.

### Space groups

A space group is the set of symmetry moves (rotations, screw rotations and translations) that copies one molecule into every position in the crystal. Proteins are made of L-amino acids, so a protein crystal can only use the 65 groups that keep the handedness of the molecule.

1. Open the **Space groups** tab.
2. In **Pick a group**, search by symbol (for example `P212121`), number or crystal system. Groups that your PDB homologues crystallised in are flagged in the list.
3. Choose **All 230** to see the other 165 groups in teaching mode. Choose **65 for proteins** to go back.
4. Read the facts of the group: number, crystal system, point group and copies per cell. The two diagrams show where the symmetry elements sit in one cell and where the copies of the molecule sit.
5. Under **Symmetry operations**, pick an operation. **Step through** animates how it moves one copy. Use **Play**, **Next step** and **Reset**.

The group you pick is saved with the project. The lattice builder uses it.

![The Space groups tab with P212121 selected, its facts, and its symmetry-element and general-position diagrams](manual/crystallize-space-groups.webp)
*P2₁2₁2₁, the space group proteins choose most often, with its two International Tables diagrams.*

> **Note:** If your computer is set to reduce motion, **Play** is not available. Use **Next step** to move through the operation one step at a time.

### Lattice and packing

The lattice builder repeats a structure by the space group and the unit cell, and measures where the copies touch.

1. **Choose a structure to pack.** Under **Your protein**, choose the AlphaFold model or a PDB entry saved in the Structure Viewer. Under **Learning examples**, choose a known crystal, for example ubiquitin (1UBQ) or tetragonal lysozyme (193L). Each example has a short note on what to look for.
2. **Set the unit cell.** An experimental PDB entry uses its own cell (**Experimental cell**). For the AlphaFold model, or to try another cell, choose **Hypothetical cell**, choose one of the 65 space groups, and enter the free cell edges and angles. Click **Build this cell**, or click **Suggest a cell that fits** to let the app search for the smallest cell without clashes.
3. **The lattice in 3D.** Choose **Molecule and its neighbours** or **One unit cell**. Each copy has its own colour; chain "A-3" is copy 3 of chain A.
4. **Packing analysis.** Read the counts: neighbours touching, residue contacts, possible hydrogen bonds, clashes and interface residues. Drag **Contact distance** to change what counts as a contact. Click a row, or a residue in 3D, to highlight both sides of that contact.

![The Lattice and packing tab with ubiquitin (1UBQ) in P212121, the molecule and its 14 neighbours drawn in 3D in different colours](manual/crystallize-lattice.webp)
*Ubiquitin (1UBQ) and every copy that touches it in its P2₁2₁2₁ crystal.*

For an AlphaFold model, tick the option to leave out residues with low pLDDT confidence. Floppy ends would otherwise make the cell too large.

> **Warning:** A hypothetical cell is a teaching aid, not a prediction of your crystal. If the analysis reports clashes, the copies overlap and no real crystal could have that cell.

### Practical guidance

The **Practical guidance** tab helps you set up the first crystallization trials and improve the first crystals. Its advice is tailored from what earlier jobs recorded about the protein. It has four tabs.

- **Screens and concentration.** **What this advice is based on** lists the size, membrane, disorder and ligand facts used. **Starting protein concentration** gives a starting value and a range in mg/mL. **Conditions that already worked for related structures** copies the crystal-growth records of PDB entries that Sequence research found. **Suggested commercial screens** lists screens in order of priority, each with the reasons for it.
- **What goes in the drop.** A schematic phase diagram explains why a precipitant is needed. Cards explain the role of the precipitant, the buffer and pH, salt, additives and, for membrane proteins, detergent.
- **Hanging vs sitting drop.** How vapour diffusion works, and the pros and cons of the two drop set-ups.
- **Optimizing a hit.** Fine-grid plates built from the condition that gave crystals, then seeding, drop and protein changes to try next.

![The Practical guidance tab with the facts the advice is based on, the starting protein concentration, and crystallization conditions copied from related PDB entries](manual/crystallize-guidance.webp)
*For carbonic anhydrase II, five related PDB entries already record a hanging-drop condition.*

> **Tip:** A condition that worked for a close relative is the strongest starting point. Set it up beside the commercial screens.

> **Note:** If no earlier job says whether the protein is a membrane protein, the guidance asks you to answer it in the [Protein readiness check](#protein-readiness-check). The advice changes for membrane proteins.

#### Optimizing a hit

A hit is a screen condition that gave crystals, even small or poor ones. The best condition is usually close to it.

1. Open **Practical guidance**, then **Optimizing a hit**. Until you enter your own hit, the form shows example values and says so.
2. Enter the hit: **Precipitant**, **Concentration in the hit** and its **Unit** (% (w/v), % (v/v) or M), the **Stock you pipette from**, the **Buffer**, the **pH (optional)**, the **Protein (mg/mL)** and any **Other components (optional)**.
3. Click **Generate plates**. The hit is saved with the job.
4. Read the two 24-well plates (rows A–D, columns 1–6):
   - **Plate 1: precipitant against pH.** The precipitant runs from 70 % to 120 % of the hit across the columns. The pH runs in 0.2-unit steps down the rows. Make one buffer stock for each row.
   - **Plate 2: precipitant against protein concentration.** The same columns. The protein runs from half to 1.5 times the hit down the rows.

   Each well shows the volume of precipitant stock to add to a 500 µL reservoir. **HIT** marks the well that repeats your hit (C4). The list under each plate says what is the same in every well.
5. Read the cards under **Seeding**, **Drops and chemistry** and **The protein itself**. Each card says when to use a technique and gives the bench steps and the references. The cards cover microseeding, streak seeding, macroseeding, cross-seeding, random microseed matrix screening (rMMS), drop ratio and volume, temperature, sitting or hanging drop, oil over the reservoir (Al's oil), additive screens, Silver Bullets, detergents, protein concentration, ligand co-crystallization, in situ proteolysis and surface entropy reduction. **Suggested for this protein** marks a card that fits what earlier jobs recorded, for example in situ proteolysis when disordered regions are recorded.

![The Optimizing a hit tab: the hit form and Plate 1, a 4 × 6 grid of precipitant against pH with the hit in well C4](manual/crystallize-optimize.webp)
*Plate 1 for an example hit of 20 % (w/v) PEG 3,350 at pH 7.5.*

> **Note:** If the hit has no pH, Plate 1 is not shown. Enter the buffer's pH to get it.

> **Tip:** The step sizes are the app's own rule of thumb. If every drop on a plate precipitates, or every drop stays clear, enter a new hit at the edge of the plate and generate again.

## HSQC spectrum prediction

An ¹H–¹⁵N HSQC is the standard first NMR experiment on a protein. Each backbone N–H gives one peak: its ¹H shift on one axis and its ¹⁵N shift on the other. Proline has no backbone N–H, so it gives no peak. A folded protein spreads its peaks out; an unfolded one crowds them near 8–8.5 ppm.

**Predict the ¹H–¹⁵N HSQC spectrum** predicts where each peak should fall, draws the spectrum the way NMR software such as Sparky does, and links every peak to its residue in the 3D structure.

1. Save the sequence in **Protein sequence** first. The job uses it and, if they exist, the AlphaFold model, PDB entries, disorder notes and ligands from earlier jobs.
2. Open **Predict the ¹H–¹⁵N HSQC spectrum** in the **Study it by NMR** section of the workflow. The prediction starts by itself.
3. Under **What the prediction starts from**, check the sequence, the structure, the disordered residues and the residues near a ligand. To use another structure, choose it in the **Structure** list.
4. Read **Predictor used**. It names the predictor, says whether it is **Structure-based** or **Sequence only**, and gives its published expected error.
5. Find a peak. Click it in the spectrum, choose a row in the **Peak list**, or click a residue in the 3D structure. All three views mark the same residue.
6. Click **Save prediction**. Click **Predict again** to run the prediction again, for example after you change an earlier job.

![The HSQC job with the predicted spectrum on the left, the AlphaFold model on the right, and peak W5 selected in both](manual/hsqc.webp)
*Peak W5 selected in the spectrum and the structure. With the sequence-only fallback, the peaks crowd near 8.2 ppm.*

To read the spectrum:

- By NMR convention both axes run backwards: ¹H falls from left to right and ¹⁵N rises from top to bottom.
- Each peak is drawn as contour rings. The legend shows folded residues, disordered residues, residues near a ligand and side-chain N–H peaks.
- Scroll to zoom and drag to pan. Use the zoom buttons, or the full-spectrum button to see everything again.
- **Labels** shows residue names. Where peaks crowd, some labels are hidden; zoom in to see them.
- **Error on every peak** draws the expected error of the predictor around each peak.
- Where peaks overlap, click again to step through them.

The engine tries UCBShift 2.0, LEGOLAS and SHIFTX2 in turn. If none of them is installed, it uses average random-coil shifts. Random-coil shifts ignore the 3D fold, so the peaks of a folded protein crowd together.

> **Note:** A prediction is a guide for assigning a real spectrum. It does not replace one. A bound ligand can move the peaks of nearby residues in ways the predictor does not model; those peaks are flagged **Near a ligand**.

> **Tip:** Above about 30 kDa, peaks broaden and special methods such as TROSY and deuteration are usually needed. The introduction at the top of the job explains this.

### Preparing the NMR sample

Below the peak list, **Preparing a protein NMR sample** gives short, cited advice for making a sample for the real experiment:

- **Size of your protein.** The job works out the protein's mass from its sequence. It says whether an ordinary HSQC should work (below about 25 kDa), whether to use a TROSY-HSQC (about 25–40 kDa), or whether to deuterate the protein as well (above about 40 kDa). The mass is for one chain; for a dimer or larger complex, judge by the complex's mass.
- **Tube and volume.** Standard 5 mm tubes (500–600 µL), Shigemi tubes (250–300 µL) and 3 mm tubes (160–200 µL), plus tube grade and cleaning.
- **Concentration and labelling.** 0.1–1 mM protein for an HSQC, and ¹⁵N, ¹³C and ²H labelling in M9 minimal medium.
- **Buffer and D₂O.** 5–10 % D₂O for the lock, pH 7 or below, deuterated or phosphate buffers, and low salt for cryoprobes.
- **Additives and reference.** TCEP, DSS or TSP, sodium azide and protease inhibitors.
- **Before it goes in the magnet.** Spinning or filtering out aggregates, filling the tube, and the measuring temperature.

The **Protein needed** table shows how many milligrams of your protein each tube takes at 0.1 mM and at 1 mM.

> **Note:** These are general starting points. Where your NMR facility's own sample rules differ, follow theirs.

## Vector and protein library

Your saved vectors and your purified proteins share one page with a tab for each: **Vectors** and **Proteins**. Open it from the **Vector and protein library** card on the dashboard, which counts both libraries and shows where they are saved. You can also use **Tools** → **Vector library** (<kbd>Ctrl+Shift+L</kbd>) or **Tools** → **Protein library** (<kbd>Ctrl+Shift+P</kbd>). Switch tabs by clicking them, or focus a tab and press <kbd>←</kbd> or <kbd>→</kbd>.

Both libraries are saved in the project database inside your project directory. The folder is shown above each tab. In the desktop app, **Open folder** shows it in your file manager, and **Change location…** moves the whole workspace to another folder, just like **File** → **Set project directory…**.

### Vectors

The vector library holds your own vectors next to the standard catalogue, and searches public collections when they are enabled and reachable. Organise vectors into collections and tags, then load a backbone into a project.

![The vector library: smart views, collections and tags on the left, vector cards in the middle, the preview on the right](manual/vector-library.webp)

To find a vector:

1. Open **Tools** → **Vector library**, or press <kbd>Ctrl+Shift+L</kbd>. The library opens on its **Vectors** tab.
2. Pick a view on the left. **All vectors**, **Favourites**, **Recent**, **My imports**, **Standard catalogue** and **Unsorted** are built in; your collections and tags are listed below them with their counts.
3. Search by name, promoter, tag, marker or accession; press <kbd>/</kbd> to jump to the search box. Open **Filters** to narrow by host, promoter, tag, marker, copy number or supplier.
4. Switch between cards and a compact list with the buttons above the results, and choose a sort: name, size, date added or last used. The library remembers both.
5. Select a vector to preview its map and features. Press <kbd>Space</kbd> for a larger quick look.
6. Choose the destination project, then click **Use in project**. The app opens that project's expression-vector design job with the selected vector.

To organise vectors:

1. Click the folder-plus button next to **Collections** to make a collection and type its name. Drag collections to reorder them; double-click one to rename it.
2. Drag vectors onto a collection in the sidebar to add them.
3. In the preview, set a colour label, add tags and write notes. Notes save as you type.
4. Right-click a vector, or use its **…** menu, to rename, favourite, duplicate, export, add to a collection or delete it. Standard catalogue vectors are read-only: you can tag, label and favourite them, and duplicate one to get a copy you can rename.
5. Deleting shows an **Undo** button for a few seconds.

To act on several vectors at once, tick their checkboxes, <kbd>Shift</kbd>-click a range or press <kbd>Ctrl+A</kbd>. The bar above the results then adds them to a collection, tags, favourites, exports or deletes them together.

To import, drag GenBank, FASTA or SnapGene files, or a whole folder, anywhere onto the library; or use **Import files** or **Import folder**. A review sheet lists each file and points out vectors that are already in the library. For each duplicate choose **Skip**, **Keep both** or **Merge** (keep the existing record), then click **Import**.

| Keys in the library | Action |
| --- | --- |
| <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> | Move between vectors |
| <kbd>Enter</kbd> | Open the vector in the chosen project |
| <kbd>Space</kbd> | Quick look |
| <kbd>F</kbd> | Favourite or unfavourite |
| <kbd>F2</kbd> | Rename |
| <kbd>Delete</kbd> | Delete, with Undo |
| <kbd>Ctrl+A</kbd> | Select every vector shown |
| <kbd>/</kbd> | Search |
| <kbd>Esc</kbd> | Clear the selection or close a sheet |

Inside **Expression vector design**, **Load backbone** opens the same library as a dialog with the same views and collections. Select a vector and press <kbd>Enter</kbd> or click **Load into this project**.

> **Note:** Public-source search can be unavailable while offline. The local catalogue is still searched, and the app explains which source could not be reached.

### Proteins

The **Proteins** tab lists every purified batch: how much is left, its status, and exactly where it is kept (for example a freezer, shelf and box). Search by name, gene, construct, buffer or location; press <kbd>/</kbd> to jump to the search box. Narrow the list by status, temperature, location, method or tag. Select a batch to see its storage, stock and history, and click **Add protein** to record a new one. The dashboard card names the busiest storage places and warns when batches are running low.

## Vector Workbench

The **Vector Workbench** opens any vector as a plasmid map and its sequence, side by side, outside a project. Use it to read a vector, annotate features, find restriction sites and ORFs, and save the result to the vector library.

![The Vector Workbench with pET28a-LIC as a circular map and a linear map beside the annotated sequence, with the lacI feature selected in both](manual/vector-workbench.webp)
*Selecting lacI on the map selects it in the sequence and opens it in the Features tab.*

### Open a vector

1. On the dashboard, find the **Vector Workbench** card. Click **Open** to start with an empty workbench, or click the card to turn it over and choose one of the vectors listed on its back. Your own vectors are listed first.
2. In an empty workbench, choose **Vector library**, **From a project** or **Import a file**. You can also paste DNA and click **New construct from DNA**.
3. Later, click **Open** (<kbd>Ctrl+O</kbd>) or **Import** in the toolbar to open another vector. Click **Dashboard** to go back. If there are unsaved changes, Protein Lab asks before it discards them.

### Read the map and sequence

- The map and the sequence are linked. Click a feature or a cut site on the map, or drag across the map or the sequence, and the same region is selected in both. The bar at the bottom shows the selected range, its length and GC content, and the melting temperature of a selection of 60 bp or less.
- Choose **Split**, **Map** or **Sequence** to show both panes or only one. **Split** needs a wide window.
- Under **Cut sites**, choose **Unique**, **Two-cutters**, **All** or **None**. The count beside each shows how many enzymes it includes.
- Tick or clear **Circular** to change the topology. Click **Reverse complement** to flip the whole construct.
- Click **ORFs** to draw open reading frames on the maps.
- Press <kbd>Ctrl+F</kbd> to find a DNA sequence.

### Edit and save

1. In the **Features** tab, select a range and enter a **Name**, **Type** and **Strand**, then click **Add feature**. To change a feature, select it, edit **Start**, **End** or **Notes**, and click **Apply changes**. Click **Delete** to remove it.
2. In the **Enzymes** tab, read the cut sites of the chosen filter.
3. In the **ORFs** tab, set the **Shortest ORF (aa)** and click **Keep as CDS** to turn an ORF into a feature.
4. Click **Save to library** (<kbd>Ctrl+S</kbd>). Save a standard vector as a new entry; save your own vector as a new entry or overwrite it.
5. Click **Export** (<kbd>Ctrl+E</kbd>) to save **GenBank (.gb)**, **SnapGene (.dna)** or **FASTA (.fasta)**.

Use <kbd>Ctrl+Z</kbd> to undo and <kbd>Ctrl+Shift+Z</kbd> or <kbd>Ctrl+Y</kbd> to redo.

> **Note:** Restriction sites and ORFs come from the local engine. If it is unavailable, the workbench says so; click **Retry** when the engine is back. You can still read and edit the map and sequence.

## Project trees

Project trees connect related saved projects, such as construct variants, and describe differences on each branch.

![The project trees workspace](manual/project-trees.webp)

To make a lineage:

1. Open **Tools** → **Project trees**.
2. Select **New project tree**, give it a name, choose its starting project, and click **Create tree**.
3. Select **Add the first branch** or the plus control on a project node. Choose the existing project to branch from, the project to add, and an optional explanation, then select **Save branch**.
4. Select a branch to review the comparison. When the comparison needs experimental context, type a note under **Your note** and click **Save note**.
5. Drag a non-root project node onto a valid parent to re-parent it. Select a project node to open that project.

> **Tip:** Protein Lab prevents a project from being linked in a loop. If a bad imported relationship is detected, the workspace identifies it so you can remove the link.

## Appearance

To change appearance:

1. Open **Settings** → **Appearance**.
2. Choose **Graphic novel**, **Monochrome dark**, or **Monochrome light**.
3. Keep the menu open while comparing options; the chosen appearance is remembered for the next launch.

The pictures in this manual follow the appearance: **Monochrome dark** shows them in the dark appearance, and the light appearances show them in **Graphic novel**.

![The Settings menu listing the three appearances](manual/settings-menu.webp)

## Keyboard and mouse

| Keys | Action |
| --- | --- |
| <kbd>F1</kbd> | Open this manual |
| <kbd>Ctrl+Shift+L</kbd> | Open the library on its Vectors tab |
| <kbd>Ctrl+Shift+P</kbd> | Open the library on its Proteins tab |
| <kbd>Tab</kbd> to a menu, then <kbd>↓</kbd> | Open that menu |
| <kbd>←</kbd> <kbd>→</kbd> | Move between menus while one is open |
| <kbd>↑</kbd> <kbd>↓</kbd>, <kbd>Enter</kbd> | Choose a menu item |
| <kbd>Esc</kbd> | Close a menu or dialog |
| Project-tree graph: <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> | Pan the focused graph |
| Project-tree graph: <kbd>+</kbd> / <kbd>=</kbd>, <kbd>-</kbd> / <kbd>_</kbd> | Zoom in or out |
| Project-tree graph: <kbd>0</kbd> | Fit the graph to the view |
| Residue window: <kbd>←</kbd> <kbd>→</kbd> | Show the previous or next residue |
| Organism field: <kbd>↑</kbd> <kbd>↓</kbd>, <kbd>Enter</kbd>, <kbd>Esc</kbd> | Move through the suggestions, choose one, close the list |
| ConSurf strip: <kbd>←</kbd> <kbd>→</kbd> / <kbd>↑</kbd> <kbd>↓</kbd> | Move one residue / one row |
| Structure Viewer, narrow window: <kbd>Esc</kbd> | Close the side panel |
| Crystallize your protein: <kbd>←</kbd> <kbd>→</kbd> | Move between the four tabs |
| HSQC spectrum: <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> | Pan the focused spectrum |
| HSQC spectrum: <kbd>+</kbd>, <kbd>-</kbd>, <kbd>0</kbd> | Zoom in, zoom out, show the full spectrum |
| HSQC spectrum: <kbd>[</kbd> <kbd>]</kbd>, <kbd>Esc</kbd> | Step through the peaks, clear the selection |
| Vector Workbench: <kbd>Ctrl+O</kbd> | Open a vector |
| Vector Workbench: <kbd>Ctrl+S</kbd>, <kbd>Ctrl+E</kbd> | Save to the library, export |
| Vector Workbench: <kbd>Ctrl+Z</kbd>, <kbd>Ctrl+Shift+Z</kbd> | Undo, redo |
| Vector Workbench: <kbd>Ctrl+F</kbd> | Find a DNA sequence |
| Expression vector design: <kbd>Ctrl+S</kbd> | Save the vector |
| Expression vector design: <kbd>?</kbd> | Show the shortcuts of the vector editor |

On macOS, use <kbd>Cmd</kbd> in place of <kbd>Ctrl</kbd> for the library and Vector Workbench shortcuts.

## Troubleshooting

### The engine does not start

1. Quit Protein Lab completely and open it again. If another instance is running, bring it forward or close it before retrying.
2. If you built from source, confirm the engine has been built by running `./build-and-install.sh` from the repository root with the app closed.
3. Read the desktop startup log at the app’s Electron user-data location, in `logs/desktop.log`. The app shows the exact log path in an engine-startup or renderer error dialog; include that file when reporting the problem.
4. If the log says the engine stopped unexpectedly, restart the app first. Do not treat an unavailable local engine as a completed chromatogram or gel analysis.

### A menu item is greyed out

1. Open a project with **File** → **Open…**. Project actions, including **Save / refresh**, report actions, workflow, roadmap, and report are unavailable until a project is open.
2. If **Set project directory…** is greyed out, use the desktop app rather than a web build and quit any separately started engine. Protein Lab cannot move an engine it did not start itself.
3. If a vector-library source is unavailable, check the source status, retry when the engine or network is available, or use a local vector instead.

### I cannot find my project

1. Open **File** → **Show project directory** to see the folder currently in use.
2. If you recently changed storage folders, choose **File** → **Set project directory…** and select the folder that contains the project. Selecting an existing Protein Lab project folder opens the projects already stored there.
3. Do not delete or replace a project directory while Protein Lab is using it. Back up the directory before moving it or before a major upgrade.
