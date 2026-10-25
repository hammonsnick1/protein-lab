// Expression host catalog for the Expression system job.
//
// Every host family and strain carries referenced information so the screen can
// show where a claim comes from. References are split into `literature` entries,
// each with a DOI that was resolved against Crossref/PubMed before being added
// here, and `vendor` entries, which are product documentation cited by catalog
// number because the vendor sites are not citable by DOI. Do not add an entry
// without checking it: the UI prints these as evidence.
//
// The catalog is data-driven so a new strain only needs a record here. Numbers
// that are a property of the family rather than the strain live on the family
// and are inherited by `hostMetrics`, which marks inherited cells so the
// comparison table can say "family typical" instead of implying a measurement.

export type HostSystem = "ecoli" | "yeast" | "insect" | "mammalian" | "cellfree";
export const hostSystems: HostSystem[] = ["ecoli", "yeast", "insect", "mammalian", "cellfree"];

export type ReferenceKind = "literature" | "vendor";
export type Reference = { id: string; kind: ReferenceKind; authors: string; year: string; title: string; source: string; doi?: string };

export const expressionReferences: Record<string, Reference> = {
  rosano2014: { id: "rosano2014", kind: "literature", authors: "Rosano GL, Ceccarelli EA", year: "2014", title: "Recombinant protein expression in Escherichia coli: advances and challenges", source: "Front Microbiol 5:172", doi: "10.3389/fmicb.2014.00172" },
  gileadi2017: { id: "gileadi2017", kind: "literature", authors: "Gileadi O", year: "2017", title: "Recombinant protein expression in E. coli: a historical perspective", source: "Methods Mol Biol 1586:3–10", doi: "10.1007/978-1-4939-6887-9_1" },
  studier1986: { id: "studier1986", kind: "literature", authors: "Studier FW, Moffatt BA", year: "1986", title: "Use of bacteriophage T7 RNA polymerase to direct selective high-level expression of cloned genes", source: "J Mol Biol 189:113–130", doi: "10.1016/0022-2836(86)90385-2" },
  studier1991: { id: "studier1991", kind: "literature", authors: "Studier FW", year: "1991", title: "Use of bacteriophage T7 lysozyme to improve an inducible T7 expression system", source: "J Mol Biol 219:37–44", doi: "10.1016/0022-2836(91)90855-Z" },
  studier2005: { id: "studier2005", kind: "literature", authors: "Studier FW", year: "2005", title: "Protein production by auto-induction in high-density shaking cultures", source: "Protein Expr Purif 41:207–234", doi: "10.1016/j.pep.2005.01.016" },
  guzman1995: { id: "guzman1995", kind: "literature", authors: "Guzman LM, Belin D, Carson MJ, Beckwith J", year: "1995", title: "Tight regulation, modulation, and high-level expression by vectors containing the arabinose PBAD promoter", source: "J Bacteriol 177:4121–4130", doi: "10.1128/jb.177.14.4121-4130.1995" },
  lopez1999: { id: "lopez1999", kind: "literature", authors: "Lopez PJ, Marchand I, Joyce SA, Dreyfus M", year: "1999", title: "The C-terminal half of RNase E, which organizes the E. coli degradosome, participates in mRNA degradation but not rRNA processing in vivo", source: "Mol Microbiol 33:188–199", doi: "10.1046/j.1365-2958.1999.01465.x" },
  fernandezcastane2012: { id: "fernandezcastane2012", kind: "literature", authors: "Fernández-Castané A, Vine CE, Caminal G, López-Santín J", year: "2012", title: "Evidencing the role of lactose permease in IPTG uptake by Escherichia coli in fed-batch high cell density cultures", source: "J Biotechnol 157:391–398", doi: "10.1016/j.jbiotec.2011.12.007" },
  gustafsson2004: { id: "gustafsson2004", kind: "literature", authors: "Gustafsson C, Govindarajan S, Minshull J", year: "2004", title: "Codon bias and heterologous protein expression", source: "Trends Biotechnol 22:346–353", doi: "10.1016/j.tibtech.2004.04.006" },
  bessette1999: { id: "bessette1999", kind: "literature", authors: "Bessette PH, Åslund F, Beckwith J, Georgiou G", year: "1999", title: "Efficient folding of proteins with multiple disulfide bonds in the Escherichia coli cytoplasm", source: "Proc Natl Acad Sci USA 96:13703–13708", doi: "10.1073/pnas.96.24.13703" },
  lobstein2012: { id: "lobstein2012", kind: "literature", authors: "Lobstein J, Emrich CA, Jeans C, Faulkner M, Riggs P, Berkmen M", year: "2012", title: "SHuffle, a novel Escherichia coli protein expression strain capable of correctly folding disulfide bonded proteins in its cytoplasm", source: "Microb Cell Fact 11:56", doi: "10.1186/1475-2859-11-56" },
  wagner2008: { id: "wagner2008", kind: "literature", authors: "Wagner S, Klepsch MM, Schlegel S, et al.", year: "2008", title: "Tuning Escherichia coli for membrane protein overexpression", source: "Proc Natl Acad Sci USA 105:14371–14376", doi: "10.1073/pnas.0804090105" },
  miroux1996: { id: "miroux1996", kind: "literature", authors: "Miroux B, Walker JE", year: "1996", title: "Over-production of proteins in Escherichia coli: mutant hosts that allow synthesis of some membrane proteins and globular proteins at high levels", source: "J Mol Biol 260:289–298", doi: "10.1006/jmbi.1996.0399" },
  ferrer2003: { id: "ferrer2003", kind: "literature", authors: "Ferrer M, Chernikova TN, Yakimov MM, Golyshin PN, Timmis KN", year: "2003", title: "Chaperonins govern growth of Escherichia coli at low temperatures", source: "Nat Biotechnol 21:1266–1267", doi: "10.1038/nbt1103-1266" },
  robichon2011: { id: "robichon2011", kind: "literature", authors: "Robichon C, Luo J, Causey TB, Benner JS, Sambrook JC", year: "2011", title: "Engineering Escherichia coli BL21(DE3) derivative strains to minimize E. coli protein contamination after purification by immobilized metal affinity chromatography", source: "Appl Environ Microbiol 77:4634–4646", doi: "10.1128/AEM.00119-11" },
  brachmann1998: { id: "brachmann1998", kind: "literature", authors: "Brachmann CB, Davies A, Cost GJ, et al.", year: "1998", title: "Designer deletion strains derived from Saccharomyces cerevisiae S288C: a useful set of strains and plasmids for PCR-mediated gene disruption and other applications", source: "Yeast 14:115–132", doi: "10.1002/(SICI)1097-0061(19980130)14:2<115::AID-YEA204>3.0.CO;2-2" },
  johnston1984: { id: "johnston1984", kind: "literature", authors: "Johnston M, Davis RW", year: "1984", title: "Sequences that regulate the divergent GAL1-GAL10 promoter in Saccharomyces cerevisiae", source: "Mol Cell Biol 4:1440–1448", doi: "10.1128/mcb.4.8.1440" },
  sikorski1989: { id: "sikorski1989", kind: "literature", authors: "Sikorski RS, Hieter P", year: "1989", title: "A system of shuttle vectors and yeast host strains designed for efficient manipulation of DNA in Saccharomyces cerevisiae", source: "Genetics 122:19–27", doi: "10.1093/genetics/122.1.19" },
  boder1997: { id: "boder1997", kind: "literature", authors: "Boder ET, Wittrup KD", year: "1997", title: "Yeast surface display for screening combinatorial polypeptide libraries", source: "Nat Biotechnol 15:553–557", doi: "10.1038/nbt0697-553" },
  chao2006: { id: "chao2006", kind: "literature", authors: "Chao G, Lau WL, Hackel BJ, Sazinsky SL, Lippow SM, Wittrup KD", year: "2006", title: "Isolating and engineering human antibodies using yeast surface display", source: "Nat Protoc 1:755–768", doi: "10.1038/nprot.2006.94" },
  cregg1985: { id: "cregg1985", kind: "literature", authors: "Cregg JM, Barringer KJ, Hessler AY, Madden KR", year: "1985", title: "Pichia pastoris as a host system for transformations", source: "Mol Cell Biol 5:3376–3385", doi: "10.1128/mcb.5.12.3376" },
  cregg1993: { id: "cregg1993", kind: "literature", authors: "Cregg JM, Vedvick TS, Raschke WC", year: "1993", title: "Recent advances in the expression of foreign genes in Pichia pastoris", source: "Nat Biotechnol 11:905–910", doi: "10.1038/nbt0893-905" },
  cereghino2000: { id: "cereghino2000", kind: "literature", authors: "Cereghino JL, Cregg JM", year: "2000", title: "Heterologous protein expression in the methylotrophic yeast Pichia pastoris", source: "FEMS Microbiol Rev 24:45–66", doi: "10.1111/j.1574-6976.2000.tb00532.x" },
  ahmad2014: { id: "ahmad2014", kind: "literature", authors: "Ahmad M, Hirz M, Pichler H, Schwab H", year: "2014", title: "Protein expression in Pichia pastoris: recent achievements and perspectives for heterologous protein production", source: "Appl Microbiol Biotechnol 98:5301–5317", doi: "10.1007/s00253-014-5732-5" },
  karbalaei2020: { id: "karbalaei2020", kind: "literature", authors: "Karbalaei M, Rezaee SA, Farsiani H", year: "2020", title: "Pichia pastoris: a highly successful expression system for optimal synthesis of heterologous proteins", source: "J Cell Physiol 235:5867–5881", doi: "10.1002/jcp.29583" },
  sinha2005: { id: "sinha2005", kind: "literature", authors: "Sinha J, Plantz BA, Inan M, Meagher MM", year: "2005", title: "Causes of proteolytic degradation of secreted recombinant proteins produced in methylotrophic yeast Pichia pastoris: case study with recombinant ovine interferon-tau", source: "Biotechnol Bioeng 89:102–112", doi: "10.1002/bit.20318" },
  vaughn1977: { id: "vaughn1977", kind: "literature", authors: "Vaughn JL, Goodwin RH, Tompkins GJ, McCawley P", year: "1977", title: "The establishment of two cell lines from the insect Spodoptera frugiperda (Lepidoptera; Noctuidae)", source: "In Vitro 13:213–217", doi: "10.1007/BF02615077" },
  wickham1992: { id: "wickham1992", kind: "literature", authors: "Wickham TJ, Davis T, Granados RR, Shuler ML, Wood HA", year: "1992", title: "Screening of insect cell lines for the production of recombinant proteins and infectious virus in the baculovirus expression system", source: "Biotechnol Prog 8:391–396", doi: "10.1021/bp00017a003" },
  luckow1993: { id: "luckow1993", kind: "literature", authors: "Luckow VA, Lee SC, Barry GF, Olins PO", year: "1993", title: "Efficient generation of infectious recombinant baculoviruses by site-specific transposon-mediated insertion of foreign genes into a baculovirus genome propagated in Escherichia coli", source: "J Virol 67:4566–4579", doi: "10.1128/jvi.67.8.4566-4579.1993" },
  vanoers2015: { id: "vanoers2015", kind: "literature", authors: "van Oers MM, Pijlman GP, Vlak JM", year: "2015", title: "Thirty years of baculovirus–insect cell protein expression: from dark horse to mainstream technology", source: "J Gen Virol 96:6–23", doi: "10.1099/vir.0.067108-0" },
  harrison2006: { id: "harrison2006", kind: "literature", authors: "Harrison RL, Jarvis DL", year: "2006", title: "Protein N-glycosylation in the baculovirus–insect cell expression system and engineering of insect cells to produce 'mammalianized' recombinant glycoproteins", source: "Adv Virus Res 68:159–191", doi: "10.1016/S0065-3527(06)68005-6" },
  kost2005: { id: "kost2005", kind: "literature", authors: "Kost TA, Condreay JP, Jarvis DL", year: "2005", title: "Baculovirus as versatile vectors for protein expression in insect and mammalian cells", source: "Nat Biotechnol 23:567–575", doi: "10.1038/nbt1095" },
  fernandes2013: { id: "fernandes2013", kind: "literature", authors: "Fernandes F, Teixeira AP, Carinhas N, Carrondo MJT, Alves PM", year: "2013", title: "Insect cells as a production platform of complex virus-like particles", source: "Expert Rev Vaccines 12:225–236", doi: "10.1586/erv.12.153" },
  schneider1972: { id: "schneider1972", kind: "literature", authors: "Schneider I", year: "1972", title: "Cell lines derived from late embryonic stages of Drosophila melanogaster", source: "J Embryol Exp Morphol 27:353–365", doi: "10.1242/dev.27.2.353" },
  graham1977: { id: "graham1977", kind: "literature", authors: "Graham FL, Smiley J, Russell WC, Nairn R", year: "1977", title: "Characteristics of a human cell line transformed by DNA from human adenovirus type 5", source: "J Gen Virol 36:59–72", doi: "10.1099/0022-1317-36-1-59" },
  thomas2005: { id: "thomas2005", kind: "literature", authors: "Thomas P, Smart TG", year: "2005", title: "HEK293 cell line: a vehicle for the expression of recombinant proteins", source: "J Pharmacol Toxicol Methods 51:187–200", doi: "10.1016/j.vascn.2004.08.014" },
  durocher2002: { id: "durocher2002", kind: "literature", authors: "Durocher Y, Perret S, Kamen A", year: "2002", title: "High-level and high-throughput recombinant protein production by transient transfection of suspension-growing human 293-EBNA1 cells", source: "Nucleic Acids Res 30:e9", doi: "10.1093/nar/30.2.e9" },
  jager2013: { id: "jager2013", kind: "literature", authors: "Jäger V, Büssow K, Wagner A, et al.", year: "2013", title: "High level transient production of recombinant antibodies and antibody fusion proteins in HEK293 cells", source: "BMC Biotechnol 13:52", doi: "10.1186/1472-6750-13-52" },
  wurm2004: { id: "wurm2004", kind: "literature", authors: "Wurm FM", year: "2004", title: "Production of recombinant protein therapeutics in cultivated mammalian cells", source: "Nat Biotechnol 22:1393–1398", doi: "10.1038/nbt1026" },
  dumont2016: { id: "dumont2016", kind: "literature", authors: "Dumont J, Euwart D, Mei B, Estes S, Kshirsagar R", year: "2016", title: "Human cell lines for biopharmaceutical manufacturing: history, status, and future perspectives", source: "Crit Rev Biotechnol 36:1110–1122", doi: "10.3109/07388551.2015.1084266" },
  xu2011: { id: "xu2011", kind: "literature", authors: "Xu X, Nagarajan H, Lewis NE, et al.", year: "2011", title: "The genomic sequence of the Chinese hamster ovary (CHO)-K1 cell line", source: "Nat Biotechnol 29:735–741", doi: "10.1038/nbt.1932" },
  puck1958: { id: "puck1958", kind: "literature", authors: "Puck TT, Cieciura SJ, Robinson A", year: "1958", title: "Genetics of somatic mammalian cells III: long-term cultivation of euploid cells from human and animal subjects", source: "J Exp Med 108:945–956", doi: "10.1084/jem.108.6.945" },
  urlaub1983: { id: "urlaub1983", kind: "literature", authors: "Urlaub G, Käs E, Carothers AM, Chasin LA", year: "1983", title: "Deletion of the diploid dihydrofolate reductase locus from cultured mammalian cells", source: "Cell 33:405–412", doi: "10.1016/0092-8674(83)90422-1" },
  carlson2012: { id: "carlson2012", kind: "literature", authors: "Carlson ED, Gan R, Hodgman CE, Jewett MC", year: "2012", title: "Cell-free protein synthesis: applications come of age", source: "Biotechnol Adv 30:1185–1194", doi: "10.1016/j.biotechadv.2011.09.016" },
  gregorio2019: { id: "gregorio2019", kind: "literature", authors: "Gregorio NE, Levine MZ, Oza JP", year: "2019", title: "A user's guide to cell-free protein synthesis", source: "Methods Protoc 2:24", doi: "10.3390/mps2010024" },
  caschera2014: { id: "caschera2014", kind: "literature", authors: "Caschera F, Noireaux V", year: "2014", title: "Synthesis of 2.3 mg/ml of protein with an all Escherichia coli cell-free transcription–translation system", source: "Biochimie 99:162–168", doi: "10.1016/j.biochi.2013.11.025" },
  schwarz2007: { id: "schwarz2007", kind: "literature", authors: "Schwarz D, Junge F, Durst F, et al.", year: "2007", title: "Preparative scale expression of membrane proteins in Escherichia coli-based continuous exchange cell-free systems", source: "Nat Protoc 2:2945–2957", doi: "10.1038/nprot.2007.426" },
  shimizu2001: { id: "shimizu2001", kind: "literature", authors: "Shimizu Y, Inoue A, Tomari Y, et al.", year: "2001", title: "Cell-free translation reconstituted with purified components", source: "Nat Biotechnol 19:751–755", doi: "10.1038/90802" },
  takai2010: { id: "takai2010", kind: "literature", authors: "Takai K, Sawasaki T, Endo Y", year: "2010", title: "Practical cell-free protein synthesis system using purified wheat embryos", source: "Nat Protoc 5:227–238", doi: "10.1038/nprot.2009.207" },
  sawasaki2002: { id: "sawasaki2002", kind: "literature", authors: "Sawasaki T, Ogasawara T, Morishita R, Endo Y", year: "2002", title: "A cell-free protein synthesis system for high-throughput proteomics", source: "Proc Natl Acad Sci USA 99:14652–14657", doi: "10.1073/pnas.232580399" },
  nebStrains: { id: "nebStrains", kind: "vendor", authors: "New England Biolabs", year: "current", title: "Competent E. coli strain selection guide and product manuals (BL21(DE3) C2527, BL21 C2530, Lemo21(DE3) C2528, NiCo21(DE3) C2529, T7 Express lysY/Iq C3013, SHuffle T7 Express C3029, SHuffle T7 Express lysY C3030, NEBExpress Iq C3037)", source: "NEB product documentation" },
  novagenStrains: { id: "novagenStrains", kind: "vendor", authors: "Merck/Novagen", year: "current", title: "pET system manual and competent-cell genotype tables (Rosetta 2, Tuner, Origami B, Rosetta-gami B, Duet vectors)", source: "Novagen technical documentation" },
  thermoStrains: { id: "thermoStrains", kind: "vendor", authors: "Thermo Fisher Scientific", year: "current", title: "E. coli genotype tables and user guides (BL21-AI, BL21 Star(DE3), One Shot competent cells)", source: "Thermo Fisher product documentation" },
  agilentStrains: { id: "agilentStrains", kind: "vendor", authors: "Agilent Technologies", year: "current", title: "ArcticExpress(DE3) RIL and BL21-CodonPlus(DE3) competent-cell instruction manuals", source: "Agilent product documentation" },
  lgcWalker: { id: "lgcWalker", kind: "vendor", authors: "LGC Biosearch Technologies", year: "current", title: "OverExpress C41(DE3) and C43(DE3) competent-cell documentation", source: "Vendor product documentation" },
  pichiaManual: { id: "pichiaManual", kind: "vendor", authors: "Thermo Fisher Scientific (Invitrogen)", year: "current", title: "EasySelect Pichia Expression Kit, pPICZ/pPICZα and pGAPZ/pGAPZα manuals, and Pichia host-strain tables (X-33, GS115, KM71H, SMD1168H)", source: "Vendor product documentation" },
  pyesManual: { id: "pyesManual", kind: "vendor", authors: "Thermo Fisher Scientific (Invitrogen)", year: "current", title: "pYES2 and INVSc1 S. cerevisiae expression manuals", source: "Vendor product documentation" },
  expiSystems: { id: "expiSystems", kind: "vendor", authors: "Thermo Fisher Scientific", year: "current", title: "Expi293, ExpiCHO-S and ExpiSf expression system user guides", source: "Vendor product documentation" },
  bacToBac: { id: "bacToBac", kind: "vendor", authors: "Thermo Fisher Scientific (Invitrogen)", year: "current", title: "Bac-to-Bac baculovirus expression system and Drosophila Expression System (pMT/BiP, pAc5.1, pIB) manuals", source: "Vendor product documentation" },
  cfpsKits: { id: "cfpsKits", kind: "vendor", authors: "New England Biolabs / Takara Bio / Cube Biotech", year: "current", title: "PURExpress in vitro protein synthesis, WEPRO wheat-germ and E. coli lysate cell-free kit manuals", source: "Vendor product documentation" },
};

