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

The HTTP payload is an analysis-result schema, not a replacement portable run/project schema. JSON disk round-trip equality is tested; UI project compatibility remains frontend acceptance work.

For report diagnostics, preserve peak `flags` and `fitQuality` when joining
measurements to local IDs and serializing jobs. If SEC uses the separate
calibrate endpoint, copy `mwUncertaintyKDa` from that prediction, concatenate
its `flags` with measurement flags, and retain `standardMassRangeKDa` on the
calibration object. Replacing the prediction must replace its previous flags,
not accumulate stale flags. Existing explicit frontend field copies need this
mapping even though the report reader already understands these fields.
Preserve null uncertainties as null; do not coerce them to zero. Both flags
and numeric estimates must survive save/reopen together.
