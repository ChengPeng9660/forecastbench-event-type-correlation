# Does calibration change the value of a second forecast?

2026-09-07 · Exploratory historical-holdout follow-up.

Default: training Overall BI gap <=3, coverage >=50%, all exact configurations. Primary seed 20260910 A to B. The raw-training router, pair eligibility and test supports remain frozen.

Input calibration separately calibrates the two exact models, then pools. Output calibration pools raw forecasts, then separately calibrates each method. Each version uses its own calibrated-selection baseline. Event-equal Brier within pair, then equal pair means. ECE is target-weighted within pair (ten bins), then equal pair means.

## Input calibration

### Complementary events

2431 pairs; 201.6 mean test events per pair. 3/4 original fixed formulas improve mean Brier versus this version's calibrated selection.

| Method | Raw Brier | Calibrated Brier | Calibration gain | Gain vs calibrated selection | Pair wins | Gain vs duplicate | Positive directions / 10 | Raw ECE | Calibrated ECE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Calibrated type selection | 0.150402 | 0.145122 | +0.005280 | +0.000000 | 0.0% | +0.000000 | 0 | 0.087931 | 0.068405 |
| Calibrated other forecast alone | 0.171903 | 0.158155 | +0.013748 | -0.013033 | 14.0% | -0.013033 | 0 | 0.120323 | 0.081625 |
| Simple mean | 0.152815 | 0.145495 | +0.007320 | -0.000373 | 44.0% | -0.000373 | 2 | 0.100108 | 0.073782 |
| Log-odds mean | 0.150978 | 0.144120 | +0.006858 | +0.001002 | 55.6% | +0.001002 | 10 | 0.095313 | 0.070922 |
| EC · w = 0.56 | 0.150819 | 0.144283 | +0.006535 | +0.000838 | 55.5% | +0.001348 | 9 | 0.094601 | 0.070958 |
| Piecewise odds | 0.150193 | 0.143529 | +0.006663 | +0.001592 | 60.4% | +0.002026 | 10 | 0.088477 | 0.064073 |
| Normalized product | 0.157220 | 0.153265 | +0.003955 | -0.008143 | 21.9% | +0.002650 | 0 | 0.110277 | 0.100024 |
| One-weight log-odds pool | 0.148487 | 0.143139 | +0.005348 | +0.001983 | 81.1% | +0.001983 | 10 | 0.087761 | 0.067585 |
| Bounded log-odds pool | 0.148479 | 0.143120 | +0.005359 | +0.002002 | 79.8% | +0.002002 | 10 | 0.087758 | 0.067563 |
| Brier convex pool | 0.149276 | 0.143680 | +0.005596 | +0.001442 | 66.3% | +0.001442 | 10 | 0.091395 | 0.070450 |

Mean [unrestricted log-odds, bounded log-odds, Brier probability] weights: [0.17085675488715818, 0.17333051865192625, 0.22846940202568541].

### All events

2431 pairs; 412.8 mean test events per pair. 4/4 original fixed formulas improve mean Brier versus this version's calibrated selection.

| Method | Raw Brier | Calibrated Brier | Calibration gain | Gain vs calibrated selection | Pair wins | Gain vs duplicate | Positive directions / 10 | Raw ECE | Calibrated ECE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Calibrated type selection | 0.157282 | 0.148245 | +0.009038 | +0.000000 | 0.0% | +0.000000 | 0 | 0.087063 | 0.051985 |
| Calibrated other forecast alone | 0.174656 | 0.158704 | +0.015952 | -0.010460 | 12.1% | -0.010460 | 0 | 0.110271 | 0.058841 |
| Simple mean | 0.157345 | 0.147148 | +0.010197 | +0.001096 | 57.5% | +0.001096 | 10 | 0.097123 | 0.058478 |
| Log-odds mean | 0.155691 | 0.145792 | +0.009899 | +0.002452 | 69.7% | +0.002452 | 10 | 0.092678 | 0.054804 |
| EC · w = 0.56 | 0.155265 | 0.145428 | +0.009837 | +0.002817 | 73.2% | +0.002915 | 10 | 0.092290 | 0.053824 |
| Piecewise odds | 0.154688 | 0.144755 | +0.009933 | +0.003489 | 76.1% | +0.003551 | 10 | 0.086818 | 0.047667 |
| Normalized product | 0.160559 | 0.151323 | +0.009236 | -0.003079 | 29.4% | +0.004870 | 0 | 0.109437 | 0.084126 |
| One-weight log-odds pool | 0.154499 | 0.145645 | +0.008855 | +0.002600 | 91.3% | +0.002600 | 10 | 0.086456 | 0.051752 |
| Bounded log-odds pool | 0.154467 | 0.145619 | +0.008849 | +0.002626 | 90.7% | +0.002626 | 10 | 0.086518 | 0.051759 |
| Brier convex pool | 0.154987 | 0.145979 | +0.009008 | +0.002265 | 82.8% | +0.002265 | 10 | 0.089361 | 0.054879 |

Mean [unrestricted log-odds, bounded log-odds, Brier probability] weights: [0.17085675488715818, 0.17333051865192625, 0.22846940202568541].

## Output calibration

### Complementary events

2431 pairs; 201.6 mean test events per pair. 4/4 original fixed formulas improve mean Brier versus this version's calibrated selection.