export type Meter = { level: number; label: string };
export type HostMetrics = { yield: string; timeToProtein: string; cost: Meter; ptm: Meter; disulfides: Meter; scale: string; commonUses: string; mainLimit: string };
export type MetricKey = keyof HostMetrics;
export type MetricColumn = { key: MetricKey; label: string; hint: string; kind: "text" | "meter"; max: number };

// Column order is the comparison table's row order. `max` is the number of pips
// drawn for an ordinal metric, so the scale reads the same in every row.
export const metricColumns: MetricColumn[] = [
  { key: "yield", label: "Typical yield", hint: "Reported range for a well-behaved target; a difficult one can be orders of magnitude lower.", kind: "text", max: 0 },
  { key: "timeToProtein", label: "Time to protein", hint: "From a finished expression construct to purified material.", kind: "text", max: 0 },
  { key: "cost", label: "Relative cost", hint: "Media, reagents and hands-on time per milligram.", kind: "meter", max: 4 },
  { key: "ptm", label: "Post-translational modification", hint: "Glycosylation and other eukaryotic processing the host can perform.", kind: "meter", max: 4 },
  { key: "disulfides", label: "Disulfide bonds", hint: "Where the system can form native disulfide bonds.", kind: "meter", max: 3 },
  { key: "scale", label: "Practical scale", hint: "Volumes the system is routinely run at.", kind: "text", max: 0 },
  { key: "commonUses", label: "Common uses", hint: "What this system is usually chosen for.", kind: "text", max: 0 },
  { key: "mainLimit", label: "Main limit", hint: "The constraint most likely to decide against it.", kind: "text", max: 0 },
];

const cost = { low: { level: 1, label: "Low" }, moderate: { level: 2, label: "Moderate" }, high: { level: 3, label: "High" }, veryHigh: { level: 4, label: "Very high" } } satisfies Record<string, Meter>;
const ptm = { none: { level: 0, label: "None" }, yeast: { level: 2, label: "Yeast-type glycans" }, insect: { level: 3, label: "Insect-type glycans" }, human: { level: 4, label: "Human-like" } } satisfies Record<string, Meter>;
const disulfide = { reducing: { level: 0, label: "Reducing cytoplasm" }, periplasm: { level: 1, label: "Periplasm / export only" }, engineered: { level: 2, label: "Engineered cytoplasm" }, secretory: { level: 3, label: "Native secretory pathway" } } satisfies Record<string, Meter>;

export type ExpressionHost = {
  id: string; name: string; aka?: string; category: string; lineage: string; promoter: string; genotype: string;
  usefulFor: string; bestFor: string[]; markers: string; caution: string; color: string;
  strengths: string[]; limits: string[]; referenceIds: string[]; metrics?: Partial<HostMetrics>;
};
export type HostFamily = { id: HostSystem; name: string; shortName: string; subtitle: string; summary: string; color: string; metrics: HostMetrics; strengths: string[]; limits: string[]; referenceIds: string[] };

