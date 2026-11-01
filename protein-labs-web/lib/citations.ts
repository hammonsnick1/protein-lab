// One registry for every source the app cites: papers, tools, databases and
// teaching websites. Screens show them through `components/ui/citations.tsx`
// and the manual reads the same entries, so a reference is written once.
//
// Rules for adding an entry:
// - Resolve the DOI against Crossref (https://api.crossref.org/works/<doi>) and
//   copy authors, year, title and journal from that record, not from memory.
// - Software and websites without a DOI carry a `url` instead.
// - Anything whose code we might study or reuse carries a `license`. Read the
//   LICENSE file in the upstream repository; an absent file means no licence
//   was granted, so record `reuse: "none"`.
// - Code that is actually copied or bundled also gets a full section in
//   `protein-labs/THIRD_PARTY_NOTICES.md` (see the template at its top).

/** `rule`: a rule of thumb the app chose itself; the entry links to the code that applies it. */
export type CitationKind = "article" | "book" | "software" | "database" | "website" | "rule";

/**
 * How far the licence lets the app reuse the code, as opposed to citing it:
 * - `permissive`: MIT/BSD/Apache-style; copy with the notice kept.
 * - `restricted`: use is limited (for example not-for-profit only); call it
 *   or study it, but get CEO sign-off before shipping any of its code.
 * - `none`: no licence was granted; read and cite only, never copy.
 */
export type LicenseReuse = "permissive" | "restricted" | "none";

export type CitationLicense = {
  /** SPDX identifier when there is one, otherwise a short name. */
  name: string;
  reuse: LicenseReuse;
  /** Where the licence text was read. */
  url: string;
  /** What the app does with it today, in one line. */
  usage: string;
};

export type Citation = {
  id: string;
  kind: CitationKind;
  /** What a student will look for: the tool or resource name, when it has one. */
  name?: string;
  /** "Family Initials" separated by commas; trailing "et al." when cut. */
  authors: string;
  year: string;
  title: string;
  /** Journal with volume and pages, publisher, or site owner. */
  source: string;
  doi?: string;
  url?: string;
  license?: CitationLicense;
};

