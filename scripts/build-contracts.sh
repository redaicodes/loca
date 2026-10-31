#!/usr/bin/env bash
# Build deployable wasm for both contracts into contracts/target/near/<crate>/.
set -euo pipefail
cd "$(dirname "$0")/../contracts"
for crate in loca test-token; do
  (cd "$crate" && cargo near build non-reproducible-wasm --no-abi)
done
ls -la target/near/*/*.wasm
