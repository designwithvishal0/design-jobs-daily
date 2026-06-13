import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const OUTPUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "jobs.json");
const log = m => console.log(`[${new Date().toISOString()}] ${m}`);
const uid = s => Buffer.from(String(s || Math.random())).toString("base64").slice(0, 10);
const guessRole = (t = "") => t.toLowerCase().includes("product designer") ? "Product Designer" : "UI/UX Designer";

function timeAgo(d) {
  if (!d) return "Recently";
  const h = Math.floor((Date.now() - new Date(d).getTime()) / 3600000);
  if (isNaN(h)) return "Recently";
  if (h < 1) return "Just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function stripHTML(s = "") {
  return s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").trim();
}

function parseRSS(xml = "") {
  const out = [];
  for (const b of xml.match(/<item[\s\S]*?<\/item>/g) || []) {
    const get = t => {
      const m = b.match(new RegExp(`<${t}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${t}>|<${t}[^>]*>([\\s\\S]*?)</${t}>`));
      return m ? stripHTML((m[1] || m[2] || "").trim()) : "";
    };
    out.push({ title: get("title"), link: get("link"), desc: get("description").slice(0, 240), pubDate: get("pubDate") });
  }
  return out;
}

const tags = (txt = "") => {
  const t = txt.toLowerCase();
  return ["Figma", "Sketch", "Adobe XD", "Prototyping", "Wireframing", "Design Systems", "User Research", "Framer"].filter(k => t.includes(k.toLowerCase()));
};

const UA = { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36", "Accept": "application/xml,text/html,*/*" } };
const KW = ["designer", "ux", "ui/ux", "ui ux", "product design", "user experience", "user interface"];
const isDesign = (t = "") => KW.some(k => t.toLowerCase().includes(k));

async function rssSource(name, url, loc) {
  try {
    const r = await fetch(url, UA);
    if (!r.ok) { log(`${name}: HTTP ${r.status}`); return []; }
    const items = parseRSS(await r.text()).filter(i => i.title);
    const jobs = items.map(i => {
      const p = i.title.split(" - ");
      return {
        id: `${name}_${uid(i.link || i.title)}`,
        title: p[0]?.trim() || i.title,
        company: p[1]?.trim() || "See listing",
        location: loc, platform: name, postedTime: timeAgo(i.pubDate),
        experience: "0-3 years", salary: "Not Disclosed", url: i.link,
        description: i.desc, tags: tags(i.desc), role: guessRole(i.title),
      };
    });
    log(`${name}: ${jobs.length} jobs`);
    return jobs;
  } catch (e) { log(`${name} error: ${e.message}`); return []; }
}

async function fromArbeitnow() {
  try {
    const r = await fetch("https://arbeitnow.com/api/job-board-api", UA);
    if (!r.ok) return [];
    const { data = [] } = await r.json();
    const jobs = data.filter(j => isDesign(j.title)).slice(0, 15).map(j => ({
      id: `arb_${j.slug || uid(j.title)}`, title: j.title, company: j.company_name,
      location: j.location || "Remote", platform: "Arbeitnow",
      postedTime: timeAgo(new Date(j.created_at * 1000).toISOString()),
      experience: "0-3 years", salary: "Not Disclosed", url: j.url,
      description: stripHTML(j.description || "").slice(0, 240), tags: (j.tags || []).slice(0, 5), role: guessRole(j.title),
    }));
    log(`Arbeitnow: ${jobs.length} jobs`);
    return jobs;
  } catch (e) { log(`Arbeitnow error: ${e.message}`); return []; }
}

async function fromRemotive() {
  try {
    const r = await fetch("https://remotive.com/api/remote-jobs?category=design&limit=30", UA);
    if (!r.ok) return [];
    const { jobs: list = [] } = await r.json();
    const jobs = list.filter(j => isDesign(j.title)).slice(0, 15).map(j => ({
      id: `rem_${j.id}`, title: j.title, company: j.company_name, location: "Remote",
      platform: "Remotive", postedTime: timeAgo(j.publication_date), experience: "0-3 years",
      salary: j.salary || "Not Disclosed", url: j.url,
      description: stripHTML(j.description || "").slice(0, 240), tags: tags(j.description || ""), role: guessRole(j.title),
    }));
    log(`Remotive: ${jobs.length} jobs`);
    return jobs;
  } catch (e) { log(`Remotive error: ${e.message}`); return []; }
}

async function fromRemoteOK() {
  try {
    const r = await fetch("https://remoteok.com/api?tags=design,ux", UA);
    if (!r.ok) return [];
    const data = await r.json();
    const jobs = (Array.isArray(data) ? data : []).filter(j => j.position && isDesign(j.position)).slice(0, 12).map(j => ({
      id: `rok_${j.id}`, title: j.position, company: j.company, location: "Remote",
      platform: "RemoteOK", postedTime: timeAgo(j.date), experience: "0-3 years",
      salary: j.salary || "Not Disclosed", url: j.url || `https://remoteok.com/l/${j.id}`,
      description: stripHTML(j.description || "").slice(0, 240), tags: (j.tags || []).slice(0, 5), role: guessRole(j.position),
    }));
    log(`RemoteOK: ${jobs.length} jobs`);
    return jobs;
  } catch (e) { log(`RemoteOK error: ${e.message}`); return []; }
}

async function main() {
  log("Fetching from all sources...");
  const results = await Promise.all([
    rssSource("Naukri", "https://www.naukri.com/rss/searchresults.php?src=search&query=ui+ux+designer&location=india&jobAge=1", "India"),
    rssSource("TimesJobs", "https://www.timesjobs.com/rss/jobssearchresult.rss?Keywords=ui+ux+designer&Location=india&jobAge=1", "India"),
    rssSource("Internshala", "https://internshala.com/rss/jobs/ui-ux-design", "India"),
    rssSource("WWR", "https://weworkremotely.com/categories/remote-design-jobs.rss", "Remote"),
    rssSource("Jobicy", "https://jobicy.com/?feed=job_feed&job_categories=design", "Remote"),
    fromArbeitnow(), fromRemotive(), fromRemoteOK(),
  ]);
  const seen = new Set();
  const all = results.flat().filter(j => {
    const k = j.url || j.title;
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (all.length === 0) throw new Error("No jobs from any source");
  await fs.writeFile(OUTPUT, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    count: all.length,
    jobs: all,
  }, null, 2));
  log(`Done. Saved ${all.length} jobs.`);
}

main().catch(e => { log(`ERROR: ${e.message}`); process.exit(1); });