const entries = [
  {
    id: "shoebill2026", kind: "software", name: "Shoebill", authors: "Liao KJ, Sun YJ", year: "2026",
    title: "Shoebill: an interpretable AlphaFold2-informed predictor of protein crystallization propensity using XGBoost",
    source: "Brief Bioinform 27:bbag233", doi: "10.1093/bib/bbag233", url: "https://github.com/KJ-Liao/Shoebill",
    license: { name: "No licence file", reuse: "none", url: "https://github.com/KJ-Liao/Shoebill", usage: "Method studied and cited; no code copied." },
  },
  {
    id: "mall2025plm", kind: "article", name: "Protein language models for crystallization", authors: "Mall R, Kaushik R, Martinez ZA, Thomson MW, Castiglione F", year: "2025",
    title: "Benchmarking protein language models for protein crystallization",
    source: "Sci Rep 15:2381", doi: "10.1038/s41598-025-86519-5",
  },
  {
    id: "mascl2025", kind: "article", name: "MASCL", authors: "Liao KJ, Sun YJ", year: "2025",
    title: "Using AlphaFold and symmetrical docking to predict protein–protein interactions for exploring potential crystallization conditions",
    source: "Proteins 93:1747–1766", doi: "10.1002/prot.26844",
  },
  {
    id: "pdb2000", kind: "database", name: "Protein Data Bank", authors: "Berman HM, et al.", year: "2000",
    title: "The Protein Data Bank",
    source: "Nucleic Acids Res 28:235–242", doi: "10.1093/nar/28.1.235", url: "https://www.rcsb.org",
  },
  {
    id: "uniprot2023", kind: "database", name: "UniProtKB", authors: "UniProt Consortium", year: "2023",
    title: "UniProt: the Universal Protein Knowledgebase in 2023",
    source: "Nucleic Acids Res 51:D523–D531", doi: "10.1093/nar/gkac1052", url: "https://www.uniprot.org",
  },
  {
    id: "alphafold2021", kind: "software", name: "AlphaFold", authors: "Jumper J, Evans R, Pritzel A, et al.", year: "2021",
    title: "Highly accurate protein structure prediction with AlphaFold",
    source: "Nature 596:583–589", doi: "10.1038/s41586-021-03819-2",
  },
  {
    id: "consurf2023", kind: "software", name: "ConSurf", authors: "Yariv B, Yariv E, Kessel A, et al.", year: "2023",
    title: "Using evolutionary data to make sense of macromolecules with a “face-lifted” ConSurf",
    source: "Protein Sci 32:e4582", doi: "10.1002/pro.4582", url: "https://consurf.tau.ac.il",
  },
  {
    id: "ucl-sgp", kind: "website", name: "UCL space-group diagrams", authors: "Cockcroft JK", year: "1999",
    title: "A hypertext book of crystallographic space group diagrams and tables",
    source: "Birkbeck College, University of London; hosted by the Department of Chemistry, UCL",
    url: "http://img.chem.ucl.ac.uk/sgp/mainmenu.htm",
    license: { name: "© 1997–1999 Birkbeck College", reuse: "none", url: "http://img.chem.ucl.ac.uk/sgp/mainmenu.htm", usage: "Visual model only; the app draws its own diagrams." },
  },
  {
    id: "gemmi", kind: "software", name: "gemmi", authors: "Wojdyr M", year: "2022",
    title: "GEMMI: A library for structural biology",
    source: "J Open Source Softw 7:4200", doi: "10.21105/joss.04200", url: "https://github.com/project-gemmi/gemmi",
    license: { name: "MPL-2.0", reuse: "permissive", url: "https://github.com/project-gemmi/gemmi/blob/master/LICENSE.txt", usage: "Space-group table (symbols, settings, operators) generated from gemmi 0.7.5; notice kept." },
  },
  {
    id: "wukovitz1995", kind: "article", name: "Why protein crystals favour some space groups", authors: "Wukovitz SW, Yeates TO", year: "1995",
    title: "Why protein crystals favour some space-groups over others",
    source: "Nat Struct Biol 2:1062–1067", doi: "10.1038/nsb1295-1062",
  },
  {
    id: "yeates2012racemic", kind: "article", name: "Racemic protein crystallography", authors: "Yeates TO, Kent SBH", year: "2012",
    title: "Racemic protein crystallography",
    source: "Annu Rev Biophys 41:41–61", doi: "10.1146/annurev-biophys-050511-102333",
  },
  {
    id: "ita2016", kind: "book", name: "International Tables, Vol. A", authors: "Aroyo MI (ed.)", year: "2016",
    title: "International Tables for Crystallography, Volume A: Space-group symmetry",
    source: "International Union of Crystallography", doi: "10.1107/97809553602060000114",
  },
  {
    id: "ucbshift2", kind: "software", name: "UCBShift 2.0", authors: "Ptaszek AL, Li J, Konrat R, Platzer G, Head-Gordon T", year: "2024",
    title: "UCBShift 2.0: bridging the gap from backbone to side chain protein chemical shift prediction for protein structures",
    source: "J Am Chem Soc 146:31733–31745", doi: "10.1021/jacs.4c10474", url: "https://github.com/THGLab/CSpred",
    license: { name: "UC Regents, not-for-profit only", reuse: "restricted", url: "https://github.com/THGLab/CSpred/blob/master/LICENSE.txt", usage: "Method studied and cited; no code shipped." },
  },
  {
    id: "legolas2025", kind: "software", name: "LEGOLAS", authors: "Darrows MY, Kodituwakku D, Xue J, Pickering I, Terrel NS, Roitberg AE", year: "2025",
    title: "LEGOLAS: a machine learning method for rapid and accurate predictions of protein NMR chemical shifts",
    source: "J Chem Theory Comput 21:4266–4275", doi: "10.1021/acs.jctc.5c00026", url: "https://github.com/roitberg-group/legolas",
    license: { name: "MIT", reuse: "permissive", url: "https://github.com/roitberg-group/legolas", usage: "Method studied and cited; no code copied yet." },
  },
  {
    id: "shiftx2", kind: "software", name: "SHIFTX2", authors: "Han B, Liu Y, Ginzinger SW, Wishart DS", year: "2011",
    title: "SHIFTX2: significantly improved protein chemical shift prediction",
    source: "J Biomol NMR 50:43–57", doi: "10.1007/s10858-011-9478-4", url: "http://www.shiftx2.ca",
  },
  {
    id: "rdkit", kind: "software", name: "RDKit", authors: "RDKit contributors", year: "2006–",
    title: "RDKit: open-source cheminformatics",
    source: "rdkit.org", doi: "10.5281/zenodo.591637", url: "https://www.rdkit.org",
    license: { name: "BSD-3-Clause", reuse: "permissive", url: "https://github.com/rdkit/rdkit/blob/master/license.txt", usage: "Backend dependency for 2D ligand drawing and R/S, E/Z labels; notice in THIRD_PARTY_NOTICES.md." },
  },
  {
    id: "molstar", kind: "software", name: "Mol*", authors: "Sehnal D, Bittrich S, Deshpande M, Svobodová R, Berka K, Bazgier V, Velankar S, Burley SK, Koča J, Rose AS", year: "2021",
    title: "Mol* Viewer: modern web app for 3D visualization and analysis of large biomolecular structures",
    source: "Nucleic Acids Res 49:W431–W437", doi: "10.1093/nar/gkab314", url: "https://molstar.org",
    license: { name: "MIT", reuse: "permissive", url: "https://github.com/molstar/molstar/blob/master/LICENSE", usage: "Bundled as the 3D structure viewer." },
  },
  {
    id: "bmrb", kind: "database", name: "BMRB", authors: "Hoch JC, Baskaran K, Burr H, et al.", year: "2023",
    title: "Biological Magnetic Resonance Data Bank",
    source: "Nucleic Acids Res 51:D368–D376", doi: "10.1093/nar/gkac1050", url: "https://bmrb.io",
  },
  // Reading an HSQC spectrum (HOM-314).
  {
    id: "bodenhausen1980", kind: "article", name: "HSQC experiment", authors: "Bodenhausen G, Ruben DJ", year: "1980",
    title: "Natural abundance nitrogen-15 NMR by enhanced heteronuclear spectroscopy",
    source: "Chem Phys Lett 69:185–189", doi: "10.1016/0009-2614(80)80041-8",
  },
  {
    id: "kay1992", kind: "article", name: "Sensitivity-enhanced HSQC", authors: "Kay L, Keifer P, Saarinen T", year: "1992",
    title: "Pure absorption gradient enhanced heteronuclear single quantum correlation spectroscopy with improved sensitivity",
    source: "J Am Chem Soc 114:10663–10665", doi: "10.1021/ja00052a088",
  },
  {
    id: "cavanagh2007", kind: "book", name: "Protein NMR Spectroscopy", authors: "Cavanagh J, Fairbrother WJ, Palmer AG, Rance M, Skelton NJ", year: "2007",
    title: "Multidimensional NMR spectroscopy",
    source: "In: Protein NMR Spectroscopy: Principles and Practice, 2nd ed., Elsevier, pp. 271–332", doi: "10.1016/B978-012164491-8/50006-3",
  },
  {
    id: "pervushin1997", kind: "article", name: "TROSY", authors: "Pervushin K, Riek R, Wider G, Wüthrich K", year: "1997",
    title: "Attenuated T2 relaxation by mutual cancellation of dipole–dipole coupling and chemical shift anisotropy indicates an avenue to NMR structures of very large biological macromolecules in solution",
    source: "Proc Natl Acad Sci USA 94:12366–12371", doi: "10.1073/pnas.94.23.12366",
  },
  {
    id: "wishart1995", kind: "article", name: "Random-coil shifts", authors: "Wishart DS, Bigam CG, Holm A, Hodges RS, Sykes BD", year: "1995",
    title: "1H, 13C and 15N random coil NMR chemical shifts of the common amino acids. I. Investigations of nearest-neighbor effects",
    source: "J Biomol NMR 5:67–81", doi: "10.1007/BF00227471",
  },
  {
    id: "nmrfam-sparky", kind: "software", name: "NMRFAM-SPARKY", authors: "Lee W, Tonelli M, Markley JL", year: "2015",
    title: "NMRFAM-SPARKY: enhanced software for biomolecular NMR spectroscopy",
    source: "Bioinformatics 31:1325–1327", doi: "10.1093/bioinformatics/btu830", url: "https://nmrfam.wisc.edu/nmrfam-sparky-distribution/",
  },
  {
    id: "ccd", kind: "database", name: "Chemical Component Dictionary (CCD)", authors: "Westbrook JD, Shao C, Feng Z, Zhuravleva M, Velankar S, Young J", year: "2015",
    title: "The chemical component dictionary: complete descriptions of constituent molecules in experimentally determined 3D macromolecules in the Protein Data Bank",
    source: "Bioinformatics 31:1274–1278", doi: "10.1093/bioinformatics/btu789", url: "https://www.wwpdb.org/data/ccd",
  },
  // Reading a 2D ligand drawing (HOM-307): wedges and hashes, R/S and E/Z.
  {
    id: "iupac2006stereo", kind: "article", name: "IUPAC wedge and hash bonds", authors: "Brecher J", year: "2006",
    title: "Graphical representation of stereochemical configuration (IUPAC Recommendations 2006)",
    source: "Pure Appl Chem 78:1897–1970", doi: "10.1351/pac200678101897",
  },
  {
    id: "cip1966", kind: "article", name: "Cahn–Ingold–Prelog rules", authors: "Cahn RS, Ingold C, Prelog V", year: "1966",
    title: "Specification of molecular chirality",
    source: "Angew Chem Int Ed Engl 5:385–415", doi: "10.1002/anie.196603851",
  },
  {
    id: "iupac2013", kind: "book", name: "IUPAC Blue Book", authors: "Favre HA, Powell WH", year: "2013",
    title: "Nomenclature of Organic Chemistry: IUPAC Recommendations and Preferred Names 2013",
    source: "Royal Society of Chemistry, Cambridge", doi: "10.1039/9781849733069",
  },
  {
    id: "hanson2018cip", kind: "article", name: "CIP rules for software", authors: "Hanson RM, Musacchio S, Mayfield JW, Vainio MJ, Yerin A, Redkin D", year: "2018",
    title: "Algorithmic analysis of Cahn–Ingold–Prelog rules of stereochemistry: proposals for revised rules and a guide for machine implementation",
    source: "J Chem Inf Model 58:1755–1765", doi: "10.1021/acs.jcim.8b00324",
  },
  {
    id: "opencloning", kind: "software", name: "OpenCloning", authors: "Lera-Ramirez M", year: "2022",
    title: "OpenCloning backend", source: "GitHub", url: "https://github.com/OpenCloning/OpenCloning_backend",
    license: { name: "MIT", reuse: "permissive", url: "https://github.com/OpenCloning/OpenCloning_backend", usage: "Vector builder conventions adapted (backend 1.9.5)." },
  },
  // Crystallization practice (HOM-312): reviews, screen design papers and the
  // vendors' own formulation pages.
  {
    id: "mcpherson2014", kind: "article", authors: "McPherson A, Gavira JA", year: "2014",
    title: "Introduction to protein crystallization",
    source: "Acta Crystallogr F Struct Biol Commun 70:2–20", doi: "10.1107/S2053230X13033141",
  },
  {
    id: "chayen2008", kind: "article", authors: "Chayen NE, Saridakis E", year: "2008",
    title: "Protein crystallization: from purified protein to diffraction-quality crystal",
    source: "Nat Methods 5:147–153", doi: "10.1038/nmeth.f.203",
  },
  {
    id: "dessau2011", kind: "article", authors: "Dessau MA, Modis Y", year: "2011",
    title: "Protein crystallization for X-ray crystallography",
    source: "J Vis Exp 47:e2285", doi: "10.3791/2285",
  },
  {
    id: "asherie2004", kind: "article", authors: "Asherie N", year: "2004",
    title: "Protein crystallization and phase diagrams",
    source: "Methods 34:266–272", doi: "10.1016/j.ymeth.2004.03.028",
  },
  {
    id: "jancarik1991", kind: "article", name: "Sparse-matrix screening", authors: "Jancarik J, Kim SH", year: "1991",
    title: "Sparse matrix sampling: a screening method for crystallization of proteins",
    source: "J Appl Crystallogr 24:409–411", doi: "10.1107/S0021889891004430",
  },
  {
    id: "newman2005", kind: "article", name: "JCSG+ screen", authors: "Newman J, Egan D, Walter TS, Meged R, Berry I, Ben Jelloul M, et al.", year: "2005",
    title: "Towards rationalization of crystallization screening for small- to medium-sized academic laboratories: the PACT/JCSG+ strategy",
    source: "Acta Crystallogr D Biol Crystallogr 61:1426–1431", doi: "10.1107/S0907444905024984",
  },
  {
    id: "gorrec2009", kind: "article", name: "Morpheus screen", authors: "Gorrec F", year: "2009",
    title: "The MORPHEUS protein crystallization screen",
    source: "J Appl Crystallogr 42:1035–1042", doi: "10.1107/S0021889809042022",
  },
  {
    id: "newstead2008", kind: "article", name: "MemGold screen", authors: "Newstead S, Ferrandon S, Iwata S", year: "2008",
    title: "Rationalizing α-helical membrane protein crystallization",
    source: "Protein Sci 17:466–472", doi: "10.1110/ps.073263108",
  },
  {
    id: "parker2012", kind: "article", name: "MemGold2 screen", authors: "Parker JL, Newstead S", year: "2012",
    title: "Current trends in α-helical membrane protein crystallization: an update",
    source: "Protein Sci 21:1358–1365", doi: "10.1002/pro.2122",
  },
  {
    id: "caffrey2015", kind: "article", name: "Lipid cubic phase (in meso)", authors: "Caffrey M", year: "2015",
    title: "A comprehensive review of the lipid cubic phase or in meso method for crystallizing membrane and soluble proteins and complexes",
    source: "Acta Crystallogr F Struct Biol Commun 71:3–18", doi: "10.1107/S2053230X14026843",
  },
  {
    id: "dale2003", kind: "article", authors: "Dale GE, Oefner C, D'Arcy A", year: "2003",
    title: "The protein as a variable in protein crystallization",
    source: "J Struct Biol 142:88–97", doi: "10.1016/S1047-8477(03)00041-8",
  },
  {
    id: "hassell2007", kind: "article", authors: "Hassell AM, An G, Bledsoe RK, Bynum JM, Carter HL, Deng SJJ, et al.", year: "2007",
    title: "Crystallization of protein–ligand complexes",
    source: "Acta Crystallogr D Biol Crystallogr 63:72–79", doi: "10.1107/S0907444906047020",
  },
  {
    id: "mcpherson2006", kind: "article", authors: "McPherson A, Cudney B", year: "2006",
    title: "Searching for silver bullets: an alternative strategy for crystallizing macromolecules",
    source: "J Struct Biol 156:387–406", doi: "10.1016/j.jsb.2006.09.006",
  },
  {
    id: "hampton-index", kind: "website", name: "Index", authors: "Hampton Research", year: "2026",
    title: "Index • Index HT: product description and reagent formulation",
    source: "Hampton Research, Aliso Viejo, CA", url: "https://hamptonresearch.com/product-Index-Index-HT-5.html",
  },
  {
    id: "hampton-pegion", kind: "website", name: "PEG/Ion • PEG/Ion 2", authors: "Hampton Research", year: "2026",
    title: "PEG/Ion • PEG/Ion 2 • PEG/Ion HT: product description and reagent formulation",
    source: "Hampton Research, Aliso Viejo, CA", url: "https://hamptonresearch.com/product-PEG-Ion-PEG-Ion-2-PEG-Ion-HT-11.html",
  },
  {
    id: "md-jcsg-plus", kind: "website", name: "JCSG-plus", authors: "Molecular Dimensions", year: "2026",
    title: "JCSG-plus: product page and formulation sheet",
    source: "Molecular Dimensions (Calibre Scientific)", url: "https://moleculardimensions.com/en/category/jcsg-plus",
  },
  {
    id: "md-morpheus", kind: "website", name: "Morpheus", authors: "Molecular Dimensions", year: "2026",
    title: "Morpheus: product page and formulation sheet",
    source: "Molecular Dimensions (Calibre Scientific)", url: "https://moleculardimensions.com/en/category/morpheus-i",
  },
  {
    id: "md-memgold", kind: "website", name: "MemGold • MemGold2", authors: "Molecular Dimensions", year: "2026",
    title: "MemGold and MemGold2: product pages and formulation sheets",
    source: "Molecular Dimensions (Calibre Scientific)", url: "https://moleculardimensions.com/en/category/memgold",
  },
  {
    id: "hampton-index-guide", kind: "website", name: "Index user guide", authors: "Hampton Research", year: "2026",
    title: "Index (HR2-144) user guide: sample preparation, interpreting results and reagent formulation",
    source: "Hampton Research, Aliso Viejo, CA", url: "https://hamptonresearch.com/uploads/support_materials/HR2-144_docs.pdf",
  },
  {
    id: "pl-crystal-rules", kind: "rule", name: "Protein Labs rule of thumb", authors: "Protein Labs", year: "2026",
    title: "Starting points chosen for the Crystallize job, not taken from one published source; adjust them from what the first plate shows",
    source: "protein-labs-web/lib/crystallization-guidance.ts", url: "https://github.com/hammonsnick1/protein-lab/blob/main/protein-labs-web/lib/crystallization-guidance.ts",
  },
  // Buffer components (lib/buffer-component-library.ts): the references behind
  // the purification cautions the Crystallize guidance reuses.
  {
    id: "good1966", kind: "article", name: "Good's buffers", authors: "Good NE, Winget GD, Winter W, Connolly TN, Izawa S, Singh RMM", year: "1966",
    title: "Hydrogen ion buffers for biological research",
    source: "Biochemistry 5:467–477", doi: "10.1021/bi00866a011",
  },
  {
    id: "graslund2008", kind: "article", authors: "Structural Genomics Consortium, et al.", year: "2008",
    title: "Protein production and purification",
    source: "Nat Methods 5:135–146", doi: "10.1038/nmeth.f.202",
  },
  {
    id: "bondos2003", kind: "article", authors: "Bondos SE, Bicknell A", year: "2003",
    title: "Detection and prevention of protein aggregation before, during, and after purification",
    source: "Anal Biochem 316:223–231", doi: "10.1016/S0003-2697(03)00059-9",
  },
  {
    id: "getz1999", kind: "article", authors: "Getz EB, Xiao M, Chakrabarty T, Cooke R, Selvin PR", year: "1999",
    title: "A comparison between the sulfhydryl reductants tris(2-carboxyethyl)phosphine and dithiothreitol for use in protein biochemistry",
    source: "Anal Biochem 273:73–80", doi: "10.1006/abio.1999.4203",
  },
  {
    id: "vagenende2009", kind: "article", authors: "Vagenende V, Yap MGS, Trout BL", year: "2009",
    title: "Mechanisms of protein stabilization and prevention of protein aggregation by glycerol",
    source: "Biochemistry 48:11084–11096", doi: "10.1021/bi900649t",
  },
  {
    id: "seddon2004", kind: "article", authors: "Seddon AM, Curnow P, Booth PJ", year: "2004",
    title: "Membrane proteins, lipids and detergents: not just a soap opera",
    source: "Biochim Biophys Acta 1666:105–117", doi: "10.1016/j.bbamem.2004.04.011",
  },
  // Crystal packing (HOM-311): contact rules and the PDB learning examples.
  {
    id: "carugo1997", kind: "article", name: "Crystal-packing contacts", authors: "Carugo O, Argos P", year: "1997",
    title: "Protein–protein crystal-packing contacts",
    source: "Protein Sci 6:2261–2263", doi: "10.1002/pro.5560061021",
  },
  {
    id: "bakerhubbard1984", kind: "article", name: "Hydrogen bonds in proteins", authors: "Baker EN, Hubbard RE", year: "1984",
    title: "Hydrogen bonding in globular proteins",
    source: "Prog Biophys Mol Biol 44:97–179", doi: "10.1016/0079-6107(84)90007-5",
  },
  {
    id: "word1999", kind: "article", name: "MolProbity contact dots", authors: "Word JM, Lovell SC, LaBean TH, Taylor HC, et al.", year: "1999",
    title: "Visualizing and quantifying molecular goodness-of-fit: small-probe contact dots with explicit hydrogen atoms",
    source: "J Mol Biol 285:1711–1733", doi: "10.1006/jmbi.1998.2400",
  },
  {
    id: "bondi1964", kind: "article", name: "Van der Waals radii", authors: "Bondi A", year: "1964",
    title: "van der Waals volumes and radii",
    source: "J Phys Chem 68:441–451", doi: "10.1021/j100785a001",
  },
  {
    id: "vijaykumar1987", kind: "article", name: "PDB 1UBQ", authors: "Vijay-Kumar S, Bugg CE, Cook WJ", year: "1987",
    title: "Structure of ubiquitin refined at 1.8 Å resolution",
    source: "J Mol Biol 194:531–544", doi: "10.1016/0022-2836(87)90679-6",
  },
  {
    id: "teeter1984", kind: "article", name: "PDB 1CRN", authors: "Teeter MM", year: "1984",
    title: "Water structure of a hydrophobic protein at atomic resolution: pentagon rings of water molecules in crystals of crambin",
    source: "Proc Natl Acad Sci USA 81:6014–6018", doi: "10.1073/pnas.81.19.6014",
  },
  {
    id: "ramanadham1990", kind: "article", name: "PDB 2LZT", authors: "Ramanadham M, Sieker LC, Jensen LH", year: "1990",
    title: "Refinement of triclinic lysozyme: II. The method of stereochemically restrained least squares",
    source: "Acta Crystallogr B 46:63–69", doi: "10.1107/S0108768189009195",
  },
  {
    id: "vaney1996", kind: "article", name: "PDB 193L", authors: "Vaney MC, Maignan S, Riès-Kautt M, Ducruix A", year: "1996",
    title: "High-resolution structure (1.33 Å) of a HEW lysozyme tetragonal crystal grown in the APCF apparatus",
    source: "Acta Crystallogr D 52:505–517", doi: "10.1107/S090744499501674X",
  },
  {
    id: "kumaraswamy1996", kind: "article", name: "PDB 1AMM", authors: "Kumaraswamy VS, Lindley PF, Slingsby C, Glover ID", year: "1996",
    title: "An eye lens protein–water structure: 1.2 Å resolution structure of γB-crystallin at 150 K",
    source: "Acta Crystallogr D 52:611–622", doi: "10.1107/S0907444995014302",
  },
  {
    id: "loris2003", kind: "article", name: "PDB 1OUR", authors: "Loris R, Tielker D, Jaeger KE, Wyns L", year: "2003",
    title: "Structural basis of carbohydrate recognition by the lectin LecB from Pseudomonas aeruginosa",
    source: "J Mol Biol 331:861–870", doi: "10.1016/S0022-2836(03)00754-X",
  },
  {
    id: "baker1988", kind: "article", name: "PDB 4INS", authors: "Baker EN, Blundell TL, Cutfield JF, Dodson EJ, et al.", year: "1988",
    title: "The structure of 2Zn pig insulin crystals at 1.5 Å resolution",
    source: "Philos Trans R Soc Lond B 319:369–456", doi: "10.1098/rstb.1988.0058",
  },
] as const satisfies readonly Citation[];

