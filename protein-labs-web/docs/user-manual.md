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
- Images live in desktop/public/manual/. lib/manual.test.ts fails if a figure is missing.
- Section anchors are slugs of the "##" title. Help > Keyboard & mouse controls opens
  the "Keyboard and mouse" section, so keep that title.
-->

Protein Lab is an offline workspace for planning protein expression, recording purification work, analysing chromatograms and gels, and preparing a purification report. The local scientific engine runs on your computer; projects remain in the project directory you choose.

## Getting started

### Install and launch

1. To use an installed copy, open **Protein Lab** from your application menu, or run `protein-labs` in a terminal.
2. To build and install from a source checkout, close Protein Lab and run `./build-and-install.sh` from the repository root. The script rebuilds the local engine, runs its tests, installs the desktop app, and leaves your `data/` folder untouched.
3. On the start screen, wait for **Scientific engine ready**. If it instead says **Offline workspace available**, you can still enter the app, but analysis that needs the local engine will not be available until it reconnects.
4. Click **Start** to open the dashboard.

![The Protein Lab start screen with the Start button and the engine status underneath](manual/start-screen.webp)
*The start screen. "Scientific engine ready" means the local engine is running.*

The dashboard is the way back to your local workspace. Use its cards to open a saved project, your project trees, the vector and protein library, or reports. Select the Protein Lab mark at the upper left from another workspace to return here.

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

![The project workflow listing the planning and purification design jobs](manual/workflow.webp)
*Workflow cards show their status and the next recommended job.*

To plan a project:

1. Click **Resume workflow** on the project dashboard, or choose **Tools** → **Project workflow**.
2. Read the **RECOMMENDED NEXT** banner, then select **Start** or **Continue**. You can also select any job card when your experiment needs a different path.
3. Save the choices in each planning job before moving on; the roadmap uses saved planning choices to populate its steps.
4. When the banner says **WORKFLOW READY**, select **Open roadmap**. For a non-planning optional job, use **Skip** only when it is not needed for this project.

> **Tip:** A workflow card can be opened again to check or revise its saved choices before you start the corresponding bench step.

The workflow has four sections. The table lists the jobs in their recommended order.

| Section | Jobs |
| --- | --- |
| **Understanding your protein** | Protein sequence, Protein properties, Sequence research, Choose reference match, Structure Viewer, Protein readiness check |
| **Plan your purification** | Affinity capture, Subtractive cleanup, SEC polishing, Choose expression system, Expression vector design, Cell lysis, Compile workflow |
| **Purify your protein** | Transformation and Expression |
| **Analyze your purification** | Chromatogram Studio, Gel densitometry |

You plan the purification from the protein outwards. First choose the capture, cleanup and polishing steps. Then choose the host, the vector and the lysis that feed them.

### Work in a job

Each job has the same header. The header shows the engine status (**Local engine connected**, **Local engine unavailable** or **Checking engine**) and the **Roadmap** and **Report** buttons. Use the tab on the left to go back to project planning or to the roadmap.

After you save a job, a **Saved** tab appears. It shows the **RECOMMENDED NEXT PLANNING JOB**. If you opened the job from the roadmap, it shows **CONTINUE THE PURIFICATION**. Select the tab to continue.

To skip a job, select **Skip** on the **RECOMMENDED NEXT** banner. The job is marked as skipped and counts as done. **Compile workflow** records that you continued without it.

## Protein sequence and properties

### Protein sequence

1. Open **Protein sequence** in the workflow.
2. Edit the **Construct name** and the **Amino acid sequence**. Spaces and line breaks are ignored.
3. Optionally, fill in **Organism**, **Gene**, **Description** and **Notes** under **Construct metadata**. Later jobs use these values.
4. Click **Save sequence**. Protein Lab saves the sequence and calculates the protein properties again.

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
- **Amino-acid composition**: the count and percentage of each residue. The bars are coloured by side-chain class.
- **Calculation assumptions**: the assumptions that the engine used.

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

## Choosing a reference match

The **Choose reference match** job selects one UniProt record. This record is the source of the cofactor, PTM, location, topology and disorder evidence for the project.

