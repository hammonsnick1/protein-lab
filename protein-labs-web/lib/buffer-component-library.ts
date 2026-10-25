// Common buffer components from the purification literature, with the purpose
// each one serves, why it is used, cautions and a reference. The Buffer
// composer (components/protein-labs/buffer-composer.tsx) picks from this list;
// a component's `role` holds the purpose label, or the scientist's own text.
//
// Pure module: no runtime `@/` imports, so `node --test` can load it.
import type { BufferComponent } from "@/lib/purification-catalog";

export type BufferPurposeId = "buffering"|"ionic-strength"|"competitor"|"reducing"|"stabilizer"|"chelator"|"protease-inhibitor"|"nuclease"|"lysis-enzyme"|"detergent"|"metal-cofactor"|"affinity-eluent";
export type BufferPurpose = { id:BufferPurposeId; label:string; summary:string; aliases:string[] };
export type BufferLibraryEntry = {
  id:string; name:string; aliases:string[];
  typical:{ low:number; high:number; unit:string }; defaultConcentration:number; defaultUnit:string;
  purposes:{ purpose:BufferPurposeId; why:string }[];
  cautions:string[]; references:string[];
  /** The one caution that can ruin a purification, shown on the row itself. */
  alert?:string;
};

/** The fixed purpose list. `aliases` are role texts saved by earlier versions and the presets, so old rows still show their purpose. */
export const bufferPurposes: BufferPurpose[] = [
  {id:"buffering",label:"Buffering agent",summary:"Holds the pH where the protein is stable and the resin binds.",aliases:["buffering","buffer"]},
  {id:"ionic-strength",label:"Ionic strength",summary:"Screens charge–charge interactions between proteins and with the resin.",aliases:["ionic strength","solubility / ionic strength","isotonic ionic strength","suppress nonspecific interaction","solubility"]},
  {id:"competitor",label:"Competitor / eluent",summary:"Competes with the tag for the resin: low in binding and wash to cut background, high to elute.",aliases:["selectivity","imac selectivity","reduce nonspecific imac binding","competitive wash","selective wash","competitive elution"]},
  {id:"reducing",label:"Reducing agent",summary:"Keeps cysteines reduced so they do not form non-native disulfides.",aliases:["redox control"]},
  {id:"stabilizer",label:"Stabilizer / osmolyte",summary:"Favours the folded state and reduces aggregation.",aliases:["stabilization","hypertonic environment"]},
  {id:"chelator",label:"Chelator",summary:"Binds divalent metal ions.",aliases:[]},
  {id:"protease-inhibitor",label:"Protease inhibitor",summary:"Blocks host proteases released during lysis.",aliases:[]},
  {id:"nuclease",label:"Nuclease",summary:"Digests released DNA and RNA so the lysate is less viscous.",aliases:[]},
  {id:"lysis-enzyme",label:"Lysis enzyme",summary:"Weakens the cell wall so cells break open.",aliases:[]},
  {id:"detergent",label:"Detergent",summary:"Solubilizes membranes and keeps hydrophobic surfaces in solution.",aliases:["membrane solubilization","maintain solubilization"]},
  {id:"metal-cofactor",label:"Metal / cofactor",summary:"Supplies a metal ion the protein, an enzyme or the capture chemistry needs.",aliases:["calcium-dependent binding","maintain binding"]},
  {id:"affinity-eluent",label:"Affinity eluent",summary:"Displaces the tag from its specific ligand to release the target.",aliases:["competitive elution","xt competitive elution","acidic elution","chelate calcium"]},
];

