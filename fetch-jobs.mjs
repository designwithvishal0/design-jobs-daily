import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT    = path.join(__dirname, "jobs.json");
const FRESH_MS  = 23 * 60 * 60 * 1000;
const FORCE     = process.argv.includes("--force");

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

async function isFresh() {
  if (FORCE) return false;
  try {
    const data = JSON.parse(await fs.readFile(OUTPUT, "utf8"));
    if (!data.fetchedAt) return false;
    return Date.now() - new Date(data.fetchedAt).getTime() < FRESH_MS;
  } catch { return false; }
}

function timeAgo(d) {
  if (!d) return "Recently";
  try {
    const h = Math.floor((Date.now() - new Date(d).getTime()) / 3600000);
    if (h < 1) return "Just now";
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch { return "Recently"; }
}

function stripHTML(s = "") {
  return s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ").trim();
}

function parseRSS(xml = "") {
  const items = [];
  for (const block of xml.match(/<item[\s\S]*?<\/item>/g) || []) {
    const get = tag => {
      const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return m ? stripHTML((m[1] || m[2] || "").trim()) : "";
    };
    items.push({ title: get("title"), link: get("link"), desc: get("description").slice(0, 250), pubDate: get("pubDate") });
  }
  return items;
}

const uid = s => Buffer.from(String(s || Math.random())).toString("base64").slice(0, 10);
const guessRole = (t = "") => t.toLowerCase().includes("product designer") ? "Product Designer" : "UI/UX Designer";
const extractTags = (text = "") => {
  const t = text.toLowerCase();
  return ["Figma","Sketch","Adobe XD","Prototyping","Wireframing","Design Systems","User Research","Interaction Design","Framer","InVision"].filter(k => t.includes(k.toLowerCase()));
};

const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Accept": "text/html,application/xml,application/rss+xml,*/*;q=0.8" };
const DESIGN_KW = ["designer","ux","ui/ux","ui ux","product design","user experience","user interface","interaction"];
const isDesign = (t = "") => DESIGN_KW.some(k => t.toLowerCase().includes(k));

async function fromNaukri() {
  const qs = ["ui+ux+designer", "product+designer", "ui+designer"];
  const jobs = [];
  for (const q of qs) {
    try {
      const res = await fetch(`https://www.naukri.com/rss/searchresults.php?src=search&query=${q}&location=india&experience=0&jobAge=1`, { headers: UA });
      if (!res.ok) { log(`Naukri "${q}": HTTP ${res.status}`); continue; }
      const text = await res.text();
      if (!text.includes("<item")) { log(`Naukri "${q}": no items`); continue; }
      for (const i of parseRSS(text)) {
        const p = i.title.split(" - ");
        jobs.push({ id: `naukri_${uid(i.link || i.title)}`, title: p[0]?.trim() || i.title, company: p[1]?.trim() || "See listing", location: p[2]?.trim() || "India", platform: "Naukri", postedTime: timeAgo(i.pubDate), experience: "0-3 years", salary: "Not Disclosed", url: i.link, description: i.desc, tags: extractTags(i.desc), role: guessRole(p[0] || i.title) });
      }
    } catch (e) { log(`Naukri "${q}" error: ${e.message}`); }
  }
  log(`Naukri: ${jobs.length} jobs`);
  return jobs;
}

async function fromShine() {
  try {
    const res = await fetch("https://www.shine.com/rss/jobs/?q=ui+ux+designer&l=india", { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const jobs = parseRSS(await res.text()).map(i => ({ id: `shine_${uid(i.link || i.title)}`, title: i.title.split(" - ")[0]?.trim() || i.title, company: i.title.split(" - ")[1]?.trim() || "See listing", location: "India", platform: "Shine", postedTime: timeAgo(i.pubDate), experience: "0-3 years", salary: "Not Disclosed", url: i.link, description: i.desc, tags: extractTags(i.desc), role: guessRole(i.title) }));
    log(`Shine: ${jobs.length} jobs`);
    return jobs;
  } catch (e) { log(`Shine error: ${e.message}`); return []; }
}

async function fromTimesJobs() {
  try {
    const res = await fetch("https://www.timesjobs.com/rss/jobssearchresult.rss?Keywords=ui+ux+designer&Location=india&jobAge=1", { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const jobs = parseRSS(await res.text()).map(i => ({ id: `tj_${uid(i.link || i.title)}`, title: i.title.split(" - ")[0]?.trim() || i.title, company: i.title.split(" - ")[1]?.trim() || "See listing", location: "India", platform: "TimesJobs", postedTime: timeAgo(i.pubDate), experience: "0-3 years", salary: "Not Disclosed", url: i.link, description: i.desc, tags: extractTags(i.desc), role: guessRole(i.title) }));
    log(`TimesJobs: ${jobs.length} jobs`);
    return jobs;
  } catch (e) { log(`TimesJobs error: ${e.message}`); return []; }
}

async function fromInternshala() {
  try {
    const res = await fetch("https://internshala.com/rss/jobs/ui-ux-design", { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const jobs = parseRSS(await res.text()).map(i => ({ id: `is_${uid(i.link || i.title)}`, title: i.title, company: "See listing", location: "India", platform: "Internshala", postedTime: timeAgo(i.pubDate), experience: "0-3 years", salary: "Not Disclosed", url: i.link, description: i.desc, tags: extractTags(i.desc), role: guessRole(i.title) }));
    log(`Internshala: ${jobs.length} jobs`);
    return jobs;
  } catch (e) { log(`Internshala error: ${e.message}`); return []; }
}

async function fromArbeitnow() {
  try {
    const res = await fetch("https://arbeitnow.com/api/job-board-api", { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data = [] } = await res.json();
    const jobs = data.filter(j => isDesign(j.title)).slice(0, 12).map(j => ({ id: `arb_${j.slug || uid(j.title)}`, title: j.title, company: j.company_name, location: j.location || "Remote", platform: "Arbeitnow", postedTime: timeAgo(new Date(j.created_at * 1000).toISOString()), experience: "0-3 years", salary: "Not Disclosed", url: j.url, description: stripHTML(j.description || "").slice(0, 250), tags: (j.tags || []).slice(0, 5), role: guessRole(j.title) }));
    log(`Arbeitnow: ${jobs.length} jobs`);
    return jobs;
  } catch (e) { log(`Arbeitnow error: ${e.message}`); return []; }
}

async function fromWWR() {
  try {
    const res = await fetch("https://weworkremotely.com/categories/remote-design-jobs.rss", { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const jobs = parseRSS(await res.text()).slice(0, 12).map(i => {
      const p = (i.title || "").split(": ");
      return { id: `wwr_${uid(i.link || i.title)}`, title: p.slice(1).join(": ").trim() || i.title, company: p[0]?.trim() || "Unknown", location: "Remote", platform: "WWR", postedTime: timeAgo(i.pubDate), experience: "0-3 years", salary: "Not Disclosed", url: i.link, description: i.desc, tags: extractTags(i.desc), role: guessRole(i.title) };
    });
    log(`WWR: ${jobs.length} jobs`);
    return jobs;
  } catch (e) { log(`WWR error: ${e.message}`); return []; }
}

async function fromRemotive() {
  try {
    const res = await fetch("https://remotive.com/api/remote-jobs?category=design&limit=20", { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { jobs: list = [] } = await res.json();
    const jobs = list.filter(j => isDesign(j.title)).slice(0, 12).map(j => ({ id: `rem_${j.id}`, title: j.title, company: j.company_name, location: "Remote", platform: "Remotive", postedTime: timeAgo(j.publication_date), experience: "0-3 years", salary: j.salary || "Not Disclosed", url: j.url, description: stripHTML(j.description || "").slice(0, 250), tags: extractTags(j.description || ""), role: guessRole(j.title) }));
    log(`Remotive: ${jobs.length} jobs`);
    return jobs;
  } catch (e) { log(`Remotive error: ${e.message}`); return []; }
}

async function fromJobicy() {
  try {
    const res = await fetch("https://jobicy.com/?feed=job_feed&job_categories=design&job_types=full-time", { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const jobs = parseRSS(await res.text()).slice(0, 10).map(i => ({ id: `jcy_${uid(i.link || i.title)}`, title: i.title, company: "See listing", location: "Remote", platform: "Jobicy", postedTime: timeAgo(i.pubDate), experience: "0-3 years", salary: "Not Disclosed", url: i.link, description: i.desc, tags: extractTags(i.desc), role: guessRole(i.title) }));
    log(`Jobicy: ${jobs.length} jobs`);
    return jobs;
  } catch (e) { log(`Jobicy error: ${e.message}`); return []; }
}

async function fromRemoteOK() {
  try {
    const res = await fetch("https://remoteok.com/api?tags=design,ux,ui-designer", { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const jobs = (Array.isArray(data) ? data : []).filter(j => j.position && isDesign(j.position)).slice(0, 8).map(j => ({ id: `rok_${j.id}`, title: j.position, company: j.company, location: "Remote", platform: "RemoteOK", postedTime: timeAgo(j.date), experience: "0-3 years", salary: j.salary || "Not Disclosed", url: j.url || `https://remoteok.com/l/${j.id}`, description: stripHTML(j.description || "").slice(0, 250), tags: (j.tags || []).slice(0, 5), role: guessRole(j.position) }));
    log(`RemoteOK: ${jobs.length} jobs`);
    return jobs;
  } catch (e) { log(`RemoteOK error: ${e.message}`); return []; }
}

async function fetchJobs() {
  log("Fetching from all sources, no API key needed...");
  const results = await Promise.all([
    fromNaukri(), fromShine(), fromTimesJobs(), fromInternshala(),
    fromArbeitnow(), fromWWR(), fromRemotive(), fromJobicy(), fromRemoteOK()
  ]);
  const seen = new Set();
  const all = results.flat().filter(j => {
    const key = j.url || j.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (all.length === 0) throw new Error("No jobs from any source");
  await fs.writeFile(OUTPUT, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    fetchedAtReadable: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "short" }),
    count: all.length,
    jobs: all
  }, null, 2));
  log(`Done. Saved ${all.length} jobs to jobs.json
