import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const OUTPUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "jobs.json");
const TOKEN  = process.env.APIFY_TOKEN;
const ACTOR  = "agentx~all-jobs-scraper";
const log = m => console.log(`[${new Date().toISOString()}] ${m}`);

const COUNTRIES = [
  { country: "Singapore",            region: "Singapore" },
  { country: "United Arab Emirates", region: "Dubai"     },
  { country: "India",                region: "India"     },
];

const KEYWORDS = ["Product Designer", "UI/UX Designer"];

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

async function startRun(keyword, country) {
  const res = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/runs?token=${TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, country, max_results: 10, posted_since: "7 days", job_type: "all" }),
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

function normalize(raw, region) {
  const title    = raw.title || raw.jobTitle || raw.position || "Untitled";
  const company  = raw.company || raw.companyName || "See listing";
  const location = raw.location || raw.jobLocation || region;
  const url      = raw.url || raw.jobUrl || raw.link || raw.applyUrl || "";
  const platform = raw.platform || raw.source || raw.jobBoard || "Other";
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

  for (const { country, region } of COUNTRIES) {
    for (const keyword of KEYWORDS) {
      try {
        log(`Starting: ${country} / ${keyword}`);
        const { runId, datasetId } = await startRun(keyword, country);
        await pollRun(runId);
        const items = await getItems(datasetId);
        let added = 0;
        for (const raw of items) {
          const job = normalize(raw, region);
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

  if (all.length === 0) throw new Error("Zero jobs from all sources");

  await fs.writeFile(OUTPUT, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    count: all.length,
    jobs: all,
  }, null, 2));

  log(`Saved ${all.length} total jobs.`);
}

main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });
