"""Harvest the live Payon Stories monster DB and diff it against ours.

    python fetch_ps_mobs.py            # harvest + report (writes snapshots/ps_mob_index.json)
    python fetch_ps_mobs.py --report   # report only, from the existing snapshot

There is no monster API. `/api/pc/item` is the only endpoint of that shape -
`/api/pc/{mob,monster,mobs,skill,map,steal,mvp}` all return the 404 page, and the
control panel's monster view 302s to a login. What exists instead is the tools
site's Monster Database, a static Next.js page that ships its data compiled into a
webpack chunk and filters it in the browser. `?q=rsx` is a client-side filter, not
a query: the served HTML contains no monster data at all.

So the harvest is: resolve the current buildId, read the build manifest, find the
chunk carrying the blob, and parse it out. The chunk hash changes on every deploy,
which is why none of it is hardcoded.

WHAT THIS CAN AND CANNOT CHECK

Per monster the blob carries hp, lv, element, race, size, type, sprite, exp.base,
exp.job, mvpExp, naturalSpawn, drops - and `stats`, which is ONLY Agi and Dex.
That is everything the page needs, because both figures it advertises derive from
those alone (100% HIT = Level + AGI + 20; 95% FLEE = Level + DEX + 75).

It carries no DEF, no MDEF, no ATK range, no STR/VIT/INT/LUK and no skill kit, so
this script cannot check any of them. Those come from a player's in-game
monster-info readout (one monster at a time, and it still omits skills) or from a
staff-supplied monsters.json. The report ends by naming that blind spot rather
than leaving a clean run to imply the whole database was verified.

TWO SCALE TRAPS, both handled below and both confirmed against an in-game readout:

  * EXP is pre-rate. Our exp/jexp are floor(theirs * 1.5); mvp_exp is 1:1. The
    game showed RSX 0806 at base 46,515 / job 48,016 where this source says
    31,010 / 32,011. Ours are what players actually receive.
  * `Agi: 0` on plants, mushrooms and treasure chests is a representation
    difference, not a nerf - we carry 1 there.
"""
import sys
import json
import math
import re

from common import get, load, save, snapshot, PS_DATA
import os

BASE = "https://tools.payonstories.com"
EXP_RATE = 1.5
OUR_DB = os.path.join(PS_DATA, "ps_mob_db.json")


def harvest():
    """Pull the monster blob out of whatever chunk currently carries it."""
    page = get(BASE + "/mob")
    m = re.search(r'"buildId":"([^"]+)"', page)
    if not m:
        sys.exit("could not find buildId on /mob - the page shape changed")
    build_id = m.group(1)
    date = re.search(r'"buildDate":"([^"]+)"', page)
    print(f"  buildId {build_id}  buildDate {date.group(1) if date else '?'}")

    manifest = get(f"{BASE}/_next/static/{build_id}/_buildManifest.js")
    chunks = sorted(set(re.findall(r"static/chunks/[\w./-]+\.js", manifest)))
    if not chunks:
        sys.exit("build manifest listed no chunks - the page shape changed")

    # The blob is identified by content, not by name: hashes change every deploy
    # and the chunk number has moved before.
    for path in chunks:
        body = get(f"{BASE}/_next/{path}")
        if '"naturalSpawn"' not in body:
            continue
        print(f"  blob in {path} ({len(body):,} bytes)")
        return build_id, _extract(body)
    sys.exit(f"no chunk of {len(chunks)} carried the monster blob")


def _extract(body):
    """Scan the object literal containing the mobs out of minified JS.

    Brace counting has to be string-aware or a `{` inside a monster name ends the
    scan early, and JS `\'` escapes are not valid JSON.
    """
    i = body.index('"1001":{')
    start = body.rindex("{", 0, i)
    depth, in_str, esc, end = 0, False, False, None
    for j in range(start, len(body)):
        c = body[j]
        if in_str:
            if esc:
                esc = False
            elif c == chr(92):
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                end = j + 1
                break
    return json.loads(body[start:end].replace(chr(92) + "'", "'"))


