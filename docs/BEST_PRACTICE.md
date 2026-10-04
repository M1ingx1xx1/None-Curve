# Best Practices

**English** · [中文](BEST_PRACTICE.zh.md)

Working conventions for None-Curve. Follow these when changing the app or its documentation.

## App language

- **The web app UI is English only.** No Chinese (or other CJK) text anywhere a user can see or hear it: visible text, button labels, placeholders, `title`, `aria-label`, `alt`, error messages, and the page `<title>`.
- Keep all source under `src/` in English, including code comments, so the rule can be checked mechanically.

Check before committing (should print nothing):

```bash
grep -rnP '[\x{3000}-\x{9fff}\x{ff00}-\x{ffef}]' src index.html
```

## Documentation language

- Every document has **separate English and Chinese editions**; never mix both languages in one file.
- English is the default: `NAME.md` is English, `NAME.zh.md` is Chinese.
- Each edition starts with a language switch linking to the other, for example `**English** · [中文](NAME.zh.md)`.
- When you change one edition, update the other in the same change so they stay in step.
- In Chinese documents, refer to interface elements by their English labels (the UI is English), with a Chinese explanation where helpful.

Current pairs: `README.md` / `README.zh.md`, `docs/USER_GUIDE.md` / `docs/USER_GUIDE.zh.md`, `docs/PRD.md` / `docs/PRD.zh.md`, `docs/PHASE.md` / `docs/PHASE.zh.md`, `docs/BEST_PRACTICE.md` / `docs/BEST_PRACTICE.zh.md`.
