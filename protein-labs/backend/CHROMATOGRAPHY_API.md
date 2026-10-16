# Chromatography API v1

`POST /v1/chromatogram/run` creates a versioned SEC or affinity run.
`POST /v1/chromatogram/analyze` returns scientific measurements for one trace.
`POST /v1/chromatogram/calibrate-sec` calibrates standards without a trace.
All use JSON and return HTTP 400 with `{error, type}` for invalid input.
No additional dependencies are required.

## Run types

`POST /v1/chromatogram/run` accepts `method: "sec" | "affinity"`. An omitted
method remains `sec`, so existing SEC request objects can move to this endpoint
without migration. SEC returns the analyze response below with `method: "sec"`.

An affinity request declares one ordered load/wash/elute method:

```json
{
  "schemaVersion": 1,
  "method": "affinity",
  "column": {
    "resinName": "Example affinity resin",
    "columnVolumeMl": 2,
    "dynamicBindingCapacityMgPerMl": 10
  },
  "load": {"proteinMassMg": 25},
  "phases": [
    {"type": "load", "volumeMl": 10, "buffer": "20 mM phosphate, pH 7.4"},
    {"type": "wash", "volumeMl": 5, "buffer": "20 mM phosphate, 20 mM imidazole"},
    {
      "type": "elute",
      "volumeMl": 10,
      "buffer": "20 mM phosphate, 300 mM imidazole",
      "peakPositionFraction": 0.25,
      "peakWidthFraction": 0.1,
      "recoveryFraction": 0.8
    }
  ],
  "fractions": [{"id": "E1", "startVolumeMl": 16, "endVolumeMl": 20}],
  "sampling": {"pointsPerMl": 20}
}
```

All volume fields are mL, all mass fields are mg, dynamic binding capacity is
mg/mL resin, and recovery inputs are fractions from 0 to 1. Phase volume is
cumulative: the example boundaries are load 0–10 mL, wash 10–15 mL and elute
15–25 mL. `peakPositionFraction` locates the apex within the elute phase, so the
example apex is 17.5 mL. `peakWidthFraction` is the Gaussian sigma divided by
elute volume. `pointsPerMl` is an integer from 1 to 1000 and the response is
limited to 200000 trace samples.

The affinity response is the portable run object. It always includes
`schemaVersion`, `method`, explicit `units`, `column`, `phases` with calculated
boundaries and phase mass records, `points`, `peaks`, `fractions` with integrated
mass, `massBalance`, and `methods`. Save and reopen the object as JSON without
dropping fields; its disk round trip is tested for equality.

Capacity is exactly
`columnVolumeMl * dynamicBindingCapacityMgPerMl`. Bound mass is the smaller of
loaded mass and capacity. Excess load becomes a mass-normalized breakthrough
peak inside the load phase; it never increases the capacity-limited elution
peak. Eluted mass is `boundMg * recoveryFraction`; material not eluted is
reported as `retainedMg`. The balance closes as
`loadedMg = breakthroughMg + elutedMg + retainedMg`. `recoveryPercent` and
`recoveredMg` mean eluted product, while `traceAreaMg` includes both
breakthrough and elution signals.

Affinity traces are deterministic concentrations in mg/mL. The compact
breakthrough and bounded-Gaussian elution profiles are numerically normalized
so their trapezoidal areas equal their reported masses. The model adds neither
baseline nor noise; `methods.baseline` and `methods.noise` state those choices.
Measured/imported traces should continue through `/analyze`, whose explicit
drift/noise-resistant detection is described below.

## Analyze request

```json
{
  "schemaVersion": 1,
  "units": {"x": "mL", "y": "mg/mL"},
  "points": [{"x": 0, "y": 0}, {"x": 1, "y": 1}, {"x": 3, "y": 0}],
  "processing": {"smoothing": 1, "baseline": "none"},
  "ranges": [{"start": 0, "end": 3}],
  "massBalance": {"loadedMg": 2}
}
```

