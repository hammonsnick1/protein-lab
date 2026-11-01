// The buffer a Subtractive cleanup or SEC polishing job runs in. A preset card
// is only the starting point: it loads into the Buffer composer, the scientist
// edits it, and the compatibility checks read the edited recipe.
//
// Pure module: no runtime `@/` imports, so `node --test` can load it.
import { findLibraryComponent, resolvePurpose } from "./buffer-component-library.ts";
import { normalizeBufferSteps, type BufferComponent, type BufferStep } from "./purification-catalog.ts";
import type { StageBuffer } from "./purification-stage-catalog.ts";

export type Compatibility = { level:"pass"|"warning"|"error"; title:string; detail:string };

export function presetBufferStep(buffer:StageBuffer, label:string):BufferStep { return { pH:String(buffer.pH), purpose:`${label} — ${buffer.name}`, components:buffer.components.map(item=>({...item})) }; }

/**
 * The saved buffer for a job: the edited step if there is one, else the
 * components older saves stored next to `bufferId`, else the preset itself.
 */
export function loadStageBufferStep(saved:Record<string,unknown>, buffers:StageBuffer[], fallbackId:string, label:string):BufferStep {
  const preset=buffers.find(item=>item.id===saved.bufferId)??buffers.find(item=>item.id===fallbackId)??buffers[0];
  const fromStep=saved.bufferStep&&typeof saved.bufferStep==="object"?saved.bufferStep:null;
  const legacy=Array.isArray(saved.bufferComponents)?{pH:saved.bufferPH??preset.pH,purpose:`${label} — ${String(saved.bufferName??preset.name)}`,components:saved.bufferComponents}:null;
  const raw=fromStep??legacy; if(!raw)return presetBufferStep(preset,label);
  return normalizeBufferSteps({storage:raw})!.storage;
}

/** What a component is, read from the library when it is a library entry, else from its typed name and purpose. */
function kinds(component:BufferComponent){
  const entry=findLibraryComponent(component.name); const purpose=resolvePurpose(entry,component.role); const name=component.name.toLowerCase(); const role=component.role.toLowerCase();
  const id=entry?.id??"";
  return {
    chelator:["edta"].includes(id)||(!entry&&(/\b(edta|egta|citrate)\b(?!-free)/.test(name)||purpose==="chelator"||/chelat/.test(role))),
    strepCompetitor:["biotin","desthiobiotin"].includes(id)||(!entry&&/biotin/.test(name)),
    detergent:purpose==="detergent"||entry?.purposes.some(item=>item.purpose==="detergent")||(!entry&&/\b(ddm|lmng|gdn|digitonin|chaps|triton|tween|maltoside|detergent)/.test(`${name} ${role}`)),
    glycerol:id==="glycerol"||(!entry&&/glycerol/.test(name)),
  };
}
const amount=(component:BufferComponent)=>`${component.concentration} ${component.unit} ${component.name}`.trim();
function find(step:BufferStep,kind:keyof ReturnType<typeof kinds>){return step.components.filter(item=>item.name.trim()&&kinds(item)[kind])}
/** The edited pH, or null when it is blank or not a number. */
export function stepPH(step:BufferStep){const value=Number(String(step.pH).trim());return String(step.pH).trim()&&Number.isFinite(value)?value:null}
export function stepFormula(step:BufferStep){return step.components.filter(item=>item.name.trim()).map(amount).join(", ")||"No components"}

/**
 * DTT above 1 mM or β-mercaptoethanol above 20 mM: the levels Ni-NTA is
 * usually quoted to tolerate, beyond which they reduce the immobilized Ni²⁺.
 * TCEP does not, so it is never listed.
 */
