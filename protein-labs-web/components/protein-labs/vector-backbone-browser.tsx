"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, Database, Download, FileInput, LoaderCircle, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JsonObject } from "@/lib/protein-labs-api";
import { fileToBase64, proteinLabsApi } from "@/lib/protein-labs-api";

type SourceDescriptor = {
  id: string;
  name: string;
  summary: string;
  detail: string;
  needsSet: boolean;
  annotated: boolean;
  attribution: string;
};

type SearchResult = {
  id: string;
  name: string;
  description: string;
  lengthBp: number | null;
  set: string;
};

type LibraryVector = {
  id: string;
  name: string;
  lengthBp: number;
  featureCount: number;
  insertName: string;
  projectCount: number;
  projects: { proteinId: string; proteinName: string }[];
  updatedAt: string;
};

// Vectors saved anywhere in this workspace. Unlike the external sources this
// one is local, already annotated, and knows which projects use each vector.
const librarySource: SourceDescriptor = {
  id: "library",
  name: "Vector database",
  summary: "Vectors already saved in this workspace, with their projects.",
  detail: "Every vector saved in an Expression vector design job is catalogued here, including the construct inserted into it.",
  needsSet: false,
  annotated: true,
  attribution: "",
};

/**
 * Pick a vector backbone and load it into the project.
 *
 * Every backbone comes from a named source so the construct has provenance:
 * SnapGene's curated plasmid files, NCBI GenBank records, the Addgene vector
 * database, or the researcher's own GenBank/FASTA/SnapGene files.
 */
