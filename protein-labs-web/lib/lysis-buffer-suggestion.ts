// Suggests a Cell lysis buffer from the choices saved in the other purification
// jobs: the Affinity capture column and binding buffer, Subtractive cleanup, the
// SEC buffer, the expression host and the membrane flag. Each part of the
// suggestion carries one plain reason line. The Cell lysis job applies the
// result into the shared Buffer composer, where it stays editable.
//
// Pure module: no runtime `@/` imports, so `node --test` can load it.
import type { BufferComponent, BufferStep } from "@/lib/purification-catalog";
import { findLibraryComponent, purposeById, resolvePurpose, type BufferPurposeId } from "./buffer-component-library.ts";

/** The capture chemistry that decides what the lysate may and may not contain. */
export type CaptureChemistry = "imac"|"gst"|"strep"|"mbp"|"calcium"|"other"|"none";
export type LysisHost = "bacteria"|"yeast"|"insect"|"mammalian"|"";
export type LysisContext = {
  /** Saved Affinity capture: column id and tag text, and its binding buffer when one was saved. */
  capture?: { columnId?:string; shortName?:string; tag?:string; binding?:BufferStep|null }|null;
  /** Saved Subtractive cleanup column, if any. */
  cleanup?: { columnId?:string; shortName?:string; tag?:string }|null;
  /** Components of the saved SEC / storage buffer, if any. */
  secComponents?: BufferComponent[];
  host: LysisHost;
  membrane: boolean;
};
export type LysisReason = { component:string; text:string };
export type LysisSuggestion = { chemistry:CaptureChemistry; step:BufferStep; reasons:LysisReason[] };

/** Capture chemistry from a saved column id, falling back to the tag text. */
export function captureChemistry(columnId?:string,tag?:string):CaptureChemistry{
  const id=(columnId??"").toLowerCase(),text=(tag??"").toLowerCase();
  if(!id&&!text)return"none";
  if(id.startsWith("his-")||id.startsWith("hat-")||/polyhistidine|\bhis\b|6×his|6xhis|hat-tag/.test(text))return"imac";
  if(id==="gst"||/\bgst\b/.test(text))return"gst";
  if(id.startsWith("strep-")||id.startsWith("twin-strep")||/strep/.test(text))return"strep";
  if(id.startsWith("mbp-")||/\bmbp\b/.test(text))return"mbp";
  if(id==="cbp"||id==="protein-c"||/calmodulin|protein c tag/.test(text))return"calcium";
  return"other";
}

export const lysisHostLabels:Record<Exclude<LysisHost,"">,string>={bacteria:"E. coli",yeast:"yeast",insect:"insect cells",mammalian:"mammalian cells"};
/** Normalizes the saved expression-system host into the four families. */
export function lysisHost(value:unknown):LysisHost{const raw=String(value??"").toLowerCase();if(!raw)return"";if(raw.includes("yeast")||raw.includes("pichia")||raw.includes("cerevisiae"))return"yeast";if(raw.includes("insect")||raw.includes("sf9")||raw.includes("baculo"))return"insect";if(raw.includes("mamm")||raw.includes("hek")||raw.includes("cho"))return"mammalian";return"bacteria"}

const chemistryLabel:Record<CaptureChemistry,string>={imac:"Ni²⁺/Co²⁺ IMAC",gst:"glutathione (GST)",strep:"Strep-Tactin",mbp:"amylose (MBP)",calcium:"calcium-dependent",other:"the chosen affinity",none:"affinity"};
const row=(name:string,concentration:number|string,unit:string,purpose:BufferPurposeId):BufferComponent=>({name,concentration,unit,role:purposeById(purpose).label});
const purposeOf=(component:BufferComponent)=>resolvePurpose(findLibraryComponent(component.name),component.role);
const formulaOf=(components:BufferComponent[])=>components.map(item=>`${item.concentration} ${item.unit} ${item.name}`).join(", ");

