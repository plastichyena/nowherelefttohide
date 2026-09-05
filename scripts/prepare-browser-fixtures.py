"""Prepare the Playwright CLI expression from validated Core benchmark saves.

python scripts/prepare-browser-fixtures.py --fixtures output/v152-validation
npx --package @playwright/cli playwright-cli -s=isolated run-code --filename=output/browser-fixtures.js
Use a dedicated browser profile: this replaces its test autosave slot.
"""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--fixtures', default='output/v152-validation')
parser.add_argument('--out', default='output/browser-fixtures.js')
args = parser.parse_args()
fixtures = []
for name in ['standard-early', 'reachable-wave-turn-20', 'reachable-wave-turn-50', 'reachable-wave-turn-51']:
    root = Path(args.fixtures)
    state = json.loads((root / (name + '.json')).read_text(encoding='utf-8'))
    occupied = {(unit['position']['q'], unit['position']['r']) for unit in state['units']}
    neighbors = [(25, 25), (27, 25), (26, 26), (25, 26), (26, 24), (27, 24)]
    destination = next((position for position in neighbors if position not in occupied), None)
    fixtures.append(dict(name=name, save=(root / (name + '.save.txt')).read_text().strip(), turn=state['turn'], units=len(state['units']), facilities=len(state['facilities']), events=len(state['events']), destination=destination))
source = (Path(__file__).parent / 'browser-fixture-performance.js').read_text(encoding='utf-8')
output = Path(args.out)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(source.replace('/* FIXTURES */ []', json.dumps(fixtures)), encoding='utf-8')
print(output)
