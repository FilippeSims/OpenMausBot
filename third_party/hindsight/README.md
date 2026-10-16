# Hindsight for OpenMausBot

This distribution uses the real Hindsight 0.10.3 engine, licensed under MIT
(see LICENSE), from https://github.com/vectorize-io/hindsight at commit
eb6df499d35300e5b2f3f029b2e6adda04ed90f8.

The Mausbot profile indexes canonical bot notes and approved team memories.
It uses Hindsight's hybrid retrieval, vector index, document replacement,
revision tags and RRF reranking. Generative extraction, observations, reflect,
the unrestricted MCP server and cloud-provider SDKs are omitted. This profile
does not implement every Hindsight feature.

The reviewed build patches replace Transformers' tokenizer loader with the
Rust tokenizers implementation using the same bundled XLM-R tokenizer, and
limit ONNX inference to two CPU threads with no memory arena. All pooling,
normalization and query/passage prefixes remain upstream code. This reduces
dependencies; it is not a claim of better retrieval quality than upstream.
The model-free LLM factory and its legacy client getters are narrowed to the
upstream NoneLLM implementation, and the disabled MCP extension imports its
FastMCP type only during type checking. These patches avoid importing optional
cloud SDKs on startup; they do not replace the memory engine.

On macOS the PostgreSQL 18.1.0 archive's Homebrew load paths are relocated at
build time and linked to the OpenSSL 3 libraries from the pinned psycopg2 wheel.
The result is ad-hoc signed before the app's normal signing step. The included
OpenSSL, PostgreSQL and pgvector license files identify these distributions.

The model is Microsoft's multilingual-e5-small (MIT), exported to quantized
ONNX by Xenova. See https://huggingface.co/intfloat/multilingual-e5-small and
https://huggingface.co/Xenova/multilingual-e5-small. The model revision and file
SHA-256 hashes are pinned in model.json. No first-run model download is needed.

Build with uv 0.9.9 installed on the build machine:

    node scripts/prepare-hindsight.mjs

Explicit targets: darwin-arm64, darwin-x64, win32-x64, linux-x64. Downloads
occur during the build. Engine and runtime wheels use hash-locked requirements.
CPython 3.11.14 comes from the hash-locked Python standalone distribution in
python.json. macOS PostgreSQL archives are also hash-locked in postgres.json. Python package
dist-info license files and the standalone Python licenses stay in the bundle;
PostgreSQL/pgvector distribution licenses are included by pg0-embedded.

At runtime, an app-owned subprocess uses a private loopback port and bearer
token. Its database lives in the app data directory, never the install folder.
Closing the parent pipe shuts down Hindsight and its embedded PostgreSQL.
The bundled runtime does not inherit the user's AI provider credentials.

macOS and Windows builds must be validated on native CI runners. The pinned
pg0 wheels set the OS minimum (currently macOS 14 arm64, macOS 15 Intel and
Linux glibc 2.35). The desktop installers require macOS 15+ for both architectures.
This is not a guarantee for older operating systems.