export const hostFamilies: Record<HostSystem, HostFamily> = {
  ecoli: {
    id: "ecoli", name: "Escherichia coli", shortName: "E. coli", subtitle: "Bacterial · fastest route to protein",
    summary: "The default first attempt. Growth is fast and cheap, the genetics are well understood, and engineered strains exist for most failure modes — but there is no glycosylation and the reducing cytoplasm fights disulfide-bonded and secreted proteins.",
    color: "#35b99a",
    metrics: {
      yield: "10–100 mg/L in shake flasks for a soluble target; much higher in fermenters", timeToProtein: "2–4 days from transformation to purified protein",
      cost: cost.low, ptm: ptm.none, disulfides: disulfide.periplasm,
      scale: "1 mL screens to >100 L fermentation", commonUses: "Structural biology, enzymes, fusion-tagged domains, antibody fragments, isotope labelling",
      mainLimit: "No glycosylation; eukaryotic, secreted and membrane targets often end up in inclusion bodies",
    },
    strengths: ["Doubling time of ~20–30 min, so a screen turns around in a day", "Dozens of characterised strains and a large inducible-promoter toolkit", "Cheapest per milligram and the easiest system to label with ¹⁵N/¹³C"],
    limits: ["No N-linked glycosylation and limited other eukaryotic processing", "The cytoplasm is reducing, so disulfide-rich proteins need export or an engineered strain", "Codon usage, toxicity and misfolding each need a different strain or vector answer"],
    referenceIds: ["rosano2014", "gileadi2017", "studier1986"],
  },
  yeast: {
    id: "yeast", name: "Yeast", shortName: "Yeast", subtitle: "Eukaryotic microbe · secretion at microbial cost",
    summary: "Eukaryotic folding, secretion and disulfide formation at close to microbial cost. Saccharomyces is the genetics workhorse; Komagataella (Pichia) is the secretion and fermentation workhorse, at the price of clone screening and methanol handling.",
    color: "#e09a3e",
    metrics: {
      yield: "1–100 mg/L in flasks; g/L is achievable for secreted protein in Pichia fed-batch", timeToProtein: "1–3 weeks — longer for Pichia, which needs integration and clone screening",
      cost: cost.moderate, ptm: ptm.yeast, disulfides: disulfide.secretory,
      scale: "Shake flask to high-cell-density fermenter", commonUses: "Secreted enzymes, surface display and library selection, membrane proteins, industrial proteins",
      mainLimit: "Hypermannosylated glycans are not human; AOX1 workflows add methanol control and clone screening",
    },
    strengths: ["Secretory pathway with chaperones, disulfide isomerases and signal-peptide processing", "Grows on defined media to very high cell density", "Auxotrophic markers and plasmid copy-number choices give fine control over expression level"],
    limits: ["N-glycans are high-mannose/hypermannosylated and immunogenic in humans", "Secreted product can be clipped by vacuolar and extracellular proteases", "Integrating Pichia vectors means screening clones for copy number and Mut phenotype"],
    referenceIds: ["karbalaei2020", "cereghino2000", "ahmad2014"],
  },
  insect: {
    id: "insect", name: "Insect cells", shortName: "Insect", subtitle: "BEVS · large and multi-subunit complexes",
    summary: "The baculovirus expression vector system is the usual answer for multi-subunit complexes, large secreted glycoproteins and virus-like particles. Expression is strong and the folding machinery is eukaryotic; the cost is three to five weeks of virus work.",
    color: "#3f9a63",
    metrics: {
      yield: "1–50 mg/L; 5–20 mg/L is typical for secreted proteins and assembled complexes", timeToProtein: "3–5 weeks including bacmid generation, virus amplification and titration",
      cost: cost.high, ptm: ptm.insect, disulfides: disulfide.secretory,
      scale: "25 mL shake flask to >100 L bioreactor", commonUses: "Multi-subunit complexes, virus-like particles and vaccines, kinases, membrane proteins",
      mainLimit: "Virus generation adds weeks, and the glycans are paucimannose rather than human",
    },
    strengths: ["Co-expression of several subunits from one virus is routine", "Handles large and heavily disulfide-bonded secreted proteins", "Serum-free suspension culture scales predictably into bioreactors"],
    limits: ["Bacmid → virus → amplification → titration is a multi-week pipeline before any protein", "N-glycans are trimmed to paucimannose with little sialylation unless the line is engineered", "Infected cultures lyse late in infection, which releases host proteases into the medium"],
    referenceIds: ["vanoers2015", "harrison2006", "kost2005", "fernandes2013"],
  },
  mammalian: {
    id: "mammalian", name: "Mammalian cells", shortName: "Mammalian", subtitle: "Human-like processing · therapeutic-grade",
    summary: "The system to use when the protein must be processed like the human original: complex glycans, correct disulfides, proteolytic maturation and secretion. Transient transfection gives milligrams in about a week; stable lines give grams per litre after months of development.",
    color: "#5e60ce",
    metrics: {
      yield: "Transient: tens to a few hundred mg/L; stable CHO processes reach g/L", timeToProtein: "1–2 weeks transient; 3–6 months for a characterised stable clone",
      cost: cost.veryHigh, ptm: ptm.human, disulfides: disulfide.secretory,
      scale: "mL transfections to >10,000 L bioreactors", commonUses: "Antibodies, receptor ectodomains, complex glycoproteins, therapeutic candidates",
      mainLimit: "The most expensive and slowest option; stable line development is a project of its own",
    },
    strengths: ["Human or near-human glycosylation, disulfide formation and proprotein processing", "Transient suspension workflows deliver usable material in about a week", "The regulatory path for CHO and HEK293 products is well trodden"],
    limits: ["Media, transfection reagents and incubator time dominate the cost per milligram", "Doubling times of ~24 h make every optimisation cycle slow", "Glycoform heterogeneity needs analytical work if the glycan matters"],
    referenceIds: ["wurm2004", "dumont2016", "thomas2005"],
  },
  cellfree: {
    id: "cellfree", name: "Cell-free systems", shortName: "Cell-free", subtitle: "In vitro translation · hours, not days",
    summary: "Transcription and translation in a tube, from a plasmid or PCR template. There is no cell to keep alive, so toxicity stops being a problem and the reaction is fully open to additives, labels and unnatural amino acids. Cost per milligram is high and scale-up is limited.",
    color: "#d6456f",
    metrics: {
      yield: "µg per 10–50 µL screen; up to ~2.3 mg/mL reported for an optimised all-E. coli reaction", timeToProtein: "Hours — a reaction is set up and read the same day",
      cost: cost.high, ptm: ptm.none, disulfides: disulfide.engineered,
      scale: "10 µL screens to mL-scale continuous-exchange reactions", commonUses: "Toxic and membrane proteins, unnatural amino acids, selective isotope labelling, rapid construct screening",
      mainLimit: "Expensive per milligram, limited volume, and no cellular secretion or quality-control machinery",
    },
    strengths: ["A toxic product cannot kill the host, because there is no host", "The reaction is open: redox state, chaperones, detergents, lipids and labels are all dosed directly", "Linear PCR product works as a template, so no cloning step is required"],
    limits: ["Reagent cost per milligram is far above fermentation", "Volumes are small; litre-scale cell-free is specialist work", "No glycosylation and no secretory pathway; disulfides need an engineered redox buffer"],
    referenceIds: ["carlson2012", "gregorio2019", "shimizu2001"],
  },
};

