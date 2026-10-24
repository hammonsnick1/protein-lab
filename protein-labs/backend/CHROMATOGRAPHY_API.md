# Chromatography API v1

`POST /v1/chromatogram/analyze` returns scientific measurements for one trace.
`POST /v1/chromatogram/calibrate-sec` calibrates standards without a trace.
Both use JSON and return HTTP 400 with `{error, type}` for invalid input.
No additional dependencies are required.

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
| `units` | input x/y plus `area` (y*x), `width` (x), `mw: kDa`, `mass: mg`, `recovery: %` |
| `points` | processed `{x,y}[]`, before any display normalization |
| `baselineOffset` | constant removed, in y units |
| `peaks` | `{start,end,apexX,response,height,area,fwhm,asymmetry10}`; widths in x, area in y*x; nullable width/asymmetry when unavailable |
| SEC peak additions | `{kav,mwKDa,outOfRange}`; out-of-range Mw is `null` |
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

Response: `{schemaVersion:1, calibration, predictions:[{veMl,kav,mwKDa,outOfRange}]}`.
`elutionVolumesMl` is optional. Fit fields: `slope,intercept,r2,logMwDaRange,veMlRange,voMl,vtMl,standardCount`.
Ordinary least squares fits **Kav = slope * log10(Mw in Da) + intercept**, matching the existing UI orientation. The example gives slope −0.25, intercept 1.5, R² 1. At 16 mL: Kav 0.5 and Mw 10 kDa. At 21 mL: Mw null, outOfRange true.

Reject Vo ≥ Vt, nonpositive volumes/masses, included standards outside the column interval, insufficient/distinctless standards and flat/reversed fits. `included:false` standards are skipped. Inversion is permitted only within both measured Ve and fitted log-Mw standard ranges. SEC estimates depend on hydrodynamic size and standard/analyte shape; no universal mass calibration is implied.

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

The HTTP payload is an analysis-result schema, not a replacement portable run/project schema. JSON disk round-trip equality is tested; UI project compatibility remains frontend acceptance work.