- `points`: 3–200000 finite samples with strictly increasing x. Irregular spacing is supported.
- `units`: x is `mL` or `min`; y is `mAU` or `mg/mL`. No implicit conversions.
- `processing`: optional; centered moving average with integer window 1–1001 (radius=floor(window/2), truncated at edges); baseline `none` or `percentile5`. Defaults shown above. Percentiles interpolate correctly at exact sample indices.
- `ranges`: optional non-overlapping integration bounds in axis units. Bounds select existing samples inclusively, without interpolating new endpoint samples. Fewer than three samples or no positive peak yields no peak. Omit to detect automatically; `maxPeaks` defaults to 10, range 1–100. Send `[]` to process without detecting.
- `sec`: optional object with `voMl`, `vtMl`, `standards` as below. Requires an mL axis.
- `massBalance`: optional; positive `loadedMg` required. mAU signals also require positive `responseFactorMAUPerMgMl` (mAU per mg/mL); time traces require positive constant `flowMlPerMin` (mL/min). Use independently measured response/flow values. Mixed-protein UV recovery requires an appropriate effective response factor; this API cannot infer one.

## Analyze response

All fields below are present; SEC-only peak fields appear when `sec` is supplied.

| Field | Shape / meaning |
| --- | --- |
| `schemaVersion` | `1` |
| `units` | input x/y plus `area` (y*x), `width` (x), `mw: kDa`, `mass: mg`, `recovery: %`, `fitResidual` (y), `mwUncertainty: kDa` |
| `points` | processed `{x,y}[]`, before any display normalization |
| `baselineOffset` | constant removed, in y units |
| `peaks` | `{start,end,apexX,response,height,area,fwhm,asymmetry10,flags,fitQuality}`; widths in x, area in y*x; nullable width/asymmetry when unavailable |
| SEC peak additions | `{kav,mwKDa,mwUncertaintyKDa,outOfRange}`; out-of-range Mw and uncertainty are `null` |
| `calibration` | `null` or SEC fit below |
| `resolutions` | `{leftPeakIndex,rightPeakIndex,rs}[]`; adjacent peak indices, dimensionless nullable Rs |
| `massBalance` | `{status,integratedArea,recoveredMg,recoveryPercent}`; status `not_requested` with null mass/recovery, or `calculated` with `loadedMg,unaccountedMg,exceedsLoaded` |
| `methods` | explicit baseline, peak baseline, noise, resolution and asymmetry method strings |

For the request above: area = 1.5 mg, asymmetry = 2, recovered mass = 1.5 mg, recovery = 75%.
Recovery sums disjoint, positive, baseline-corrected peak areas. It is recovery of the selected/detected peaks, not proof that all loaded material was collected. Unaccounted mass is loaded minus recovered; negative values and recovery above 100% are reported, never clamped.

## SEC calibration request and response

```json
{
  "voMl": 8,
  "vtMl": 24,
  "standards": [
    {"mwDa": 1000, "veMl": 20, "included": true},
    {"mwDa": 10000, "veMl": 16, "included": true},
    {"mwDa": 100000, "veMl": 12, "included": true}
  ],
  "elutionVolumesMl": [16, 21]
}
```

Response: `{schemaVersion:1, calibration, predictions:[{veMl,kav,mwKDa,mwUncertaintyKDa,outOfRange,flags}]}`.
`elutionVolumesMl` is optional. Fit fields: `slope,intercept,r2,logMwDaRange,veMlRange,voMl,vtMl,standardCount`.
Additive fit fields: `standardMassRangeKDa: [min,max]` from included standards only,
`residualVarianceKav` (SSE/(n-2), null for two standards), `meanLogMwDa` and
`sumSquaredLogMwDa` (centered Sxx). These describe the same calibration;
`r2` is calibration quality and is distinct from each peak's `fitQuality`.
Ordinary least squares fits **Kav = slope * log10(Mw in Da) + intercept**, matching the existing UI orientation. The example gives slope −0.25, intercept 1.5, R² 1. At 16 mL: Kav 0.5 and Mw 10 kDa. At 21 mL: Mw null, outOfRange true.

