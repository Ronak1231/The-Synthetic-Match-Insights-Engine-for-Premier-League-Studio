"""Natural-language generation for chat answers when no LLM is used (or as the fallback for one).

Not fill-in-the-blank: each answer is assembled from sentences chosen by what the numbers *mean*
(wasteful finishing, controlling without chances, a comeback...), with phrasing that varies by
question and by audience mode. Every number comes from the tool facts.
"""
from __future__ import annotations

import zlib


def _f(x) -> str:
    return str(int(x)) if isinstance(x, float) and x.is_integer() else str(x)


def pick(options: list[str], key: str, salt: int = 0) -> str:
    return options[(zlib.crc32(key.encode()) + salt) % len(options)]


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def _ordinal_minutes(ms: list[int]) -> str:
    return _join([f"{m}'" for m in ms])


def _team_story(f: dict) -> str:
    h, a, x, p, sc = f["home"], f["away"], f["xg"], f["possession"], f["score"]
    lines = []
    for key, name in (("home", h), ("away", a)):
        diff = sc[key] - x[key]
        if diff <= -1:
            lines.append(f"{name} will feel they left goals out there: {_f(x[key])} xG, only {sc[key]} scored")
        elif diff >= 0.8 and sc[key] > 0:
            lines.append(f"{name} were clinical, scoring {sc[key]} from {_f(x[key])} xG")
    lead = "home" if p["home"] >= p["away"] else "away"
    other = "away" if lead == "home" else "home"
    names = {"home": h, "away": a}
    if abs(p["home"] - p["away"]) >= 6:
        if x[other] > x[lead]:
            lines.append(f"{names[lead]} had more of the ball ({p[lead]}%) but {names[other]} made the better chances ({_f(x[other])} xG to {_f(x[lead])})")
        else:
            lines.append(f"{names[lead]} bossed possession ({p[lead]}%) and created more too")
    elif abs(x["home"] - x["away"]) >= 0.8:
        better = "home" if x["home"] > x["away"] else "away"
        lines.append(f"Possession was even, but {names[better]} created far more ({_f(x[better])} xG to {_f(x['away' if better == 'home' else 'home'])})")
    return ". ".join(lines)


def match_summary(f: dict, mode: str, key: str) -> str:
    h, a, s = f["home"], f["away"], f["score"]
    hs, as_ = s["home"], s["away"]
    if f["finished"]:
        if hs == as_:
            head = pick([f"{h} and {a} shared the spoils, {hs}-{as_}.", f"It finished level: {h} {hs}-{as_} {a}.",
                         f"Honours even in the end, {hs}-{as_}."], key)
        else:
            w, l = (h, a) if hs > as_ else (a, h)
            ws, ls = max(hs, as_), min(hs, as_)
            head = pick([f"{w} beat {l} {ws}-{ls}.", f"{w} came out on top, {ws}-{ls} against {l}.", f"A {ws}-{ls} win for {w} over {l}."], key)
    else:
        lead = "level" if hs == as_ else "ahead"
        head = (f"{h} and {a} are level at {hs}-{as_} after {f['minute']} minutes." if lead == "level" else
                f"After {f['minute']} minutes, {(h if hs > as_ else a)} lead {max(hs, as_)}-{min(hs, as_)}.")
    parts = [head]
    story = _team_story(f)
    if story:
        parts.append(story + ".")
    if f["goals"]:
        gs = [f"{g['player']} ({g['minute']}')" if mode != "analyst" else f"{g['player']} {g['minute']}' ({_f(g['xg'])} xG)" for g in f["goals"]]
        parts.append(pick(["The goals came from ", "Scorers: ", "On the scoresheet: "], key, 1) + _join(gs) + ".")
    if mode == "analyst":
        parts.append(f"Shots {f['shots']['home']}-{f['shots']['away']} ({f['onTarget']['home']}-{f['onTarget']['away']} on target), "
                     f"possession {f['possession']['home']}%-{f['possession']['away']}%.")
    if "motm" in f:
        m = f["motm"]
        parts.append(pick([f"{m['player']} ({m['team']}) was the standout, rated {m['rating']:.1f}.",
                           f"Player of the match: {m['player']}, rated {m['rating']:.1f}."], key, 2))
    return " ".join(parts)