export function suggestLysisBuffer(context:LysisContext):LysisSuggestion{
  const capture=context.capture??null;
  const chemistry=captureChemistry(capture?.columnId,capture?.tag);
  const column=capture?.shortName||chemistryLabel[chemistry];
  const components:BufferComponent[]=[];const reasons:LysisReason[]=[];
  const add=(component:BufferComponent,text:string)=>{components.push(component);reasons.push({component:component.name,text})};

  // Base: the binding buffer's buffering agent and salt, so the cleared lysate loads without exchange.
  const binding=capture?.binding??null;
  const base=(binding?.components??[]).filter(item=>{const purpose=purposeOf(item);return purpose==="buffering"||purpose==="ionic-strength"});
  let pH=binding?.pH?.trim()||"";
  if(base.some(item=>purposeOf(item)==="buffering")){
    components.push(...base.map(item=>({...item})));
    reasons.push({component:"Base",text:`${formulaOf(base)}${pH?`, pH ${pH}`:""} copies the Affinity capture binding buffer, so the cleared lysate loads onto ${column} without a buffer exchange.`});
  }else{
    const imac=chemistry==="imac";pH=pH||(imac?"8.0":"7.5");
    const fallback=[row("Tris-HCl",50,"mM","buffering"),row("NaCl",imac?300:150,"mM","ionic-strength")];
    components.push(...fallback);
    reasons.push({component:"Base",text:chemistry==="none"?`No Affinity capture is saved yet, so this starts from a general native lysis base (${formulaOf(fallback)}, pH ${pH}). Save Affinity capture to tailor it.`:`No binding buffer is saved with ${column}, so this uses a standard ${imac?"IMAC":"native"} base (${formulaOf(fallback)}, pH ${pH}).`});
  }

  // Capture-specific additions and exclusions.
  if(chemistry==="imac"){
    const saved=Number((binding?.components??[]).find(item=>purposeOf(item)==="competitor")?.concentration);
    const imidazole=Number.isFinite(saved)&&saved>=10&&saved<=20?saved:Number.isFinite(saved)&&saved>20?20:10;
    add(row("Imidazole",imidazole,"mM","competitor"),`${imidazole} mM imidazole stops host proteins with a few surface histidines from binding ${column}; 10–20 mM keeps the His tag bound.`);
    add(row("TCEP",0.5,"mM","reducing"),"TCEP, not DTT: DTT reduces the Ni²⁺ on IMAC resin and turns it brown.");
    reasons.push({component:"EDTA",text:"No EDTA: it strips Ni²⁺ and Co²⁺ from the IMAC resin."});
  }else if(chemistry==="gst"){
    add(row("DTT",1,"mM","reducing"),"DTT is fine here: glutathione resin has no metal to reduce, and a reductant keeps GST in its binding-competent state.");
    reasons.push({component:"Imidazole",text:"No imidazole: glutathione resin does not need a competitor to keep background low."});
  }else if(chemistry==="strep"){
    add(row("TCEP",0.5,"mM","reducing"),"TCEP keeps cysteines reduced and does not affect Strep-Tactin binding.");
    reasons.push({component:"Biotin",text:"No biotin: free biotin blocks Strep-Tactin. If the culture medium or host supplies biotin, add avidin (optional) to mask it before loading."});
  }else if(chemistry==="mbp"){
    add(row("TCEP",0.5,"mM","reducing"),"TCEP keeps cysteines reduced and does not affect amylose binding.");
    reasons.push({component:"Maltose",text:"No maltose: it is the eluent and would stop the MBP fusion binding the amylose or dextrin resin."});
  }else if(chemistry==="calcium"){
    add(row("CaCl₂",2,"mM","metal-cofactor"),`${column} binds only in calcium, so the lysate carries 2 mM CaCl₂.`);
    reasons.push({component:"EDTA",text:"No EDTA or EGTA: chelating calcium is how this resin elutes."});
  }else{
    add(row("TCEP",0.5,"mM","reducing"),"TCEP keeps cysteines reduced during lysis and is compatible with most affinity resins.");
  }

  // Membrane proteins: extract with the detergent the SEC buffer keeps.
  if(context.membrane){
    const sec=(context.secComponents??[]).map(item=>findLibraryComponent(item.name)).find(entry=>entry?.purposes.some(value=>value.purpose==="detergent"));
    if(sec&&sec.id!=="ddm")add(row(sec.name,sec.typical.high,sec.typical.unit,"detergent"),`Membrane protein: extract with ${sec.name}, the detergent the SEC buffer keeps it in.`);
    else add(row("DDM",1,"% (w/v)","detergent"),sec?"Membrane protein: 1 % DDM extracts it from the membrane; the SEC buffer keeps DDM above its CMC.":"Membrane protein: 1 % DDM extracts it from the membrane. Keep DDM above its CMC in every later buffer.");
  }

  // Lysate handling: nuclease with its Mg²⁺, protease inhibitors, lysis enzyme.
  add(row("Benzonase nuclease",25,"U/mL","nuclease"),"Benzonase digests released DNA and RNA, so the lysate is less viscous and clears and loads faster.");
  add(row("MgCl₂",2,"mM","metal-cofactor"),"Benzonase needs 1–2 mM Mg²⁺ to work.");
  const cleanupImac=captureChemistry(context.cleanup?.columnId,context.cleanup?.tag)==="imac";
  const edtaFree=chemistry==="imac"||chemistry==="calcium"||cleanupImac;
  add(row(edtaFree?"EDTA-free protease inhibitor":"Protease inhibitor cocktail",1,"×","protease-inhibitor"),chemistry==="imac"?"EDTA-free protease inhibitor: blocks host proteases without stripping the IMAC resin.":chemistry==="calcium"?"EDTA-free protease inhibitor: EDTA would remove the calcium the resin needs.":cleanupImac?`EDTA-free protease inhibitor: Subtractive cleanup uses ${context.cleanup?.shortName||"IMAC"}, so keep chelators out upstream.`:"Protease inhibitor cocktail blocks host proteases released during lysis.");
  if(context.host==="bacteria")add(row("Lysozyme",1,"mg/mL","lysis-enzyme"),"E. coli: lysozyme weakens the cell wall, so cells break with gentler sonication or homogenization.");
  else if(context.host==="yeast")reasons.push({component:"Lysozyme",text:"Yeast: lysozyme does not digest yeast walls; break cells by bead beating or homogenization (or zymolyase)."});
  else if(context.host)reasons.push({component:"Lysozyme",text:`${context.host==="insect"?"Insect":"Mammalian"} cells have no cell wall, so no lysis enzyme is needed.`});
  else reasons.push({component:"Lysozyme",text:"No expression host is saved yet; lysozyme is added for E. coli once that is chosen."});

  return{chemistry,step:{pH,purpose:`Lysis — suggested for ${column}`,components},reasons};
}