1. In **Sequence research**, run **Find UniProt matches** first. The saved matches are ranked by identity, coverage and review status.
2. Open **Choose reference match** and select a match in the list.
3. Read its evidence: **Cofactors**, **PTM and maturation features**, **Cellular location**, **Membrane regions** and **Disordered regions**. Click **Open UniProt** to read the full record.
4. Click **Save selected reference**. The **Protein readiness check** uses this record.

> **Warning:** A close homolog is supporting evidence. It does not prove that each annotation applies to your construct. Confirm active-site residues, modified positions and construct boundaries before you use the annotations.

## Structure Viewer

The **Structure Viewer** shows the AlphaFold model or an experimental PDB entry in 3D and highlights regions of interest.

### Choose a structure

1. Open **Structure Viewer** in the workflow.
2. In the **Structure** panel, select a structure. **Predicted (AlphaFold)** holds the AlphaFold model. **Found by Sequence research** holds the PDB entries from the PDB search, with identity and coverage. **Linked to UniProt** holds the PDB entries of the reference record. **Added by PDB ID** holds the entries that you loaded by ID.
3. To load another entry, type its four-character ID in **Load any PDB entry by ID** and click **Load**.
4. Read the facts list: source, method, resolution, match, chains, mapped chains and ligands.

If no PDB entries are listed, click **Open Sequence research** and run **Find PDB structures**.

> **Note:** A PDB entry needs a UniProt reference match to number its residues and regions. Run **Find UniProt matches** in **Sequence research** first.

### Use the 3D view

- Drag to rotate. Scroll to zoom. Click a residue to identify it.
- Choose **Cartoon**, **Surface** or **Ball & stick**.
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

### Get an AlphaFold model

In the **AlphaFold model** panel, enter a **UniProt accession**, or leave it blank to use the inferred accession. Click **Retrieve AlphaFold DB model**. If there is no model in AlphaFold DB, click **Prepare AlphaFold Server job**. When the server returns the result, click **Import returned result**.

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
3. Set the tag position and the linker. The construct preview shows the expressed fusion and the protein after tag cleavage.
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
2. Select a lysis method and click **Use this choice**.
3. In **Lysis buffer**, read the **SUGGESTED FROM YOUR CHOICES** card. The suggestion starts from the binding buffer of your capture column. Each line tells you why a component is added or left out, for example imidazole for IMAC, a detergent for a membrane protein, or lysozyme for *E. coli*.
4. Click **Apply suggestion** to put the suggestion into the composer. Or, under **Or start from a preset**, select a preset and click **Load into the lysis buffer**.
5. Edit the buffer in the composer. If you click **Re-apply suggestion** after you edit, Protein Lab replaces your edits.
6. Read the **Compatibility check**, then click **Save job**.

> **Note:** A cell-free host has no cells to lyse, so Protein Lab does not suggest a lysis enzyme. Clarify the reaction mix by centrifugation before you load it.

### Compile workflow

1. Open **Compile workflow**.
2. Read the **Compatibility review**. It counts the **Blocking**, **Warning** and **Pass** findings for the complete design.
3. Read the **Generated bench workflow**. It lists the steps from material preparation to quality control and storage.
4. Click **Copy report** to copy the workflow to the clipboard.
5. Click **Save workflow**. If there are blocking findings, the button is **Save draft**. Solve the blocking findings, then save again.

## Transformation and Expression

This job records the bench work that makes the protein.

1. Open **Transformation and Expression** in the **Purify your protein** section.
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

![The chromatogram studio showing a size-exclusion trace with three labelled peaks](manual/chromatogram.webp)
*A size-exclusion run with labelled peaks.*

### Import and inspect a trace

1. From a roadmap step, select **Chromatogram Studio**, or open the chromatography job in the workflow.
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

1. Open **Quantify a gel** from a roadmap step, or open the gel job in the workflow.
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
| Expression vector design: <kbd>Ctrl+S</kbd> | Save the vector |
| Expression vector design: <kbd>?</kbd> | Show the shortcuts of the vector editor |

On macOS, use <kbd>Cmd</kbd> in place of <kbd>Ctrl</kbd> for the library shortcuts.

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
