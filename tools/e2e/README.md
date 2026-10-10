# Browser regression tests

Static analysis kept telling me the load paths were fine. They were not: a build
loaded from a pin or from Save/Load was priced with the *previous* build's wildcard
card slots, overstating DPS by 60% on the test build. Nothing short of driving a
real browser found it, and three earlier "fixes" written from reading the source
turned out not to touch the reported bug at all.

So these are the tests that only a browser can run. They are deliberately NOT in
`npm test` or the deploy workflow — they need a running stack and a real Chrome, and
a browser download does not belong in the deploy path. Run them by hand when a load
path, the compare panel, or the editor's state handling changes.

## Running

Three terminals, or background the first two:

```sh
cd open-ps-calc-backend/backend && npm start          # :4000
cd open-ps-calc-frontend/frontend && npm run dev      # :5173
cd tools/e2e && npm install && node wildcard-carryover.mjs
```

Pass a URL to test somewhere else, production included:

```sh
node wildcard-carryover.mjs https://openpscalc.com/
```

`playwright-core` drives the Chrome already installed on the machine (`channel:
"chrome"`), so there is no browser to download.

## What each one covers

- **wildcard-carryover.mjs** — pins and saves a build with a slotted weapon and no
  wildcard mix, turns wildcard mix on, then loads the build back both ways. The
  loaded build must price at its own DPS, not the live build's. This is the
  regression that produced two separate player reports ("Load doesn't work",
  "loading pinned builds is not working"), because a wrong number looks like
  nothing happened.

- **damage-branch-labels.mjs** — the damage buttons must say what they compute. With a
  skill selected they read *Skill / Normal hit / Critical hit*, and two of those looked
  like a pair and were not: “Normal hit” was the AUTO ATTACK (different attack, no
  skill ratio) while “Critical hit” was the SKILL critting (same attack, ratio
  applied) — Sonic Blow Lv10 read 2936 / 296 / 2936. The load-bearing assertion is that
  the button now called “Auto attack” shows the same damage as selecting no skill at
  all (296 = 296), which is what makes the label honest rather than merely different.
  Uses Sonic Blow, not Shadow Slash from the report: Shadow Slash cannot crit, so it
  only ever renders two buttons.

- **editor-columns.mjs** — the editor is a CSS multi-column layout, and multicol
  balances by HEIGHT: one panel taller than the balanced height drags that height up
  until the last column has nothing left to hold, and a panel cannot be split to
  relieve it (border + background, so a split box looks broken). The manual-edit
  fields inside the Target panel cost the fourth column at full width. Collapsing them
  fixed the default but not opening them; packing them tighter did not reach it either,
  because the budget shrinks as the viewport grows. They are their own panel now.
  Asserts 4 columns for monster, custom, AND custom-with-fields-open at 1800 / 1920 /
  2200 / 2560 — the expanded case especially, since it regressed twice. Measure with a
  FRESH context per width: the collapse choice lives in localStorage and reusing one
  gives a contaminated reading (it gave me one I reported before catching it).

- **manual-enemy-edits.mjs** — the hand-typed enemy adjustments, which live inside
  Custom stats. Copies a real monster in first so the numbers mean something, then
  checks a flat DEF delta and a percentage resistance both cut damage, that AGI drags
  FLEE with it (it was inert when first shipped), that the badge counts the active
  edits, and two things that matter most: that edits set here do NOT follow you back
  to the Monster tab — hidden state must never move a number — and that with
  everything at 0 the damage is exactly the un-edited figure. The leak assertion is
  deliberately made against a DAMAGE-affecting edit: an earlier version left only AGI
  set, which moves hit chance, and a mutation run showed it passing against a real
  leak.

- **custom-target-copy-mob.mjs** — copying the selected monster into the custom
  target must land every field on what the monster actually has, checked against the
  same /data/mobs the editor reads. Orc Warrior on purpose: its race is “DemiHuman” in
  the vanilla mob DB and “Demi-Human” in the dropdown and every race bonus, so if the
  copy ever bypasses the loader’s alias the select lands on a value it has no option
  for and reads blank. Also prices both ways — a copied target must deal exactly the
  damage the monster it came from does, and that the Survivability panel — which used
  to vanish silently in custom mode — prices the copy identically (same Effective HP)
  while a target left at ATK 0 explains itself instead of quoting zero.

- **mounted-spear-size.mjs** — a spear does 75% to Medium targets on foot and 100% mounted (status.c:1856 copies the Large column over the Medium one). That rule was never implemented, and because the Riding Peco Peco checkbox already drove the ASPD penalty and Spear Mastery’s mounted ATK, ticking it moved numbers and hid the gap. Drives the real checkbox and reads the breakdown: the 75% row is there on foot and gone mounted, the damage rises, and a two-handed sword is unaffected either way.

- **ardent-helm.mjs** — Ardent Helm (8417) is a PS custom the item API has no entry
  for, so it was hand-written from the wiki and shipped with slots: 0, which is what
  the player hit: no card option. Checks the helm contributes exactly one card slot
  (by delta, so the weapon’s own slots cannot mask it), that its Defense 3 and Mdef +2
  reach the stat panel, and that Magnum Break’s lingering weapon buff reads Holy with
  the helm and Fire without — the half of its description the engine used to skip.

