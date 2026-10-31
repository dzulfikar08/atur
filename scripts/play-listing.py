"""Play listing images via the Android Publisher API.

usage: play-listing.py <list|icon|feature> [file]
  list     print every image per language (type, id, sha256, url) and download them to listing-dump/
  icon     replace the hi-res icon in every listing language with <file> (512x512 PNG)
  feature  replace the feature graphic in every listing language with <file> (1024x500)
"""

import hashlib
import os
import sys
import urllib.request

import google.auth
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

PKG = "com.diatur.app"
TYPES = {"icon": "icon", "feature": "featureGraphic"}
ALL_TYPES = ["icon", "featureGraphic", "phoneScreenshots", "sevenInchScreenshots", "tenInchScreenshots", "tvBanner", "wearScreenshots"]

creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/androidpublisher"])
svc = build("androidpublisher", "v3", credentials=creds, cache_discovery=False)
edits = svc.edits()

mode = sys.argv[1]
edit = edits.insert(packageName=PKG, body={}).execute()["id"]
langs = [x["language"] for x in edits.listings().list(packageName=PKG, editId=edit).execute().get("listings", [])]
print("languages:", langs)


def dump(tag):
    os.makedirs("listing-dump", exist_ok=True)
    for lang in langs:
        for t in ALL_TYPES:
            for img in edits.images().list(packageName=PKG, editId=edit, language=lang, imageType=t).execute().get("images", []):
                print(f"{tag} {lang} {t} id={img['id']} sha256={img['sha256']}")
                data = urllib.request.urlopen(img["url"]).read()
                open(f"listing-dump/{tag}-{lang}-{t}-{img['id'][:8]}.png", "wb").write(data)


if mode == "list":
    dump("current")
    edits.delete(packageName=PKG, editId=edit).execute()
else:
    file = sys.argv[2]
    want = hashlib.sha256(open(file, "rb").read()).hexdigest()
    t = TYPES[mode]
    print("local sha256:", want)
    for lang in langs:
        edits.images().deleteall(packageName=PKG, editId=edit, language=lang, imageType=t).execute()
        up = edits.images().upload(
            packageName=PKG, editId=edit, language=lang, imageType=t,
            media_body=MediaFileUpload(file, mimetype="image/png"),
        ).execute()
        print(f"uploaded {lang} {t}: {up['image']['sha256']}")
        assert up["image"]["sha256"] == want, "uploaded sha mismatch"
    edits.commit(packageName=PKG, editId=edit).execute()
    print("edit committed")
    # re-read from a fresh edit to prove the stored listing changed
    edit = edits.insert(packageName=PKG, body={}).execute()["id"]
    for lang in langs:
        got = edits.images().list(packageName=PKG, editId=edit, language=lang, imageType=t).execute().get("images", [])
        print(f"verify {lang} {t}: {[i['sha256'] for i in got]}")
        assert [i["sha256"] for i in got] == [want], "stored sha differs"
    dump("after")
    edits.delete(packageName=PKG, editId=edit).execute()
