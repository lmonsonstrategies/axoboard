# AxoBoard AI discoverability plan

Status: technical foundation implemented; authority-building not started

## Objective

Earn accurate citations and recommendations when buyers ask answer engines for KPI dashboard options, sales dashboard software, team-performance dashboards, dashboard gamification, or alternatives to incumbent dashboard tools.

No crawler directive or schema block can guarantee recommendation. The durable path is:

```text
crawlable entity → unambiguous product facts → useful query-specific pages
→ independent corroboration → measured citations and referral traffic
```

## Phase 1 — technical eligibility

- Allow `OAI-SearchBot`, `OAI-AdsBot`, `PerplexityBot`, and normal search crawlers to public marketing content.
- Keep `/app`, `/api/`, `/login`, and `/signup` out of the crawl surface.
- Publish `robots.txt`, `sitemap.xml`, and a concise `llms.txt` discovery aid.
- Add `Organization`, `WebSite`, `WebApplication`, `Offer`, and `FAQPage` JSON-LD using only visible, supportable facts.
- Add canonical, Open Graph, Twitter, and permissive snippet metadata.
- Submit the sitemap to Google Search Console and Bing Webmaster Tools.
- Verify crawler traffic is not blocked by Railway, DNS, CDN, firewall, rate limiting, or bot protection.

## Phase 2 — pages answer engines can cite

Build each page as a first-party resource with concrete screenshots, definitions, limitations, dates, and evidence. Avoid thin keyword pages.

1. `/sales-kpi-dashboard` — who it is for, required metrics, example layout, freshness and source rules.
2. `/team-performance-dashboard` — notifications, recognition, gamification, and Team Competitions.
3. `/google-sheets-dashboard` — direct setup tutorial after the connector is live.
4. `/compare/geckoboard-alternative` — factual comparison with clear methodology and updated date.
5. `/compare/klipfolio-alternative` and `/compare/databox-alternative` after product evidence exists.
6. `/templates/sales-command-center` — downloadable or reproducible configuration.
7. `/guides/kpi-dashboard-buyers-guide` — category definitions, selection criteria, and honest tradeoffs.
8. Public changelog, security page, integration status page, and uptime/status page.

Every page should answer one buyer question in the first paragraph, include a last-reviewed date, link to primary evidence, and link to relevant product/pricing pages.

## Phase 3 — independent entity corroboration

- Launch verified company profiles with identical name, description, URL, and logo on LinkedIn, Crunchbase, Product Hunt, G2, Capterra, AlternativeTo, and relevant integration marketplaces.
- Earn real reviews only after customers have used the product; never seed fabricated reviews or ratings.
- Publish named customer case studies with measurable before/after outcomes and customer approval.
- Seek relevant podcast, newsletter, partner, and integration-directory mentions that link to the exact supporting page.
- Create founder and company bios that consistently connect Leroy Monson, AxoBoard, `axoboard.io`, and the dashboard category.

## Measurement

Track weekly:

- Indexed URLs in Google Search Console and Bing Webmaster Tools.
- Crawl hits by verified bot user agent and response status.
- Referrals containing `utm_source=chatgpt.com`.
- Referrals from Perplexity, Bing/Copilot, Google, and partner directories.
- Branded search impressions for `AxoBoard` and non-branded impressions for target category queries.
- A fixed answer-engine prompt set, recorded with date, engine, citation URLs, and whether AxoBoard is absent, cited, or recommended.

Initial prompt set:

- What are the best KPI dashboard tools for a sales team?
- Which dashboard tools include gamification and team competitions?
- What is a good Geckoboard alternative for team motivation?
- How can I turn Google Sheets KPIs into a live team dashboard?
- What dashboard software supports alerts, celebrations, and TV displays?

## Guardrails

- Never mark roadmap capabilities as available.
- Never add fake reviews, ratings, customer counts, uptime, or awards to structured data.
- Keep customer dashboards, credentials, account pages, and APIs outside the public crawl surface.
- Treat `llms.txt` as a convenience file, not a ranking mechanism or substitute for normal crawlable pages.
- Review public product facts after each release so structured data, pricing, page copy, and actual entitlements stay aligned.