export function VectorBackboneBrowser({
  proteinId,
  onLoaded,
  onClose,
}: {
  proteinId: string;
  onLoaded: (vector: JsonObject, note: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [sources, setSources] = useState<SourceDescriptor[]>([librarySource]);
  const [library, setLibrary] = useState<LibraryVector[]>([]);
  const [sourceId, setSourceId] = useState("library");
  const [sets, setSets] = useState<{ id: string; name: string }[]>([]);
  const [setId, setSetId] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingId, setLoadingId] = useState("");
  const [failure, setFailure] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const source = useMemo(() => sources.find((value) => value.id === sourceId) ?? null, [sources, sourceId]);
  const matchingLibrary = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return library;
    return library.filter((entry) => [entry.name, entry.insertName, ...entry.projects.map((use) => use.proteinName)].join(" ").toLowerCase().includes(needle));
  }, [library, query]);
  // Sets only apply to SnapGene, so the list is derived rather than cleared.
  const activeSets = sourceId === "snapgene" ? sets : [];
  const activeSetId = sourceId === "snapgene" ? setId : "";

  useEffect(() => {
    proteinLabsApi.vectorSources()
      .then((value) => setSources([librarySource, ...(value.sources as SourceDescriptor[])]))
      .catch((reason: unknown) => setFailure(message(reason)));
  }, []);

  // The catalogue is local, so it loads once and filters in the browser.
  useEffect(() => {
    if (sourceId !== "library") return;
    let active = true;
    proteinLabsApi.vectorLibrary()
      .then((value) => { if (active) setLibrary(value.vectors as unknown as LibraryVector[]); })
      .catch((reason: unknown) => { if (active) setFailure(message(reason)); });
    return () => { active = false; };
  }, [sourceId]);

  // SnapGene groups its plasmids into sets, so load those before searching.
  useEffect(() => {
    if (sourceId !== "snapgene") return;
    let active = true;
    proteinLabsApi.vectorSourceSets("snapgene")
      .then((value) => {
        if (!active) return;
        const list = value.sets as { id: string; name: string }[];
        setSets(list);
        setSetId((current) => current || list.find((entry) => entry.id.includes("pet"))?.id || list[0]?.id || "");
      })
      .catch((reason: unknown) => { if (active) setFailure(message(reason)); });
    return () => { active = false; };
  }, [sourceId]);

  // Search as the researcher types. Addgene and SnapGene match a cached index
  // locally, so only NCBI needs the query to be deliberate.
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      const unsearchable = sourceId === "file" || sourceId === "library"
        || (sourceId === "snapgene" && !setId)
        || (sourceId === "ncbi" && query.trim().length < 3);
      if (unsearchable) { setResults([]); return; }
      setSearching(true); setFailure("");
      proteinLabsApi.searchVectorSources(sourceId, query, setId, 40)
        .then((value) => { if (active) setResults(value.results as SearchResult[]); })
        .catch((reason: unknown) => { if (active) { setFailure(message(reason)); setResults([]); } })
        .finally(() => { if (active) setSearching(false); });
    }, sourceId === "ncbi" ? 500 : 180);
    return () => { active = false; clearTimeout(timer); };
  }, [sourceId, query, setId]);

  async function loadFromLibrary(entry: LibraryVector) {
    setLoadingId(entry.id); setFailure("");
    try {
      const vector = await proteinLabsApi.copyLibraryVector(proteinId, entry.id);
      await onLoaded(vector, `${entry.name} loaded from the vector database with ${entry.featureCount} annotations.`);
    } catch (reason) { setFailure(message(reason)); }
    finally { setLoadingId(""); }
  }

  async function load(result: SearchResult) {
    setLoadingId(result.id); setFailure("");
    try {
      const vector = await proteinLabsApi.loadVectorFromSource(proteinId, sourceId, result.id, result.set || setId);
      const added = Number((vector.annotationReport as JsonObject | undefined)?.added ?? 0);
      const features = Array.isArray(vector.features) ? vector.features.length : 0;
      await onLoaded(
        vector,
        added
          ? `${result.name} loaded and annotated locally with ${added} features.`
          : `${result.name} loaded with ${features} curated annotations.`,
      );
    } catch (reason) { setFailure(message(reason)); }
    finally { setLoadingId(""); }
  }

  async function importFile(file: File | null) {
    if (!file) return;
    setLoadingId("file"); setFailure("");
    try {
      // SnapGene files are binary, so they travel as base64.
      const snapgene = /\.(dna|prot)$/i.test(file.name);
      const content = snapgene ? await fileToBase64(file) : await file.text();
      const vector = await proteinLabsApi.importVector(proteinId, file.name, content);
      const features = Array.isArray(vector.features) ? vector.features.length : 0;
      await onLoaded(vector, `${file.name} imported with ${features} annotations.`);
    } catch (reason) { setFailure(message(reason)); }
    finally { setLoadingId(""); if (fileRef.current) fileRef.current.value = ""; }
  }

  return <div className="backbone-browser">
    <header>
      <span>
        <strong>Load a vector backbone</strong>
        <small>Choose where the backbone comes from, then load it with its annotations.</small>
      </span>
      <Button variant="ghost" size="icon" onClick={onClose}><X /></Button>
    </header>

    <div className="backbone-sources">
      {sources.map((option) => <button
        key={option.id}
        className={option.id === sourceId ? "selected" : ""}
        onClick={() => { setSourceId(option.id); setResults([]); setFailure(""); }}
      >
        {option.id === "file" ? <FileInput /> : <Database />}
        <span>
          <strong>{option.name}</strong>
          <small>{option.summary}</small>
        </span>
      </button>)}
    </div>

    {source && <p className="backbone-detail">
      {source.detail}
      {!source.annotated && " Protein Lab annotates it after download."}
    </p>}

    {sourceId === "library"
      ? <>
          <div className="backbone-search">
            <label className="backbone-query">
              <Search/>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search saved vectors, inserts, or projects"/>
            </label>
          </div>
          <div className="backbone-results">
            {matchingLibrary.map((entry) => <article key={entry.id}>
              <span>
                <strong>{entry.name}</strong>
                <small>
                  {entry.lengthBp.toLocaleString()} bp · {entry.featureCount} annotations
                  {entry.insertName ? ` · insert: ${entry.insertName}` : ""}
                </small>
                <small className="backbone-uses">
                  Used in {entry.projectCount} project{entry.projectCount === 1 ? "" : "s"}
                  {entry.projects.length ? `: ${entry.projects.map((use) => use.proteinName).join(", ")}` : ""}
                </small>
              </span>
              <Button size="sm" variant="outline" disabled={Boolean(loadingId)} onClick={() => void loadFromLibrary(entry)}>
                {loadingId === entry.id ? <LoaderCircle className="spin"/> : <Download/>} Load
              </Button>
            </article>)}
            {!matchingLibrary.length && <p className="backbone-empty">
              {library.length ? "No saved vector matched that search." : "No vectors have been saved yet. Name and save one in Expression vector design and it will appear here."}
            </p>}
          </div>
        </>
      : sourceId === "file"
      ? <div className="backbone-file">
          <input ref={fileRef} type="file" hidden accept=".gb,.gbk,.genbank,.ape,.fa,.fasta,.fna,.dna,.prot"
            onChange={(event) => void importFile(event.target.files?.[0] ?? null)} />
          <Button disabled={loadingId === "file"} onClick={() => fileRef.current?.click()}>
            {loadingId === "file" ? <LoaderCircle className="spin" /> : <FileInput />} Choose a sequence file
          </Button>
          <small>GenBank (.gb, .gbk), FASTA (.fa, .fasta) and SnapGene (.dna) files are all read with their annotations.</small>
        </div>
      : <>
          <div className="backbone-search">
            {sourceId === "snapgene" && <label>Plasmid set
              <select value={activeSetId} onChange={(event) => setSetId(event.target.value)}>
                {activeSets.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
            </label>}
            <label className="backbone-query">
              <Search />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={sourceId === "ncbi" ? "Vector name or accession, e.g. pET-28a or OL989372" : "Search backbone name, e.g. pET-28a"}
              />
            </label>
            {searching && <LoaderCircle className="spin" />}
          </div>

          <div className="backbone-results">
            {results.map((result) => <article key={`${result.id}-${result.name}`}>
              <span>
                <strong>{result.name}</strong>
                <small>
                  {result.lengthBp ? `${result.lengthBp.toLocaleString()} bp · ` : ""}
                  {result.description || result.id}
                </small>
              </span>
              <Button size="sm" variant="outline" disabled={Boolean(loadingId)} onClick={() => void load(result)}>
                {loadingId === result.id ? <LoaderCircle className="spin" /> : <Download />} Load
              </Button>
            </article>)}
            {!searching && !results.length && <p className="backbone-empty">
              {sourceId === "ncbi" && query.trim().length < 3
                ? "Type at least three characters to search NCBI."
                : query || sourceId !== "ncbi" ? "No backbone matched that search." : "Search for a backbone to begin."}
            </p>}
          </div>
        </>}

    {source?.attribution && <p className="backbone-attribution">{source.attribution}</p>}
    {failure && <div className="backbone-failure"><CircleAlert /><span>{failure}</span></div>}
  </div>;
}

function message(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}
