# Public play report

- Release / build / scenario / seed / session:
- Outcome and turn (normal in-game loss, action rejection, query/input error, and technical failure are separate):
- Public transcript/artifact path:

## Finding

### Intention

State the intended action and its public rationale in a short sentence.

### Observed execution

Record accepted/rejected, actual position or source/destination/count, turn, revision, requestId, eventId and the source log path/line. Quote the public event or result summary. A legal query or preview is a prediction, not evidence of execution.

### Inference

State what the observed result suggests and what remains unverified. Do not request private model reasoning, private GameState, hidden enemy positions or RNG.

## Reproducible evidence

```sh
node scripts/extract-public-evidence.mjs output/claude-playtest-20260927-v168-seed6/logs/transcript.jsonl > output/public-evidence.jsonl
```

The v1.6.8 source log records SF-42 (`special-forces-42`) suppressing oilfield-north at T30, revision325, request `T30-end`, event-3968; event-3969 recovers that facility. It records 30 people returning from farm-4 to city-4 at T54, revision533, request `t54-f4-0`, event-6423. The following population-transfers query at revision533 makes transfer from city-4 legal with max30. It does not record that transfer being executed. These statements are evidence about that recorded play, not v1.6.9 balance results.
