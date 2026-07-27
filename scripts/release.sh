#!/usr/bin/env bash
# Release do DaazNexus: envia o repo web + faz o bump/commit/tag/push do
# Desktop. Pára aqui de propósito — NUNCA publica o release (isDraft=false),
# esse passo é sempre manual e separado (ver publish.sh), porque é a única
# acção aqui que é pública/irreversível para os utilizadores finais.
#
# Uso: scripts/release.sh [patch|minor|major]   (default: patch)
set -euo pipefail

BUMP="${1:-patch}"
WEB_DIR="/home/daazlabs/projects/daaznexus"
DESKTOP_DIR="/home/daazlabs/projects/daaznexus/nexus-desktop"

echo "== 1/6 Push do repo web =="
cd "$WEB_DIR"
if [ -n "$(git status --porcelain)" ]; then
  echo "ERRO: há alterações por commitar em $WEB_DIR — este script não commita nada aqui, só envia. Aborta."
  exit 1
fi
git push origin master
echo

echo "== 2/6 Build de sanidade (Desktop) =="
cd "$DESKTOP_DIR"
npm run build
echo

echo "== 3/6 Bump de versão ($BUMP) =="
NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version)
NEW_VERSION="${NEW_VERSION#v}"
echo "Nova versão: $NEW_VERSION"
echo

echo "== 4/6 Commit =="
git add -A
git commit -m "chore: bump version to $NEW_VERSION"
echo

echo "== 5/6 Tag =="
git tag "v$NEW_VERSION"
echo

echo "== 6/6 Push (dispara o build no GitHub Actions) =="
git push origin main --tags
echo

echo "== FEITO =="
echo "Tag: v$NEW_VERSION"
echo "Build a decorrer: https://github.com/daazlabs/nexus-desktop/actions"
echo "Publicar (passo manual à parte): scripts/publish.sh v$NEW_VERSION"
