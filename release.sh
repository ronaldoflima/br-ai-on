#!/usr/bin/env bash
set -e

BUMP=${1:-patch}  # patch | minor | major

if [[ ! "$BUMP" =~ ^(patch|minor|major)$ ]]; then
  echo "Uso: ./release.sh [patch|minor|major]"
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Erro: working tree não está limpa. Commit ou stash as mudanças primeiro."
  exit 1
fi

CURRENT=$(node -p "require('./dashboard/package.json').version")

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
case "$BUMP" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"
TAG="v$NEW_VERSION"

# Atualiza package.json e package-lock.json
sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" dashboard/package.json
sed -i "0,/\"version\": \"$CURRENT\"/s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" dashboard/package-lock.json

git add dashboard/package.json dashboard/package-lock.json
git commit -m "chore: bump version to $TAG"
git tag "$TAG"

echo "Versão $CURRENT → $NEW_VERSION"
echo "Commit e tag $TAG criados."
echo ""
echo "Para publicar:"
echo "  git push && git push --tags"
echo "  gh release create $TAG --generate-notes"
