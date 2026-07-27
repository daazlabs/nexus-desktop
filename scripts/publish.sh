#!/usr/bin/env bash
# Publica um release do nexus-desktop (tira do estado draft). Separado de
# propósito de release.sh — é a única acção pública/irreversível (dispara
# auto-update para quem já tem a app instalada), por isso nunca corre
# automaticamente a seguir ao build.
#
# Uso: scripts/publish.sh vX.Y.Z
set -euo pipefail

TAG="${1:?Uso: scripts/publish.sh vX.Y.Z}"
REPO="daazlabs/nexus-desktop"

echo "== A verificar o build do release mais recente =="
RUN=$(gh run list --workflow=release.yml --repo "$REPO" --limit 1 --json status,conclusion)
ST=$(echo "$RUN" | python3 -c "import json,sys; d=json.load(sys.stdin)[0]; print(d['status'])")
CO=$(echo "$RUN" | python3 -c "import json,sys; d=json.load(sys.stdin)[0]; print(d.get('conclusion') or '')")

if [ "$ST" != "completed" ]; then
  echo "ERRO: o build ainda está a decorrer (status=$ST). Espera terminar antes de publicar."
  exit 1
fi
if [ "$CO" != "success" ]; then
  echo "ERRO: o build não terminou com sucesso (conclusion=$CO). Não publicar."
  exit 1
fi

echo "Build OK. A publicar $TAG..."
gh release edit "$TAG" --repo "$REPO" --draft=false
echo "== Publicado: https://github.com/$REPO/releases/tag/$TAG =="
