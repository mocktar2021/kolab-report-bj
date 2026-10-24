# Social posts (TikTok and Facebook)

Images and a short video for the launch ads, built from the same design as the 52 s video in `../launch-ad` (KRB-246). The text to post with them, the posting plan and the ad settings are in `annonces.md`.

## Files

| File | What it holds |
| --- | --- |
| `posts.html` | Six slides: the hook, the outline, the team, the AI, the final report and the offer. `?f=` picks the format, `?s=` the slide, `?e=` the ending. |
| `render.mjs` | Screenshots every slide in every format and both endings, and fails when a mock-up doesn't fit its frame. |
| `cut.sh` | Cuts the 52 s ad to 28 s for TikTok and Reels ads. |
| `annonces.md` | Ad text for Facebook and TikTok, organic captions and the posting plan. |

Rendered images and videos go to `out/` and stay out of git.

## Formats

| Name | Size | Use |
| --- | --- | --- |
| `fil` | 1080x1350 (4:5) | Facebook feed, one image |
| `carre` | 1080x1080 (1:1) | Facebook carousel |
| `story` | 1080x1920 (9:16) | Stories, WhatsApp status, TikTok photo post |

The `story` format keeps 210 px free at the top and 360 px at the bottom, where TikTok and Stories draw their own buttons and caption.

Both endings exist for every image: `lancement` says "Lancement le 27 octobre" and asks for a reminder e-mail, `disponible` says "Disponible maintenant".

## Build

You need the repo's `node_modules` (`npm ci` at the root) and ffmpeg.

```sh
cd docs/marketing/social-posts
node render.mjs                       # 36 images in out/<ending>/<format>/
node render.mjs disponible fil        # one ending and one format
sh cut.sh ../launch-ad/kolabreport_disponible.mp4 out/kolabreport_28s_disponible.mp4
```

Render the full video first (see `../launch-ad/README.md`), then cut it. The 28 s cut keeps scenes 1, 3, 5, 6, 11 and 12. Every voice line ends before its cut, and the loudness stays at -14 LUFS.

To change a slide, edit its function in `posts.html`. Each format gets as many mock rows as it has room for (`ROOM`), and a mock-up shrinks to fit its stage. `render.mjs` reports any slide where it had to shrink below 72% or where text spills over.