def report(theirs):
    ours = load(OUR_DB)["mobs"]
    common = [k for k in theirs if k in ours]
    print(f"\n{len(theirs):,} monsters live, {len(ours):,} ours, {len(common):,} in both\n")

    rows, rounding = [], []
    for k in common:
        t, o = theirs[k], ours[k]
        for field, live, held in (
            ("hp", t["hp"], o["hp"]),
            ("exp", math.floor(t["exp"]["base"] * EXP_RATE), o["exp"]),
            ("jexp", math.floor(t["exp"]["job"] * EXP_RATE), o["jexp"]),
            ("mvp_exp", int(t["mvpExp"] or 0), o["mvp_exp"]),
            ("level", t["lv"], o["level"]),
            ("agi", t["stats"]["Agi"], o["stats"]["agi"]),
            ("dex", t["stats"]["Dex"], o["stats"]["dex"]),
            ("race", t["race"].replace("-", ""), o["race"].replace("-", "")),
            ("size", t["size"], o["size"]),
            ("element_level", t["element"][1], o["element_level"]),
        ):
            if live == held:
                continue
            # Their 0 means "not published", not "zero" - plants and treasure
            # chests read Agi 0 where we carry 1, and hp 0 appears on 53 mobs.
            if live == 0 and held in (0, 1):
                continue
            if field in ("exp", "jexp") and abs(live - held) == 1:
                rounding.append((k, o["name"], field, held, live))
                continue
            rows.append((k, o["name"], field, held, live))

    if rows:
        print(f"{len(rows)} value(s) differ from live:")
        print()
        for mid, name, field, held, live in sorted(rows, key=lambda r: int(r[0])):
            print(f"  {mid:>6} {name[:24]:<24} {field:<14} ours {str(held):>10} -> live {str(live)}")
    else:
        print("Every field this source publishes matches.")

    # Kept out of the list above on purpose. 455 rows of +/-1 would bury the handful
    # of real retunes this script exists to surface, and the rounding rule behind
    # them is still only one observation deep: the game showed RSX 0806 at job EXP
    # 48,016 where we held 48,017, i.e. floor rather than round. Two more in-game
    # readouts on mobs where the conventions disagree (Scorpion base 431 vs 430,
    # Poring job 2 vs 1) would settle whether to rewrite the lot.
    if rounding:
        print()
        print(f"{len(rounding)} EXP value(s) differ by exactly 1 - rounding convention, not a retune.")
        print("  We appear to round where the server floors; unconfirmed beyond RSX 0806.")
        if "--rounding" in sys.argv:
            for mid, name, field, held, live in sorted(rounding, key=lambda r: int(r[0])):
                print(f"  {mid:>6} {name[:24]:<24} {field:<14} ours {held:>10} -> live {live}")
        else:
            print("  Re-run with --rounding to list them.")

    new = [k for k in theirs if k not in ours]
    if new:
        print(f"\n{len(new)} monster(s) live that we do not have:\n")
        for k in sorted(new, key=int):
            t = theirs[k]
            print(f"  {k:>6} {t['name'][:24]:<24} lv{t['lv']:<4} hp {t['hp']:>9,} {t['race']}/{t['size']}")
        print("\n  Adding these needs DEF and ATK, which this source does not carry.")

    print("\nNOT CHECKED - this source publishes none of it:")
    print("  DEF, MDEF, ATK range, STR/VIT/INT/LUK, and every monster's skill kit.")
    print("  Those need an in-game monster-info readout (one mob at a time, and it")
    print("  omits skills too) or a staff monsters.json. A clean run above does NOT")
    print("  mean the database is verified.")


def main():
    snap = snapshot("ps_mob_index.json")
    if "--report" in sys.argv:
        theirs = load(snap)["mobs"]
    else:
        build_id, theirs = harvest()
        save(snap, {"_source": f"{BASE}/mob webpack blob", "_build": build_id, "mobs": theirs})
        print(f"  wrote {snap} ({len(theirs):,} monsters)")
    report(theirs)


if __name__ == "__main__":
    main()
