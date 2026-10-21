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

Protein Lab plans protein expression, analyses purification runs, and writes the purification report. It runs entirely on your computer: a local scientific engine starts with the app and keeps every project in a folder you choose.

## Getting started

1. Open Protein Lab. The start screen shows whether the scientific engine is ready.
2. Click **Start** to open the dashboard.

![The Protein Lab start screen with the Start button and the engine status underneath](manual/start-screen.webp)
*The start screen. "Scientific engine ready" means the local engine is running.*

The dashboard summarises your projects, project trees, the job you were last working on, and your reports. Click any card to open it.

![The dashboard with lab statistics, projects, project trees and reports cards](manual/dashboard.webp)
*The dashboard after clicking Start.*

> **Note:** If the start screen says the engine is not connected, quit Protein Lab and open it again. See [Troubleshooting](#troubleshooting).

## The menu bar

The menu bar at the top of the window is always available. Click a menu name to open it, or move between menus with the arrow keys once one is open.

| Menu | What it holds |
| --- | --- |
| **File** | New project, open a project, save, export, share, and the project directory |
| **Edit** | Refresh the workspace and edit the current report |
| **Settings** | The app's appearance |
| **Tools** | Project gallery, project trees, vector library, and the current project's workflow, roadmap and report |
| **Help** | This manual, keyboard and mouse controls, and the app version |

Items that need an open project, such as **Save / refresh**, stay greyed out until you open one.

## Choosing where projects are saved

Every project, job and report is saved in your **project directory**. To change it:

1. Open **File** → **Set project directory…**
2. Choose a folder and click **Use this folder**.
3. If the folder is empty, choose **Copy my projects** to bring your existing projects with you, or **Start empty**.

![The File menu with Set project directory and the folder projects are saved in](manual/file-menu.webp)
*The File menu shows where projects are currently saved.*

Protein Lab restarts its engine on the new folder and returns to the dashboard. Your previous folder is never deleted, so you can switch back to it at any time. If you choose a folder that already holds Protein Lab projects, the app opens those projects.

**File** → **Show project directory** opens the folder in your file manager.

> **Tip:** Choose a folder that is backed up, or a shared lab drive, so the whole lab's projects are kept together.

> **Warning:** If the project directory is on a drive that is later unplugged, Protein Lab saves to its default folder until the drive is back, and the File menu says so.

## Creating a project

A project holds one protein: its sequence, workflow, purification roadmap and report.

1. Open **File** → **New project**.
2. Give the project a name and paste the amino-acid sequence in one-letter code.
3. Click **Create project**.

![The new project dialog with a name and an amino-acid sequence filled in](manual/new-project.webp)
*Protein Lab counts the residues as you paste.*

To reopen a project later, use **File** → **Open…** and click its card.

![The project gallery with a saved project card](manual/project-gallery.webp)

## Project workflow

Each project opens on its dashboard. **Resume workflow** takes you to the workflow: the planning jobs that take a protein from sequence to a purification plan.

![The project dashboard with Resume workflow, Purification roadmap and Report](manual/project-dashboard.webp)

![The project workflow listing the planning and purification design jobs](manual/workflow.webp)
*Work through the jobs in order. Each card shows whether it is completed, recommended or available.*

## Purification roadmap

The roadmap lays out the purification as steps, from transformation and expression to SEC polishing. Your workflow choices fill each step in automatically. Click **Add record or data** on a step to attach a chromatogram, a gel or a note.

![The purification roadmap with a column for each purification step](manual/roadmap.webp)

> **Tip:** Right-click the roadmap to insert a step. To reorder, hold <kbd>Ctrl</kbd>, click the step to move, then click its new position.

## Chromatogram viewer

The chromatogram studio plots affinity and size-exclusion runs. Import a trace as CSV, TSV or text with volume and absorbance columns, then use **Find peaks** to label each peak with its elution volume, height and area.

![The chromatogram studio showing a size-exclusion trace with three labelled peaks](manual/chromatogram.webp)
*A size-exclusion run with its peaks found and labelled.*

## Densitometry studio

The gel studio quantifies SDS-PAGE and other gels. Import a PNG, JPEG or TIFF image, then click **Detect lanes & bands**. Check the detected lanes and bands, mark the ladder lane, and pick the band for your protein to see its purity.

![The gel densitometry studio with an imported gel image ready for lane detection](manual/gel-studio.webp)
*A gel straight after import, with the origin and dye-front guides.*

## Purification report

The report collects every project page, from protein properties to quality control, into one editable document. Use **Print / PDF** to save a copy, or export standalone HTML.

![The purification report builder with its page list and the first page](manual/report.webp)

## Vector library

**Tools** → **Vector library** (<kbd>Ctrl+Shift+L</kbd>) searches expression vectors and backbones. Pick a vector and click **Use in project** to start designing a construct.

![The vector library with search and vector cards](manual/vector-library.webp)

## Project trees

Project trees connect related projects, for example a construct and its later variants, and record what changed between them.

![The project trees workspace](manual/project-trees.webp)

## Appearance

**Settings** → **Appearance** switches between three looks: Graphic novel (light), Monochrome dark and Monochrome light. Your choice is remembered.

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

## Troubleshooting

- **"Engine not connected" on the start screen.** Quit Protein Lab and open it again. The app writes a startup log to its `logs` folder; include it when you report a problem.
- **A menu item is greyed out.** Most project items need an open project. Open one with **File** → **Open…**.
- **Set project directory is greyed out.** You are using the web build, or Protein Lab is connected to an engine it did not start. Quit any other copy of the engine and reopen Protein Lab.