def goals(f: dict, mode: str, key: str) -> str:
    g = f["goals"]
    if not g:
        return pick(["Nothing yet: it is still 0-0.", "No goals so far."], key)
    body = [f"{x['player']} ({x['minute']}')" + (f", a {_f(x['xg'])} xG chance" if mode == "analyst" else "") for x in g]
    out = f"{len(g)} goal{'s' if len(g) != 1 else ''}: {_join(body)}."
    if "luckiest" in f and len(g) > 1:
        lk = f["luckiest"]
        out += f" The least likely finish was {lk['player']}'s at {lk['minute']}' ({_f(lk['xg'])} xG)."
    multi = {}
    for x in g:
        multi[x["player"]] = multi.get(x["player"], 0) + 1
    for name, n in multi.items():
        if n > 1:
            out += pick([f" {name} scored {n} of them.", f" {name} was the difference, with {n}."], key)
    return out


def top_players(f: dict, mode: str, key: str) -> str:
    lead = f["leaders"]
    if not lead:
        return "Nobody has played enough yet."
    who = f" for {f['team']}" if f["team"] else ""
    top = lead[0]
    tail = _join([f"{r['player']} ({_f(r['value'])})" for r in lead[1:]])
    intro = pick([f"{top['player']} leads{who} on {f['metric']} with {_f(top['value'])}", f"Top of the list{who} for {f['metric']} is {top['player']} ({_f(top['value'])})"], key)
    if len(lead) > 1 and lead[1]["value"] == top["value"]:
        intro = f"{top['player']} and {lead[1]['player']} are level{who} on {f['metric']} at {_f(top['value'])}"
        tail = _join([f"{r['player']} ({_f(r['value'])})" for r in lead[2:]])
    return intro + (f", then {tail}." if tail else ".")


def shots(f: dict, mode: str, key: str) -> str:
    if not f["count"]:
        return "There are no shots matching that yet."
    top = f["biggest"][0]
    verb = {"goal": "and scored", "saved": "but it was saved", "off target": "but dragged it off target", "blocked": "but it was blocked"}.get(top["outcome"], f"({top['outcome']})")
    out = (f"The best chance was {top['player']}'s in minute {top['minute']}: {_f(top['xg'])} xG, {verb}. "
           f"All told that's {f['count']} shots worth {_f(f['totalXg'])} xG, with {f['goals']} goal{'s' if f['goals'] != 1 else ''}.")
    if mode == "analyst" and len(f["biggest"]) > 1:
        out += " Next best: " + _join([f"{s['player']} {s['minute']}' ({_f(s['xg'])})" for s in f["biggest"][1:4]]) + "."
    return out


def team_stats(f: dict, mode: str, key: str) -> str:
    eff = f"{f['goals']} goal{'s' if f['goals'] != 1 else ''} from {f['shots']} shots ({f['onTarget']} on target, {_f(f['xg'])} xG)"
    out = pick([f"{f['team']}: {eff}.", f"{f['team']} have {eff}."], key)
    out += f" They had {f['possession']}% of the ball and completed {f['passAccuracy']}% of {f['passes']} passes."
    out += f" Off the ball: {f['tackles']} tackles and {f['pressures']} pressing actions"
    out += f", {f['fouls']} fouls and {f['cards']} card{'s' if f['cards'] != 1 else ''}." if mode == "analyst" else "."
    return out


def player_stats(f: dict, mode: str, key: str) -> str:
    if not f.get("involved"):
        return f"{f['player']} ({f['team']}) hasn't had a touch yet."
    bits = [f"{f['goals']} goal{'s' if f['goals'] != 1 else ''} from {f['shots']} shots ({_f(f['xg'])} xG)",
            f"{f['passes']} passes at {f['passAccuracy']}%", f"{f['tackles']} tackles"]
    if f["topSpeed"]:
        bits.append(f"a top speed of {_f(f['topSpeed'])} km/h")
    verdict = ""
    if f["shots"] >= 4 and f["goals"] == 0:
        verdict = " A frustrating day in front of goal."
    elif f["goals"] and f["goals"] >= f["xg"] + 0.8:
        verdict = " Finished better than the chances suggested."
    return f"{f['player']} ({f['team']}, {f['position']}) is rated {f['rating']:.1f}: " + _join(bits) + "." + verdict


def key_moments(f: dict, mode: str, key: str) -> str:
    return pick(["The moments that mattered: ", "Key moments: ", "Here is how it unfolded: "], key) + "; ".join(f"{m['minute']}' {m['headline']}" for m in f["moments"]) + "."


def phases(f: dict, mode: str, key: str) -> str:
    w = f["windows"]
    if not w:
        return "Not enough of the match has been played to split into periods."
    out = f"The most one-sided spell was {f['mostOneSided']} minutes. "
    out += " ".join(f"{x['window']}': {_f(x['homeXg'])}-{_f(x['awayXg'])} xG." for x in w)
    return out


