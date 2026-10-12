#!/usr/bin/env bash
# Одна команда: ядро → Excel → сайт (двойник, расчёт, пример) → GitHub Pages.
# Использование: ./publish.sh "что изменилось"   (без аргумента — только сборка, без выкладки)
set -euo pipefail
cd "$(dirname "$0")"
node build-engine.mjs >/dev/null 2>&1
node --experimental-strip-types --no-warnings /home/claude/model/v2/export_engine.ts
( cd /home/claude/model/v2 && python3 build_xlsx_v2.py >/dev/null )
python3 /mnt/skills/public/xlsx/scripts/recalc.py /home/claude/model/Модель_расчёт_v2.xlsx 90 | tail -2
python3 site/build_site.py --strict
[ $# -eq 0 ] && { echo "собрано в web/ (без выкладки)"; exit 0; }
DST=/home/claude/ventilation
cp web/index.html web/calc.html web/example.html web/model_raschet.xlsx "$DST"/
cd "$DST"
git add -A
git commit -q -m "$1" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PMshDRnGPtrDWUS9FH4Pvw" || echo "нет изменений"
git push -q origin main && echo "выложено: https://bliizi.github.io/ventilation/"
