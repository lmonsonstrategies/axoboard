# Approved visual baselines

Only independently reviewed checkpoint screenshots belong here.

The audit runner never writes this directory during a normal or proposal run. `--propose-baselines` stages candidates under the run report. A different reviewer must use `scripts/approve-qa-baselines.mjs`; the script rejects self-approval and writes `approval-manifest.json` with verified SHA-256 values.

No product baseline is approved in the initial harness commit. Until reviewed baseline images are added, gate mode fails closed with `visual.baseline-missing`.