export function strongThiolReductants(components:BufferComponent[]):string[] {
  return components.filter(item=>{
    const entry=findLibraryComponent(item.name); const name=item.name.toLowerCase();
    const id=entry?.id??(/\bdtt\b|dithiothreitol/.test(name)?"dtt":/mercaptoethanol|\bb-?me\b|β-me/.test(name)?"bme":"");
    const value=Number(item.concentration); const unit=item.unit.trim().toLowerCase();
    const mM=unit==="m"?value*1000:unit==="µm"||unit==="um"?value/1000:unit==="mm"?value:Number.NaN;
    return Number.isFinite(mM)&&((id==="dtt"&&mM>1)||(id==="bme"&&mM>20));
  }).map(amount);
}

/** Checks on the edited reverse-affinity buffer: no chelator before IMAC, no biotin before Strep recapture. */
export function cleanupBufferChecks(tag:string, step:BufferStep):Compatibility[] {
  const checks:Compatibility[]=[];
  if(/his|polyhistidine|hat/i.test(tag)){const chelators=find(step,"chelator");checks.push(chelators.length?err("Cleanup buffer contains an IMAC-incompatible chelator",`${chelators.map(amount).join(", ")} can strip nickel or cobalt. Remove it before IMAC cleanup.`):ok("Cleanup buffer is chelator-free","No EDTA, EGTA or citrate in the edited buffer."))}
  if(/his|polyhistidine|hat/i.test(tag)){const strong=strongThiolReductants(step.components);if(strong.length)checks.push(warn("Thiol reductant can reduce the IMAC metal",`${strong.join(", ")} can reduce the Ni²⁺ on the resin at this concentration. Use 1–5 mM TCEP for the reverse-IMAC pass.`))}
  if(/strep/i.test(tag)){const competitors=find(step,"strepCompetitor");if(competitors.length)checks.push(err("Competing ligand blocks Strep recapture",`${competitors.map(amount).join(", ")} occupies Strep-Tactin. Remove it before the subtractive binding step.`))}
  return checks;
}

/** Checks on the edited SEC buffer: pH against the resin range and the pI, detergent for membrane proteins, glycerol and pressure. */
export function secBufferChecks(column:{phMin:number;phMax:number}, step:BufferStep, context:{pI:number|null;membrane:boolean}):Compatibility[] {
  const checks:Compatibility[]=[]; const pH=stepPH(step);
  if(pH===null)checks.push(err("Buffer pH is not set","Enter the SEC buffer pH so it can be checked against the resin operating range."));
  else if(pH<column.phMin||pH>column.phMax)checks.push(err("Buffer pH is outside the operating range",`pH ${pH} is outside the listed pH ${column.phMin}–${column.phMax} operating range.`));
  else checks.push(ok("Buffer pH fits the resin range",`pH ${pH} is within the listed pH ${column.phMin}–${column.phMax} operating range.`));
  if(pH!==null&&context.pI!==null&&Math.abs(pH-context.pI)<.5)checks.push(warn("SEC buffer pH is close to predicted pI",`pH ${pH} is within 0.5 unit of pI ${context.pI.toFixed(2)}; aggregation can broaden or distort the peak.`));
  const detergents=find(step,"detergent");
  if(context.membrane&&!detergents.length)checks.push(err("Membrane-protein SEC buffer lacks detergent","Add the validated detergent or membrane mimic so the protein stays solubilized through SEC."));
  else if(context.membrane)checks.push(ok("Membrane solubilization is maintained",`${detergents.map(amount).join(", ")} keeps the protein solubilized.`));
  const glycerol=find(step,"glycerol");
  if(glycerol.length)checks.push(warn("Viscous SEC buffer requires lower flow",`${glycerol.map(amount).join(", ")} raises backpressure, especially in a cold room. Use the product's pressure limit and reduce flow.`));
  return checks;
}

function ok(title:string,detail:string):Compatibility{return{level:"pass",title,detail}}function warn(title:string,detail:string):Compatibility{return{level:"warning",title,detail}}function err(title:string,detail:string):Compatibility{return{level:"error",title,detail}}
