---
title: Research providers and legal boundaries
description: Provider access, configuration, data sent, capture limits, and third-party responsibilities.
---

Every provider is off until its disclosure is accepted on the device. The disclosure names the host and query data. Provider credentials stay in the local companion environment and are not stored in the workspace.

| Provider            | Route                | Configuration                                   | What Dusori saves                                                   | Important boundary                                                    |
| ------------------- | -------------------- | ----------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Microsoft Learn     | Browser or companion | None                                            | Catalog/reference metadata; companion may fetch exact approved page | Microsoft terms apply                                                 |
| Wikipedia           | Browser              | None                                            | Bounded extract and reference                                       | Wikimedia terms and source license apply                              |
| Hacker News         | Browser              | None                                            | Public result/reference metadata                                    | Algolia/HN availability applies                                       |
| GitHub              | Browser              | None for public search path                     | Public result/reference metadata                                    | GitHub rate limits and terms apply                                    |
| Stack Overflow      | Browser              | None                                            | Public result/reference metadata                                    | Stack Exchange terms and content license apply                        |
| OpenAlex            | Browser              | None                                            | Public metadata and reconstructed abstract where supplied           | OpenAlex source/license metadata still matters                        |
| Crossref            | Browser              | None                                            | Public scholarly metadata and abstract where supplied               | Publisher and work licenses still apply                               |
| Open Library        | Browser              | None                                            | Public book metadata and description where supplied                 | Edition and linked-text rights still vary                             |
| npm                 | Browser              | None                                            | Package metadata and published README                               | Package and registry licenses vary                                    |
| arXiv               | Companion            | None                                            | Public result/reference metadata                                    | Paper licenses vary                                                   |
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
