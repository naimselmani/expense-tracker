#!/usr/bin/env python3
"""Merge exact upload dates from a channel's YouTube RSS feed into its JSON.

The RSS feed (feeds/videos.xml) exposes precise <published> dates for the
~15 most recent uploads and, unlike per-video metadata, isn't bot-walled —
so it works from anonymous CI. Only sets `d`; leaves the videos-page order
(set by yt_transform) untouched.

Usage: yt_rss_dates.py <json> <rss_xml>
"""
import json
import re
import sys


def main():
    json_path, xml_path = sys.argv[1], sys.argv[2]
    with open(xml_path, encoding="utf-8", errors="replace") as f:
        xml = f.read()

    dates = {}
    for entry in re.findall(r"<entry>(.*?)</entry>", xml, re.S):
        vid = re.search(r"<yt:videoId>([^<]+)</yt:videoId>", entry)
        pub = re.search(r"<published>(\d{4})-(\d{2})-(\d{2})", entry)
        if vid and pub:
            dates[vid.group(1)] = int(pub.group(1) + pub.group(2) + pub.group(3))

    with open(json_path) as f:
        doc = json.load(f)

    applied = 0
    for v in doc.get("videos", []):
        if v.get("id") in dates and not v.get("d"):
            v["d"] = dates[v["id"]]
            applied += 1

    with open(json_path, "w") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)

    print("%s: RSS applied %d exact dates" % (doc.get("slug", "?"), applied))


if __name__ == "__main__":
    main()
