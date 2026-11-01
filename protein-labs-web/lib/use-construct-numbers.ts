"use client";

import { useEffect, useMemo, useState } from "react";
import { proteinLabsApi, type ProteinBundle } from "@/lib/protein-labs-api";
import { constructNumbers, sequencesToAnalyse, speciesFromMetrics, type ConstructNumbers, type SpeciesNumbers } from "@/lib/construct-numbers";

// Analysed sequences are shared across screens for the session, like the
// construct designer's own cache, so opening the roadmap after Affinity
// capture costs no extra engine calls.
const analysedCache = new Map<string, SpeciesNumbers>();

/**
 * `constructNumbers` for a component. A project that has not saved a
 * construct yet has its planned fusion and cleaved product analysed by the
 * engine's ProtParam, the same call the construct designer makes.
 */
export function useConstructNumbers(bundle: ProteinBundle): { numbers: ConstructNumbers; analysing: boolean; failed: boolean } {
  // `revision` re-reads the cache once the engine has answered.
  const [revision, setRevision] = useState(0);
  const pending = useMemo(() => sequencesToAnalyse(bundle).filter((sequence) => !analysedCache.has(sequence)), [bundle, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = pending.join("|");
  const [failedKey, setFailedKey] = useState("");
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    Promise.all(key.split("|").map(async (sequence) => {
      const species = speciesFromMetrics((await proteinLabsApi.analyzeSequence(sequence)).result, sequence.length);
      if (!species) throw new Error("The engine returned no mass for the construct.");
      analysedCache.set(sequence, species);
    }))
      .then(() => { if (!cancelled) setRevision((value) => value + 1); })
      .catch(() => { if (!cancelled) setFailedKey(key); });
    return () => { cancelled = true; };
  }, [key]);
  const numbers = useMemo(() => constructNumbers(bundle, analysedCache), [bundle, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  return { numbers, analysing: Boolean(key) && failedKey !== key, failed: Boolean(key) && failedKey === key };
}
