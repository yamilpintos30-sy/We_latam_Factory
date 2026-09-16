import { readFile } from "node:fs/promises";

const env = Object.fromEntries((await readFile(new URL("../.env", import.meta.url), "utf8"))
  .split(/\r?\n/).map(line => line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(match => [match[1], match[2].replace(/^['"]|['"]$/g, "")]));
const ELEVENLABS_BASE_URL = (env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io").replace(/\/$/, "");
const ELEVENLABS_MODEL = env.ELEVENLABS_MODEL || "music_v2";
const headers = { "content-type": "application/json", "xi-api-key": env.ELEVENLABS_API_KEY };
const prompt = "Authentic Argentine cumbia in 2/4 at exactly 92 BPM, guiro, timbales, congas, electric cumbia bass and bright keyboard lead. Festive dance groove. Avoid reggaeton dembow, salsa, EDM, trap and cinematic ambient. Instrumental diagnostic with a resolved ending.";
const plan = await fetch(`${ELEVENLABS_BASE_URL}/v1/music/plan`, { method: "POST", headers, body: JSON.stringify({ prompt, music_length_ms: 4000, model_id: ELEVENLABS_MODEL }) });
console.log(`plan=${plan.status}`);
if (!plan.ok) process.exitCode = 1;
else {
  const compositionPlan = await plan.json();
  const detailed = await fetch(`${ELEVENLABS_BASE_URL}/v1/music/detailed?output_format=pcm_48000`, { method: "POST", headers, body: JSON.stringify({ composition_plan: compositionPlan, model_id: ELEVENLABS_MODEL, with_timestamps: true, with_waveform_visual: true }) });
  const bytes = Buffer.from(await detailed.arrayBuffer());
  const type = detailed.headers.get("content-type") || "";
  console.log(`detailed=${detailed.status} type=${type} bytes=${bytes.length}`);
  if (!detailed.ok) { console.log(bytes.toString("utf8").slice(0, 500)); process.exitCode = 1; }
  else {
    const boundary = type.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i)?.slice(1).find(Boolean);
    if (!boundary) console.log("multipart=no");
    else {
      const parts = bytes.toString("latin1").split(`--${boundary}`).filter(part => part.includes("\r\n\r\n"));
      console.log(`multipart=yes parts=${parts.length}`);
      for (const part of parts) {
        const split = part.indexOf("\r\n\r\n"), partHeaders = part.slice(0, split).trim();
        console.log(partHeaders.replace(/\r\n/g, " | "));
        if (/application\/json/i.test(partHeaders)) {
          const metadata = JSON.parse(Buffer.from(part.slice(split + 4).replace(/\r\n$/, ""), "latin1").toString("utf8"));
          console.log(`metadata=${Object.keys(metadata).join(",")}`);
        }
      }
    }
  }
}
