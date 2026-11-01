"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BookOpen, FlaskConical, Plus, Search, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BufferComponent, BufferStep } from "@/lib/purification-catalog";
import { tcepInPhosphate, tcepPhosphateCaveat } from "@/lib/reductant-need";
import { applyLibraryComponent, bufferUnits, findLibraryComponent, formatTypicalRange, purposeById, purposeExplanation, purposeOptions, rangeStatus, resolvePurpose, searchLibrary, type BufferLibraryEntry, type BufferPurposeId } from "@/lib/buffer-component-library";

const customPurpose = "__custom";

/**
 * One buffer step's recipe: pH, purpose and component rows, each picked from
 * the literature component library or typed in as a custom entry. Shared by the
 * purification jobs that set buffers; key it by step so row selection resets.
 */
export function BufferComposer({ label, step, onChange, children }: { label:string; step:BufferStep; onChange:(step:BufferStep)=>void; children?:React.ReactNode }) {
  const [selected,setSelected]=useState(0);
  const [newRow,setNewRow]=useState(-1);
  // Rows where the scientist chose "Custom…" and has not typed a purpose yet.
  const [customRows,setCustomRows]=useState<number[]>([]);
  const components=step.components;
  const active=Math.min(selected,components.length-1);
  function update(patch:Partial<BufferStep>){onChange({...step,...patch})}
  function updateComponent(index:number,patch:Partial<BufferComponent>){update({components:components.map((item,itemIndex)=>itemIndex===index?{...item,...patch}:item)})}
  function addComponent(){update({components:[...components,{name:"",concentration:"",unit:"mM",role:""}]});setSelected(components.length);setNewRow(components.length)}
  function removeComponent(index:number){update({components:components.filter((_,itemIndex)=>itemIndex!==index)});setCustomRows([]);setNewRow(-1);setSelected(current=>current>=index?Math.max(0,current-1):current)}
  function choosePurpose(index:number,value:string){if(value===customPurpose){setCustomRows(rows=>[...rows,index]);updateComponent(index,{role:""});return}setCustomRows(rows=>rows.filter(row=>row!==index));updateComponent(index,{role:purposeById(value as BufferPurposeId).label})}
  return <section className="buffer-editor buffer-composer">
    <header><span><strong>{label}</strong><small>{step.purpose}</small></span><label>pH<input inputMode="decimal" value={step.pH} onChange={e=>update({pH:e.target.value})}/></label></header>
    <label className="purpose-field">Purpose<input value={step.purpose} onChange={e=>update({purpose:e.target.value})}/></label>
    <div className="buffer-composer-table" role="table" aria-label={`${label} buffer components`}>
      <div className="buffer-composer-row buffer-composer-head" role="row"><b role="columnheader">Component</b><b role="columnheader">Concentration</b><b role="columnheader">Unit</b><b role="columnheader">Purpose</b><b role="columnheader"><span className="sr-only">Remove</span></b></div>
      {components.map((component,index)=>{const entry=findLibraryComponent(component.name);const purpose=resolvePurpose(entry,component.role);const custom=!purpose&&(component.role!==""||customRows.includes(index));const range=rangeStatus(entry,component);const units=bufferUnits.includes(component.unit)?bufferUnits:[component.unit,...bufferUnits];return <div key={index} role="row" className={`buffer-composer-row${index===active?" selected":""}`} onFocus={()=>setSelected(index)} onClick={()=>setSelected(index)}>
        <ComponentPicker value={component.name} entry={entry} autoFocus={index===newRow} onText={name=>updateComponent(index,{name})} onPick={item=>{setCustomRows(rows=>rows.filter(row=>row!==index));updateComponent(index,applyLibraryComponent(component,item))}}/>
        <input aria-label="Concentration" className={range?"out-of-range":""} title={range&&entry?`${range==="above"?"Above":"Below"} the typical ${formatTypicalRange(entry)}`:undefined} inputMode="decimal" placeholder={entry?String(entry.defaultConcentration):"—"} value={String(component.concentration)} onChange={e=>updateComponent(index,{concentration:e.target.value})}/>
        <select aria-label="Unit" value={component.unit} onChange={e=>updateComponent(index,{unit:e.target.value})}>{units.map(unit=><option key={unit} value={unit}>{unit}</option>)}</select>
        <div className="buffer-composer-purpose"><select aria-label="Purpose" value={purpose??(custom?customPurpose:"")} onChange={e=>choosePurpose(index,e.target.value)}>{!purpose&&!custom&&<option value="" disabled>Choose a purpose…</option>}{purposeOptions(entry).map(option=><option key={option.id} value={option.id}>{option.label}</option>)}<option value={customPurpose}>Custom…</option></select>{custom&&<input aria-label="Custom purpose" autoFocus={customRows.includes(index)} placeholder="Describe the purpose" value={component.role} onChange={e=>updateComponent(index,{role:e.target.value})}/>}</div>
        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${component.name||"component"}`} onClick={e=>{e.stopPropagation();removeComponent(index)}}><Trash2/></Button>
        {entry?.alert&&<p className="buffer-composer-alert"><TriangleAlert aria-hidden="true"/><span><b>{entry.name}:</b> {entry.alert}</span></p>}
      </div>})}
      {tcepInPhosphate(components)&&<p className="buffer-composer-alert"><TriangleAlert aria-hidden="true"/><span><b>TCEP with phosphate:</b> {tcepPhosphateCaveat}</span></p>}
      {!components.length&&<div className="buffer-composer-empty"><FlaskConical aria-hidden="true"/><span><strong>No components yet</strong><small>Start with the buffering agent and salt, then add what this step needs: a competitor, reducing agent or stabilizer.</small></span></div>}
    </div>
    <Button variant="outline" onClick={addComponent}><Plus/> Add component</Button>
    {components[active]&&<ComponentDetail component={components[active]}/>}
    {children}
  </section>;
}

/** Searchable library picker; any typed name that is not in the library is kept as a custom component. */
function ComponentPicker({ value, entry, autoFocus, onText, onPick }: { value:string; entry:BufferLibraryEntry|undefined; autoFocus:boolean; onText:(name:string)=>void; onPick:(item:BufferLibraryEntry)=>void }) {
  const [open,setOpen]=useState(false); const [query,setQuery]=useState(""); const [highlight,setHighlight]=useState(0);
  const listId=useId(); const list=useRef<HTMLDivElement>(null);
  const matches=searchLibrary(query);
  useEffect(()=>{list.current?.querySelector(`[data-index="${highlight}"]`)?.scrollIntoView({block:"nearest"})},[highlight,open]);
  function pick(item:BufferLibraryEntry){onPick(item);setOpen(false);setQuery("")}
  function onKeyDown(event:React.KeyboardEvent<HTMLInputElement>){if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();if(!open){setOpen(true);return}const step=event.key==="ArrowDown"?1:-1;setHighlight(current=>matches.length?(current+step+matches.length)%matches.length:0)}else if(event.key==="Enter"&&open){event.preventDefault();if(matches[highlight])pick(matches[highlight]);else setOpen(false)}else if(event.key==="Escape"&&open){event.preventDefault();setOpen(false)}}
  return <div className="buffer-picker">
    <Search aria-hidden="true"/>
    <input role="combobox" aria-label="Component" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open&&matches[highlight]?`${listId}-${highlight}`:undefined} autoFocus={autoFocus} placeholder="Search or type a name" value={value} onFocus={()=>{setQuery("");setHighlight(0);setOpen(true)}} onBlur={()=>setOpen(false)} onChange={e=>{onText(e.target.value);setQuery(e.target.value);setHighlight(0);setOpen(true)}} onKeyDown={onKeyDown}/>
    {value.trim()&&!entry&&!open&&<span className="buffer-picker-custom">Custom</span>}
    {open&&<div className="buffer-picker-list" role="listbox" id={listId} ref={list} aria-label="Buffer component library">
      {matches.map((item,index)=><div key={item.id} id={`${listId}-${index}`} data-index={index} role="option" aria-selected={index===highlight} className={index===highlight?"highlighted":""} onMouseDown={e=>e.preventDefault()} onMouseEnter={()=>setHighlight(index)} onClick={()=>pick(item)}><span><strong>{item.name}</strong><small>{item.purposes.map(option=>purposeById(option.purpose).label).join(" · ")}</small></span><em>{formatTypicalRange(item)}</em></div>)}
      {!matches.length&&<p>No library match. “{query.trim()}” will be kept as a custom component; choose or describe its purpose.</p>}
    </div>}
  </div>;
}

/** Why the selected row is in the buffer, with the library's cautions and references. */
function ComponentDetail({ component }: { component:BufferComponent }) {
  const entry=findLibraryComponent(component.name); const purpose=resolvePurpose(entry,component.role);
  if(!component.name.trim())return <aside className="buffer-composer-detail empty"><Search aria-hidden="true"/><span><strong>Pick a component</strong><small>Search the library by name, alias or purpose (try “reducing” or “detergent”), or type any name to add a custom component.</small></span></aside>;
  if(!entry)return <aside className="buffer-composer-detail">
    <header><span><strong>{component.name}</strong><small>Custom component</small></span></header>
    <div className="buffer-composer-detail-body"><section><h4>{purpose?`Why it is used · ${purposeById(purpose).label}`:"Your purpose"}</h4><p>{purpose?purposeById(purpose).summary:component.role.trim()||"Describe why this component is in the buffer."}</p></section><section><h4>Not in the library</h4><p>Protein Lab has no cautions or references for this component. Check its compatibility with the resin, the other components and your protein yourself.</p></section></div>
  </aside>;
  const range=rangeStatus(entry,component); const others=entry.purposes.filter(item=>item.purpose!==purpose);
  return <aside className="buffer-composer-detail">
    <header><span><strong>{entry.name}</strong>{entry.aliases.length>0&&<small>Also called {entry.aliases.slice(0,3).join(", ")}</small>}</span><em>Typical {formatTypicalRange(entry)}</em></header>
    {range&&<p className="buffer-composer-range-note"><TriangleAlert aria-hidden="true"/>{component.concentration} {component.unit} is {range} the typical range. Check that this is intended.</p>}
    <div className="buffer-composer-detail-body">
      <section>
        <h4>{purpose?`Why it is used · ${purposeById(purpose).label}`:"Your purpose"}</h4>
        <p>{purpose?purposeExplanation(entry,purpose):component.role.trim()||"Describe why this component is in the buffer, or choose one of its library purposes."}</p>
        {others.map(item=><p key={item.purpose} className="buffer-composer-other"><b>{purpose?"Also used as":"Library purpose"} · {purposeById(item.purpose).label}.</b> {item.why}</p>)}
      </section>
      <section className="buffer-composer-cautions">
        <h4><TriangleAlert aria-hidden="true"/>Cautions</h4>
        {entry.cautions.length?<ul>{entry.cautions.map(item=><li key={item}>{item}</li>)}</ul>:<p>No common cautions recorded. Still check product instructions.</p>}
      </section>
    </div>
    <footer><h4><BookOpen aria-hidden="true"/>References</h4><ol>{entry.references.map(item=><li key={item}>{item}</li>)}</ol></footer>
  </aside>;
}