Reject Vo ≥ Vt, nonpositive volumes/masses, included standards outside the column interval, insufficient/distinctless standards and flat/reversed fits. `included:false` standards are skipped. Inversion is permitted only within both measured Ve and fitted log-Mw standard ranges. SEC estimates depend on hydrodynamic size and standard/analyte shape; no universal mass calibration is implied.

## Report diagnostics (additive v1 fields)

Every measured peak has `flags: [{code,level,title,message}]` and
`fitQuality: {rSquared,residual,model}`. `residual` is RMSE in the input y units,
not calibration residual variance or residual sum of squares. The model string
is `gaussian_fixed_apex_fwhm_amplitude_fit`: apex and FWHM are measured, held
fixed, and only nonnegative Gaussian amplitude is fitted by closed-form least
squares. No iterative optimizer, center refinement or species deconvolution is
performed. Quality uses every selected sample with signed local baseline
residuals (negative noise is retained). Area still uses positive trapezoids.
R-squared is `1-SSE/SST`, can be negative, and is never clipped. Both statistics
are null for fewer than five samples or an unavailable/nonpositive FWHM.

Flags identify unavailable quality, fewer than five samples within FWHM,
R-squared below 0.95, or an adjacent Rs below 1.5. These are diagnostic
thresholds, not evidence of a particular biological cause. An overlapping peak
can still pass the Gaussian check; a good fit does not establish purity.

`mwUncertaintyKDa` is a **first-order, one-sigma, calibration-only estimate** for
one new Kav observation. It is not a 95% interval, a fitted peak-center error,
or a complete experimental uncertainty budget. With `z=log10(MwDa)`, calibration
slope `b`, `s²=SSE/(n-2)` and `Sxx=sum((z_i-mean(z_i))²)`, the implementation is:

```
u_z = sqrt(s² * (1 + 1/n + (z-mean(z_i))²/Sxx)) / abs(b)
u_Mw = ln(10) * Mw_kDa * u_z
```

