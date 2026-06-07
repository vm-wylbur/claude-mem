# /// script
# requires-python = ">=3.11"
# dependencies = ["pylate", "numpy", "torch"]
# ///
# Author: PB and Claude / Date: 2026-06-07 / License: (c) HRDAG, 2026, GPL-2 or newer
# claude-mem/eval/colbert-inspect.py
#
# Did the bake-off run ColBERT at its best? Probes the GTE-ModernColBERT-v1
# config + encode behavior to check: (1) query augmentation (pad-to-N with
# [MASK]), (2) document length cap, (3) whether token embeddings are pre-
# normalized, (4) what PyLate's own scoring does vs the manual MaxSim used.

import json, sys
import numpy as np, torch
from pylate import models

dev = "mps" if torch.backends.mps.is_available() else "cpu"
m = models.ColBERT("lightonai/GTE-ModernColBERT-v1", device=dev)

print("=== model config (defaults, NO overrides) ===")
for attr in ("query_length", "document_length", "query_prefix", "document_prefix",
             "attend_to_expansion_tokens", "skiplist_words", "similarity_fn_name"):
    print(f"  {attr} = {getattr(m, attr, '<none>')}")
# the underlying ST modules sometimes hold the real maxlen / mask config
try:
    tok = m.tokenizer
    print(f"  tokenizer.model_max_length = {tok.model_max_length}")
    print(f"  mask_token = {tok.mask_token!r} id={tok.mask_token_id}")
except Exception as e:
    print("  tokenizer introspection failed:", e)

print("\n=== query encode: does it pad to a fixed length with MASK expansion? ===")
for q in ["upsmon", "upsmon -c fsd is destructive not a probe",
          "a much longer query about ssh controlmaster yubikey sk key passphrase failures and retries"]:
    e = m.encode([q], is_query=True, show_progress_bar=False)[0]
    a = np.asarray(e)
    print(f"  q_tokens={a.shape[0]:>3}  dim={a.shape[1]}  | words={len(q.split())}  '{q[:40]}'")

print("\n=== document encode: token counts (truncation at default doc_length?) ===")
docs = ["short doc", " ".join(["lorem ipsum dolor sit amet"] * 200)]  # ~1000 words
for d in docs:
    e = m.encode([d], is_query=False, show_progress_bar=False)[0]
    a = np.asarray(e)
    print(f"  d_tokens={a.shape[0]:>4}  dim={a.shape[1]}  | words={len(d.split())}")

print("\n=== are token embeddings already L2-normalized? ===")
e = np.asarray(m.encode(["test vector norm"], is_query=True, show_progress_bar=False)[0])
norms = np.linalg.norm(e, axis=1)
print(f"  token-vector norms: min={norms.min():.4f} max={norms.max():.4f} mean={norms.mean():.4f}")

print("\n=== PyLate canonical scoring available? ===")
try:
    from pylate import rank
    print("  pylate.rank.rerank exists:", hasattr(rank, "rerank"))
except Exception as ex:
    print("  no pylate.rank:", ex)
try:
    from pylate import scores as pscores
    print("  pylate.scores fns:", [x for x in dir(pscores) if not x.startswith('_')][:8])
except Exception as ex:
    print("  no pylate.scores:", ex)