export const expressionHosts: Record<HostSystem, ExpressionHost[]> = {
  ecoli: [
    { id: "bl21-de3", name: "BL21(DE3)", category: "Routine T7 expression", lineage: "E. coli B", promoter: "T7 / IPTG", genotype: "F− ompT hsdS_B(r_B− m_B−) gal dcm λ(DE3)", usefulFor: "The standard first-choice host for routine high-level T7 expression.", bestFor: ["Routine soluble proteins", "pET vectors", "Fast screening"], markers: "No intrinsic plasmid-selection marker.", caution: "Basal T7 expression can be toxic and inclusion bodies remain possible.", color: "#35b99a",
      strengths: ["Chromosomal λDE3 supplies T7 RNA polymerase from a lacUV5 promoter, so IPTG drives very strong transcription", "Deficient in OmpT and Lon proteases, which protects many recombinant products", "The best-characterised starting point: almost every troubleshooting protocol assumes it"],
      limits: ["lacUV5 is leaky, so a toxic product can be lost before induction", "Rapid accumulation favours inclusion bodies for slow-folding targets", "No rare-codon tRNA supplementation and a reducing cytoplasm"],
      referenceIds: ["studier1986", "studier2005", "rosano2014", "nebStrains"],
      metrics: { yield: "Among the highest of the E. coli hosts: tens to >100 mg/L for a soluble target", mainLimit: "Leaky basal expression before induction, and inclusion bodies for slow-folding targets" } },
    { id: "bl21", name: "BL21", category: "Non-T7 routine expression", lineage: "E. coli B", promoter: "lac / tac / trc / araBAD", genotype: "F− ompT hsdS_B(r_B− m_B−) gal dcm", usefulFor: "Protease-deficient background for non-T7 bacterial promoters.", bestFor: ["pMAL", "pGEX", "pBAD", "Routine cytoplasmic expression"], markers: "No intrinsic plasmid-selection marker.", caution: "Does not supply T7 RNA polymerase; T7-only vectors will not express.", color: "#4db6ac",
      strengths: ["Same protease-deficient B background as BL21(DE3) without the λDE3 insert", "Works with host-polymerase promoters (lac, tac, trc, araBAD), which are gentler than T7", "A good control host when T7 toxicity is suspected"],
      limits: ["T7-only vectors such as pET give no product at all", "Host-polymerase promoters are weaker, so peak yield is lower than T7"],
      referenceIds: ["rosano2014", "nebStrains"],
      metrics: { yield: "Lower than T7 hosts: typically a few to tens of mg/L", mainLimit: "No T7 RNA polymerase, so pET-style vectors do not express" } },
    { id: "bl21-plyss", name: "BL21(DE3)pLysS", category: "Tight / toxic expression", lineage: "E. coli B", promoter: "T7 / IPTG", genotype: "BL21(DE3) pLysS (Camᴿ)", usefulFor: "T7 lysozyme suppresses basal T7 polymerase activity before induction.", bestFor: ["Mildly toxic targets", "Reduced leakiness"], markers: "Chloramphenicol resistance from pLysS.", caution: "Yield can be lower and chloramphenicol selection is required.", color: "#ff8a65",
      strengths: ["T7 lysozyme binds and inhibits T7 RNA polymerase, cutting pre-induction expression", "Cells are also easier to lyse, because lysozyme is already inside them", "Usually rescues plasmid instability caused by a mildly toxic product"],
      limits: ["Lower post-induction yield than plain BL21(DE3)", "Chloramphenicol must be maintained or pLysS is lost", "pLysE is tighter still, but harder to grow"],
      referenceIds: ["studier1991", "rosano2014", "nebStrains"],
      metrics: { yield: "Lower than BL21(DE3) by design, in exchange for tight pre-induction control" } },
    { id: "bl21-ai", name: "BL21-AI", category: "Arabinose-controlled T7", lineage: "E. coli B", promoter: "T7 / arabinose", genotype: "araB::T7RNAP-tetA", usefulFor: "Arabinose-controlled T7 polymerase provides low basal expression and tunable induction.", bestFor: ["Toxic proteins", "Arabinose-controlled T7"], markers: "Chromosomal tetA at the T7 polymerase insertion.", caution: "Induction differs from IPTG-only DE3 workflows and needs optimization.", color: "#ff7043",
      strengths: ["T7 polymerase sits under araBAD control, which is far tighter than lacUV5", "Arabinose dose tunes polymerase level, so expression rate can be dialled down", "Useful when a toxic construct cannot be maintained in BL21(DE3)"],
      limits: ["Two inducers to think about if the vector is also lac-regulated", "araBAD response depends on carbon source and arabinose catabolism"],
      referenceIds: ["guzman1995", "thermoStrains"],
      metrics: { timeToProtein: "2–4 days; add a titration run to find the arabinose dose" } },
    { id: "bl21-star", name: "BL21 Star(DE3)", category: "High transcript abundance", lineage: "E. coli B", promoter: "T7 / IPTG", genotype: "BL21(DE3) rne131", usefulFor: "The rne131 allele stabilizes mRNA and can increase recombinant yield.", bestFor: ["Short-lived mRNA", "High yield"], markers: "No intrinsic plasmid-selection marker.", caution: "Greater mRNA stability can raise basal expression.", color: "#ffca28",
      strengths: ["The truncated RNase E of rne-131 no longer organises the degradosome, so mRNA persists longer", "Helps when the limit is transcript stability rather than transcription"],
      limits: ["More stable mRNA also means more basal product from a leaky promoter", "No benefit when folding, not transcript supply, is the bottleneck"],
      referenceIds: ["lopez1999", "thermoStrains"] },
    { id: "tuner", name: "Tuner(DE3)", category: "Induction tuning", lineage: "E. coli B", promoter: "T7 / IPTG", genotype: "BL21(DE3) lacY1", usefulFor: "lacY1 enables more uniform IPTG entry and concentration-dependent tuning.", bestFor: ["Dose-response induction", "Solubility optimization", "Toxic targets"], markers: "No intrinsic plasmid-selection marker.", caution: "Requires an IPTG titration; maximum expression may not be most soluble.", color: "#ffa726",
      strengths: ["Without lactose permease, IPTG enters by diffusion, so the whole culture responds to the dose instead of a subpopulation", "Lets you trade expression rate against solubility with a titration plate"],
      limits: ["Needs an IPTG dose–response experiment to be worth using", "Higher IPTG is not the same as more usable protein"],
      referenceIds: ["fernandezcastane2012", "novagenStrains"],
      metrics: { timeToProtein: "3–5 days: one titration run, then the production culture" } },
    { id: "rosetta2", name: "Rosetta 2(DE3)", category: "Rare codons", lineage: "E. coli B", promoter: "T7 / IPTG", genotype: "BL21(DE3) pRARE2 (Camᴿ)", usefulFor: "pRARE2 supplies tRNAs for codons uncommon in E. coli.", bestFor: ["Eukaryotic genes", "Rare-codon-rich ORFs", "Non-optimized constructs"], markers: "Chloramphenicol resistance from pRARE2.", caution: "Maintain pRARE2 selection and check resistance compatibility.", color: "#7e9cff",
      strengths: ["Supplements the tRNAs for codons that stall translation of unoptimised eukaryotic genes", "Avoids re-synthesising the gene when truncation products are the symptom"],
      limits: ["Chloramphenicol selection constrains the expression vector's marker", "No help if the real problem is folding, toxicity or mRNA structure"],
      referenceIds: ["gustafsson2004", "rosano2014", "novagenStrains"] },
    { id: "codonplus", name: "BL21-CodonPlus(DE3)-RIL", category: "Rare codons", lineage: "E. coli B", promoter: "T7 / IPTG", genotype: "Enhanced tRNA genes argU ileY leuW; Tetᴿ/Strᴿ", usefulFor: "Extra Arg, Ile and Leu tRNAs improve translation of AT-rich or eukaryotic genes.", bestFor: ["AGA/AGG", "AUA", "CUA codons"], markers: "Tetracycline and streptomycin/spectinomycin resistance.", caution: "Accessory tRNA plasmid adds a second selection requirement.", color: "#7986cb",
      strengths: ["Targets the specific Arg, Ile and Leu codons that dominate AT-rich genes", "A -RP variant covers Arg and Pro codons for GC-rich genes instead"],
      limits: ["Two extra resistance markers to work around", "Choose RIL or RP from the construct's codon profile, not by default"],
      referenceIds: ["gustafsson2004", "agilentStrains"] },
    { id: "origami", name: "Origami B(DE3)", category: "Disulfide folding", lineage: "E. coli B", promoter: "T7 / IPTG", genotype: "gor522::Tn10 trxB (Kanᴿ, Tetᴿ)", usefulFor: "trxB/gor defects create a more oxidizing cytoplasm for disulfide bonds.", bestFor: ["Cytoplasmic disulfides", "Cysteine-rich proteins"], markers: "Kanamycin and tetracycline resistance.", caution: "Growth is slower and the strain already carries multiple resistances.", color: "#ab47bc",
      strengths: ["Loss of thioredoxin reductase and glutathione reductase lets cytoplasmic disulfides form", "Avoids the yield penalty of periplasmic export for disulfide-bonded targets"],
      limits: ["Grows slowly and benefits from reduced-temperature induction", "Two resistance markers already in use before the expression plasmid"],
      referenceIds: ["bessette1999", "novagenStrains"],
      metrics: { timeToProtein: "3–5 days: slower growth and usually a low-temperature induction", disulfides: disulfide.engineered } },
    { id: "rosetta-gami", name: "Rosetta-gami B(DE3)", category: "Rare codons + disulfides", lineage: "E. coli B", promoter: "T7 / IPTG", genotype: "gor522::Tn10 trxB pRARE (Camᴿ, Kanᴿ, Tetᴿ)", usefulFor: "Combines oxidative folding with rare-codon tRNAs.", bestFor: ["Disulfide-rich eukaryotic proteins", "Rare codons plus oxidative folding"], markers: "Chloramphenicol, kanamycin and tetracycline resistance.", caution: "Multiple markers constrain vector choice and slow growth.", color: "#8e24aa",
      strengths: ["One host for the two most common eukaryotic-gene problems: rare codons and disulfides", "Saves a round of strain screening for cysteine-rich mammalian domains"],
      limits: ["Three resistance markers leave little room for the expression plasmid", "Slowest-growing of the common BL21 derivatives"],
      referenceIds: ["bessette1999", "gustafsson2004", "novagenStrains"],
      metrics: { disulfides: disulfide.engineered } },
    { id: "shuffle", name: "SHuffle T7 Express", category: "Disulfide folding", lineage: "Enhanced E. coli B", promoter: "T7 / IPTG", genotype: "ΔtrxB Δgor with cytoplasmic DsbC (Specᴿ)", usefulFor: "Oxidizing cytoplasm plus DsbC supports correct multi-disulfide folding.", bestFor: ["Antibody fragments", "Secreted-domain mimics", "Multiple disulfides"], markers: "Spectinomycin resistance.", caution: "Compare B-lineage and K-12 SHuffle hosts at lower temperatures.", color: "#ce5dd6",
      strengths: ["ΔtrxB Δgor plus a signal-sequenceless DsbC isomerase shuffles mis-paired disulfides to the native set", "In the source study temperature had the largest effect on yield, and the B-strain background outperformed the K-12 version", "The usual first try for scFv and Fab fragments in the cytoplasm"],
      limits: ["Needs a low-temperature induction screen to get the best out of it", "ahpC suppressor background means growth and lysis behave differently from BL21(DE3)"],
      referenceIds: ["lobstein2012", "bessette1999", "nebStrains"],
      metrics: { timeToProtein: "3–6 days including a temperature screen", disulfides: disulfide.engineered } },
    { id: "shuffle-lysy", name: "SHuffle T7 Express lysY", category: "Tight + disulfide folding", lineage: "Enhanced E. coli B", promoter: "T7 / IPTG", genotype: "SHuffle background plus MiniF lysY (Camᴿ)", usefulFor: "Adds LysY suppression of basal T7 activity to an oxidative-folding host.", bestFor: ["Toxic disulfide-rich proteins", "Tight control plus DsbC"], markers: "Chloramphenicol and spectinomycin resistance.", caution: "Expect slower optimization with two selection antibiotics.", color: "#d65f8d",
      strengths: ["Oxidative-folding cytoplasm and T7 lysozyme repression in one host", "The option when a disulfide-rich product is also toxic before induction"],
      limits: ["Two selection antibiotics plus the expression plasmid's own marker", "Slowest optimisation of the SHuffle hosts"],
      referenceIds: ["lobstein2012", "studier1991", "nebStrains"],
      metrics: { disulfides: disulfide.engineered } },
    { id: "lemo21", name: "Lemo21(DE3)", category: "Tight / membrane expression", lineage: "BL21(DE3) derivative", promoter: "T7 / IPTG + rhamnose", genotype: "BL21(DE3) with rhamnose-tunable T7 lysozyme (Camᴿ)", usefulFor: "Rhamnose tunes effective T7 transcription over a broad range.", bestFor: ["Membrane proteins", "Toxic proteins", "Insoluble targets"], markers: "Chloramphenicol resistance from pLemo.", caution: "Requires two-dimensional IPTG/rhamnose optimization.", color: "#ff6f61",
      strengths: ["Rhamnose-controlled T7 lysozyme gives a continuous dial on transcription, not an on/off switch", "Built on the finding that slowing T7 expression is what rescues membrane-protein overexpression", "Membrane targets often move from inclusion bodies to the membrane at an intermediate rhamnose dose"],
      limits: ["A two-dimensional IPTG × rhamnose screen is the point of the strain, not optional", "Maximum yield is lower than unrestrained BL21(DE3)"],
      referenceIds: ["wagner2008", "nebStrains"],
      metrics: { yield: "Lower than BL21(DE3) by design; 1–20 mg/L is a realistic membrane-protein range", timeToProtein: "4–7 days including the rhamnose × IPTG screen" } },
    { id: "c41", name: "C41(DE3)", category: "Toxic / membrane expression", lineage: "BL21(DE3)-derived", promoter: "Reduced-activity T7 / IPTG", genotype: "Selected T7-expression tolerance mutations", usefulFor: "Tolerates targets whose strong T7 expression kills standard BL21(DE3).", bestFor: ["Toxic proteins", "Membrane proteins", "Problematic T7 constructs"], markers: "No intrinsic plasmid-selection marker.", caution: "Expression can be lower; screen C41 and C43 in parallel.", color: "#ef5350",
      strengths: ["Isolated directly by selecting survivors of toxic membrane-protein induction", "Later work showed the mutations act by weakening expression from the T7 promoter", "One of the two 'Walker strains' that are still the reflex for a target that kills BL21(DE3)"],
      limits: ["Lower transcription means lower total yield", "Which of C41 and C43 works is target-specific; screen both"],
      referenceIds: ["miroux1996", "wagner2008", "lgcWalker"],
      metrics: { yield: "Lower than BL21(DE3): single-digit to tens of mg/L for a tolerated target", mainLimit: "Reduced T7 activity caps the yield; the benefit is that the culture survives at all" } },
    { id: "c43", name: "C43(DE3)", category: "Toxic / membrane expression", lineage: "C41(DE3)-derived", promoter: "Reduced-activity T7 / IPTG", genotype: "C41-derived T7-expression tolerance mutations", usefulFor: "Second-generation toxic-protein host with a distinct tolerance profile.", bestFor: ["Highly toxic targets", "Membrane proteins", "C41 failures"], markers: "No intrinsic plasmid-selection marker.", caution: "Lower transcription can reduce total yield.", color: "#e53935",
      strengths: ["Selected from C41(DE3) for tolerance to the E. coli F-ATPase b subunit, so it survives a harsher target", "Frequently works where both BL21(DE3) and C41(DE3) fail"],
      limits: ["Lowest transcription of the T7 hosts listed here", "No advantage for a well-behaved soluble protein"],
      referenceIds: ["miroux1996", "wagner2008", "lgcWalker"],
      metrics: { yield: "Lower than C41(DE3) for most targets; chosen for tolerance, not quantity" } },
    { id: "arctic", name: "ArcticExpress(DE3) RIL", category: "Solubility / cold folding", lineage: "Enhanced E. coli B", promoter: "T7 / IPTG", genotype: "Cpn10/Cpn60 chaperonins plus argU ileY leuW tRNAs", usefulFor: "Cold-adapted chaperonins support folding during low-temperature expression.", bestFor: ["Insoluble proteins", "Low-temperature induction", "Rare codons"], markers: "Gentamicin, streptomycin and tetracycline resistance.", caution: "Chaperonins appear in lysate and add selection constraints.", color: "#42a5f5",
      strengths: ["Co-expresses Cpn10/Cpn60 from the psychrophile Oleispira antarctica, which keep E. coli growing at low temperature", "Lets you run induction at 10–13 °C, where slow folding competes better with aggregation", "The RIL tRNA set is included, so rare codons are covered too"],
      limits: ["Abundant chaperonin in the lysate can co-purify and needs watching on the gel", "Three resistance markers; induction runs for days rather than hours"],
      referenceIds: ["ferrer2003", "agilentStrains"],
      metrics: { timeToProtein: "4–7 days: induction at 10–13 °C runs for 24–72 h", mainLimit: "Long cold inductions and chaperonin background in the lysate" } },
    { id: "nico21", name: "NiCo21(DE3)", category: "Purification optimized", lineage: "Enhanced E. coli B", promoter: "T7 / IPTG", genotype: "can::CBD; slyD::CBD; ΔhsdS", usefulFor: "Reduces common E. coli contaminants in nickel/cobalt IMAC eluates.", bestFor: ["His-tag purification", "Cleaner IMAC", "Structural biology"], markers: "No intrinsic expression-plasmid marker.", caution: "Use the intended cleanup strategy for maximum benefit.", color: "#26a69a",
      strengths: ["The usual metal-binding contaminants (SlyD, Can, ArnA, GlmS) are tagged with chitin-binding domains or deleted", "A chitin-resin pass after IMAC removes the tagged contaminants", "Expression behaves like BL21(DE3), so no re-optimisation is needed"],
      limits: ["The benefit is eluate purity, not yield", "You have to actually run the chitin cleanup step to collect it"],
      referenceIds: ["robichon2011", "nebStrains"],
      metrics: { mainLimit: "Same yield as BL21(DE3); the gain is IMAC purity and only if the chitin step is run" } },
    { id: "t7-express", name: "T7 Express lysY/Iq", category: "Very tight T7 control", lineage: "Enhanced E. coli B", promoter: "T7 / IPTG", genotype: "Stable MiniF lysY/lacIq; BL21-derived", usefulFor: "LysY and lacIq minimize basal T7 expression for exceptionally toxic targets.", bestFor: ["Highly toxic proteins", "Unstable plasmids", "Lowest basal expression"], markers: "Stable MiniF lysY/lacIq.", caution: "Tight repression may require longer induction optimization.", color: "#ff5c8a",
      strengths: ["Two independent brakes: extra LacI from lacIq and T7 lysozyme from lysY", "Carried on a stable MiniF, so there is no plasmid-loss problem as with pLysS", "The host to try when a construct cannot even be cloned and maintained"],
      limits: ["Tight repression means induction conditions need their own optimisation", "Lower peak yield than BL21(DE3)"],
      referenceIds: ["studier1991", "nebStrains"] },
    { id: "nebexpress", name: "NEBExpress Iq", category: "Non-T7 lac control", lineage: "Enhanced E. coli B", promoter: "lac / tac / trc / T5-lacO", genotype: "Enhanced BL21-derived non-T7 host carrying stable MiniF lacIq", usefulFor: "Strong lac repression for controlled non-T7 expression.", bestFor: ["Non-T7 vectors", "pMAL", "lac/tac/trc systems"], markers: "Stable lacIq; follow vector selection guidance.", caution: "Does not supply T7 RNA polymerase.", color: "#66bb6a",
      strengths: ["lacIq keeps lac/tac/trc and T5-lacO vectors genuinely off before induction", "Protease-deficient background suits MBP and GST fusion workflows"],
      limits: ["No T7 RNA polymerase, so pET vectors will not express", "Host-polymerase promoters give lower peak expression than T7"],
      referenceIds: ["rosano2014", "nebStrains"],
      metrics: { yield: "Lower than T7 hosts: typically a few to tens of mg/L" } },
  ],
  yeast: [
    { id: "by4741", name: "S. cerevisiae BY4741", category: "Budding yeast", lineage: "S. cerevisiae S288C-derived", promoter: "GAL1 / TEF1 / PGK1 / GPD", genotype: "MATa his3Δ1 leu2Δ0 met15Δ0 ura3Δ0", usefulFor: "Defined auxotrophies and extensive genetics make BY4741 reproducible for intracellular expression.", bestFor: ["Functional studies", "Auxotrophic selection", "Eukaryotic folding"], markers: "his3Δ1, leu2Δ0, met15Δ0, ura3Δ0.", caution: "Glycosylation differs from mammalian cells.", color: "#f4a261",
      strengths: ["Complete-deletion auxotrophies cannot revert, unlike point-mutant markers", "The reference background for the genome-wide deletion collection, so comparison data exist", "Four markers allow several plasmids or integrations at once"],
      limits: ["Intracellular expression levels are modest compared with Pichia secretion", "Hypermannosyl glycans differ from mammalian ones"],
      referenceIds: ["brachmann1998", "sikorski1989"],
      metrics: { yield: "Typically 1–20 mg/L intracellular from flask culture", commonUses: "Functional assays, complementation, yeast genetics, moderate-scale intracellular expression" } },
    { id: "w303", name: "S. cerevisiae W303-1A", category: "Budding yeast", lineage: "S. cerevisiae W303", promoter: "GAL1 / TEF1 / PGK1 / GPD", genotype: "MATa ade2-1 can1-100 his3-11,15 leu2-3,112 trp1-1 ura3-1", usefulFor: "Widely used laboratory background with multiple auxotrophic markers.", bestFor: ["GAL1 induction", "Multi-plasmid selection", "Mechanistic studies"], markers: "ADE2, HIS3, LEU2, TRP1 and URA3 auxotrophies.", caution: "Document the exact W303 derivative used.", color: "#e9c46a",
      strengths: ["Five auxotrophic markers support complex multi-plasmid experiments", "Decades of mechanistic literature use this background"],
      limits: ["Point-mutant markers can revert, unlike the BY4741 deletions", "W303 stocks differ between labs; record the exact derivative"],
      referenceIds: ["sikorski1989", "johnston1984"],
      metrics: { yield: "Typically 1–20 mg/L intracellular from flask culture" } },
    { id: "invsc1", name: "S. cerevisiae INVSc1", category: "GAL1 induction", lineage: "S. cerevisiae diploid", promoter: "GAL1 / galactose", genotype: "his3Δ1 leu2 trp1-289 ura3-52", usefulFor: "Common diploid host supplied for galactose-inducible pYES workflows.", bestFor: ["pYES vectors", "GAL1 induction", "Routine eukaryotic expression"], markers: "HIS3, LEU2, TRP1 and URA3 auxotrophies.", caution: "Glucose represses GAL1; switch carbon source carefully.", color: "#f6bd60",
      strengths: ["Diploid, so it is robust and grows well on selective media", "Supplied as the matched host for pYES2-type GAL1 vectors"],
      limits: ["GAL1 is repressed by glucose; the carbon-source switch has to be done properly", "Diploid genetics make knockouts harder than in BY4741"],
      referenceIds: ["johnston1984", "pyesManual"],
      metrics: { timeToProtein: "4–7 days including the galactose induction switch" } },
    { id: "eby100", name: "S. cerevisiae EBY100", category: "Surface display", lineage: "BJ5465-derived", promoter: "GAL1 / galactose", genotype: "AGA1::GAL1-AGA1::URA3; pep4::HIS3; prb1Δ", usefulFor: "Chromosomal Aga1 enables Aga2-fusion display for affinity maturation and library screening.", bestFor: ["Yeast surface display", "Binder libraries", "Flow selection"], markers: "URA3 integration plus TRP1/LEU2/HIS3 options.", caution: "Requires an Aga2 display vector and secretion signal.", color: "#dda15e",
      strengths: ["Galactose-inducible chromosomal AGA1 anchors Aga2 fusions on the cell wall", "Display level per cell is high enough for quantitative flow-cytometry affinity measurement", "Protease-deficient (pep4, prb1) background protects displayed constructs"],
      limits: ["This is a selection platform, not a production host: material per cell is tiny", "Needs an Aga2 display vector with a secretion signal and a flow cytometer or sorter"],
      referenceIds: ["boder1997", "chao2006"],
      metrics: { yield: "Display scale, not preparative: ~10⁴–10⁵ fusion copies per cell", scale: "Library cultures for sorting; not a production scale", commonUses: "Antibody and binder library selection, affinity maturation, quantitative binding titrations", mainLimit: "Produces displayed protein for selection, not soluble protein for purification" } },
    { id: "x33", name: "K. phaffii X-33", aka: "Pichia pastoris X-33", category: "Methylotrophic yeast", lineage: "Komagataella phaffii wild type", promoter: "AOX1 / methanol or GAP", genotype: "Wild type; Mut⁺ phenotype", usefulFor: "Robust secretion and high-cell-density expression with AOX1 or GAP vectors.", bestFor: ["Secreted proteins", "High-density fermentation", "pPICZ/pGAPZ"], markers: "Dominant Zeocin selection.", caution: "Methanol induction requires process controls; glycosylation can be heterogeneous.", color: "#bc6c25",
      strengths: ["Wild-type background with no auxotrophy to satisfy; selection is dominant Zeocin", "Secretes product into a nearly protein-free medium, which simplifies capture", "AOX1 is one of the strongest regulated promoters available in any system"],
      limits: ["Methanol feeding needs oxygen transfer and process control", "Secreted glycoproteins are hypermannosylated and heterogeneous"],
      referenceIds: ["karbalaei2020", "cregg1993", "pichiaManual"],
      metrics: { yield: "0.1 to >10 g/L of secreted protein in controlled fed-batch fermentation", timeToProtein: "2–4 weeks: linearise, integrate, screen clones, then ferment", scale: "Shake flask screens to industrial fermenters", commonUses: "Secreted enzymes and industrial proteins at gram scale" } },
    { id: "gs115", name: "K. phaffii GS115", aka: "Pichia pastoris GS115", category: "Methylotrophic yeast", lineage: "Komagataella phaffii", promoter: "AOX1 / methanol or GAP", genotype: "his4; Mut⁺ phenotype", usefulFor: "HIS4 auxotrophy supports classic Pichia-vector selection.", bestFor: ["AOX1 expression", "HIS4 selection", "Secreted proteins"], markers: "his4 auxotrophy; Zeocin-compatible derivatives.", caution: "Screen multiple integration clones.", color: "#b56576",
      strengths: ["The original Pichia expression host, with the longest published track record", "HIS4 complementation selects integrants without an antibiotic"],
      limits: ["Integration copy number varies, so clones must be screened for expression", "Methanol process control is the same burden as for X-33"],
      referenceIds: ["cregg1985", "cereghino2000", "pichiaManual"],
      metrics: { yield: "0.1 to >10 g/L secreted in fed-batch; much lower in shake flasks", timeToProtein: "2–4 weeks including clone screening" } },
    { id: "km71h", name: "K. phaffii KM71H", category: "Mutˢ control", lineage: "Komagataella phaffii", promoter: "AOX1 / methanol or GAP", genotype: "arg4 aox1::ARG4; Mutˢ phenotype", usefulFor: "Slow methanol utilization can moderate AOX1 production for difficult targets.", bestFor: ["Mutˢ screening", "Difficult secreted proteins", "pPICZ"], markers: "Zeocin; AOX1 disrupted by ARG4.", caution: "Induction kinetics differ from Mut⁺ strains.", color: "#9c6644",
      strengths: ["AOX1 is disrupted, so methanol is used slowly and oxygen demand is far lower", "Slower synthesis can improve folding and secretion of a difficult product"],
      limits: ["Induction takes longer than a Mut⁺ strain and the kinetics are different", "Not the first choice when total yield is the only goal"],
      referenceIds: ["cereghino2000", "pichiaManual"],
      metrics: { yield: "Usually below a Mut⁺ strain; chosen when folding beats quantity", timeToProtein: "3–5 weeks: slow methanol utilisation lengthens induction" } },
    { id: "smd1168h", name: "K. phaffii SMD1168H", category: "Protease deficient", lineage: "GS115-derived", promoter: "AOX1 / methanol or GAP", genotype: "pep4 his4; reduced vacuolar protease A", usefulFor: "Reduced proteolysis can improve recovery of sensitive intracellular or secreted products.", bestFor: ["Protease-sensitive targets", "Secreted proteins", "pPICZ/pGAPZ"], markers: "his4; Zeocin-compatible.", caution: "Protease deficiency does not eliminate all extracellular proteolysis.", color: "#7f5539",
      strengths: ["pep4 removes protease A, which activates several other vacuolar proteases", "The host to switch to when a secreted product appears clipped on the gel"],
      limits: ["Extracellular proteolysis still happens; pH, temperature and feeding also need attention", "Grows less robustly than the protease-competent strains"],
      referenceIds: ["sinha2005", "pichiaManual"],
      metrics: { mainLimit: "Reduced but not eliminated proteolysis; process pH and harvest timing still matter" } },
  ],
  insect: [
    { id: "sf9", name: "Sf9", category: "Baculovirus workhorse", lineage: "Spodoptera frugiperda ovarian clone", promoter: "Polyhedrin / p10; OpIE", genotype: "Clonal derivative of Sf21; aneuploid insect line", usefulFor: "Standard host for baculovirus generation, plaque assays, amplification and recombinant expression.", bestFor: ["Baculovirus production", "Membrane proteins", "Suspension scale-up"], markers: "Viral workflow; plasmid systems may use blasticidin.", caution: "Optimize MOI and harvest time; glycosylation differs from mammals.", color: "#52b788",
      strengths: ["Clonal, so virus titration and plaque assays are reproducible", "Transfects well, which makes it the usual host for generating the virus stock", "Adapts to serum-free suspension for scale-up"],
      limits: ["Secreted-protein yield is often below High Five", "Polyhedrin-driven expression peaks as the cells lyse, so harvest timing matters"],
      referenceIds: ["vaughn1977", "luckow1993", "bacToBac"],
      metrics: { commonUses: "Virus generation and amplification, intracellular and membrane proteins, complexes" } },
    { id: "sf21", name: "Sf21", category: "Baculovirus alternative", lineage: "Spodoptera frugiperda ovarian line", promoter: "Polyhedrin / p10; OpIE", genotype: "Parental heterogeneous line from which Sf9 was cloned", usefulFor: "Established host for baculovirus transfection, amplification and expression.", bestFor: ["Virus amplification", "Baculovirus expression", "Alternative to Sf9"], markers: "System-dependent viral or plasmid selection.", caution: "Compare yield and infection kinetics with Sf9.", color: "#40916c",
      strengths: ["The parental IPLB-SF-21 line; some targets express better here than in Sf9", "Tolerates a wider range of media and culture conditions"],
      limits: ["Heterogeneous population, so titration is less reproducible than Sf9", "Cell size and infection kinetics differ from Sf9; do not reuse its settings"],
      referenceIds: ["vaughn1977", "vanoers2015"] },
    { id: "high-five", name: "High Five", aka: "BTI-TN-5B1-4", category: "High-yield secretion", lineage: "Trichoplusia ni BTI-TN-5B1-4", promoter: "Polyhedrin / p10", genotype: "Ovarian-derived T. ni line; heterogeneous aneuploid genome", usefulFor: "Frequently gives strong recombinant and secreted protein yield after baculovirus infection.", bestFor: ["Secreted proteins", "High expression", "Serum-free suspension"], markers: "Baculovirus workflow; no infection selection marker.", caution: "Use Sf9/Sf21 for initial virus generation when recommended.", color: "#2d6a4f",
      strengths: ["Screened against other insect lines and selected for higher recombinant and secreted protein yield", "Often several-fold better than Sf9 for a secreted glycoprotein", "Grows in serum-free and protein-free media, which helps downstream capture"],
      limits: ["Not the line to generate or titre virus in; use Sf9/Sf21 for that", "More sensitive to shear and medium changes than Sf9"],
      referenceIds: ["wickham1992", "vanoers2015"],
      metrics: { yield: "Often the highest of the insect lines for secreted protein: 10–50 mg/L", commonUses: "Secreted glycoproteins, ectodomains, VLPs" } },
    { id: "expisf9", name: "ExpiSf9", category: "High-density suspension", lineage: "Suspension-adapted Sf9", promoter: "Polyhedrin / p10", genotype: "Proprietary high-density Sf9-derived line", usefulFor: "High-density, chemically defined baculovirus expression with matched medium and workflow.", bestFor: ["High-density suspension", "Scale-up", "Baculovirus expression"], markers: "Matched ExpiSf reagents.", caution: "Treat as an integrated vendor system.", color: "#1b4332",
      strengths: ["Chemically defined medium and matched enhancer remove serum variability", "Runs at higher cell density than classical Sf9 culture, so volumetric yield improves"],
      limits: ["Locked to the vendor's medium, reagent and feeding schedule", "Reagent cost is above classical serum-free insect culture"],
      referenceIds: ["expiSystems", "vanoers2015"],
      metrics: { cost: cost.high, scale: "30 mL to bioreactor scale in the matched medium" } },
    { id: "s2", name: "Drosophila S2", category: "Stable plasmid expression", lineage: "Drosophila melanogaster Schneider 2", promoter: "Metallothionein / CuSO₄; Act5C", genotype: "Late-embryonic hemocyte-like aneuploid line", usefulFor: "Simple nonviral transient or stable expression with inducible MT or constitutive Act5C vectors.", bestFor: ["Stable insect lines", "Secreted proteins", "Nonviral expression"], markers: "Blasticidin or hygromycin via cotransfected marker.", caution: "Baculovirus transfer vectors are not the appropriate plasmid system.", color: "#74c69d",
      strengths: ["No virus to make: plasmid transfection gives transient or stable expression", "Copper-inducible metallothionein promoter is tight and dose-responsive", "Stable polyclonal lines secrete continuously for months, which suits repeat production"],
      limits: ["Expression per cell is below an optimised baculovirus infection", "Stable line selection takes 3–6 weeks", "Baculovirus transfer vectors do not work here; use pMT/BiP or pAc5.1"],
      referenceIds: ["schneider1972", "bacToBac"],
      metrics: { yield: "1–20 mg/L; lower per cell than optimised BEVS", timeToProtein: "1 week transient; 3–6 weeks for a stable line", commonUses: "Stable secreted-protein lines, repeat production without virus work", mainLimit: "Lower peak expression than baculovirus infection" } },
  ],
  mammalian: [
    { id: "hek293t", name: "HEK293T", category: "Transient adherent", lineage: "Human embryonic kidney 293-derived", promoter: "CMV / CAG / EF1α; SV40 enhancement", genotype: "HEK293 derivative expressing SV40 large T antigen", usefulFor: "Very high transient transfection efficiency for rapid small-to-medium-scale production.", bestFor: ["Transient expression", "Viral packaging", "Complex mammalian proteins"], markers: "Vector-dependent G418, puromycin or hygromycin.", caution: "Adherent workflows scale less easily; SV40-origin replication needs compatible vectors.", color: "#5e60ce",
      strengths: ["Transfects extremely efficiently, so a pilot experiment is cheap and fast", "SV40 large T amplifies SV40-origin plasmids, raising transient copy number", "The standard host for packaging lentivirus and AAV"],
      limits: ["Adherent culture needs surface area, so scale-up is awkward", "The SV40 benefit only applies to vectors carrying an SV40 origin"],
      referenceIds: ["graham1977", "thomas2005"],
      metrics: { yield: "Transient: ~1–20 mg/L in adherent format", scale: "Dishes and flasks; litres require many vessels", commonUses: "Pilot expression, viral vector packaging, cell-biology assays" } },
    { id: "expi293f", name: "Expi293F", category: "Transient suspension", lineage: "High-density suspension HEK293", promoter: "CMV / CAG / EF1α", genotype: "Proprietary HEK293-derived suspension production line", usefulFor: "High-density transient expression with human-like folding and PTM processing.", bestFor: ["Secreted proteins", "Antibodies", "Structural biology"], markers: "Transient workflow; optional vector-dependent selection.", caution: "Use matched medium, reagent, feed and enhancer.", color: "#6930c3",
      strengths: ["High-density suspension transient expression with human glycosylation", "Matched medium, transfection reagent and enhancer make runs reproducible", "Usable material from DNA in about a week, with no cell-line development"],
      limits: ["Tied to the vendor's matched reagent set", "Transient runs have to be repeated for each new batch of protein"],
      referenceIds: ["jager2013", "dumont2016", "expiSystems"],
      metrics: { yield: "Transient: tens to a few hundred mg/L for a well-behaved secreted protein", timeToProtein: "7–10 days from DNA to purified protein", commonUses: "Antibodies, ectodomains, structural-biology targets needing human glycans" } },
    { id: "hek293-6e", name: "HEK293-6E", category: "EBNA1 suspension", lineage: "Suspension HEK293 expressing EBNA1", promoter: "CMV / CAG with oriP/EBNA1", genotype: "HEK293 derivative stably expressing EBNA1", usefulFor: "EBNA1 supports transient episomal amplification and retention of oriP vectors.", bestFor: ["pTT/oriP vectors", "Secreted proteins", "Transient scale-up"], markers: "Vector-dependent; EBNA1 is host encoded.", caution: "oriP benefit requires EBNA1 and a compatible vector.", color: "#7400b8",
      strengths: ["EBNA1 retains and amplifies oriP plasmids, which extends transient expression", "Developed specifically for high-throughput transient production in suspension", "Licensing and protocols are well established in academic structural biology"],
      limits: ["The advantage disappears with a vector that has no oriP", "Needs the pTT-style vector series to get the full benefit"],
      referenceIds: ["durocher2002", "dumont2016"],
      metrics: { yield: "Transient: tens of mg/L, extended by episomal retention", timeToProtein: "7–12 days including a longer expression phase" } },
    { id: "cho-k1", name: "CHO-K1", category: "Stable or transient", lineage: "Chinese hamster ovary K1", promoter: "CMV / CAG / EF1α", genotype: "Aneuploid CHO-K1 lineage", usefulFor: "Industry-standard mammalian background for stable recombinant proteins and biologics.", bestFor: ["Stable cell lines", "Secreted glycoproteins", "Bioprocess development"], markers: "Vector-dependent G418, puromycin, DHFR or GS selection.", caution: "Stable clone development is slower; glycans are CHO-specific.", color: "#4ea8de",
      strengths: ["The most common production background for licensed biologics, with a sequenced genome", "Tolerates suspension, serum-free culture and long fed-batch processes", "Glycosylation lacks the immunogenic α-Gal and NGNA epitopes of some other rodent lines"],
      limits: ["Stable clone development and characterisation takes months", "CHO glycans differ from human in sialylation and fucosylation detail"],
      referenceIds: ["puck1958", "xu2011", "wurm2004"],
      metrics: { yield: "Stable fed-batch: 0.5–5 g/L for an antibody; far lower transiently", timeToProtein: "3–6 months to a characterised stable clone", commonUses: "Biologics manufacture, stable secreted glycoproteins, bioprocess development" } },
    { id: "expicho", name: "ExpiCHO-S", category: "Transient suspension", lineage: "High-density suspension CHO-S", promoter: "CMV / CAG / EF1α", genotype: "Proprietary CHO-S-derived production line", usefulFor: "High-yield transient CHO expression with a matched chemically defined system.", bestFor: ["Antibodies", "Secreted proteins", "CHO-like glycosylation"], markers: "Transient system; stable selection is separate.", caution: "Follow matched transfection, feed, enhancer and temperature-shift workflows.", color: "#48bfe3",
      strengths: ["Gives CHO-type glycosylation on a transient timeline, which de-risks a later stable line", "Matched feed and temperature-shift protocol pushes transient titres well above standard CHO", "Chemically defined throughout, so lot-to-lot variability is low"],
      limits: ["Several protocol variants (standard, high titre, max titre) to choose and keep straight", "Reagent cost per run is high"],
      referenceIds: ["expiSystems", "dumont2016"],
      metrics: { yield: "Transient: tens to several hundred mg/L under the matched protocol", timeToProtein: "10–14 days with the extended feed protocol" } },
    { id: "cho-dg44", name: "CHO-DG44", category: "Stable amplified expression", lineage: "CHO double-deletion mutant", promoter: "CMV / SV40 with DHFR", genotype: "DHFR-deficient CHO derivative", usefulFor: "DHFR selection and methotrexate amplification support high-producing stable clones.", bestFor: ["Stable biologics", "Gene amplification", "Antibodies"], markers: "DHFR complementation and methotrexate amplification.", caution: "Clone development and amplification are time-intensive.", color: "#56cfe1",
      strengths: ["Both DHFR alleles are deleted, so complementation selection is clean and non-revertible", "Stepwise methotrexate amplification raises transgene copy number and titre", "A classical, well-documented route to a very high-producing clone"],
      limits: ["Amplification and clone screening take many months", "Amplified arrays can be genetically unstable over long culture"],
      referenceIds: ["urlaub1983", "wurm2004"],
      metrics: { yield: "Stable amplified clones: 1–5 g/L is achievable for an antibody", timeToProtein: "6–12 months including amplification and clone stability testing", cost: cost.veryHigh, mainLimit: "Longest development timeline of any option here" } },
  ],
  cellfree: [
    { id: "ecoli-lysate", name: "E. coli lysate (batch TX-TL)", category: "Batch cell-free", lineage: "S30-type extract from a BL21-derived strain", promoter: "T7 (plasmid or linear template)", genotype: "Cell-free extract; no living host", usefulFor: "Same-day expression from a plasmid or PCR product, with the reaction open to any additive.", bestFor: ["Toxic proteins", "Rapid construct screening", "Additive and redox screens"], markers: "None — there is no cell to select.", caution: "Energy supply limits batch reactions; yields fall off after a few hours.", color: "#d6456f",
      strengths: ["No host viability constraint, so a toxic or lytic product is no obstacle", "An optimised all-E. coli reaction has been reported at 2.3 mg/mL of protein", "Plate-format screening of many constructs or conditions in a single afternoon"],
      limits: ["Batch reactions run out of energy and accumulate inhibitory phosphate", "No glycosylation, no secretion, and the cytoplasmic-equivalent redox state is reducing by default"],
      referenceIds: ["caschera2014", "carlson2012", "gregorio2019", "cfpsKits"],
      metrics: { yield: "0.1–2.3 mg per mL of reaction, depending on extract and energy system", timeToProtein: "Same day: a 2–6 h reaction from a ready template" } },
    { id: "ecoli-cecf", name: "E. coli CECF (continuous exchange)", category: "Continuous-exchange cell-free", lineage: "E. coli extract in a two-compartment reactor", promoter: "T7 (plasmid template)", genotype: "Cell-free extract; no living host", usefulFor: "Preparative-scale cell-free expression, especially of membrane proteins supplied with detergent or lipid.", bestFor: ["Membrane proteins", "Preparative cell-free", "Detergent and lipid screens"], markers: "None — there is no cell to select.", caution: "Dialysis setup, feeding mix and detergent choice all need optimising.", color: "#c2405f",
      strengths: ["A dialysis membrane feeds substrates in and removes inhibitory by-products, so synthesis continues for many hours", "Detergents, lipids or nanodiscs are added directly, so a membrane protein folds without ever touching a membrane", "Milligram quantities are reachable in a millilitre-scale reaction"],
      limits: ["More hardware and optimisation than a batch reaction", "Detergent or lipid choice is target-specific and has to be screened"],
      referenceIds: ["schwarz2007", "carlson2012"],
      metrics: { yield: "Up to a few mg per mL of reaction mixture for a well-behaved target", timeToProtein: "1–2 days including the dialysis reaction setup", scale: "0.05–3 mL reaction compartments", commonUses: "Membrane proteins, transporters, preparative cell-free for structural work", cost: cost.veryHigh } },
    { id: "pure", name: "PURE (reconstituted)", category: "Reconstituted cell-free", lineage: "Purified recombinant translation machinery, not a lysate", promoter: "T7 (plasmid or linear template)", genotype: "Defined set of purified components; no extract", usefulFor: "A fully defined translation reaction with no nucleases or unknown lysate activities.", bestFor: ["Defined reactions", "Unnatural amino acids", "Nuclease-sensitive templates"], markers: "None — there is no cell to select.", caution: "Lowest yield per reaction and the most expensive per milligram.", color: "#b23a62",
      strengths: ["Reconstituted from purified components, so every protein in the tube is known", "No competing nucleases or proteases from a lysate, which suits linear templates and synthetic biology", "The usual platform for unnatural amino acids and ribosome engineering"],
      limits: ["Yield per reaction is below a good lysate system", "The most expensive cell-free option per milligram"],
      referenceIds: ["shimizu2001", "carlson2012", "cfpsKits"],
      metrics: { yield: "Typically tens to a few hundred µg per mL — below lysate systems", cost: cost.veryHigh, commonUses: "Defined-system biochemistry, unnatural amino acids, synthetic biology", mainLimit: "Cost per milligram; chosen for definition, not quantity" } },
    { id: "wheat-germ", name: "Wheat germ extract", category: "Eukaryotic cell-free", lineage: "Purified wheat embryo extract", promoter: "T7 / SP6 via a split-primer or plasmid template", genotype: "Cell-free extract; no living host", usefulFor: "Eukaryotic cell-free translation, which often folds multi-domain eukaryotic proteins better than an E. coli extract.", bestFor: ["Eukaryotic multi-domain proteins", "High-throughput proteomics", "Disulfide-containing targets"], markers: "None — there is no cell to select.", caution: "Lower throughput per volume than E. coli extract and sensitive to extract quality.", color: "#a8426b",
      strengths: ["Eukaryotic ribosomes and chaperones give a better hit rate on eukaryotic multi-domain proteins", "Purified embryos remove the endogenous translation inhibitors that plagued earlier wheat-germ extracts", "Works from a split-primer PCR template, so no cloning is needed for a screen"],
      limits: ["Yield per millilitre is generally below an optimised E. coli reaction", "Extract preparation quality dominates performance"],
      referenceIds: ["takai2010", "sawasaki2002", "cfpsKits"],
      metrics: { yield: "Tens to hundreds of µg per mL of reaction", timeToProtein: "1–2 days including template preparation", commonUses: "Eukaryotic proteins, proteome-scale screening, in vitro assay material", ptm: { level: 1, label: "Eukaryotic folding, no glycosylation" } } },
  ],
};

