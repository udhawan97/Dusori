---
title: Research providers and legal boundaries
description: Provider access, configuration, data sent, capture limits, and third-party responsibilities.
---

Every provider is off until its disclosure is accepted on the device. The disclosure names the host and query data. Provider credentials stay in the local companion environment and are not stored in the workspace.

v0.12.4 uses one provider catalog for the 13 research adapters. The catalog is not a plugin loader;
it is the tested source of truth for readiness, the exact consent scope, query routing, evidence
lens, capture policy, and browser origin. Tests require both hosted and desktop content-security
policies to permit every browser origin declared there. Optional AI remains outside that catalog
because it has its own consent and payload contract.

| Provider            | Route                | Configuration                                   | What Dusori saves                                                   | Important boundary                                                    |
| ------------------- | -------------------- | ----------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Microsoft Learn     | Browser or companion | None                                            | Catalog or ranked-search reference; no module-page snapshot         | Microsoft terms apply                                                 |
| Wikipedia           | Browser              | None                                            | Bounded extract and reference                                       | Wikimedia terms and source license apply                              |
| Hacker News         | Browser              | None                                            | Public result/reference metadata                                    | Algolia/HN availability applies                                       |
| GitHub              | Browser              | None for public search path                     | Public repository metadata and bounded published README where found | GitHub rate limits and terms apply                                    |
| Stack Overflow      | Browser              | None                                            | Public question body and answer metadata from the API               | Stack Exchange terms and content license apply                        |
| OpenAlex            | Browser              | None                                            | Public metadata and reconstructed abstract where supplied           | OpenAlex source/license metadata still matters                        |
| Crossref            | Browser              | None                                            | Public scholarly metadata and abstract where supplied               | Publisher and work licenses still apply                               |
| Open Library        | Browser              | None                                            | Public book metadata and description where supplied                 | Edition and linked-text rights still vary                             |
| npm                 | Browser              | None                                            | Package metadata and published README                               | Package and registry licenses vary                                    |
| arXiv               | Companion            | None                                            | Public paper metadata and abstract                                  | Paper licenses vary                                                   |
| SearXNG             | Companion            | `SEARXNG_URL`                                   | Search references                                                   | You choose and trust the instance                                     |
| Brave Search        | Companion            | `BRAVE_API_KEY`                                 | Search references                                                   | Your account, quota, and provider terms                               |
| Tavily              | Companion            | `TAVILY_API_KEY`                                | Search references                                                   | Your account, quota, and provider terms                               |
| Reddit              | Companion            | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`      | Self-post text or link reference; over-18 results excluded          | Your registered app and Reddit terms                                  |
| YouTube Data API v3 | Companion            | `YOUTUBE_API_KEY`                               | Video metadata, thumbnail proxy, and a reference                    | Preferred path; your Google project quota and YouTube API terms apply |
| Invidious fallback  | Companion            | Optional self-hosted `INVIDIOUS_URL`            | Video metadata, thumbnail proxy, and a reference                    | No default or public instance is selected by Dusori                   |
| Ollama              | Companion            | Running loopback model; `OLLAMA_MODEL` optional | Passage-indexed, model-labeled output after separate consent        | Local model and license vary                                          |
| Anthropic           | Companion            | `ANTHROPIC_API_KEY`                             | Model-labeled output only after feature consent                     | Your account, quota, and Anthropic terms                              |
| OpenAI              | Companion            | `OPENAI_API_KEY`                                | Model-labeled output only after feature consent                     | Your account, quota, and OpenAI terms                                 |

## Lawful collection rules

Dusori does not bypass authentication, paywalls, CAPTCHAs, robots controls, private-address blocks, or platform restrictions. It does not impersonate a browser session, scrape a logged-in social feed, or download YouTube video/audio/captions.

For YouTube, `YOUTUBE_API_KEY` is the preferred metadata-search path. A self-hosted `INVIDIOUS_URL` can act as a fallback when the API key is absent or the official request is unavailable. Both paths remain metadata/reference-only; neither harvests captions or downloads media.

The learner is responsible for:

- choosing an instance or service whose terms permit the intended request;
- keeping credentials private and within provider quotas;
- respecting copyright and the license attached to saved material;
- supplying transcript or document text only when they own it, supplied it, or have permission;
- verifying whether a provider’s free tier is still available.

Dusori being free and open source does not make third-party services free, permanent, or unrestricted.

## AI boundaries

AI is optional and consent is feature-specific. Dusori discovers a running Ollama service on this computer's loopback address without requiring shell-only settings, chooses the lightest recognized chat model unless `OLLAMA_MODEL` names one explicitly, and calls it ready only after a small structured generation check succeeds. A listed model that cannot load stays labeled as failed. Dusori does not contact LAN or hosted Ollama-compatible endpoints, and it never starts Ollama or downloads a model. Hosted Anthropic/OpenAI configuration is labeled as hosted, not local. Depending on the feature, the disclosure may cover the query plus candidate metadata, accepted-source excerpts, a roadmap objective, current preferences, or typed instructions. For synthesis, the model may select and order approved passage IDs; the displayed wording remains verbatim source text. Deterministic ranking, synthesis structure, and prompt generation remain the fallbacks.

Never put provider keys in workspace files, notes, screenshots, bug reports, or command-line arguments. Supply them as local companion environment variables.

## Failure and fallback behavior

A research run asks all relevant, allowed providers concurrently. One timeout or provider error is
recorded and does not discard results from the others. Saving then proceeds source by source: if
content capture fails, Dusori keeps the URL reference and the failure message; if one save fails,
the remaining shortlist still proceeds. Only saved readable text can become quoted evidence.

If separately consented AI synthesis becomes unavailable, Dusori writes the deterministic
evidence-first brief. If the learner edited the current brief, the refresh becomes a proposal rather
than overwriting it.
