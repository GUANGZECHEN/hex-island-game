# Compact action labels

Approved UI-only request, 2026-11-15: keep desktop action buttons compact instead of stretching them to accommodate full phrases.

Visible construction labels are Road, Settlement, City and Develop. Setup and paid construction share the same short nouns. Other lengthy actions lose redundant verbs; End turn and Undo last action retain their wording. Full action names remain in hover titles and accessible labels. Costs remain visible and are also provided as an accessible description.

Each button uses an icon + short label row with resource costs in a second row. The command tray width, adjacent hand, legal-action visibility, handlers, game rules, safe Undo order and network protocol are unchanged.

Validation: `tests/compact-actions.test.ts` tests mappings, names, unchanged handlers and source contracts. `scripts/qa-compact-actions.mjs` checks real setup/Undo controls plus representative cost-button layout fixtures at desktop and phone widths. Standard publication workflow still checks the live multiplayer game and 3D renderer. The layout fixtures do not simulate a paid game action or modify authoritative state.
