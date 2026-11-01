"use client";

import { useMemo, useState } from "react";
import { Check, CircleMinus, CirclePlus, ShieldAlert, Sparkles, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BufferComposer } from "@/components/protein-labs/buffer-composer";
import type { JsonObject, ProteinBundle } from "@/lib/protein-labs-api";
import type { BufferComponent, BufferStep } from "@/lib/purification-catalog";
import { savedBufferSteps } from "@/lib/purification-buffers";
import { lysisBuffers } from "@/lib/purification-stage-catalog";
import { lysisHost, lysisHostLabels, suggestLysisBuffer, type LysisContext } from "@/lib/lysis-buffer-suggestion";
import { constructCysteines } from "@/lib/reductant-need";

/** What the lysis suggestion reads from the other saved purification jobs. */
export function lysisSuggestionContext(bundle:ProteinBundle,membrane:boolean,method?:string):LysisContext&{hostName:string;secName:string}{
  const config=(type:string)=>bundle.projectJobs.find(job=>job.appType===type)?.config??{};
  const affinity=config("purification-affinity"),cleanup=config("purification-subtractive"),sec=config("purification-sec"),expression=config("expression-system");
  const shared=savedBufferSteps(bundle.projectJobs);
  const binding=shared.binding??null;
  const secComponents=shared.storage?.components??[];
  const host=lysisHost(expression.hostSystemId??expression.hostSystem);
  // The lysate holds the tagged fusion, so count its cysteines.
  const construct=(config("purification-cleavage").construct??affinity.construct) as JsonObject|undefined;
  return{
    capture:affinity.columnId?{columnId:String(affinity.columnId),shortName:String(affinity.shortName??""),tag:String(affinity.tag??""),binding:binding?.components.length?binding:null}:null,
    cleanup:cleanup.columnId?{columnId:String(cleanup.columnId),shortName:String(cleanup.shortName??""),tag:String(cleanup.tag??"")}:null,
    secComponents,host,membrane,method,cysteines:constructCysteines(construct,bundle.protein.sequence),
    hostName:host?`${capitalize(lysisHostLabels[host])}${expression.strainName?` · ${expression.strainName}`:""}`:"",
    secName:String(sec.bufferName??""),
  };
}

/**
 * The Cell lysis buffer: a suggestion built from the capture column and the
 * other saved choices, with one reason per part, applied in one click into the
 * shared Buffer composer, where the scientist keeps editing it. The lysis
 * presets stay available as other starting points.
 */
export function LysisBufferPanel({ bundle, membrane, methodId, step, source, onApply, onEdit, onInspectPreset }: { bundle:ProteinBundle; membrane:boolean; methodId:string; step:BufferStep; source:string; onApply:(step:BufferStep)=>void; onEdit:(step:BufferStep)=>void; onInspectPreset:(id:string)=>void }) {
  const context=useMemo(()=>lysisSuggestionContext(bundle,membrane,methodId),[bundle,membrane,methodId]);
  const suggestion=useMemo(()=>suggestLysisBuffer(context),[context]);
  // Re-key the composer when a whole buffer is loaded, so its row selection resets.
  const [version,setVersion]=useState(0);
  const applied=sameStep(step,suggestion.step);
  const inBuffer=new Set(suggestion.step.components.map(item=>item.name));
  function apply(){onApply(structuredClone(suggestion.step));setVersion(value=>value+1)}
  const facts:[string,string,boolean][]=[["Capture",context.capture?.shortName||"Not saved",Boolean(context.capture)],["Host",context.hostName||"Not saved",Boolean(context.host)],["Membrane protein",membrane?"Yes":"No",true],["Cysteines",context.cysteines===null||context.cysteines===undefined?"No sequence":String(context.cysteines),context.cysteines!==null&&context.cysteines!==undefined],["Cleanup",context.cleanup?.shortName||"Not saved",Boolean(context.cleanup)],["SEC buffer",context.secName||"Not saved",Boolean(context.secName)]];
  return <section className="stage-choice-section lysis-buffer-section">
    <header><h3>Lysis buffer</h3><p>Apply the suggestion to start from a buffer that suits your capture column, or start from a preset. Every component stays editable below.</p></header>
    <div className="lysis-buffer-layout">
      <aside className={`lysis-suggestion${applied?" applied":""}`} aria-label="Suggested lysis buffer">
        <header><span className="lysis-suggestion-icon"><Sparkles aria-hidden="true"/></span><span><small>SUGGESTED FROM YOUR CHOICES</small><strong>{suggestion.step.purpose.replace(/^Lysis — suggested for /,"For ")}</strong><em>pH {suggestion.step.pH} · {suggestion.step.components.length} components</em></span></header>
        <dl className="lysis-context">{facts.map(([label,value,known])=><div key={label} className={known?"":"unknown"}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <ol className="lysis-reasons">{suggestion.reasons.map(reason=>{const added=reason.component==="Base"||inBuffer.has(reason.component);return <li key={reason.component} className={added?"added":"left-out"}>{added?<CirclePlus aria-label="Added"/>:<CircleMinus aria-label="Left out"/>}<span><b>{reason.component==="Base"?"Base buffer":reason.component}</b>{reason.text}</span></li>})}</ol>
        <footer>{applied?<p className="lysis-applied"><Check aria-hidden="true"/>Applied to the buffer below</p>:<Button onClick={apply}><WandSparkles/>{source==="suggested"?"Re-apply suggestion":"Apply suggestion"}</Button>}{!applied&&source==="suggested"&&<small>Your edits differ from the suggestion; re-applying replaces them.</small>}</footer>
      </aside>
      <div className="lysis-buffer-editor">
        <div className="lysis-presets" role="group" aria-label="Lysis buffer presets"><span>Or start from a preset</span>{lysisBuffers.map(preset=><button key={preset.id} className={preset.id===source?"selected":""} style={{"--stage-color":preset.color} as React.CSSProperties} onClick={()=>onInspectPreset(preset.id)}>{preset.name}</button>)}</div>
        <BufferComposer key={`${source}-${version}`} label="Lysis" step={step} onChange={onEdit}>
          <div className="guidance-card"><ShieldAlert/><span><strong>Starting conditions, not a bench authorization</strong><small>Add PMSF or inhibitor cocktail just before lysis, keep the lysate cold, and confirm concentrations against product instructions.</small></span></div>
        </BufferComposer>
      </div>
    </div>
  </section>;
}

function sameStep(a:BufferStep,b:BufferStep){const rows=(step:BufferStep)=>step.components.map((item:BufferComponent)=>`${item.name}|${item.concentration}|${item.unit}|${item.role}`).join(";");return a.pH===b.pH&&rows(a)===rows(b)}
function capitalize(value:string){return value.charAt(0).toUpperCase()+value.slice(1)}