This applies local error propagation to an ordinary regression prediction
variance ([NIST calibration reference](https://www.itl.nist.gov/div898/software/dataplot/refman1/auxillar/calibrat.htm)).
It assumes independent, equal-variance Kav errors, exact standard masses, and
fixed Vo/Vt. It excludes peak-localization, standard-mass and column-volume
uncertainty, shape mismatch, and systematic errors. Each numeric estimate
carries the `calibration_only_mass_uncertainty` note so a report can print that
limitation. Exact collinear standards produce zero calibration scatter, not
proof of zero total uncertainty. Two standards produce a null uncertainty and
`mass_uncertainty_unavailable`. Out-of-range masses also have null uncertainty;
no extrapolated mass is introduced. Values at least as large as Mw receive
`large_mass_uncertainty` because the linear approximation is unreliable.

Known-answer example: standards with log10 masses `[3,4,5,6]`, Kav values
`[0.76,0.49,0.24,0.01]`, Vo=8 mL and Vt=24 mL yield b=-0.25, intercept=1.5,
s²=0.0002 and Sxx=5. At 16 mL, Mw=10 kDa and
u_Mw=`10*ln(10)*sqrt(0.0002*1.3)/0.25` kDa (approximately 1.485 kDa).

## Measurement methods and limits

Detection removes endpoint linear drift, applies a seven-sample moving average, and seeks maxima above the larger of the 65th percentile and 3 noise sigma. Noise sigma is `1.4826*MAD(first differences)/sqrt(2)` under independent additive noise. Traces shorter than seven samples use directly observed strict local maxima instead because they cannot support the smoother or a meaningful noise estimate; a three-sample triangle is therefore a valid detected peak. A candidate is a separate peak only when the intervening valley drops by at least the larger of 3 noise sigma and 10% of the smaller apex. Adjacent integration regions meet at the observed smoothed valley.

Measurements use the processed signal, a straight baseline between each region's endpoints and trapezoidal integration after clamping negative residuals to zero. FWHM and 10%-height crossings use linear interpolation. Rs = `1.18 * delta-apex / (FWHM1 + FWHM2)`; As = trailing/leading width at 10% height. These are apparent peak measurements, not a deconvolution of overlapping species. Truncated/overlapping peaks and noisy endpoints can bias area and widths. Positive clipping biases noise area upward; measured noisy-fixture error is 1.32% (2% test tolerance), versus <1e-10 relative error for the noiseless Gaussian.

References: [Cytiva SEC calibration instructions](https://cdn.cytivalifesciences.com/api/public/content/digi-14748-original), [Agilent resolution definition](https://www.agilent.com/cs/library/eseminars/public/GCTheory.pdf), [MTC asymmetry definition](https://www.mtc-usa.com/calc_hasy).

## Frontend integration handoff

The backend PR does not change React or `.chromproj` persistence. Frontend owner must:

1. Call analyze for trace processing, automatic/manual peak measurements and recovery; call calibrate-sec for the standards workspace and peak recalibration. Preserve trace/peak IDs, labels, styles and raw samples in the existing project object. Map peak results back to existing IDs by the requested range, not unstable asynchronous response order.
2. Replace local baseline, smoothing, peak area/detection and SEC fitting/inversion in `chromatogram-studio-job.tsx`. Debounce and discard stale responses; surface readable validation errors. Do not silently fall back to old calculations when the backend is unavailable.
3. Keep presentation shifts/scales/normalization separate from quantitative analysis; never request mass recovery from a normalized or arbitrarily scaled signal. Preserve exclusions as distinct trace segments so integration does not bridge missing data. Split requests by segment if needed.
4. Use server Kav values for standards/peaks, server fit fields for plots and server outOfRange for absent Mw. Show units and the stated method with Rs/As/recovery. Preserve existing project import/export, and test an old `.chromproj` through save/reopen before claiming compatibility.
5. Compare ordinary SEC against the existing formula (example above, relative tolerance 1e-10). Intentional differences: invalid columns now fail, extrapolated masses are suppressed, quantiles are corrected, noisy detection uses explicit noise/drift handling, and peak integration uses full manual ranges or detected valleys rather than the old 2.5%-height boundary walk.

For report diagnostics, preserve peak `flags` and `fitQuality` when joining
measurements to local IDs and serializing jobs. If SEC uses the separate
calibrate endpoint, copy `mwUncertaintyKDa` from that prediction, concatenate
its `flags` with measurement flags, and retain `standardMassRangeKDa` on the
calibration object. Replacing the prediction must replace its previous flags,
not accumulate stale flags. Existing explicit frontend field copies need this
mapping even though the report reader already understands these fields.
Preserve null uncertainties as null; do not coerce them to zero. Both flags
and numeric estimates must survive save/reopen together.

For affinity, add a `method: "sec" | "affinity"` discriminator to the existing
project object and default missing values to `sec`. Submit the affinity fields
shown above to `/v1/chromatogram/run`. Plot response `points` without changing
their units; draw each `phases[].startVolumeMl/endVolumeMl` as boundaries; show
the phase buffer and phase `mass` beside the trace. The load-phase
`kind:"breakthrough"` peak must remain distinct from the `kind:"elution"` peak.
Use `massBalance` verbatim for loaded, capacity, bound, breakthrough, eluted,
retained and recovery displays. Persist the complete run response—including
column, phases, fractions and methods—through the existing project save/export
path rather than adding an affinity-only file format.

The older `/analyze` payload remains an analysis-result schema, not a portable
project schema. `/run` is the versioned chromatography run boundary. JSON disk
round-trip equality is tested here; UI project compatibility remains frontend
acceptance work.
