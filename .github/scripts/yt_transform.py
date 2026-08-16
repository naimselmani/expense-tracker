#!/usr/bin/env python3
"""Transform a yt-dlp flat-playlist dump into the lean per-channel JSON the
Binge app reads. Oldest video first.

Preserves any precise upload dates (`d`, YYYYMMDD) already present in a
previously published file at out_path, so the per-video date scrape
(see yt_scrape_dates.py) only has to run once per video.

Usage: yt_transform.py <raw_json> <out_json>
Env:   SLUG, SRC_URL
"""
import json
import os
import sys


def main():
    raw_path, out_path = sys.argv[1], sys.argv[2]
    with open(raw_path) as f:
        data = json.load(f)

    # Carry forward precise dates + view counts already known for these ids
    # (the flat listing exposes neither; the API pass fills them in).
    prior_d = {}
    prior_vc = {}
    if os.path.exists(out_path):
        try:
            with open(out_path) as f:
                for v in json.load(f).get("videos", []):
                    if not v.get("id"):
                        continue
                    if v.get("d"):
                        prior_d[v["id"]] = v["d"]
                    if v.get("vc"):
                        prior_vc[v["id"]] = v["vc"]
        except Exception:
            prior_d, prior_vc = {}, {}

    entries = [e for e in (data.get("entries") or []) if e and e.get("id")]
    vids = []
    for e in entries:
        ts = e.get("timestamp") or e.get("release_timestamp")
        vids.append({
            "id": e["id"],
            "title": (e.get("title") or "Untitled").strip(),
            "duration": e.get("duration") or None,
            "ts": int(ts) if ts else None,
            "d": prior_d.get(e["id"]),
            "vc": e.get("view_count") or prior_vc.get(e["id"]) or None,   # views (API-filled)
        })

    # Keep the exact videos-page order, oldest first: yt-dlp lists newest
    # first, so we just reverse. We deliberately do NOT re-sort by parsed
    # date — the page order is the source of truth for per-channel order,
    # and dates (exact or approximate) only drive labels / year grouping /
    # the merged timeline.
    vids.reverse()
    for i, v in enumerate(vids):
        v["i"] = i

    name = (data.get("channel") or data.get("title")
            or data.get("uploader") or os.environ["SLUG"])
    doc = {
        "slug": os.environ["SLUG"],
        "name": name,
        "channelId": data.get("channel_id") or data.get("id"),
        "url": os.environ["SRC_URL"],
        "count": len(vids),
        "videos": vids,
    }
    with open(out_path, "w") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)

    have = sum(1 for v in vids if v.get("d"))
    print("%s: %d videos (%d with precise dates)" % (os.environ["SLUG"], len(vids), have))


if __name__ == "__main__":
    main()
