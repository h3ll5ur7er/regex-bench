# UX principles

regexr and regex101 are excellent. To beat them we have to be *clearer*, not busier.

1. **One screen, no fluff.** The pattern is the hero: large, monospace, at the top. The text is directly
   below. Results are next to the text, not under a fold. No landing page, no sign-up, no ads.
2. **Explain in place.** Every token of the pattern is coloured by kind and hovering it explains it. The same
   colour is used in the explanation tree, the matches and the diagram. Learn the colour once, read it
   everywhere.
3. **Groups are a colour, not a number.** Group 1 is always the same hue in the pattern, the text highlights,
   the match table and the diagram. Named groups show their name.
4. **Show, don't tell, then tell on request.** Defaults hide nothing that matters, but documentation lives one
   keypress away (`?`), filtered to the current flavor.
5. **Never freeze.** Every run is budgeted. A slow pattern shows a calm, specific message ("stopped after
   1.5 s: catastrophic backtracking likely in `(a+)+`") instead of a frozen tab.
6. **Keyboard first.** Every action has a shortcut; focus order follows the reading order.
7. **Errors point.** Diagnostics underline the exact span and say what to do.
8. **Light and dark, both designed.** Not an inverted afterthought.
9. **Fast first paint.** The app shell renders before any WASM is loaded; WASM loads lazily.
