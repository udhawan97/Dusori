# YouTube provider (Invidious-backed) — design

**Status:** approved · **Date:** 2026-07-27

## Program context

The research-agent spec deferred Reddit and YouTube for "API friction, not
value". Two things changed: the companion now has an established proxy seam
(arXiv, web search), and source-grounded review sessions made **readable
local text** the currency of every downstream feature — search, graph,
briefs, and recall prompts all need words on the device.

That reframes the feature. The question is not "can Dusori show videos"; it
is "can a video become a source Dusori can actually use". Only a transcript
does that. Reddit stays deferred.

## Why Invidious rather than the official API

|                      | Most-viewed ordering              | Transcript                                                     | Key              |
| -------------------- | --------------------------------- | -------------------------------------------------------------- | ---------------- |
| Invidious / Piped    | `sort_by=view_count`              | `/api/v1/captions/<id>`                                        | none             |
| YouTube Data API v3  | `order=viewCount` + `videos.list` | **no** — `captions.download` is OAuth-only, not key-accessible | Google Cloud key |
| SearXNG video engine | relevance only                    | no                                                             | none             |

The official API cannot hand a transcript to a key-only client, so it would
ship videos that no other Dusori feature can read. Invidious is open source,
keyless, and self-hostable, which also matches the SearXNG precedent already
in the companion: **the operator names an instance; Dusori ships no default
host.** No instance configured means no provider — exactly like web search.

## Companion routes

All three sit behind the existing bearer token, origin allowlist, and
loopback bind, and are hardcoded to the single configured instance. The only
user-controlled input is a query string or an 11-character video id
(`^[A-Za-z0-9_-]{11}$`).

- **`GET /api/research/youtube?q=`** — `<instance>/api/v1/search?type=video&sort_by=view_count`,
  lenient zod, top 8 as `{ id, title, author, publishedAt?, summary, url,
viewCount, lengthSeconds }`. The stored `url` is the canonical
  `https://www.youtube.com/watch?v=<id>`, never the instance, so a saved
  source stays valid when the instance goes away.
- **`GET /api/research/youtube-transcript?id=`** — `<instance>/api/v1/captions/<id>`,
  prefers an English track, downloads it, and converts WebVTT to plain text
  (cues, timestamps, and consecutive duplicate lines removed).
- **`GET /api/research/youtube-thumbnail?id=`** — `<instance>/vi/<id>/mqdefault.jpg`,
  streamed back with a content-type allowlist (`image/jpeg|png|webp`) and a
  2 MiB cap.

`503 { reason: 'not-configured' }` when `INVIDIOUS_URL` is unset, matching
web search.

## Thumbnails without calling Google

The obvious implementation — pointing `<img>` at `i.ytimg.com` — would make
the browser fetch from Google every time a card renders, with no per-use
consent, and would need `img-src` widened for the whole app. Instead the
thumbnail is proxied by the companion and fetched by the app **through the
authenticated client**, then rendered from an object URL. `img-src` already
allows `blob:`, so **the CSP does not change at all**, and no request leaves
the device except the one the companion makes on the user's behalf.

Thumbnails therefore exist only in live research results, where the
companion is already connected. A saved source is text, as always.

## Core

- `types.ts`: `ResearchCandidateKind` gains `video`; `ResearchCapture` gains
  optional `capturedVia`, so a capture can report what it actually got
  rather than what the provider guessed beforehand.
- `brief.ts`: `video → Videos`, ordered after `course`.
- `companion.ts`: `searchYouTube`, `fetchYouTubeTranscript`,
  `fetchYouTubeThumbnail` on the existing client.
- `providers/youtube.ts`: `createYouTubeProvider({ search, transcript })`.
  `capture()` tries the transcript; with one it returns the readable text and
  `capturedVia: 'youtube-transcript'`; without, a reference document that
  says so plainly, and `capturedVia: 'youtube-reference'`. The page-fetch
  upgrade is never offered — readability on a YouTube watch page yields
  nothing.
- Ranking needs no change: `communityScore: viewCount` feeds the existing
  provider-relative normalization, and `kind: 'video'` feeds diversity
  selection.

## Consent

One new provider disclosure, naming the companion and what leaves the
device: the objective text goes to the configured instance; approving a
video additionally fetches its captions and thumbnail from that instance.
No YouTube or Google host is contacted by the browser.

## Trust

Transcripts are untrusted text like every other source: sanitized rendering,
size-capped, never instructions. A transcript is machine-generated speech
recognition much of the time — the captured document says where it came from
and on what date, so it is never mistaken for the learner's notes or for an
authoritative transcript.

## Out of scope

Reddit; playlists and channels; inline playback; watch history; anything
that runs without an explicit user action; ranking videos by anything other
than the public signals already shown.