const cytiva = "Cytiva. Recombinant Protein Purification Handbook: Principles and Methods (18-1142-75).";
const cytivaAntibody = "Cytiva. Antibody Purification Handbook.";
const qiagen = "QIAGEN. The QIAexpressionist: a handbook for high-level expression and purification of 6xHis-tagged proteins, 5th ed. (2003).";
const bondos = "Bondos SE, Bicknell A. Detection and prevention of protein aggregation before, during, and after purification. Anal Biochem 2003;316:223–231.";
const graslund = "Gräslund S, et al. Protein production and purification. Nat Methods 2008;5:135–146.";
const good = "Good NE, et al. Hydrogen ion buffers for biological research. Biochemistry 1966;5:467–477.";
const bornhorst = "Bornhorst JA, Falke JJ. Purification of proteins using polyhistidine affinity tags. Methods Enzymol 2000;326:245–254.";
const golovanov = "Golovanov AP, Hautbergue GM, Wilson SA, Lian LY. A simple method for improving protein solubility and long-term stability. J Am Chem Soc 2004;126:8933–8939.";
const tsumoto = "Tsumoto K, et al. Role of arginine in protein refolding, solubilization, and purification. Biotechnol Prog 2004;20:1301–1308.";
const vagenende = "Vagenende V, Yap MGS, Trout BL. Mechanisms of protein stabilization and prevention of protein aggregation by glycerol. Biochemistry 2009;48:11084–11096.";
const arakawa = "Arakawa T, Timasheff SN. Stabilization of protein structure by sugars. Biochemistry 1982;21:6536–6544.";
const getz = "Getz EB, et al. A comparison between the sulfhydryl reductants tris(2-carboxyethyl)phosphine and dithiothreitol for use in protein biochemistry. Anal Biochem 1999;273:73–80.";
const cleland = "Cleland WW. Dithiothreitol, a new protective reagent for SH groups. Biochemistry 1964;3:480–482.";
const james = "James GT. Inactivation of the protease inhibitor phenylmethylsulfonyl fluoride in buffers. Anal Biochem 1978;86:574–579.";
const seddon = "Seddon AM, Curnow P, Booth PJ. Membrane proteins, lipids and detergents: not just a soap opera. Biochim Biophys Acta 2004;1666:105–117.";
const hjelmeland = "Hjelmeland LM. A nondenaturing zwitterionic detergent for membrane biochemistry: design and synthesis. Proc Natl Acad Sci USA 1980;77:6368–6370.";
const strep = "Schmidt TGM, Skerra A. The Strep-tag system for one-step purification and high-affinity detection or capturing of proteins. Nat Protoc 2007;2:1528–1535.";
const strepXt = "IBA Lifesciences. Strep-Tactin®XT protein purification manual.";
const smith = "Smith DB, Johnson KS. Single-step purification of polypeptides expressed in Escherichia coli as fusions with glutathione S-transferase. Gene 1988;67:31–40.";
const diGuan = "di Guan C, Li P, Riggs PD, Inouye H. Vectors that facilitate the expression and purification of foreign peptides in Escherichia coli by fusion to maltose-binding protein. Gene 1988;67:21–30.";
const hopp = "Hopp TP, et al. A short polypeptide marker sequence useful for recombinant protein identification and purification. Bio/Technology 1988;6:1204–1210.";
const rigaut = "Rigaut G, et al. A generic protein purification method for protein complex characterization and proteome exploration. Nat Biotechnol 1999;17:1030–1032.";
const benzonase = "Merck (MilliporeSigma). Benzonase® Nuclease product information.";
const berg = "Berg JM, Shi Y. The galvanization of biology: a growing appreciation for the roles of zinc. Science 1996;271:1081–1085.";

const entry=(id:string,name:string,aliases:string[],typical:[number,number,string],defaultConcentration:number,purposes:BufferLibraryEntry["purposes"],cautions:string[],references:string[]):BufferLibraryEntry=>({id,name,aliases,typical:{low:typical[0],high:typical[1],unit:typical[2]},defaultConcentration,defaultUnit:typical[2],purposes,cautions,references});

const alerts: Record<string,string> = {
  edta:"Strips Ni²⁺ and Co²⁺ from IMAC resins.",
  dtt:"Reduces Ni²⁺ on IMAC resins; keep at or below about 1 mM, or use TCEP.",
  imidazole:"Absorbs at 280 nm; blank A280 against the same buffer.",
  "triton-x-100":"Absorbs strongly at 280 nm.",
  pmsf:"Toxic; hydrolyses within about an hour, so add it just before lysis.",
  "protease-inhibitor-cocktail":"Use an EDTA-free cocktail before IMAC.",
  "glycine-low-ph":"Neutralize eluted fractions immediately.",
  ddm:"Keep above its CMC in every buffer after extraction.",
};

