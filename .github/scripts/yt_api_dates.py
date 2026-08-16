#!/usr/bin/env python3
"""Enrich videos via the YouTube Data API (videos.list) — the one reliable,
no-bot-wall source from CI. Fills two things per batch of 50 ids (1 quota
unit each; a whole channel is a handful of units out of 10,000/day):

  * exact publish date `d` (YYYYMMDD) — only for videos that don't have one
    yet (incremental; a video is dated once and skipped thereafter);
  * `vc` view count — refreshed for every video each run (cheap, and keeps
    the "Most viewed" sort current).

Order is left untouched (the videos-page order set by yt_transform).

Usage: yt_api_dates.py <json> [max]
Env:   YT_API_KEY  (if unset, this is a no-op)
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

API = "https://www.googleapis.com/youtube/v3/videos"


def main():
    path = sys.argv[1]
    cap = int(sys.argv[2]) if len(sys.argv) > 2 else 5000
    key = os.environ.get("YT_API_KEY")
    if not key:
        print("no YT_API_KEY — skipping API enrichment")
        return

    with open(path) as f:
        doc = json.load(f)
    ids = [v["id"] for v in doc.get("videos", []) if v.get("id")][:cap]
    if not ids:
        return

    dates, views = {}, {}
    for i in range(0, len(ids), 50):
        batch = ids[i:i + 50]
        qs = urllib.parse.urlencode({
            "part": "snippet,statistics",
            "fields": "items(id,snippet/publishedAt,statistics/viewCount)",
            "maxResults": "50",
            "id": ",".join(batch),
            "key": key,
        })
        try:
            with urllib.request.urlopen(API + "?" + qs, timeout=30) as r:
                data = json.load(r)
        except Exception as e:
            print("  API error on batch %d: %r" % (i // 50, e))
            continue
        for it in data.get("items", []):
            vid = it.get("id")
            pa = (it.get("snippet") or {}).get("publishedAt", "")
            if vid and len(pa) >= 10 and pa[4] == "-" and pa[7] == "-":
                dates[vid] = int(pa[0:4] + pa[5:7] + pa[8:10])
            vcs = (it.get("statistics") or {}).get("viewCount")
            if vid and vcs is not None:
                try:
                    views[vid] = int(vcs)
                except (TypeError, ValueError):
                    pass
        time.sleep(0.1)

    dated, viewed = 0, 0
    for v in doc.get("videos", []):
        vid = v.get("id")
        if vid in dates and not v.get("d"):
            v["d"] = dates[vid]
            dated += 1
        if vid in views:
            v["vc"] = views[vid]
            viewed += 1

    with open(path, "w") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
    print("%s: API dated %d, views %d (of %d)"
          % (doc.get("slug", "?"), dated, viewed, len(ids)))


if __name__ == "__main__":
    main()
