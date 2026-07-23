# Reflection

1. **Assumptions:** The portal is a server-rendered HTML application with a conventional login form and cookie session. The public API uses `{ data, meta }` envelopes and null for unavailable model fields.
2. **Hardest part:** The live portal could not be reached, while the specification requires recon before selectors are finalized. The implementation stays useful by making paths and credentials configurable and by failing clearly when generic parsing cannot identify the expected data.
3. **With another day:** I would capture real portal fixtures, replace generic selectors with confirmed selectors, verify pagination and hidden endpoints, and exercise session expiry against the live system.
4. **Mistake avoided:** Treating the draft model fields or guessed portal URLs as authoritative would make a seemingly complete adapter brittle and misleading.
5. **Self-critique:** The generic parser is intentionally broad but cannot guarantee compatibility with the real portal until fixtures are available. The next improvement should be fixture-driven parser tests based on recon rather than adding more speculative fallbacks.
