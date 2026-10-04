# Best Practices

Working conventions for None-Curve. Follow these when changing the app.

## Language

- **The web app UI is English only.** No Chinese (or other CJK) text anywhere a user can see or hear it: visible text, button labels, placeholders, `title`, `aria-label`, `alt`, error messages, and the page `<title>`.
- Keep all source under `src/` in English, including code comments, so the rule can be checked mechanically.
- Project docs (README, `docs/*.zh.md`) may stay bilingual; this rule applies to the app itself.

Check before committing (should print nothing):

```bash
grep -rnP '[\x{3000}-\x{9fff}\x{ff00}-\x{ffef}]' src index.html
```

**界面语言：** 网页 UI 必须全英文，不得出现任何中文；`src/` 内的代码与注释也保持英文。文档可以中英双语。