export type ExpressionVectorFamily = { id: string; name: string; promoter: string; replication: string; selection: string; delivery: string; benefits: string; caution: string; compatibleHostIds?: string[]; requiredPromoterTokens?: string[] };

export const expressionVectors: Record<HostSystem, ExpressionVectorFamily[]> = {
  ecoli: [
    { id: "pet28", name: "pET-28 / kanamycin T7", promoter: "T7-lac / IPTG", replication: "pBR322/pMB1-family bacterial origin", selection: "Kanamycin", delivery: "Transform a host supplying T7 RNA polymerase", benefits: "Strong inducible expression, common His₆ tags and straightforward IMAC purification.", caution: "Requires a DE3/T7 host; basal expression can be toxic.", requiredPromoterTokens: ["t7"] },
    { id: "pet21", name: "pET-21 / ampicillin T7", promoter: "T7-lac / IPTG", replication: "pBR322/pMB1-family origin", selection: "Ampicillin", delivery: "Transform a T7 polymerase host", benefits: "Widely used T7 backbone with optional C-terminal His tag.", caution: "Ampicillin selection can be less stable at high density.", requiredPromoterTokens: ["t7"] },
    { id: "pet-sumo", name: "pET-SUMO fusion", promoter: "T7-lac / IPTG", replication: "pBR322/pMB1-family origin", selection: "Usually kanamycin", delivery: "Transform a T7 polymerase host", benefits: "SUMO can improve soluble expression and Ulp1 cleavage exposes a native N terminus.", caution: "Adds a large fusion and requires efficient SUMO proteolysis.", requiredPromoterTokens: ["t7"] },
    { id: "pgex", name: "pGEX GST fusion", promoter: "tac / lac repression / IPTG", replication: "pBR322-derived replicon", selection: "Ampicillin", delivery: "Transform a compatible E. coli host", benefits: "GST improves solubility and enables glutathione capture.", caution: "GST is ~26 kDa and dimeric; it may alter oligomerization." },
    { id: "pmal", name: "pMAL MBP fusion", promoter: "tac / lac repression / IPTG", replication: "pBR322/ColE1-family origin", selection: "Ampicillin", delivery: "Transform a non-T7 or T7-capable host", benefits: "MBP is a strong solubility enhancer and supports amylose capture.", caution: "MBP is ~42 kDa and often should be removed before structural studies." },
    { id: "pbad", name: "pBAD arabinose-inducible", promoter: "araBAD / L-arabinose", replication: "pBR322/ColE1-family origin", selection: "Ampicillin or kanamycin", delivery: "Transform an ara-compatible host", benefits: "Tunable induction and low basal expression without T7 polymerase.", caution: "Carbon source and strain affect arabinose response." },
    { id: "pduet", name: "Duet co-expression vectors", promoter: "Two T7-lac cassettes / IPTG", replication: "Compatible origins by family member", selection: "Ampicillin, kanamycin, chloramphenicol or streptomycin", delivery: "Co-transform compatible-origin plasmids into a T7 host", benefits: "Coordinates complexes, chaperones, cofactors or multiple subunits.", caution: "Verify origin and antibiotic compatibility across every plasmid.", requiredPromoterTokens: ["t7"] },
  ],
  yeast: [
    { id: "pyes2", name: "pYES2 GAL1 / 2µ", promoter: "GAL1 / galactose", replication: "2µ high-copy episome plus E. coli origin", selection: "URA3 yeast; ampicillin E. coli", delivery: "Transform S. cerevisiae and select uracil prototrophy", benefits: "Strong inducible expression with a familiar shuttle-vector workflow.", caution: "Carbon-source switching is required and high copy can burden cells.", compatibleHostIds: ["by4741", "w303", "invsc1"], requiredPromoterTokens: ["gal1"] },
    { id: "pesc", name: "pESC dual GAL1/GAL10", promoter: "Bidirectional GAL1 / GAL10", replication: "2µ high-copy episome", selection: "HIS3, TRP1, LEU2 or URA3", delivery: "Transform S. cerevisiae with the matching auxotrophic marker", benefits: "Co-expresses two proteins from divergent galactose-inducible promoters.", caution: "Match marker to host auxotrophy and balance both cassettes.", compatibleHostIds: ["by4741", "w303", "invsc1"], requiredPromoterTokens: ["gal1"] },
    { id: "prs", name: "pRS CEN/ARS or 2µ shuttle", promoter: "TEF1, GPD, PGK1 or GAL1", replication: "CEN/ARS low-copy or 2µ high-copy", selection: "HIS3, TRP1, LEU2 or URA3", delivery: "Transform S. cerevisiae", benefits: "Modular copy-number and marker choices support controlled expression.", caution: "The backbone does not define the expression promoter; annotate the cassette.", compatibleHostIds: ["by4741", "w303", "invsc1"] },
    { id: "pyd1", name: "pYD1 / Aga2 yeast-display", promoter: "GAL1 / galactose", replication: "2µ yeast shuttle vector", selection: "TRP1 yeast; ampicillin E. coli", delivery: "Transform EBY100 or another Aga1-compatible display strain", benefits: "Displays Aga2 fusions on the yeast surface for quantitative binding and library selection.", caution: "Requires an Aga2 display vector, secretion signal and Aga1-expressing host.", compatibleHostIds: ["eby100"], requiredPromoterTokens: ["gal1"] },
    { id: "ppicz", name: "pPICZ / pPICZα AOX1", promoter: "AOX1 / methanol", replication: "AOX1 genomic integration", selection: "Zeocin", delivery: "Linearize, transform K. phaffii and screen clones", benefits: "Strong methanol-inducible intracellular or α-factor-directed secretion.", caution: "Methanol handling, Mut phenotype and integration copy effects require screening.", compatibleHostIds: ["x33", "gs115", "km71h", "smd1168h"], requiredPromoterTokens: ["aox1"] },
    { id: "pgapz", name: "pGAPZ / pGAPZα", promoter: "GAP / constitutive", replication: "K. phaffii genomic integration", selection: "Zeocin", delivery: "Linearize and transform K. phaffii", benefits: "Avoids methanol induction and supports continuous production.", caution: "No off-switch for toxic proteins.", compatibleHostIds: ["x33", "gs115", "km71h", "smd1168h"] },
  ],
  insect: [
    { id: "pfastbac1", name: "pFastBac1 baculovirus transfer", promoter: "Polyhedrin late promoter", replication: "Tn7 transposition into bacmid", selection: "Bacmid-generation antibiotics", delivery: "Generate bacmid/virus, amplify in Sf9/Sf21, infect production cells", benefits: "High-level expression across Sf9, Sf21 and High Five.", caution: "Requires virus generation, titering and MOI/time-course optimization.", compatibleHostIds: ["sf9", "sf21", "high-five", "expisf9"] },
    { id: "pfastbac-dual", name: "pFastBac Dual", promoter: "Polyhedrin and p10", replication: "Tn7 transposition into bacmid", selection: "Bacmid-generation antibiotics", delivery: "Generate one virus encoding two cassettes", benefits: "Co-expresses two subunits or a target plus helper.", caution: "Promoter strength differs; verify stoichiometry empirically.", compatibleHostIds: ["sf9", "sf21", "high-five", "expisf9"] },
    { id: "pib", name: "pIB / OpIE plasmid", promoter: "OpIE1/OpIE2 immediate-early", replication: "Nonviral plasmid; transient or stable", selection: "Blasticidin", delivery: "Direct plasmid transfection", benefits: "Simpler nonviral expression without generating baculovirus.", caution: "Usually lower expression than optimized baculovirus systems.", compatibleHostIds: ["sf9", "sf21", "high-five", "expisf9"] },
    { id: "pmt-bip", name: "pMT/BiP/V5-His", promoter: "Drosophila metallothionein / Cu²⁺", replication: "Nonviral plasmid", selection: "Blasticidin or hygromycin", delivery: "Transfect S2 cells and induce with copper sulfate", benefits: "Tight inducible S2 expression with BiP secretion and V5/His tags.", caution: "Copper concentration and induction duration require optimization.", compatibleHostIds: ["s2"], requiredPromoterTokens: ["metallothionein"] },
    { id: "pac51", name: "pAc5.1 Drosophila vectors", promoter: "Actin 5C / constitutive", replication: "Nonviral plasmid", selection: "Blasticidin or hygromycin", delivery: "Directly transfect S2 cells", benefits: "Continuous expression without an induction step.", caution: "Constitutive expression is unsuitable for toxic products.", compatibleHostIds: ["s2"] },
  ],
  mammalian: [
    { id: "pcdna31", name: "pcDNA3.1 CMV", promoter: "CMV immediate-early", replication: "Transient plasmid or random integration", selection: "Neomycin/G418; ampicillin in E. coli", delivery: "Transient transfection or stable integration", benefits: "Broad-host, high-level mammalian expression with many tag variants.", caution: "Verify signal peptide, Kozak sequence and marker orientation." },
    { id: "pcdna34", name: "pcDNA3.4 high-expression", promoter: "Full-length CMV", replication: "Transient mammalian plasmid", selection: "Backbone/system dependent", delivery: "Expi293F or ExpiCHO-S transient transfection", benefits: "Optimized high-level transient expression for Expi workflows.", caution: "Use matched cell, medium, transfection and enhancer conditions.", compatibleHostIds: ["hek293t", "expi293f", "cho-k1", "expicho"] },
    { id: "ptt5", name: "pTT / oriP-EBNA1", promoter: "CMV with oriP/EBNA1", replication: "EBNA1-positive oriP episome", selection: "Backbone dependent", delivery: "Transient transfection into HEK293-6E", benefits: "High transient copy number and prolonged expression in EBNA1 cells.", caution: "The advantage is lost in hosts without EBNA1.", compatibleHostIds: ["hek293-6e"], requiredPromoterTokens: ["orip", "ebna1"] },
    { id: "pcag", name: "CAG promoter vectors", promoter: "CAG hybrid", replication: "Transient or stable integration", selection: "Puromycin, G418, hygromycin or none", delivery: "Transient transfection or stable-line generation", benefits: "Strong broad expression and often better resistance to silencing than minimal CMV.", caution: "Large promoter/enhancer footprint can constrain vector capacity." },
    { id: "lentiviral", name: "Third-generation lentiviral transfer", promoter: "EF1α, PGK, SFFV or cell-specific", replication: "Integrated self-inactivating provirus", selection: "Puromycin, blasticidin, hygromycin or fluorescent sorting", delivery: "Package, transduce target cells and select", benefits: "Stable delivery to dividing and non-dividing mammalian cells.", caution: "Requires biosafety review and insertion/copy-number assessment." },
    { id: "dhfr-cho", name: "DHFR-linked CHO vectors", promoter: "CMV or SV40 linked to DHFR", replication: "Stable integration with amplification", selection: "DHFR complementation and methotrexate", delivery: "Transfect DHFR-deficient CHO, select, amplify and clone", benefits: "Classical route to very high-producing stable CHO clones.", caution: "Long development timeline and amplification-associated instability.", compatibleHostIds: ["cho-dg44"], requiredPromoterTokens: ["dhfr"] },
  ],
  cellfree: [
    { id: "pt7-cf", name: "T7 cell-free plasmid template", promoter: "T7 with a cell-free-optimised 5′ UTR", replication: "Propagated in E. coli; used as purified plasmid", selection: "Ampicillin or kanamycin during cloning only", delivery: "Add purified plasmid directly to the reaction", benefits: "Reusable, sequence-verified template that gives the most reproducible cell-free yields.", caution: "Template purity matters: carry-over RNase or salt inhibits the reaction.", requiredPromoterTokens: ["t7"] },
    { id: "linear-pcr", name: "Linear PCR / split-primer template", promoter: "T7 or SP6 added by the primer", replication: "None — the PCR product is the template", selection: "None", delivery: "Add the PCR product straight to the reaction", benefits: "No cloning at all, so a construct series can be screened the day it is designed.", caution: "Lysate exonucleases degrade linear DNA; PURE or a protected template performs better." },
    { id: "cf-detergent", name: "Detergent / lipid-supplemented reaction", promoter: "T7 (plasmid template)", replication: "Not applicable", selection: "None", delivery: "Dose detergent, liposomes or nanodiscs into the reaction", benefits: "Folds a membrane protein as it is made, with no membrane insertion step.", caution: "The right detergent or lipid is target-specific and has to be screened." },
    { id: "cf-redox", name: "Oxidising / chaperone-supplemented reaction", promoter: "T7 (plasmid template)", replication: "Not applicable", selection: "None", delivery: "Add a GSSG/GSH redox buffer plus DsbC or PDI to the reaction", benefits: "Lets a disulfide-bonded protein form native bonds in an otherwise reducing extract.", caution: "Redox and chaperone levels both need titrating; over-oxidation stalls translation." },
  ],
};

