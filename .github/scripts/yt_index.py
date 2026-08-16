#!/usr/bin/env python3
"""Rebuild cdn/youtube/index.json from every per-channel file on disk
(restored from gh-pages + freshly scraped), so the index always reflects
the full published set.

Usage: yt_index.py <youtube_dir>
"""
import glob
import json
import os
import sys


def main():
    ydir = sys.argv[1] if len(sys.argv) > 1 else "cdn/youtube"
    chans = []
    for p in sorted(glob.glob(os.path.join(ydir, "*.json"))):
        if os.path.basename(p) == "index.json":
            continue
        try:
            with open(p) as f:
                d = json.load(f)
        except Exception:
            continue
        chans.append({
            "slug": d.get("slug"),
            "name": d.get("name"),
            "count": d.get("count", 0),
            "url": d.get("url"),
        })
    with open(os.path.join(ydir, "index.json"), "w") as f:
        json.dump({"channels": chans}, f, separators=(",", ":"), ensure_ascii=False)
    print("index.json: %d channels" % len(chans))


if __name__ == "__main__":
    main()