export const bufferComponentLibrary: BufferLibraryEntry[] = [
  // Buffering agents
  entry("tris","Tris-HCl",["Tris","Tris base","Trizma","tris(hydroxymethyl)aminomethane"],[20,100,"mM"],50,[{purpose:"buffering",why:"pKa about 8.1 at 25 °C, so it buffers well from pH 7 to 9: the usual range for lysis, IMAC and GST capture. Cheap and does not precipitate with divalent metals."}],["pH falls by about 0.03 units for every 1 °C rise; set the pH at the temperature you will work at (a pH 8.0 buffer made at 25 °C is near pH 8.6 at 4 °C).","Its primary amine reacts with NHS-ester and aldehyde reagents; exchange it out before amine labelling or cross-linking."],[good,cytiva]),
  entry("hepes","HEPES",["HEPES-NaOH","HEPES-KOH"],[10,50,"mM"],20,[{purpose:"buffering",why:"A Good's buffer with pKa about 7.5 that buffers from pH 6.8 to 8.2, with little temperature drift and weak metal binding. A common default for IMAC lysis buffers and for final storage and SEC buffers."}],["Interferes with the Lowry (Folin) protein assay; use Bradford or A280 instead."],[good,graslund]),
  entry("sodium-phosphate","Sodium phosphate",["NaPi","phosphate","NaH2PO4","Na2HPO4","phosphate buffer"],[20,100,"mM"],50,[{purpose:"buffering",why:"pKa about 7.2, buffering from pH 5.8 to 8.0. No amine and no metal coordination, so it is the classic Ni-NTA lysis, wash and elution buffer (50 mM NaH₂PO₄, 300 mM NaCl, pH 8.0)."}],["Precipitates with Ca²⁺, Mg²⁺ and Zn²⁺; avoid when those ions are needed.","The pH drops sharply when sodium phosphate freezes; avoid it for frozen storage.","TCEP is unstable in phosphate buffer at neutral pH; make it fresh if both are used."],[qiagen]),
  entry("mes","MES",["MES-NaOH","2-(N-morpholino)ethanesulfonic acid"],[20,50,"mM"],25,[{purpose:"buffering",why:"A Good's buffer with pKa about 6.1, buffering from pH 5.5 to 6.7. Used for proteins that are more stable slightly acidic, and for cation-exchange steps."}],["Gives no buffering above about pH 6.7.","At pH below about 6 histidines protonate and His-tagged proteins release from IMAC resin; do not use it for IMAC binding."],[good]),
  // Salts
  entry("nacl","NaCl",["sodium chloride","salt"],[50,500,"mM"],150,[{purpose:"ionic-strength",why:"Screens electrostatic interactions. 300–500 mM in IMAC lysis and wash buffers cuts nonspecific ionic binding of host proteins; around 150 mM keeps most proteins soluble in storage."}],["High salt strengthens hydrophobic interactions and can salt out some proteins.","Lower it before ion-exchange chromatography, where salt is the eluent."],[qiagen,graslund,bondos]),
  entry("kcl","KCl",["potassium chloride"],[50,300,"mM"],150,[{purpose:"ionic-strength",why:"An alternative to NaCl that matches intracellular ionic conditions, used for enzymes and complexes that need K⁺ or are sensitive to Na⁺."}],["K⁺ precipitates SDS as potassium dodecyl sulfate; dilute or exchange samples before SDS-PAGE."],[cytiva]),
  // Competitors and affinity eluents
  entry("imidazole","Imidazole",[],[5,500,"mM"],20,[{purpose:"competitor",why:"Competes with histidine side chains for Ni²⁺ or Co²⁺ sites. 10–40 mM in binding and wash buffers displaces host proteins with a few surface histidines; 250–500 mM elutes the His-tagged target."}],["Absorbs at 280 nm; blank A280 readings against the same buffer, or remove imidazole before measuring concentration.","Imidazole is basic; check the pH after adding it.","High imidazole can destabilize some proteins; exchange it out soon after elution."],[qiagen,bornhorst]),
  entry("desthiobiotin","Desthiobiotin",["D-desthiobiotin"],[2,10,"mM"],2.5,[{purpose:"affinity-eluent",why:"Binds Strep-Tactin reversibly and displaces Strep-tag II gently, so the target elutes native and the resin can be regenerated."}],["Too weak to elute efficiently from Strep-Tactin XT; use biotin with XT resins.","Free biotin in culture media or lysate blocks Strep-Tactin; remove it before capture."],[strep]),
  entry("biotin","Biotin",["D-biotin","vitamin B7"],[10,50,"mM"],50,[{purpose:"affinity-eluent",why:"Competitively elutes Twin-Strep-tag fusions from Strep-Tactin XT, whose affinity is too high for desthiobiotin."}],["On classic Strep-Tactin resins biotin binds almost irreversibly; use desthiobiotin there.","Any biotin present before capture blocks binding."],[strepXt]),
  entry("glutathione","Reduced glutathione",["GSH","glutathione","L-glutathione reduced"],[10,20,"mM"],10,[{purpose:"affinity-eluent",why:"Competes the GST fusion off immobilized glutathione; about 10 mM in 50 mM Tris-HCl pH 8.0 is the standard elution."}],["Glutathione is acidic; re-check and adjust the pH after dissolving it.","Oxidizes in solution; prepare elution buffer fresh.","Remove it before thiol labelling or assays sensitive to reductant."],[smith,cytiva]),
  entry("maltose","Maltose",["D-maltose","maltose monohydrate"],[10,20,"mM"],10,[{purpose:"affinity-eluent",why:"Competes MBP fusions off amylose or dextrin resin under mild, native conditions."}],[],[diGuan,cytiva]),
  entry("glycine-low-ph","Low-pH glycine",["glycine","glycine-HCl","glycine pH 2.7"],[0.1,0.1,"M"],0.1,[{purpose:"affinity-eluent",why:"0.1 M glycine-HCl at pH 2.5–3.0 releases Fc and Protein A/G fusions from their ligand by disrupting the interaction at low pH."}],["Neutralize fractions at once, for example with 1/10 volume of 1 M Tris-HCl pH 8–9, to limit acid denaturation."],[cytivaAntibody]),
  entry("flag-peptide","FLAG peptide",["DYKDDDDK peptide","3×FLAG peptide","3xFLAG peptide"],[100,200,"µg/mL"],100,[{purpose:"affinity-eluent",why:"Competitively elutes FLAG-tagged proteins from anti-FLAG antibody resin without changing pH."}],["3×FLAG fusions need the 3×FLAG peptide; the single FLAG peptide elutes them poorly."],[hopp]),
  // Reducing agents
  entry("tcep","TCEP",["TCEP-HCl","tris(2-carboxyethyl)phosphine"],[0.1,1,"mM"],0.5,[{purpose:"reducing",why:"Odourless, thiol-free reductant that is more resistant to air oxidation than DTT, works over a wide pH range, and need not be removed before maleimide labelling. It is gentler on IMAC resins than DTT."}],["Unstable in phosphate buffers at neutral pH; prepare fresh in those buffers.","TCEP-HCl stock is strongly acidic; neutralize it before adding to weak buffers."],[getz,graslund]),
  entry("dtt","DTT",["dithiothreitol","Cleland's reagent"],[1,10,"mM"],1,[{purpose:"reducing",why:"A strong dithiol reductant that keeps cysteines reduced and reverses disulfide bonds at low millimolar concentration."}],["Reduces Ni²⁺ on IMAC resins, turning them brown and lowering capacity; keep it at or below about 1 mM during IMAC, or use TCEP.","Oxidizes in air within hours; add it fresh.","Oxidized DTT absorbs near 280 nm and can inflate A280 readings."],[cleland,getz]),
  entry("bme","β-Mercaptoethanol",["2-mercaptoethanol","beta-mercaptoethanol","BME","β-ME","2-ME"],[5,20,"mM"],10,[{purpose:"reducing",why:"Monothiol reductant that Ni-NTA resin tolerates up to about 20 mM, so it is the traditional reductant in His-tag protocols."}],["Volatile, toxic and strong-smelling; handle in a fume hood.","Oxidizes quickly in solution; add it fresh."],[qiagen]),
  // Stabilizers and osmolytes
  entry("glycerol","Glycerol",[],[5,20,"% (v/v)"],10,[{purpose:"stabilizer",why:"Preferentially excluded from the protein surface, which favours compact native states and suppresses aggregation; also a cryoprotectant for frozen stocks."}],["Raises viscosity and column back-pressure; stay at or below about 20 %.","Remove it before crystallization trials or assays it interferes with."],[vagenende,bondos,graslund]),
  entry("sucrose","Sucrose",[],[5,10,"% (w/v)"],5,[{purpose:"stabilizer",why:"Preferentially excluded from the protein surface, stabilizing the folded state; also used as a cryoprotectant and to make a hypertonic buffer for osmotic or periplasmic release."}],["Raises viscosity and density; dilute or exchange it before SEC and other high-resolution steps."],[arakawa]),
  entry("arginine","L-Arginine",["arginine","Arg","L-Arg","L-arginine HCl"],[50,500,"mM"],50,[{purpose:"stabilizer",why:"Suppresses aggregation and improves solubility; equimolar 50 mM L-Arg with L-Glu can raise the maximum soluble concentration several-fold."}],["At high concentration (around 0.5 M and above) it can weaken binding to affinity resins; it is also used to elute from Protein A.","Adding the free base or HCl salt shifts the pH; re-adjust after adding it."],[golovanov,tsumoto]),
  entry("glutamate","L-Glutamate",["glutamate","Glu","L-Glu","L-glutamic acid","sodium glutamate"],[50,200,"mM"],50,[{purpose:"stabilizer",why:"Used with L-Arg at equal concentration (typically 50 mM each); the pair improves solubility and long-term stability more than either alone."}],["Most effective paired with L-Arg; adjust the pH after adding both."],[golovanov]),
  // Chelators and metals
  entry("edta","EDTA",["Na2EDTA","ethylenediaminetetraacetic acid"],[0.5,5,"mM"],1,[{purpose:"chelator",why:"Binds divalent metals, which inhibits metalloproteases and slows metal-catalysed cysteine oxidation during lysis and storage."},{purpose:"affinity-eluent",why:"Strips Ca²⁺ to release calcium-dependent tags such as the calmodulin-binding peptide or Protein C epitope."}],["Strips Ni²⁺ and Co²⁺ from IMAC resins; leave it out of every buffer before and during IMAC (or use an EDTA-resistant resin).","Inhibits Mg²⁺-dependent nucleases such as Benzonase and DNase I.","Removes Mg²⁺ and Ca²⁺ that enzymes or the target may need."],[qiagen,rigaut]),
  entry("mgcl2","MgCl₂",["MgCl2","magnesium chloride","Mg2+"],[1,10,"mM"],2,[{purpose:"metal-cofactor",why:"Benzonase and DNase I need about 1–2 mM Mg²⁺ to digest nucleic acids in the lysate; many nucleotide-binding proteins need Mg²⁺ too."}],["Precipitates with phosphate at higher concentrations.","EDTA in the same buffer removes it."],[benzonase]),
  entry("cacl2","CaCl₂",["CaCl2","calcium chloride","Ca2+"],[1,5,"mM"],2,[{purpose:"metal-cofactor",why:"Calcium is required for calmodulin-binding peptide capture on calmodulin resin and for anti-Protein C (HPC4) capture; chelating it elutes the target."}],["Precipitates with phosphate; use Tris or HEPES.","Calcium can change the activity or oligomeric state of calcium-binding targets."],[rigaut]),
  entry("zncl2","ZnCl₂",["ZnCl2","zinc chloride","Zn2+","ZnSO4"],[1,100,"µM"],10,[{purpose:"metal-cofactor",why:"Supplies structural Zn²⁺ for zinc-finger and other zinc-dependent proteins that otherwise lose their fold during purification."}],["Precipitates as zinc phosphate; avoid phosphate buffers.","DTT binds Zn²⁺; prefer TCEP if a reductant is needed.","Keep it at low micromolar; excess free zinc can cause aggregation."],[berg]),
  // Protease inhibitors
  entry("pmsf","PMSF",["phenylmethylsulfonyl fluoride","phenylmethanesulfonyl fluoride"],[0.1,1,"mM"],1,[{purpose:"protease-inhibitor",why:"Irreversibly blocks serine proteases released during lysis; inexpensive and added from an ethanol or isopropanol stock."}],["Hydrolyses in aqueous buffer within about an hour at neutral to basic pH; add it immediately before lysis.","Toxic; handle with gloves in a fume hood.","Inhibits thrombin, Factor Xa and enterokinase; remove it before tag cleavage with those proteases."],[james]),
  entry("protease-inhibitor-cocktail","Protease inhibitor cocktail",["PIC","cOmplete","EDTA-free protease inhibitor","protease inhibitors"],[1,1,"×"],1,[{purpose:"protease-inhibitor",why:"A mix of inhibitors that covers serine, cysteine and metalloproteases in one addition during lysis."}],["Many cocktails contain EDTA; choose an EDTA-free version before IMAC.","Remove it before tag cleavage; it can inhibit the cleavage protease."],[cytiva]),
  // Nucleases and lysis enzymes
  entry("benzonase","Benzonase nuclease",["Benzonase","endonuclease"],[10,250,"U/mL"],25,[{purpose:"nuclease",why:"Degrades DNA and RNA from lysed cells, lowering lysate viscosity so it clarifies faster and flows through columns with better recovery."}],["Needs 1–2 mM Mg²⁺; chelators such as EDTA inhibit it.","It is a protein; later purification steps must remove it."],[benzonase,qiagen]),
  entry("dnase-i","DNase I",["DNase","deoxyribonuclease I"],[5,10,"µg/mL"],10,[{purpose:"nuclease",why:"Digests released genomic DNA to reduce lysate viscosity."}],["Needs Mg²⁺ (and Ca²⁺ for stability); EDTA inhibits it.","Does not digest RNA."],[cytiva]),
  entry("lysozyme","Lysozyme",["hen egg-white lysozyme","HEWL"],[0.2,1,"mg/mL"],1,[{purpose:"lysis-enzyme",why:"Hydrolyses the peptidoglycan cell wall of E. coli, so cells break with gentler sonication or freeze–thaw; about 1 mg/mL on ice for 30 min."}],["Adds a ~14 kDa band to gels and can carry through early steps.","Works poorly at high ionic strength; add before raising salt, or lyse mechanically."],[qiagen]),
  // Detergents
  entry("triton-x-100","Triton X-100",["Triton","TX-100"],[0.1,1,"% (v/v)"],0.1,[{purpose:"detergent",why:"Nonionic detergent that helps solubilize membranes during lysis and reduces nonspecific hydrophobic binding in washes; tolerated by Ni-NTA resin."}],["Its aromatic ring absorbs strongly at 280 nm, interfering with A280 measurements.","Low CMC and large micelles make it hard to remove by dialysis."],[qiagen]),
  entry("tween-20","Tween-20",["polysorbate 20","Tween 20"],[0.01,0.1,"% (v/v)"],0.05,[{purpose:"detergent",why:"Mild nonionic detergent that reduces sticking to tubes and resins and lowers nonspecific binding in wash buffers."}],["Old stocks accumulate peroxides that can oxidize proteins; use fresh, low-peroxide grades."],[qiagen]),
  entry("ddm","DDM",["n-dodecyl-β-D-maltoside","dodecyl maltoside","n-dodecyl-beta-D-maltoside"],[0.02,1,"% (w/v)"],0.05,[{purpose:"detergent",why:"Mild nonionic maltoside detergent; about 1 % extracts membrane proteins and a few times its CMC (around 0.02–0.05 %) keeps them in micelles through purification."}],["Keep it above its CMC in every buffer after extraction, or the protein aggregates.","The micelle (roughly 70 kDa) adds to the apparent mass on SEC."],[seddon]),
  entry("chaps","CHAPS",[],[0.1,1,"% (w/v)"],0.5,[{purpose:"detergent",why:"Zwitterionic, nondenaturing bile-salt detergent; its high CMC means it can be removed by dialysis."}],["High CMC means relatively large amounts are needed to stay above it.","Extracts some membrane proteins less efficiently than maltosides; screen detergents."],[hjelmeland,seddon]),
].map(item=>alerts[item.id]?{...item,alert:alerts[item.id]}:item);

