#!/bin/sh
set -eu

directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export PATH="/Applications/Docker.app/Contents/Resources/bin:$HOME/.docker/bin:$PATH"
if ! command -v docker >/dev/null 2>&1; then
  printf 'Instale o Docker Desktop antes de iniciar o Hindsight.\n' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  open -a Docker
  printf 'Aguarde o Docker Desktop iniciar e abra este arquivo novamente.\n' >&2
  exit 1
fi

docker compose -f "$directory/compose.yaml" up -d --wait --wait-timeout 600
printf '\nHindsight local pronto, sem Groq, Ollama ou chave de API.\n'
printf 'API: http://127.0.0.1:8888\nPainel: http://127.0.0.1:9999\n'