| Method | Raw Brier | Calibrated Brier | Calibration gain | Gain vs calibrated selection | Pair wins | Gain vs duplicate | Positive directions / 10 | Raw ECE | Calibrated ECE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Calibrated type selection | 0.150402 | 0.144286 | +0.006115 | +0.000000 | 0.0% | +0.000000 | 0 | 0.087931 | 0.064125 |
| Calibrated other forecast alone | 0.171903 | 0.159238 | +0.012665 | -0.014952 | 12.8% | -0.012248 | 0 | 0.120323 | 0.082933 |
| Simple mean | 0.152815 | 0.143972 | +0.008843 | +0.000314 | 50.3% | +0.000973 | 9 | 0.100108 | 0.068776 |
| Log-odds mean | 0.150978 | 0.143514 | +0.007464 | +0.000772 | 55.5% | +0.001421 | 9 | 0.095313 | 0.066952 |
| EC · w = 0.56 | 0.150819 | 0.143405 | +0.007414 | +0.000881 | 56.1% | +0.001601 | 10 | 0.094601 | 0.065949 |
| Piecewise odds | 0.150193 | 0.143546 | +0.006646 | +0.000740 | 54.9% | +0.001595 | 9 | 0.088477 | 0.063795 |
| Normalized product | 0.157220 | 0.143502 | +0.013718 | +0.000785 | 55.7% | +0.002250 | 8 | 0.110277 | 0.065100 |
| One-weight log-odds pool | 0.148487 | 0.142221 | +0.006266 | +0.002066 | 79.8% | +0.002195 | 10 | 0.087761 | 0.062041 |
| Bounded log-odds pool | 0.148479 | 0.142197 | +0.006281 | +0.002089 | 77.7% | +0.002219 | 10 | 0.087758 | 0.061986 |
| Brier convex pool | 0.149276 | 0.142358 | +0.006918 | +0.001928 | 74.6% | +0.002070 | 10 | 0.091395 | 0.063345 |

Mean [unrestricted log-odds, bounded log-odds, Brier probability] weights: [0.15761724147036826, 0.1611961945862887, 0.18518649832732959].

### All events

2431 pairs; 412.8 mean test events per pair. 4/4 original fixed formulas improve mean Brier versus this version's calibrated selection.

| Method | Raw Brier | Calibrated Brier | Calibration gain | Gain vs calibrated selection | Pair wins | Gain vs duplicate | Positive directions / 10 | Raw ECE | Calibrated ECE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Calibrated type selection | 0.157282 | 0.147831 | +0.009451 | +0.000000 | 0.0% | +0.000000 | 0 | 0.087063 | 0.048822 |
| Calibrated other forecast alone | 0.174656 | 0.159528 | +0.015128 | -0.011697 | 10.7% | -0.009525 | 0 | 0.110271 | 0.059477 |
| Simple mean | 0.157345 | 0.145386 | +0.011960 | +0.002446 | 67.0% | +0.003023 | 10 | 0.097123 | 0.052013 |
| Log-odds mean | 0.155691 | 0.145081 | +0.010610 | +0.002750 | 69.9% | +0.003281 | 10 | 0.092678 | 0.050243 |
| EC · w = 0.56 | 0.155265 | 0.144888 | +0.010377 | +0.002943 | 71.2% | +0.003557 | 10 | 0.092290 | 0.049226 |
| Piecewise odds | 0.154688 | 0.145249 | +0.009440 | +0.002583 | 69.2% | +0.003615 | 10 | 0.086818 | 0.047961 |
| Normalized product | 0.160559 | 0.144766 | +0.015793 | +0.003065 | 71.8% | +0.004491 | 10 | 0.109437 | 0.048763 |
| One-weight log-odds pool | 0.154499 | 0.145125 | +0.009374 | +0.002706 | 90.5% | +0.002871 | 10 | 0.086456 | 0.047170 |
| Bounded log-odds pool | 0.154467 | 0.145076 | +0.009391 | +0.002755 | 89.5% | +0.002919 | 10 | 0.086518 | 0.047074 |
| Brier convex pool | 0.154987 | 0.145031 | +0.009956 | +0.002800 | 87.8% | +0.003038 | 10 | 0.089361 | 0.048184 |

Mean [unrestricted log-odds, bounded log-odds, Brier probability] weights: [0.15761724147036826, 0.1611961945862887, 0.18518649832732959].

## Interpretation and limitations

Calibration can change a single model substantially. Aggregation benefit is therefore measured relative to the equally calibrated selection baseline of the same version. A calibration gain compares each complete method with its own raw version; it is a different comparison.
Duplicate controls freeze every trained weight and calibration coefficient. Input: F(s_c,s_c). Output: C_m(F(s,s)). The latter reuses the calibrator fitted on the real two-model training outputs; it is a substitution diagnostic, not a separately optimized single-model pipeline.
Calibrators minimize regularized training log loss, so neither held-out Brier nor ECE is guaranteed to improve. Output calibration and input calibration use different calibrated-selection baselines and answer different questions.
Multiple fitted stages reuse the outer training sample; no inner cross-fitting is claimed. All complete pipelines are evaluated on disjoint frozen outer test events. Existing historical test reuse makes this exploratory. Ten directions reuse events and models and are not independent replications.
A positive gain supports usefulness under the specified pipeline and comparator. It does not identify independent internal evidence or an unrestricted conditional-information mechanism. Normalized product is a heuristic pooling formula, not a joint probability of distinct events.

See PROTOCOL.md, source-manifest.json, audit.json, all-direction-scores.csv.gz, primary-pair-results.json.gz (including all calibration coefficients) and all 24 views.

Derived from ForecastBench (Forecasting Research Institute), CC BY-SA 4.0.