export const bufferUnits = ["mM","M","µM","nM","% (v/v)","% (w/v)","mg/mL","µg/mL","U/mL","×"];

function normalizeName(value:string){return value.normalize("NFKD").toLowerCase().replace(/[\s\-_·,()]/g,"")}
export function findLibraryComponent(name:string):BufferLibraryEntry|undefined{const key=normalizeName(name);if(!key)return undefined;return bufferComponentLibrary.find(item=>[item.name,...item.aliases].some(value=>normalizeName(value)===key))}
export function purposeById(id:BufferPurposeId){return bufferPurposes.find(item=>item.id===id)!}
/** Purposes offered for a component: the library entry's own, or every purpose for a custom component. */
export function purposeOptions(item:BufferLibraryEntry|undefined):BufferPurpose[]{return item?item.purposes.map(value=>purposeById(value.purpose)):bufferPurposes}
/** Which listed purpose a saved `role` means, matching its label or an older alias; null means the role is the scientist's own text. */
export function resolvePurpose(item:BufferLibraryEntry|undefined,role:string):BufferPurposeId|null{const key=role.trim().toLowerCase();if(!key)return null;return purposeOptions(item).find(value=>value.label.toLowerCase()===key||value.aliases.includes(key))?.id??null}
export function purposeExplanation(item:BufferLibraryEntry|undefined,purpose:BufferPurposeId|null){if(!purpose)return"";return item?.purposes.find(value=>value.purpose===purpose)?.why??purposeById(purpose).summary}

