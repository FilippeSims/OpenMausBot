"""Local CPU profile for Hindsight 0.10.3 (MIT).

Preserves the upstream ONNX pooling, normalization and query/passage prefixes.
Only its tokenizer loader is replaced, so neither Transformers nor model
downloads are needed on an end user's machine.
"""
from pathlib import Path
import numpy as np
from tokenizers import Tokenizer


class LocalAutoTokenizer:
    @classmethod
    def from_pretrained(cls, directory):
        instance = cls()
        instance.tokenizer = Tokenizer.from_file(str(Path(directory) / "tokenizer.json"))
        return instance

    def __call__(self, texts, *, padding, truncation, max_length, return_tensors):
        if return_tensors != "np" or not padding or not truncation:
            raise ValueError("Unsupported Mausbot tokenizer call")
        self.tokenizer.enable_truncation(max_length=max_length)
        # XLM-R's padding token is <pad> (ID 1), as in the original tokenizer.
        self.tokenizer.enable_padding(pad_id=1, pad_token="<pad>")
        encoded = self.tokenizer.encode_batch(texts)
        return {
            "input_ids": np.array([item.ids for item in encoded], dtype=np.int64),
            "attention_mask": np.array([item.attention_mask for item in encoded], dtype=np.int64),
        }
