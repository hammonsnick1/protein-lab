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

The dashboard is the way back to your local workspace. Use its cards to open a saved project, your project trees, the vector library, or reports. Select the Protein Lab mark at the upper left from another workspace to return here.

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
| **Tools** | Project gallery, project trees, vector library, and the current project's workflow, roadmap and report |
| **Help** | This manual, keyboard and mouse controls, and the app version |

To use it:

1. Open a project first when you need **Save / refresh**, **Save As / Export**, **Share**, **Edit report**, **Project workflow**, **Purification roadmap**, or **Purification report**.
2. Use **File** → **Open…** or **Tools** → **Project gallery** to choose a project.
3. Use **Help** → **User manual** at any time to return to this guide, or **Help** → **Keyboard & mouse controls** to jump directly to [Keyboard and mouse](#keyboard-and-mouse).

> **Note:** A grey menu item is unavailable in the current context; it has not failed. Open a project for project-specific actions.

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
3. Choose **SDS-PAGE** or **Native PAGE**. Set the band sensitivity and rolling-ball radius if needed; the origin and dye-front guides help orient the image but do not change a measurement.
4. Click **Detect lanes & bands**. Review the detected lanes and bands on the image. Add or edit a lane when needed, then use **Re-detect in lanes** to measure those lanes again.
5. Select the target band in a sample lane. This labels the selected target; it does not change the underlying band measurement.

### Calibrate and document the method

1. Select **Ladder** and choose the ladder preset, or select **Custom** and enter marker masses from top to bottom in kDa.
2. Mark the lane containing the ladder. Check the calibration card and residual table before using molecular-weight results.
3. Select **Method** to review the background method, lane geometry, band-integration method, and any quantification warnings.
4. Export the band table as CSV when you need a tabular record, then click **Save gel job** to retain the image annotations, densities, uncertainties, refusals, calibration, and method metadata with the project.

> **Warning:** Saturated bands and invalid ladder assignments are reported as limitations rather than estimated silently. Reacquire or correct the image and re-run detection if the reported method warning makes the result unsuitable for your conclusion.

## Purification report

The report collects project pages—from protein properties through quality control—into an editable purification record. Saved workflow choices and selected analyses can populate pages, but you should review the text before distributing the report.

![The purification report builder with its page list and the first page](manual/report.webp)

To prepare a report:

1. Open **Report** on the project dashboard or **Tools** → **Purification report**.
2. Edit the title, summary, page headings, and **Record** text directly on the pages. Select **Show the recorded plan** to include saved planning details where available.
3. Use the page list to include or omit a page, move it up or down, or delete it. Select **Add a page** for a custom page; **Restore standard pages** rebuilds the default set and removes typed notes on removed pages after confirmation.
4. Select **Add chromatogram or gel** on a page to attach a saved analysis, then edit its figure caption.
5. Click **Save report**. Edits also autosave shortly after you stop typing; wait for **All changes saved** before closing the app.
6. Use **Print / PDF** to use your system print dialog, or export a **Standalone HTML** or **Markdown** copy.

## Vector library

The vector library holds your own vectors next to the standard catalogue, and searches public collections when they are enabled and reachable. Organise vectors into collections and tags, then load a backbone into a project.

![The vector library: smart views, collections and tags on the left, vector cards in the middle, the preview on the right](manual/vector-library.webp)

To find a vector:

1. Open **Tools** → **Vector library**, or press <kbd>Ctrl+Shift+L</kbd>.
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

## Project trees

Project trees connect related saved projects, such as construct variants, and describe differences on each branch.

![The project trees workspace](manual/project-trees.webp)

To make a lineage:

1. Open **Tools** → **Project trees**.
2. Select **New project tree**, give it a name, choose its starting project, and click **Create tree**.
3. Select **Add the first branch** or the plus control on a project node. Choose the existing project to branch from, the project to add, and an optional explanation, then select **Save branch**.
4. Select a branch to review the comparison. Add a branch note when the automated comparison needs experimental context.
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
| <kbd>Ctrl+Shift+L</kbd> | Open the vector library |
| <kbd>Tab</kbd> to a menu, then <kbd>↓</kbd> | Open that menu |
| <kbd>←</kbd> <kbd>→</kbd> | Move between menus while one is open |
| <kbd>↑</kbd> <kbd>↓</kbd>, <kbd>Enter</kbd> | Choose a menu item |
| <kbd>Esc</kbd> | Close a menu or dialog |
| Project-tree graph: <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> | Pan the focused graph |
| Project-tree graph: <kbd>+</kbd> / <kbd>=</kbd>, <kbd>-</kbd> / <kbd>_</kbd> | Zoom in or out |
| Project-tree graph: <kbd>0</kbd> | Fit the graph to the view |

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