const systemLabels: Record<HostSystem, string> = { ecoli: "Escherichia coli", yeast: "Yeast", insect: "Insect", mammalian: "Mammalian", cellfree: "Cell-free" };

export function systemLabel(value: HostSystem) { return systemLabels[value]; }

// Saved projects store the system as either the id ("ecoli") or the display
// label ("Escherichia coli"), and older saves predate the cell-free family, so
// the match is by substring and the fallback stays E. coli as it always was.
export function normalizeHostSystem(value: unknown): HostSystem {
  const key = String(value ?? "").toLowerCase();
  if (key.includes("cell-free") || key.includes("cellfree") || key.includes("cell free") || key.includes("in vitro")) return "cellfree";
  if (key.includes("yeast") || key.includes("pichia") || key.includes("cerevisiae") || key.includes("phaffii")) return "yeast";
  if (key.includes("insect") || key.includes("baculo")) return "insect";
  if (key.includes("mammal") || key.includes("cho") || key.includes("hek")) return "mammalian";
  return "ecoli";
}

export function allHosts(): { system: HostSystem; host: ExpressionHost }[] {
  return hostSystems.flatMap((system) => expressionHosts[system].map((host) => ({ system, host })));
}

// A saved strain id is resolved across every family, not only the saved system,
// so a project whose hostSystem label was written by an older build still finds
// its cell line.
export function findHost(id: string): { system: HostSystem; host: ExpressionHost } | null {
  return allHosts().find((entry) => entry.host.id === id) ?? null;
}