export type CitationId = (typeof entries)[number]["id"];

export const citations: Readonly<Record<CitationId, Citation>> = Object.fromEntries(entries.map((entry) => [entry.id, entry])) as Record<CitationId, Citation>;

export function getCitation(id: CitationId): Citation { return citations[id]; }

/** The link a reader follows: the DOI when there is one, otherwise the URL. */
export function citationHref(citation: Citation): string | null {
  if (citation.doi) return `https://doi.org/${citation.doi}`;
  return citation.url ?? null;
}

/** "Han et al. 2011" — for marker tooltips and running text. */
export function citationShortLabel(citation: Citation): string {
  const names = citation.authors.replace(/,?\s*et al\.$/, "").split(",").map((name) => name.trim()).filter(Boolean);
  const family = (name: string) => name.replace(/\s+\(ed\.\)$/, "").replace(/\s+[A-Z]+$/, "");
  const who = names.length === 0 ? citation.source
    : names.length === 1 && !/et al\.$/.test(citation.authors) ? family(names[0])
    : names.length === 2 ? `${family(names[0])} & ${family(names[1])}`
    : `${family(names[0])} et al.`;
  return `${who} ${citation.year}`;
}

/** A numbered reference list for one job or panel. Markers and the list read numbers from here, so they always agree. */
export type CitationScope = {
  /** Unique per screen; used for the anchor ids of the list items. */
  key: string;
  ids: readonly CitationId[];
  number: (id: CitationId) => number;
  anchor: (id: CitationId) => string;
};

/** Numbers follow the order given; duplicates keep their first number. */
export function citationScope(key: string, ids: readonly CitationId[]): CitationScope {
  const ordered = [...new Set(ids)];
  const numbers = new Map(ordered.map((id, index) => [id, index + 1]));
  return {
    key,
    ids: ordered,
    number: (id) => {
      const value = numbers.get(id);
      if (value === undefined) throw new Error(`Citation "${id}" is not in the "${key}" reference list.`);
      return value;
    },
    anchor: (id) => `ref-${key}-${id}`,
  };
}

/** Every entry with a recorded licence, for the Licences section. */
export function licenseRegister(): (Citation & { license: CitationLicense })[] {
  return (entries as readonly Citation[])
    .filter((entry): entry is Citation & { license: CitationLicense } => entry.license !== undefined)
    .sort((a, b) => (a.name ?? a.title).localeCompare(b.name ?? b.title));
}

export const LICENSE_REUSE_LABELS: Record<LicenseReuse, string> = {
  permissive: "Reuse allowed with notice",
  restricted: "Restricted use",
  none: "Cite only — no reuse",
};