def compare_halves(f: dict, mode: str, key: str) -> str:
    h = f["halves"]
    a, b = f["home"], f["away"]
    out = (f"{a}: {h['first']['home']['shots']} shots ({_f(h['first']['home']['xg'])} xG) before the break, "
           f"{h['second']['home']['shots']} ({_f(h['second']['home']['xg'])}) after. "
           f"{b}: {h['first']['away']['shots']} ({_f(h['first']['away']['xg'])}) then {h['second']['away']['shots']} ({_f(h['second']['away']['xg'])}).")
    if h["second"]["away"]["xg"] > h["first"]["away"]["xg"] * 2 and h["second"]["away"]["xg"] > 0.8:
        out += f" {b} came alive after the interval."
    return out


def momentum(f: dict, mode: str, key: str) -> str:
    lean = ("it was finely balanced" if f["leaning"] == "balanced" else f"{f['leaning']} had the upper hand")
    out = f"Around minute {f['minute']} {lean}, momentum {f['momentum']:+d} (positive favours {f['home']}) and {f['homePossession']}% of the ball for {f['home']}."
    if f["context"]:
        out += f" {f['context'][0]['headline']}."
    return out


def whatif(f: dict, explanation: str | None, key: str) -> str:
    return (explanation or "") + pick([" Remember, these are model estimates.", " That's a simulation, not a certainty.", " Treat it as an informed estimate."], key)


def records(f: dict, mode: str, key: str) -> str:
    bits = []
    if "hardestShot" in f:
        x = f["hardestShot"]
        bits.append(f"hardest shot: {x['player']} at {_f(x['speedKmh'])} km/h ({x['minute']}')")
    if "longestPass" in f:
        x = f["longestPass"]
        bits.append(f"longest completed pass: {x['player']} to {x['to']}, {_f(x['metres'])} m ({x['minute']}')")
    if "fastestSprint" in f:
        x = f["fastestSprint"]
        bits.append(f"fastest sprint: {x['player']} at {_f(x['speedKmh'])} km/h over {_f(x['metres'])} m")
    if "hardestPassCompleted" in f:
        x = f["hardestPassCompleted"]
        bits.append(f"trickiest pass pulled off: {x['player']} (difficulty {_f(x['difficulty'])})")
    return "Standout numbers: " + "; ".join(bits) + "." if bits else "No records yet."


def compare_players(f: dict, mode: str, key: str) -> str:
    a, b = f["a"], f["b"]
    better = a if a["rating"] >= b["rating"] else b
    other = b if better is a else a
    return (f"{better['player']} edges it: rated {better['rating']:.1f} against {other['player']}'s {other['rating']:.1f}. "
            f"{a['player']} has {a['goals']} goals from {a['shots']} shots and {a['passAccuracy']}% passing; "
            f"{b['player']} has {b['goals']} from {b['shots']} and {b['passAccuracy']}%.")


def discipline(f: dict, mode: str, key: str) -> str:
    c = f["cards"]
    out = f"Fouls: {f['home']} {f['fouls']['home']}, {f['away']} {f['fouls']['away']}. "
    if not c:
        return out + "Nobody was booked."
    return out + f"{len(c)} booking{'s' if len(c) != 1 else ''}: " + _join([f"{x['player']} ({x['minute']}')" for x in c]) + "."


def timeline(f: dict, mode: str, key: str) -> str:
    g = f["goals"]
    if not g:
        return "No goals, so no story to tell yet."
    out = "How it unfolded: " + ", ".join(f"{x['score']} at {x['minute']}'" for x in g) + "."
    if f["leadChanges"]:
        out += f" The lead changed hands {f['leadChanges']} time{'s' if f['leadChanges'] != 1 else ''}."
    if f["fightBack"]:
        out += f" {_join(f['fightBack'])} had to fight back."
    return out


OUT_OF_SCOPE = {
    "fixtures": "I only know this one synthetic match, so I can't tell you about fixtures, schedules or tickets.",
    "real": "Everything here is synthetic and fictional, so I have nothing on real clubs, tables or transfers.",
    "other": "That is outside what this match data can tell me.",
}


def out_of_scope(topic: str, name_home: str, name_away: str) -> str:
    return (f"{OUT_OF_SCOPE.get(topic, OUT_OF_SCOPE['other'])} I can tell you about {name_home} vs {name_away}: "
            f"the story, players, chances, momentum, or a 'what if' on any shot.")


def fallback(name_home: str, name_away: str, summary: str) -> str:
    short = " ".join(summary.replace("! ", ". ").split(". ")[:2]).rstrip(".") + "."
    return (f"I couldn't tie that to anything in the {name_home} vs {name_away} data, so here is the headline instead: {short} "
            f"Try asking about a player, the biggest chance, momentum, cards, records, or a 'what if' on a shot.")
