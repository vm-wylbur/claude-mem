# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "sentence-transformers>=2.7.0",
#   "transformers>=4.51.0",
#   "torch",
# ]
# ///
#
# Author: PB and Claude
# Date: 2026-05-31
# License: (c) HRDAG, 2026, GPL-2 or newer
#
# claude-mem/eval/rerank-sanity.py
#
# THROWAWAY harness sanity check for the rerank probe. The probe returned
# catastrophic, inverted-looking results on real DB content (gold docs pushed
# to pool-bottom). This isolates model-vs-harness with trivially-relevant vs
# trivially-irrelevant docs (no DB, no domain confound), across dtypes.
#
# RESULT (2026-05-31): PASSES in all three configs -- relevant scores ~0.93-0.94,
# irrelevant ~0.34-0.39, on mps/fp16, mps/fp32, cpu/fp32. The model + seq-cls
# load + CrossEncoder score orientation are CORRECT. So the catastrophic probe
# numbers are NOT a model/dtype/score-sign bug; the cause is in how the probe
# feeds REAL memory content (length/truncation/format) -- chase that next, see
# eval/rerank-debug.py.
#
#   uv run eval/rerank-sanity.py                 # sweeps mps/fp16, mps/fp32, cpu/fp32
#   uv run eval/rerank-sanity.py <model>

import os
import sys

os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TQDM_DISABLE", "1")

import torch
from sentence_transformers import CrossEncoder

MODEL = sys.argv[1] if len(sys.argv) > 1 else "tomaarsen/Qwen3-Reranker-0.6B-seq-cls"

CASES = [
    ("How many people live in Berlin?",
     "Berlin is the capital of Germany and has a population of about 3.85 million people.",
     "Bananas are a good source of potassium and grow in tropical climates."),
    ("upsmon -c fsd is destructive not a probe",
     "Running upsmon -c fsd does NOT probe the UPS; the fsd command forces a shutdown and is destructive.",
     "The km0 site is located in San Juan, Puerto Rico."),
]

CONFIGS = [
    ("mps", torch.float16),
    ("mps", torch.float32),
    ("cpu", torch.float32),
]


def run(device: str, dtype) -> None:
    if device == "mps" and not torch.backends.mps.is_available():
        print(f"\n### {device}/{dtype} -- MPS unavailable, skipped")
        return
    print(f"\n### {device}/{str(dtype).split('.')[-1]}  model={MODEL}")
    model = CrossEncoder(device=device, model_name_or_path=MODEL, max_length=512,
                         model_kwargs={"torch_dtype": dtype})
    for q, rel, irr in CASES:
        scores = model.predict([(q, rel), (q, irr)], show_progress_bar=False)
        s_rel, s_irr = float(scores[0]), float(scores[1])
        ok = "OK" if s_rel > s_irr else ">>> BROKEN <<<"
        print(f"  Q={q[:38]!r:42}  rel={s_rel:+.5f}  irr={s_irr:+.5f}  {ok}")


for dev, dt in CONFIGS:
    try:
        run(dev, dt)
    except Exception as e:
        print(f"\n### {dev}/{dt} -- ERROR: {type(e).__name__}: {e}")

print("\ndone")