export type MetricCell = { key: MetricKey; column: MetricColumn; value: string | Meter; inherited: boolean };

// Strain records only override the metrics that genuinely differ from their
// family, so an un-overridden cell is reported as the family's typical value
// rather than presented as a measurement of that strain.
export function hostMetrics(system: HostSystem, host: ExpressionHost): MetricCell[] {
  const family = hostFamilies[system].metrics;
  return metricColumns.map((column) => {
    const override = host.metrics?.[column.key];
    return { key: column.key, column, value: override ?? family[column.key], inherited: override === undefined };
  });
}

export function familyMetrics(system: HostSystem): MetricCell[] {
  const family = hostFamilies[system].metrics;
  return metricColumns.map((column) => ({ key: column.key, column, value: family[column.key], inherited: false }));
}

export function isMeter(value: string | Meter): value is Meter { return typeof value === "object" && value !== null && "level" in value; }

export function hostReferences(host: ExpressionHost): Reference[] { return resolveReferences(host.referenceIds); }
export function familyReferences(system: HostSystem): Reference[] { return resolveReferences(hostFamilies[system].referenceIds); }
export function resolveReferences(ids: string[]): Reference[] { return ids.map((id) => expressionReferences[id]).filter((entry): entry is Reference => Boolean(entry)); }

