# Battleflow

**See only what matters for the phase you're in.**

Battleflow is a mobile-first companion for Warhammer 40,000 10th edition. Pick your current game phase—Command, Movement, Shooting, Charge, Fight, or Battleshock—and get a scannable reference of every weapon profile, ability, stratagem, and rule on your roster that applies *right now*, grouped by unit.

No hunting through PDFs or flipping pages mid-turn.

## What you get

- **Phase-first navigation** — Tap the phase you're playing; everything else stays out of the way.
- **Roster at a glance** — Units, weapons, abilities, and stratagems for that phase in one dense, readable layout.
- **Stratagems, detachment rules, and army rules** — surfaced in the same view alongside your units.
- **Quick details** — Tap any row to open a bottom sheet with full stats, timing, conditions, and modifiers without leaving the phase view.
- **37 factions** — Full game data from BSData 

## What Battleflow is not

Battleflow is a **reference sheet**, not a game engine. It does not track model positions, wounds, movement, or dice. It helps you remember what your army *can do* in the current phase—not simulate the battle.

## How to use it

1. Export your army list from the GW app, New Recruit, or any tool that produces the standard GW format.
2. Open Battleflow and paste the list text into the import box.
3. Battleflow detects your faction automatically, or lets you pick from the full list.
4. Select the **active phase** (CMD → MOV → SHO → CHG → FGT → BSK).
5. Scan units and stratagems for everything relevant to that phase.
6. **Tap any item** to read full rules, keywords, CP cost, and conditions in the detail drawer.
7. Change phase anytime; the list updates instantly.

## Try it

**Local development**

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Status

Live: roster import, phase filtering, stratagems, detachment rules, and army rules for all 37 factions. Live CP tracking and roster persistence across sessions are not yet implemented.

## Feedback

Issues and ideas welcome on [GitHub](https://github.com/yungnick/Battleflow/issues).

---

*Developers: see [`AGENTS.md`](AGENTS.md) for data pipeline architecture and game data update instructions, and [`design-reference/README.md`](design-reference/README.md) for UI specs.*