/** Library entries matching a search on name, alias or purpose; names that start with the query first. */
export function searchLibrary(query:string):BufferLibraryEntry[]{const key=query.trim().toLowerCase();if(!key)return bufferComponentLibrary;const score=(item:BufferLibraryEntry)=>{const names=[item.name,...item.aliases].map(value=>value.toLowerCase());if(names.some(value=>value.startsWith(key)))return 0;if(names.some(value=>value.includes(key)))return 1;if(item.purposes.some(value=>purposeById(value.purpose).label.toLowerCase().includes(key)))return 2;return 3};return bufferComponentLibrary.map(item=>({item,rank:score(item)})).filter(value=>value.rank<3).sort((a,b)=>a.rank-b.rank).map(value=>value.item)}

/** A row after choosing a library entry: blank rows take the typical concentration and unit; a purpose the entry does not serve becomes its first purpose. */
export function applyLibraryComponent(current:BufferComponent,item:BufferLibraryEntry):BufferComponent{const blank=String(current.concentration).trim()==="";return{name:item.name,concentration:blank?item.defaultConcentration:current.concentration,unit:blank?item.defaultUnit:current.unit,role:resolvePurpose(item,current.role)?current.role:purposeById(item.purposes[0].purpose).label}}

export function formatTypicalRange(item:BufferLibraryEntry){const {low,high,unit}=item.typical;return low===high?`${low} ${unit}`:`${low}–${high} ${unit}`}
/** "above" or "below" when a concentration in the typical range's unit falls outside it; "" otherwise. */
export function rangeStatus(item:BufferLibraryEntry|undefined,component:BufferComponent):"above"|"below"|""{if(!item)return"";const value=Number(component.concentration);const unit=(value:string)=>value.replace(/\s*\(.*\)$/,"").trim();if(String(component.concentration).trim()===""||!Number.isFinite(value)||unit(component.unit)!==unit(item.typical.unit))return"";return value>item.typical.high?"above":value<item.typical.low?"below":""}