export function referenceCitation(reference: Reference) {
  return reference.kind === "vendor" ? `${reference.authors} — ${reference.source}` : `${reference.authors} (${reference.year}) ${reference.source}`;
}
export function referenceUrl(reference: Reference) { return reference.doi ? `https://doi.org/${reference.doi}` : null; }

export type VectorMatch = { family: ExpressionVectorFamily; level: "pass" | "warning"; note: string };

// Which catalog vectors can actually be used in one chosen cell line. A family
// restricted to other hosts is left out entirely; one whose promoter machinery
// the host does not supply is listed with the caveat rather than hidden, since
// the host can often be swapped for a compatible relative.
export function compatibleVectorFamilies(system: HostSystem, host: ExpressionHost): VectorMatch[] {
  return expressionVectors[system]
    .filter((family) => !family.compatibleHostIds || family.compatibleHostIds.includes(host.id))
    .map((family) => family.requiredPromoterTokens && !family.requiredPromoterTokens.some((token) => host.promoter.toLowerCase().includes(token))
      ? { family, level: "warning" as const, note: `Expects ${family.requiredPromoterTokens.join(" / ")} capability, which is not listed for ${host.name}.` }
      : { family, level: "pass" as const, note: family.benefits });
}

export function hostCategories(system: HostSystem) { return ["All hosts", ...Array.from(new Set(expressionHosts[system].map((entry) => entry.category)))]; }

export function matchesHostSearch(host: ExpressionHost, search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [host.name, host.aka ?? "", host.category, host.lineage, host.genotype, host.promoter, host.markers, host.usefulFor, host.bestFor.join(" "), host.strengths.join(" "), host.limits.join(" ")].join(" ").toLowerCase().includes(needle);
}

// The config written to the project job. Other jobs (Cell lysis, Transformation
// and expression, reports, the project-tree diff) read these exact keys, so the
// shape is fixed and covered by a test.
export function hostSavedConfig(system: HostSystem, host: ExpressionHost) {
  const cells = hostMetrics(system, host);
  return {
    hostSystem: systemLabel(system), hostSystemId: system, hostId: host.id, strainId: host.id, strainName: host.name,
    category: host.category, lineage: host.lineage, promoter: host.promoter, genotype: host.genotype,
    usefulFor: host.usefulFor, bestFor: host.bestFor, markers: host.markers,
    typicalYield: metricText(cells, "yield"), timeToProtein: metricText(cells, "timeToProtein"),
    referenceCitations: hostReferences(host).map(referenceCitation), savedByUser: true,
  };
}

function metricText(cells: MetricCell[], key: MetricKey) {
  const cell = cells.find((entry) => entry.key === key);
  if (!cell) return "";
  return isMeter(cell.value) ? cell.value.label : cell.value;
}