- **job-gated-bonuses.mjs** — item effects written for one class must not reach the
  others. Poring Dagger gives its attack speed only to a Novice or Super Novice, but
  the evaluator could not resolve `BaseJob`, `BaseClass` or any `Job_*` constant, and
  an unresolvable condition FAILS OPEN — so 50 of the 51 job-gated items in the DB
  applied to every class. Reads the ASPD a player sees, Poring Dagger against a plain
  Main Gauche (same Knife type, so any difference is the item), across six classes.

- **wildcard-mode-roundtrip.mjs** — which slots are in wildcard mix is the player's
  choice, so it has to travel with the build. It used to be inferred from
  wildcard_slots, and the inference cannot represent the ordinary case: switching to a
  wildcard mix deliberately leaves the real cards equipped so switching back restores
  them, and a slot with real cards reads as "not in wildcard mode". A build shared or
  saved mid-experiment came back with the cards — 100 HIT on a Phreeoni Card. Covers
  the share link, Save/Load and pins, plus a link carrying no wildcard_mode, which must
  still be inferred so links players already sent keep working.

- **wildcard-stat-readout.mjs** — the stats panel must track the Cards / Wildcard mix
  toggle. A weapon carded with a Mummy Card kept its +20 HIT in the readout after the
  slot was switched to a wildcard mix, because the damage request built its own
  card override while the status, the equip-bonus badges and the breakpoints read the
  un-overridden build. Drives the real toggle both ways and compares the shown HIT
  against the same /calculate/status the hit chance comes from, so the test states the
  property (panel agrees with the build it prices) rather than a total.

- **pin-load-visible.mjs** — clicking Load on a pinned build must visibly take you to
  that build. State assertions all passed while this was broken: the build loaded, and
  then `onCalculate` pulled the results panel back into view, so the user was scrolled
  straight back to the compare table and saw nothing change. Asserts the outcome a
  person can see — the button acknowledges the click, the editor ends up on screen, and
  it shows the pinned build.

- **double-attack-visible.mjs** — Double Attack must be named on screen with its proc
  chance. It was modelled and folded into the DPS for as long as the engine has existed,
  and rendered nowhere, so a player reported it as unimplemented. Covers the dagger skill
  proc and Sidewinder Card's `bDoubleRate` on a Monk's knuckle.

- **plagiarised-waterball.mjs** — covers two reports from one player. Typing "spear boom" into
  the skill picker must select **Spear Boomerang**: the scraped PS skill DB labelled it "Sonic
  Wave", and because the picker also searches the vanilla description the query DID return a
  row, just under a name that exists nowhere on PS — which reads as "the skill is missing". And
  a Rogue's Water Ball must offer 10 ranks and price them (Lv10 / Lv5 ≈ 400% / 250%), while a
  Wizard's own Water Ball still stops at 5.

- **equip-legality.mjs** — the three rules the 2026-09-24 QA sweep found sitting unread in
  the data. A two-handed weapon must leave no off-hand (a Claymore with a four-Hydra dagger
  in the left hand read +80%), an item's base-level requirement must exclude it (a level-1
  character wore a level-33 Claymore), and a skill must say when your weapon cannot cast it
  (Double Strafe priced happily with a dagger). Each is checked both ways — the one-handed
  weapon that must KEEP its off-hand, and the bow that must not be warned about — because
  all three fixes are the kind that are easy to make too aggressive.

- **holy-strike-visible.mjs** — the Holy Strike proc has to be on screen, not just in the DPS:
  it was computed and folded into the total for nine days while rendering nowhere, and players
  reported the card combo as unimplemented twice. It also now covers the 2026-09-25 report that
  the proc ignored crit — the panel must show a normal AND a critical per-proc figure, the
  critical being the larger and quoted at the character's real crit rate.

- **item-picker-duplicates.mjs** — searching the headgear slot for "apple" must return
  exactly one Apple of Archer, the real 2285, and none of the three copies Payon Stories
  does not have. Checked in the search box because that is where the wrong pick happens,
  with a control search ("hat", 50 results) so a hiding rule that went too far would fail
  rather than look like a pass. It also covers the follow-on report — typing a PARTIAL query
  must not auto-equip anything, because the picker used to fire as soon as one row was
  enabled and a level-1 build greys most of the list.

## These go stale silently

Being outside `npm test` is what makes them cheap to keep, and also what let
`double-attack-visible.mjs` assert a number that had been wrong for hours: the Sidewinder
expectation still said 5% after the weapon restriction was lifted, and nothing re-ran it.
**Run ALL of them (every .mjs here) whenever you change what they cover**, not just the one you are working on:

```sh
for f in tools/e2e/*.mjs; do node "$f" || echo "FAILED: $f"; done
```

## A note on what these are for

Both of these exist because reading the source said everything was fine. Assert what a
person would see, not what the state says — the two reports that produced this directory
were both cases where the state was correct and the screen was not.
