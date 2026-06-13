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

const guessRole = (t = "") =>
  t.toLowerCase().includes("product designer") ? "Product Designer" : "UI/UX Designer";

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runActor(keyword, country) {
  const startRes = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/runs?token=${TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword,
        country,
        max_results: 10,
        posted_since: "7 days",
        job_type: "all",
      }),
    }
  );
  if (!startRes.ok) {
    throw new Error(`start failed ${startRes.status}: ${(await startRes.text()).slice(0, 100)}`);
  }
  const startData = await startRes.json();
  const runId = startData.data.id;
  const datasetId = startData.data.defaultDatasetId;
  log(`  run ${runId} started, polling...`);

  for (let i = 0; i < 48; i++) {
    await sleep(5000);
    const poll = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${TOKEN}`);
    if (!poll.ok) continue;
    const { data } = await poll.json();
    log(`  status: ${data.status} (${i + 1})`);
    if (data.status === "SUCCEEDED") break;
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(data.status)) {
      throw new Error(`run ended with ${data.status}`);
    }
  }

  const dsRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${TOKEN}&clean=true`
  );
  if (!dsRes.ok) throw new Error(`dataset read failed ${dsRes.status}`);
  return dsRes.json();
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
    experience: raw.seniority || raw.experience || "0-3
