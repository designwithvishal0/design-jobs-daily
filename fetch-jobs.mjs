import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const OUTPUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "jobs.json");
const TOKEN  = process.env.APIFY_TOKEN;
const ACTOR  = "agentx~all-jobs-scraper";

const log = m => console.log(`[${new Date().toISOString()}] ${m}`);

const COUNTRIES = [
  { country: "India",                region: "India"     },
  { country: "Singapore",            region: "Singapore" },
  { country: "United Arab Emirates", region: "Dubai"     },
  { country: "Germany",              region: "Germany"   },
  { country: "United Kingdom",       region: "UK"        },
  { country: "United States",        region: "USA"       },
];

const KEYWORDS = ["Product Designer", "UI/UX Designer"];
const PER_QUERY = 12;
const POSTED_SINCE = "7 days";

function timeAgo(d) {
  if (!d) return "Recently";
  const h = Math.floor((Date.now() - new Date(d).getTime()) / 3600000);
  if (isNaN(h)) return "Recently";
  if (h < 1) return "Just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const guessRole = (t = "") =>
  t.toLowerCase().includes("product designer") ? "Product Designer" : "UI/UX Designer";

async function runActor(keyword, country) {
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${TOKEN}`;
  const body = { keyword, country, max_results: PER_QUERY, posted_since: POSTED_SINCE, job_type: "all" };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

function normalize(raw, region) {
  const title    = raw.title || raw.jobTitle || raw.position || "Untitled role";
  const company  = raw.company || raw.companyName || raw.company_name || "See listing";
  const location = raw.location || raw.jobLocation || region;
  const url      = raw.url || raw.jobUrl || raw.link || raw.applyUrl || "";
  const platform = raw.platform || raw.source || raw.jobBoard || "Other";
  const posted   = raw.postedAt || raw.posted_at || raw.datePosted || raw.publishedAt;
  let salary = "Not Disclosed";
  if (raw.salary) {
    if (typeof raw.salary === "string") salary = raw.salary;
    else if (raw.salary.minValue || raw.salary.maxValue) {
      const c = raw.salary.currency || "";
      salary = `${c} ${raw.salary.minValue || ""}-${raw.salary.maxValue || ""}`.trim();
    }
  } else if (raw.salaryText) salary = raw.salaryText;

  const tags = Array.isArray(raw.skills) ? raw.skills.slice(0, 5)
    : Array.isArray(raw.tags) ? raw.tags.slice(0, 5) : [];

  return {
    id: `${platform}_${Buffer.from(url || title + company).toString("base64").slice(0, 12)}`,
    title, company, location, region, platform,
    postedTime: timeAgo(posted),
    experience: raw.seniority || raw.experience || "0-3 years",
    salary, url,
    description: (raw.description || raw.summary || "").replace(/<[^>]*>/g, "").slice(0, 240),
    tags, role: raw.role || guessRole(title),
  };
}

async function main() {
  if (!TOKEN) throw new Error("APIFY_TOKEN env var not set");
  log("Starting Apify multi-country fetch...");

  const all = [];
  const seen = new Set();

  for (const { country, region } of COUNTRIES) {
    for (const keyword of KEYWORDS) {
      try {
        const items = await runActor(keyword, country);
        let added = 0;
        for (const raw of items) {
          const job = normalize(raw, region);
          const key = job.url || job.title + job.company;
          if (seen.has(key)) continue;
          seen.add(key);
          all.push(job);
          added++;
        }
        log(`${country} / ${keyword}: ${added} jobs`);
      } catch (e) {
        log(`${country} / ${keyword} error: ${e.message}`);
      }
    }
  }

  if (all.length === 0) throw new Error("No jobs returned from Apify");

  await fs.writeFile(OUTPUT, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    count: all.length,
    jobs: all,
  }, null, 2));

  log(`Done. Saved ${all.length} jobs.`);
}

main().catch(e => { log(`ERROR: ${e.message}`); process.exit(1); });
