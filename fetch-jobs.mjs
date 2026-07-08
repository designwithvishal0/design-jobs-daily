import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const OUTPUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "jobs.json");
const TOKEN  = process.env.APIFY_TOKEN;
const ACTOR  = "agentx~all-jobs-scraper";
const log = m => console.log(`[${new Date().toISOString()}] ${m}`);

// Platform names must exactly match the actor's input schema enum
const COUNTRIES = [
  { country: "India", region: "India",
    platforms: ["Indeed","Glassdoor","Naukri.com","foundit","Talent.com","Jooble"] },
];

const KEYWORDS = ["Product Designer", "UI/UX Designer"];

// Dedicated actors for platforms the main scraper does not cover.
// These are location agnostic: startup and X roles are mostly remote anyway.
const EXTRA_SOURCES = [
  {
    label: "Wellfound", region: "Global",
    actor: "orgupdate~wellfound-jobs-scraper",
    input: { countryName: "Remote", locationName: "Remote", includeKeyword: "designer", pagesToFetch: 1, jobType: "FULLTIME", datePosted: "week" },
  },
  {
    label: "Y Combinator", region: "Global",
    actor: "parsebird~yc-jobs-scraper",
    input: { searchQuery: "product designer", roleFilter: "designer", maxResults: 25 },
  },
  {
    label: "X Jobs", region: "Global",
    actor: "powerai~twitter-jobs-search-scraper",
    input: { keyword: "product designer", maxResults: 15 },
  },
  {
    label: "X Jobs", region: "Global",
    actor: "powerai~twitter-jobs-search-scraper",
    input: { keyword: "ui ux designer", maxResults: 15 },
  },
];

function timeAgo(d) {
  if (!d) return "Recently";
  const h = Math.floor((Date.now() - new Date(d).getTime()) / 3600000);
  if (isNaN(h)) return "Recently";
  if (h < 1) return "Just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const guessRole = t =>
  (t||"").toLowerCase().includes("product designer") ? "Product Designer" : "UI/UX Designer";

// Keep only roles suited to 0-3 years of experience
const MAX_YOE = 3;
const SENIOR_TITLE = /\b(senior|sr\.?|lead|principal|staff|head of|director|vp|vice president|architect)\b/i;

function fitsExperience(job) {
  if (SENIOR_TITLE.test(job.title)) return false;
  const exp = (job.experience || "").toLowerCase();
  if (/\b(senior|lead|principal|staff|director|expert)\b/.test(exp)) return false;
  // Parse patterns like "2-5 years", "5+ years", "minimum 4 years"
  const m = exp.match(/(\d+)\s*(?:-|to|\+)?/);
  if (m && parseInt(m[1], 10) > MAX_YOE) return false;
  return true; // unknown experience stays in
}

async function startRun(actor, input) {
  const res = await fetch(
    `https://api.apify.com/v2/acts/${actor}/runs?token=${TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!res.ok) throw new Error(`start ${res.status}: ${(await res.text()).slice(0,100)}`);
  const { data } = await res.json();
  return { runId: data.id, datasetId: data.defaultDatasetId };
}

async function pollRun(runId) {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${TOKEN}`);
    if (!res.ok) continue;
    const { data } = await res.json();
    log(`  poll ${i+1}: ${data.status}`);
    if (data.status === "SUCCEEDED") return true;
    if (["FAILED","ABORTED","TIMED-OUT"].includes(data.status)) throw new Error(data.status);
  }
  throw new Error("poll timeout");
}

async function getItems(datasetId) {
  const res = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${TOKEN}&clean=true`);
  if (!res.ok) throw new Error(`dataset ${res.status}`);
  return res.json();
}

function normalize(raw, region, platformOverride) {
  const title    = raw.title || raw.jobTitle || raw.position || raw.role || raw.name || "Untitled";
  const company  = raw.company || raw.companyName || raw.company_name || raw.startup || "See listing";
  const location = raw.location || raw.jobLocation || raw.locationName || region;
  const url      = raw.url || raw.jobUrl || raw.link || raw.applyUrl || raw.job_url || "";
  const platform = platformOverride || raw.platform || raw.source || raw.jobBoard || "Other";
  const posted   = raw.postedAt || raw.posted_at || raw.datePosted || raw.publishedAt;
  let salary = "Not Disclosed";
  if (raw.salary) salary = typeof raw.salary === "string" ? raw.salary : `${raw.salary.currency||""} ${raw.salary.minValue||""}-${raw.salary.maxValue||""}`.trim();
  else if (raw.salaryText) salary = raw.salaryText;
  return {
    id: `${platform}_${Buffer.from(url||title+company).toString("base64").slice(0,12)}`,
    title, company, location, region, platform,
    postedTime: timeAgo(posted),
    experience: raw.seniority || raw.experience || "0-3 years",
    salary, url,
    description: (raw.description || raw.summary || "").replace(/<[^>]*>/g,"").slice(0,240),
    tags: (raw.skills || raw.tags || []).slice(0,5),
    role: raw.role || guessRole(title),
  };
}

async function main() {
  if (!TOKEN) throw new Error("APIFY_TOKEN env var not set");
  log("Starting poll-based fetch...");
  const all = [], seen = new Set();

  for (const { country, region, platforms } of COUNTRIES) {
    for (const keyword of KEYWORDS) {
      try {
        log(`Starting: ${country} / ${keyword}`);
        const { runId, datasetId } = await startRun(ACTOR, { keyword, country, platforms, max_results: 10, posted_since: "7 days", job_type: "all" });
        await pollRun(runId);
        const items = await getItems(datasetId);
        let added = 0;
        for (const raw of items) {
          const job = normalize(raw, region);
          if (!fitsExperience(job)) continue;
          const key = job.url || job.title + job.company;
          if (seen.has(key)) continue;
          seen.add(key); all.push(job); added++;
        }
        log(`Done: ${country} / ${keyword} => ${added} jobs`);
      } catch (e) {
        log(`Error: ${country} / ${keyword} => ${e.message}`);
      }
    }
  }

  for (const { label, region, actor, input } of EXTRA_SOURCES) {
    try {
      log(`Starting extra source: ${label}`);
      const { runId, datasetId } = await startRun(actor, input);
      await pollRun(runId);
      const items = await getItems(datasetId);
      let added = 0;
      for (const raw of items) {
        const job = normalize(raw, region, label);
        if (!fitsExperience(job)) continue;
        const key = job.url || job.title + job.company;
        if (seen.has(key)) continue;
        seen.add(key); all.push(job); added++;
      }
      log(`Done: ${label} => ${added} jobs`);
    } catch (e) {
      log(`Error: ${label} => ${e.message}`);
    }
  }

  if (all.length === 0) {
    log("WARNING: Zero jobs from all sources. Keeping existing jobs.json untouched.");
    log("Check the actor input schema at apify.com/agentx/all-jobs-scraper if this persists.");
    return;
  }

  await fs.writeFile(OUTPUT, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    count: all.length,
    jobs: all,
  }, null, 2));

  log(`Saved ${all.length} total jobs.`);
}

main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });
