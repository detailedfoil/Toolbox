#!/bin/bash
# Commits the names, descriptions and photos found so far (called part-way through a run and again at the end).
# $1 = commit message to use when the run hasn't written its own summary yet.
[ -f tools/product-search/data/web-names.json ] || exit 0
paths=(tools/product-search/data/web-names.json)
[ -f tools/product-search/data/desc-words.json ] && paths+=(tools/product-search/data/desc-words.json)
for d in tools/product-search/photos tools/product-search/descriptions; do [ -d "$d" ] && paths+=("$d"); done
git add -- "${paths[@]}"
if git diff --cached --quiet; then echo "Nothing new to save"; exit 0; fi
git config user.name "github-actions[bot]"
git config user.email "41898283+github-actions[bot]@users.noreply.github.com"
if [ -n "$1" ]; then git commit -q -m "$1"
elif [ -f "$RUNNER_TEMP/names-commit.txt" ]; then git commit -q -F "$RUNNER_TEMP/names-commit.txt"
else git commit -q -m "Product names and photos (run stopped early) [skip ci]"; fi
for i in 1 2 3; do
  git push -q && exit 0
  sleep 5
  git pull -q --rebase --autostash || { echo "Couldn't fit this run's progress on top of the latest main"; git rebase --abort 2>/dev/null; }
done
exit 1
