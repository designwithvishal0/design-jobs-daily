# Design Jobs Daily

A fully automated job aggregator for Product Designers and UI/UX Designers. It pulls fresh listings every morning from 8+ job platforms, deduplicates them, filters out stale postings, and publishes everything to a clean single page viewer. No server, no database, no maintenance. GitHub does all the work.

**Live site:** [designwithvishal0.github.io/design-jobs-daily](https://designwithvishal0.github.io/design-jobs-daily)

## Why this exists

Design job hunting in India is scattered across ten platforms, and most listings are dead by the time you find them. Instead of checking LinkedIn, Naukri, Glassdoor, Indeed and five other sites every morning, this repo checks all of them for you and gives you one page with only recent, relevant roles.

I built it for my own job search. Then designers in my network started using it as their first stop every morning, so I kept it running.

## What it covers

* **Roles:** Product Designer, UI/UX Designer
* **Regions:** India via Naukri, worldwide remote for startup and X roles
* **Sources:** Naukri, Wellfound, Y Combinator (Work at a Startup) and X Jobs
* **Experience band:** roles requiring up to 3 years, senior and lead titles filtered out
* **Freshness:** only jobs posted within the last 7 days make it in

## How it works

```
GitHub Actions (daily cron, 8 AM IST)
        │
        ▼
fetch-jobs.mjs ──► Apify actor scrapes each keyword across 9 platforms
        │
        ▼
Dedupe, normalize, tag role and region
        │
        ▼
jobs.json committed back to the repo
        │
        ▼
GitHub Pages serves index.html, which reads jobs.json client side
```

The entire stack is a single Node script, one workflow file, and one static HTML page. Zero hosting cost, zero infrastructure.

## Tech

* **Node.js 20** with native fetch, no dependencies
* **Apify** actors for each job platform
* **GitHub Actions** for the daily schedule and auto commit
* **GitHub Pages** for hosting the viewer
* **Vanilla HTML/CSS/JS** viewer with region and role filters

## Running it yourself

1. Fork this repo
2. Get an Apify token and add it as a repository secret named `APIFY_TOKEN`
3. Edit the `SOURCES` array in `fetch-jobs.mjs` to match your role and platforms
4. Enable GitHub Pages (Settings → Pages → Deploy from branch → main → root)
5. Trigger the first run manually from the Actions tab

After that it runs itself every day.

## Roadmap

* Email or Telegram digest of new roles each morning
* More regions (Singapore, Dubai and beyond)
* Salary range extraction where platforms expose it
* More role keywords
* Company deduplication across platforms

## License

MIT. Fork it, adapt it for your own role and region, and share it with anyone job hunting.

---

Built and maintained by [Vishal](https://designwvishal.framer.website), Product Designer.
