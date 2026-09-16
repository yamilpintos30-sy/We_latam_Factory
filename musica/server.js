import http from "node:http";
import { access, readFile, readdir, mkdir, writeFile, rename } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const ROOT = process.cwd();
const PUBLIC = join(ROOT, "public");
const OUTPUT = join(ROOT, "data", "generated");
const JOBS = join(ROOT, "data", "jobs");
const VIDEO_TEMPLATE = join(ROOT, "data", "templates", "music-video-template.mp4");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/$/, "");
const ELEVENLABS_BASE_URL = (process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io").replace(/\/$/, "");
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || "music_v2";
const jobs = new Map();
const saveQueues = new Map();
const execFileAsync = promisify(execFile);
const MUSIC_START_RULE = "REGLA OBLIGATORIA E INNEGOCIABLE: la música debe ser claramente audible desde 00:00 exacto. La primera nota, pulso, textura o elemento musical debe comenzar en el segundo 0, sin ningún silencio inicial, fade-in silencioso ni introducción ambiental vacía. Esta regla tiene prioridad sobre cualquier otra instrucción.";
const MUSIC_START_RULE_EN = "MANDATORY NON-NEGOTIABLE RULE: music must be clearly audible at exact 00:00. The first note, beat, texture, or musical element must start at second 0, with no initial silence, silent fade-in, or empty ambient intro. This rule takes priority over every other instruction.";

await loadEnv();
await mkdir(OUTPUT, { recursive: true });
await mkdir(JOBS, { recursive: true });
await loadJobs();

const formats = {
  short: { label: "Short", defaultMinutes: 1, min: 0.25, max: 1.5, segmentMinutes: 1.5 },
  video: { label: "Video", defaultMinutes: 5, min: 1, max: 10, segmentMinutes: 10 },
  long: { label: "Long", defaultMinutes: 60, min: 60, max: 180, segmentMinutes: 10 },
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "POST" && url.pathname === "/api/trends") return await trends(req, res);
    if (req.method === "POST" && url.pathname === "/api/generate") return await createJob(req, res);
    if (req.method === "POST" && url.pathname === "/api/video") return await createMusicVideo(req, res);
    if (req.method === "GET" && url.pathname === "/api/jobs") return listJobs(res);
    if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) return getJob(url, res);
    if (req.method === "GET" && url.pathname.startsWith("/media/")) return media(url, res);
    if (req.method === "GET" && url.pathname.startsWith("/exports/")) return exported(url, res);
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, { ok: true, creativeEngine: Boolean(process.env.OLLAMA_API_KEY), musicEngine: Boolean(process.env.ELEVENLABS_API_KEY) });
    }
    return staticFile(url.pathname, res);
  } catch (error) {
    console.error(error);
    return json(res, error.status || 500, { error: error.message || "Error inesperado" });
  }
});

server.listen(PORT, HOST, () => console.log(`Nocturne Studio listo en http://${HOST}:${PORT}`));

async function trends(req, res) {
  const body = await bodyJson(req);
  const genre = clean(body.genre) || "ambient";
  const useTrends = body.useTrends !== false;
  if (!process.env.OLLAMA_API_KEY) return json(res, 200, { ...demoTrend(genre), mode: useTrends ? "demo" : "manual" });

  const query = useTrends
    ? `tendencias actuales y producción musical del género ${genre}: BPM, compás, ritmo, instrumentos, voz, arreglos y sonido 2026`
    : `características musicales auténticas de ${genre}: historia, BPM, compás, patrón rítmico, instrumentos, armonía, voz, estructura y producción`;
  const search = await ollama("/api/web_search", { query, max_results: 6 });
  const sources = (search.results || []).map(({ title, url, content }) => ({ title, url, content: clean(content, 700) }));
  const schema = {
    type: "object",
    properties: {
      title: { type: "string" }, albumTitle: { type: "string" }, summary: { type: "string" }, hook: { type: "string" }, visualPrompt: { type: "string" },
      bpm: { type: "integer" }, mood: { type: "array", items: { type: "string" } },
      instruments: { type: "array", items: { type: "string" } }, prompt: { type: "string" }, trackTitles: { type: "array", items: { type: "string" } },
      musicProfile: { type: "object", properties: { tempoBpm: { type: "integer" }, key: { type: "string" }, rhythm: { type: "string" }, instrumentation: { type: "array", items: { type: "string" } }, vocalStyle: { type: "string" }, arrangement: { type: "array", items: { type: "string" } }, production: { type: "string" }, negativeStyles: { type: "array", items: { type: "string" } }, culturalNotes: { type: "string" } }, required: ["tempoBpm", "key", "rhythm", "instrumentation", "vocalStyle", "arrangement", "production", "negativeStyles", "culturalNotes"] }
    }, required: ["title", "albumTitle", "summary", "hook", "visualPrompt", "bpm", "mood", "instruments", "prompt", "trackTitles", "musicProfile"]
  };
  const result = await ollama("/api/chat", {
    model: process.env.OLLAMA_MODEL || "gpt-oss:120b", stream: false, format: schema,
    messages: [
        { role: "system", content: `Eres productor musical, arreglador y etnomusicólogo experto. Sin imitar artistas, canciones, melodías, portadas ni letras protegidas, define con precisión el género pedido y nunca lo sustituyas por una categoría genérica. Responde JSON válido en español. Crea un universo original coherente, 30 títulos breves, un título de álbum, un prompt musical en inglés y un visualPrompt sin texto. musicProfile debe fijar BPM, tonalidad, patrón rítmico auténtico, instrumentos culturalmente correctos, estilo vocal, estructura, época/sonido de producción y estilos que deben excluirse para evitar deriva de género. ${MUSIC_START_RULE}` },
      { role: "user", content: `Género exacto elegido por el usuario: ${genre}. Investigación web:\n${JSON.stringify(sources)}\n${useTrends ? "Usa también las tendencias actuales relevantes." : "Prioriza la identidad auténtica del género sobre las tendencias."} Propón un concepto original para una serie de singles y un álbum.` }
    ]
  });
  let analysis;
  try { analysis = parseModelJson(result.message?.content || result.message?.thinking || ""); }
  catch { throw Object.assign(new Error("El director creativo devolvió un análisis no válido"), { status: 502 }); }
  analysis.trackTitles = analysis.trackTitles || analysis.songTitles || analysis.trackList || [];
  analysis.prompt = analysis.prompt || analysis.musicalPrompt || `Original ${genre} composition`;
  analysis.title = analysis.title || analysis.trackTitles[0] || analysis.albumTitle || "Nueva señal";
  analysis.albumTitle = analysis.albumTitle || `${analysis.title} — Sessions`;
  analysis.summary = analysis.summary || `Una colección original de ${genre} construida a partir de señales culturales actuales.`;
  analysis.hook = analysis.hook || "Un universo sonoro coherente con variaciones propias para cada lanzamiento.";
  analysis.visualPrompt = analysis.visualPrompt || `Original ${genre} nocturnal abstract environment, cinematic album artwork, no text`;
  analysis.bpm = Number(analysis.bpm) || 72;
  analysis.mood = Array.isArray(analysis.mood) ? analysis.mood : ["nocturno", "cinemático", "inmersivo"];
  analysis.instruments = Array.isArray(analysis.instruments) ? analysis.instruments : ["sintetizadores", "texturas ambientales", "percusión orgánica"];
  analysis.musicProfile = normalizeMusicProfile(analysis.musicProfile, genre, analysis);
  analysis.bpm = analysis.musicProfile.tempoBpm;
  analysis.instruments = analysis.musicProfile.instrumentation;
  json(res, 200, { ...analysis, sources: sources.map(({ title, url }) => ({ title, url })), live: useTrends, mode: useTrends ? "trends" : "manual" });
}

async function createJob(req, res) {
  const body = await bodyJson(req);
  const format = formats[body.format];
  if (!format) return json(res, 400, { error: "Formato no válido" });
  const isDemo = body.mode === "demo";
  const requestedMinutes = clamp(Number(body.minutes) || format.defaultMinutes, format.min, format.max);
  const productionMinutes = 3;
  const productionCount = clamp(Math.round(Number(body.count) || 1), 1, 30);
  const minutes = isDemo ? 0.5 : productionMinutes;
  const count = isDemo ? 1 : productionCount;
  const prompt = clean(body.prompt, 3900);
  const genre = clean(body.genre) || (prompt ? "prompt-driven" : "");
  if (!genre || !prompt) return json(res, 400, { error: "Faltan género o concepto musical" });

  const id = randomUUID();
  const durations = [minutes];
  const trackTitles = Array.isArray(body.trackTitles) ? body.trackTitles.map(x => clean(x, 100)).filter(Boolean) : [];
  const requestedSeed = Number(body.coverSeed);
  const musicProfile = normalizeMusicProfile(body.musicProfile, genre, { bpm: body.bpm, instruments: body.instruments });
  const job = { id, mode: isDemo ? "demo" : "album", status: "queued", phase: "Preparando el estudio", format: body.format, genre, userPrompt: prompt, artist: clean(body.artist, 100) || "Artista", albumTitle: clean(body.albumTitle, 100) || clean(body.title, 100) || "Nuevo álbum", title: clean(body.title, 100) || "Nueva sesión", instrumental: Boolean(body.instrumental), musicProfile, visualPrompt: clean(body.visualPrompt, 1200), coverSeed: Number.isInteger(requestedSeed) ? clamp(requestedSeed, 1, 2147483646) : 3107, concurrency: clamp(Number(process.env.GENERATION_CONCURRENCY) || 2, 1, 3), progress: 0, total: count * durations.length, tracks: [], covers: [], warnings: [], exportUrl: null, error: null, createdAt: new Date().toISOString(), source: { prompt, trackTitles, musicProfile, visualPrompt: clean(body.visualPrompt, 1200), minutes: productionMinutes, requestedMinutes, count: productionCount, instrumental: Boolean(body.instrumental) } };
  jobs.set(id, job);
  await persistJob(job);
  runJob(job, durations, prompt, Boolean(body.instrumental), count, trackTitles).catch(async error => {
    job.status = "failed"; job.phase = "Producción detenida"; job.error = error.message; await persistJob(job); console.error(error);
  });
  json(res, 202, { job });
}

async function runJob(job, durations, prompt, instrumental, count, trackTitles) {
  job.status = "generating"; job.phase = "Componiendo música y arte en paralelo";
  await persistJob(job);
  if (!process.env.ELEVENLABS_API_KEY) {
    await new Promise(resolve => setTimeout(resolve, 900));
    job.status = "demo"; job.progress = 100;
    job.error = "Configura el motor musical para generar audio. El concepto y la cola funcionan en modo demostración.";
    await persistJob(job);
    return;
  }
  const songs = Array.from({ length: count }, (_, song) => ({ song, songTitle: trackTitles[song] || (job.mode === "demo" ? job.title : `${job.title} ${String(song + 1).padStart(2, "0")}`) }));
  const coverWork = (async () => {
    for (const { song, songTitle } of songs) {
      const choices = job.mode === "demo" ? 3 : 1;
      for (let option = 0; option < choices; option++) {
        try { await makeCover(job, songTitle, song, option); }
        catch (error) { job.warnings.push(`Portada ${option + 1}: ${error.message}`); await persistJob(job); }
      }
    }
  })();
  const musicWork = runPool(songs, job.concurrency, async ({ song, songTitle }) => {
    const totalSeconds = durations.reduce((sum, value) => sum + value * 60, 0);
    job.phase = `Investigando y produciendo: ${songTitle}`;
    await persistJob(job);
    const direction = await researchTrackDirection(job, songTitle, prompt, totalSeconds, instrumental, song, count);
    const lyrics = direction.lyrics;
    for (let i = 0; i < durations.length; i++) {
    const duration = durations[i];
    const segmentPrompt = buildProductionPrompt(job, songTitle, song, count, i, durations.length, direction.musicPrompt, lyrics, direction.musicProfile);
    const planResponse = await fetch(`${ELEVENLABS_BASE_URL}/v1/music/plan`, {
      method: "POST",
      headers: { "content-type": "application/json", "xi-api-key": process.env.ELEVENLABS_API_KEY },
      body: JSON.stringify({ prompt: segmentPrompt, music_length_ms: Math.round(duration * 60000), model_id: ELEVENLABS_MODEL })
    });
    if (!planResponse.ok) throw new Error(`El motor musical no pudo planificar (${planResponse.status}): ${clean(await planResponse.text(), 300)}`);
    const compositionPlan = reinforceCompositionPlan(await planResponse.json(), direction.musicProfile, job.genre, instrumental);
    const response = await fetch(`${ELEVENLABS_BASE_URL}/v1/music/detailed?output_format=pcm_48000`, {
      method: "POST",
      headers: { "content-type": "application/json", "xi-api-key": process.env.ELEVENLABS_API_KEY },
      body: JSON.stringify({ composition_plan: compositionPlan, model_id: ELEVENLABS_MODEL, with_timestamps: !instrumental, with_waveform_visual: true })
    });
    if (!response.ok) throw new Error(`El motor musical no pudo componer (${response.status}): ${clean(await response.text(), 300)}`);
    const detailed = parseDetailedMusicResponse(Buffer.from(await response.arrayBuffer()), response.headers.get("content-type") || "");
    const pcm = detailed.audio;
    if (!pcm?.length) throw new Error("La composición terminó sin audio utilizable.");
    // Evita publicar una pista silenciosa si el proveedor cambia el orden de
    // las partes multipart o devuelve un artefacto vacío.
    // No inspeccionamos solamente el inicio: una introducción ambiental puede
    // tener varios segundos casi silenciosos aunque la pista completa sea válida.
    // Muestreamos todo el buffer para detectar silencio real sin falsos positivos.
    let nonZero = 0;
    const stride = Math.max(1, Math.floor(pcm.length / 200000));
    for (let i = 0; i < pcm.length; i += stride) if (pcm[i] !== 0) nonZero++;
    if (nonZero <= 32) throw new Error("La composición devolvió audio silencioso; intentá generar nuevamente.");
    const wordTimestamps = normalizeWordTimestamps(detailed.metadata?.words_timestamps || detailed.metadata?.word_timestamps || detailed.metadata?.words || []);
    const syncedLyrics = groupTimedWords(wordTimestamps);
    const filename = `${job.id}-${String(song + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}.wav`;
    await writeFile(join(OUTPUT, filename), pcmToWav(pcm, 48000, 2, 16));
    job.tracks.push({ name: durations.length > 1 ? `${songTitle} · Parte ${i + 1}` : songTitle, songTitle, trackNumber: song + 1, part: i + 1, durationMinutes: duration, lyrics, syncedLyrics, musicProfile: direction.musicProfile, musicPrompt: direction.musicPrompt, research: direction.sources, waveform: detailed.metadata?.waveform_visual || [], compositionPlan, url: `/media/${filename}`, filename });
    job.progress = Math.round((job.tracks.length / job.total) * 100);
    await persistJob(job);
    }
  });
  await musicWork;
  job.phase = "Audio listo · terminando portadas";
  await persistJob(job);
  await coverWork;
  job.tracks.sort((a, b) => a.trackNumber - b.trackNumber || a.filename.localeCompare(b.filename));
  if (job.mode === "demo") {
    job.status = "complete"; job.phase = "Demo lista para aprobar"; job.completedAt = new Date().toISOString();
    await persistJob(job);
    return;
  }
  job.phase = "Empaquetando el lanzamiento";
  await persistJob(job);
  await makePackage(job);
  job.status = "complete"; job.phase = "Lanzamiento listo"; job.completedAt = new Date().toISOString();
  await persistJob(job);
}

function listJobs(res) {
  const items = [...jobs.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return json(res, 200, { jobs: items });
}

function getJob(url, res) {
  const job = jobs.get(url.pathname.split("/").pop());
  return job ? json(res, 200, { job }) : json(res, 404, { error: "Sesión no encontrada" });
}

async function media(url, res) {
  const name = normalize(url.pathname.slice(7)).replace(/^([.][.][/\\])+/, "");
  if (!/^[\w-]+\.(mp3|mp4|wav|png)$/.test(name)) return json(res, 400, { error: "Archivo no válido" });
  const type = name.endsWith(".png") ? "image/png" : name.endsWith(".wav") ? "audio/wav" : name.endsWith(".mp4") ? "video/mp4" : "audio/mpeg";
  res.writeHead(200, { "content-type": type, "content-disposition": `inline; filename="${name}"` });
  createReadStream(join(OUTPUT, name)).on("error", () => res.end()).pipe(res);
}

async function exported(url, res) {
  const name = normalize(url.pathname.slice(9)).replace(/^([.][.][/\\])+/, "");
  if (!/^[\w-]+\.zip$/.test(name)) return json(res, 400, { error: "Archivo no válido" });
  res.writeHead(200, { "content-type": "application/zip", "content-disposition": `attachment; filename="${name}"` });
  createReadStream(join(OUTPUT, name)).on("error", () => res.end()).pipe(res);
}

async function createMusicVideo(req, res) {
  const body = await bodyJson(req);
  const jobId = clean(body.jobId, 80);
  const filename = clean(body.filename, 180);
  const job = jobs.get(jobId);
  if (!job) return json(res, 404, { error: "Sesión no encontrada" });
  const track = job.tracks.find(item => item.filename === filename);
  if (!track || !/^[\w-]+\.wav$/.test(filename)) return json(res, 404, { error: "Canción no encontrada en esta sesión" });

  try { await access(VIDEO_TEMPLATE); }
  catch { return json(res, 503, { error: "El vídeo base no está instalado en el servidor" }); }

  const number = String(track.trackNumber || 1).padStart(2, "0");
  const outputFilename = `${job.id}-${number}-video-seleccionado.mp4`;
  const outputPath = join(OUTPUT, outputFilename);
  const python = join(ROOT, ".venv", "bin", "python");
  job.phase = `Creando vídeo con ${track.songTitle}`;
  await persistJob(job);
  try {
    const { stdout } = await execFileAsync(python, [
      join(ROOT, "scripts", "make_music_video.py"),
      "--video", VIDEO_TEMPLATE,
      "--audio", join(OUTPUT, filename),
      "--output", outputPath,
      "--title", track.songTitle,
      "--artist", job.artist,
    ], { timeout: 30 * 60 * 1000, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(stdout.trim());
    track.videoUrl = `/media/${outputFilename}`;
    track.videoFilename = outputFilename;
    track.videoDurationSeconds = result.durationSeconds;
    job.phase = "Vídeo listo para descargar";
    await persistJob(job);
    return json(res, 201, { video: { url: track.videoUrl, filename: outputFilename, durationSeconds: result.durationSeconds } });
  } catch (error) {
    job.phase = "No se pudo crear el vídeo";
    await persistJob(job);
    return json(res, 500, { error: clean(error.stderr || error.message || "Error al crear el vídeo", 500) });
  }
}

async function makeCover(job, title, index, option = 0) {
  const filename = `${job.id}-cover-${String(index + 1).padStart(2, "0")}-${option + 1}.png`;
  const python = join(ROOT, ".venv", "bin", "python");
  const prompt = `${job.visualPrompt || `${job.genre}, nocturnal abstract landscape`}. Same visual universe for album ${job.albumTitle}; variation inspired by ${title}`;
  try {
    const seed = job.coverSeed + index * 101 + option * 7919;
    await execFileAsync(python, [join(ROOT, "scripts", "generate_cover.py"), "--prompt", prompt, "--output", join(OUTPUT, filename), "--seed", String(seed)], { timeout: 20 * 60 * 1000, maxBuffer: 1024 * 1024 });
    job.covers.push({ title, option: option + 1, seed, url: `/media/${filename}`, filename });
    await persistJob(job);
  } catch (error) {
    throw new Error("El generador de portadas no está instalado. Ejecuta: bash scripts/setup-cover-model.sh");
  }
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) { const item = items[cursor++]; await worker(item); }
  });
  await Promise.all(runners);
}

async function researchTrackDirection(job, title, albumDirection, durationSeconds, instrumental, index, count) {
  const desiredLines = instrumental ? 0 : clamp(Math.round(durationSeconds / 8), 8, 40);
  const query = `${job.genre} music production guide BPM meter rhythm instruments harmony vocals arrangement cultural context ${new Date().getUTCFullYear()}`;
  let sources = [];
  try {
    const search = await ollama("/api/web_search", { query, max_results: 5 });
    sources = (search.results || []).map(({ title: sourceTitle, url, content }) => ({ title: clean(sourceTitle, 180), url, content: clean(content, 850) }));
  } catch (error) {
    job.warnings.push(`La investigación de ${title} no respondió; se usó la dirección general del álbum.`);
  }
  const schema = {
    type: "object",
    properties: {
      musicPrompt: { type: "string" },
      tempoBpm: { type: "integer" }, key: { type: "string" }, rhythm: { type: "string" }, meter: { type: "string" },
      instrumentation: { type: "array", items: { type: "string" } }, vocalStyle: { type: "string" },
      arrangement: { type: "array", items: { type: "string" } }, production: { type: "string" },
      negativeStyles: { type: "array", items: { type: "string" } }, culturalNotes: { type: "string" },
      lyrics: { type: "array", items: { type: "string" } }
    },
    required: ["musicPrompt", "tempoBpm", "key", "rhythm", "meter", "instrumentation", "vocalStyle", "arrangement", "production", "negativeStyles", "culturalNotes", "lyrics"]
  };
  try {
    const result = await ollama("/api/chat", {
      model: process.env.OLLAMA_MODEL || "gpt-oss:120b", stream: false, format: schema,
      messages: [
        { role: "system", content: `Eres un productor musical, compositor, letrista y etnomusicólogo. Diseña cada canción desde cero usando la investigación proporcionada. El género pedido es obligatorio: define tú el BPM, compás, groove, armonía, instrumentos, técnica vocal, arreglo y mezcla apropiados. Evita rasgos de géneros que puedan desviar el resultado. No imites artistas, canciones, melodías ni letras existentes. Las letras deben ser originales, cantables, culturalmente naturales y usar el idioma o variante lingüística adecuada al género. ${MUSIC_START_RULE} Responde únicamente JSON válido.` },
        { role: "user", content: `Álbum: ${job.albumTitle}. Canción ${index + 1}/${count}: ${title}. Género exacto: ${job.genre}. Duración aproximada: ${Math.round(durationSeconds)} segundos. Dirección general: ${clean(albumDirection, 700)}. Investigación web: ${JSON.stringify(sources)}. Crea una identidad propia para esta canción que siga perteneciendo al álbum. ${instrumental ? "Debe ser estrictamente instrumental y lyrics debe ser []." : `Escribe aproximadamente ${desiredLines} líneas, incluyendo versos y un estribillo memorable; lyrics debe contener solo las líneas cantadas, sin etiquetas.`}` }
      ]
    });
    const parsed = parseModelJson(result.message?.content || result.message?.thinking || "");
    const musicProfile = normalizeMusicProfile({ ...parsed, rhythm: [parsed.meter, parsed.rhythm].filter(Boolean).join(", ") }, job.genre, job.musicProfile);
    const lyrics = instrumental ? [] : normalizeStringList(parsed.lyrics || parsed.lines, []).slice(0, 40);
    return { musicProfile, lyrics, musicPrompt: cleanMultiline(parsed.musicPrompt || parsed.prompt || albumDirection, 1200), sources: sources.map(({ title: sourceTitle, url }) => ({ title: sourceTitle, url })) };
  } catch (error) {
    job.warnings.push(`No se pudo crear un brief individual para ${title}; se usó el perfil investigado del álbum.`);
    return { musicProfile: job.musicProfile, lyrics: [], musicPrompt: albumDirection, sources: sources.map(({ title: sourceTitle, url }) => ({ title: sourceTitle, url })) };
  }
}

function normalizeMusicProfile(value, genre, fallback = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    tempoBpm: clamp(Number(source.tempoBpm || source.bpm || fallback.tempoBpm || fallback.bpm) || 100, 35, 240),
    key: clean(source.key || fallback.key || "producer-selected key", 60),
    rhythm: clean(source.rhythm || fallback.rhythm || `authentic ${genre} rhythmic identity`, 600),
    instrumentation: normalizeStringList(source.instrumentation || source.instruments || fallback.instrumentation || fallback.instruments, ["genre-authentic rhythm section", "genre-authentic lead instruments"]),
    vocalStyle: clean(source.vocalStyle || fallback.vocalStyle || `vocals appropriate to ${genre}`, 500),
    arrangement: normalizeStringList(source.arrangement || fallback.arrangement, ["intro", "development", "main hook", "contrast section", "resolved ending"]),
    production: clean(source.production || fallback.production || `professional production appropriate to ${genre}`, 600),
    negativeStyles: normalizeStringList(source.negativeStyles || fallback.negativeStyles, ["genre drift", "unrelated stylistic clichés"]),
    culturalNotes: clean(source.culturalNotes || fallback.culturalNotes || `Respect the musical language and cultural context of ${genre}`, 600)
  };
}

function normalizeStringList(value, fallback = []) { return (Array.isArray(value) ? value : fallback).map(item => clean(item, 160)).filter(Boolean).slice(0, 16); }

function buildProductionPrompt(job, songTitle, song, count, part, parts, creativePrompt, lyrics, trackProfile) {
  const p = trackProfile || job.musicProfile || normalizeMusicProfile({}, job.genre);
  const lyricText = lyrics.length ? `EXACT ORIGINAL LYRICS, keep this order and do not add words:\n[Verse / Chorus material]\n${lyrics.join("\n")}` : "STRICTLY INSTRUMENTAL. No singing, spoken words, chants or vocal samples.";
  return cleanMultiline(`AUTHENTIC ${job.genre}. Preserve the requested genre and never substitute it with an unrelated style. The researched specification below has priority over any conflicting general album direction.\nMANDATORY TIMING: ${MUSIC_START_RULE_EN}\nTitle: ${songTitle}. Track ${song + 1}/${count}, part ${part + 1}/${parts}.\nTempo: exactly ${p.tempoBpm} BPM. Key or tonal center: ${p.key}.\nRhythmic identity: ${p.rhythm}.\nRequired instrumentation: ${p.instrumentation.join(", ")}.\nVocal identity: ${p.vocalStyle}.\nArrangement in order: ${p.arrangement.join(" -> ")}.\nProduction and mix: ${p.production}.\nCultural direction: ${p.culturalNotes}.\nMust avoid: ${p.negativeStyles.join(", ")}.\nDIRECT USER PROMPT (follow this creative direction exactly): ${job.userPrompt}.\nIndividual creative direction: ${creativePrompt}.\n${lyricText}\nMake the genre identity unmistakable, follow its natural pacing and dynamics, and finish with an intentional ending appropriate to this composition. Never imitate an existing artist or song.`, 4050);
}

function reinforceCompositionPlan(plan, profile, genre, instrumental) {
  if (!plan || (!Array.isArray(plan.sections) && !Array.isArray(plan.chunks))) throw new Error("El plan musical recibido no contiene secciones válidas.");
  const signature = [genre, `${profile.tempoBpm} BPM`, MUSIC_START_RULE_EN, profile.rhythm, ...profile.instrumentation, profile.vocalStyle, profile.production].filter(Boolean);
  const negatives = [...(profile.negativeStyles || []), ...(instrumental ? ["vocals", "singing", "spoken word"] : [])];
  plan.positive_global_styles = [...new Set([...signature, ...(plan.positive_global_styles || [])])].slice(0, 50);
  plan.negative_global_styles = [...new Set([...negatives, ...(plan.negative_global_styles || [])])].slice(0, 50);
  for (const section of plan.sections || []) {
    section.positive_local_styles = [...new Set([...signature, ...(section.positive_local_styles || [])])].slice(0, 50);
    section.negative_local_styles = [...new Set([...negatives, ...(section.negative_local_styles || [])])].slice(0, 50);
    if (instrumental) section.lines = [];
  }
  for (const chunk of plan.chunks || []) {
    chunk.positive_styles = [...new Set([...signature, ...(chunk.positive_styles || [])])].slice(0, 50);
    chunk.negative_styles = [...new Set([...negatives, ...(chunk.negative_styles || [])])].slice(0, 50);
  }
  return plan;
}

function parseDetailedMusicResponse(buffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  if (!boundaryMatch) {
    if (/json/i.test(contentType)) { const data = JSON.parse(buffer.toString("utf8")); return { metadata: data.json || data, audio: data.audio ? Buffer.from(data.audio, "base64") : null }; }
    return { metadata: {}, audio: buffer };
  }
  const delimiter = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`); let cursor = 0, metadata = {}, audio = null;
  while (true) {
    const start = buffer.indexOf(delimiter, cursor); if (start < 0) break;
    const next = buffer.indexOf(delimiter, start + delimiter.length); if (next < 0) break;
    let part = buffer.subarray(start + delimiter.length, next); cursor = next;
    if (part.subarray(0, 2).toString() === "\r\n") part = part.subarray(2);
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n")); if (headerEnd < 0) continue;
    const headers = part.subarray(0, headerEnd).toString("utf8").toLowerCase(); let body = part.subarray(headerEnd + 4);
    if (body.length >= 2 && body.subarray(body.length - 2).toString() === "\r\n") body = body.subarray(0, body.length - 2);
    if (headers.includes("application/json")) { const parsed = JSON.parse(body.toString("utf8")); metadata = { ...metadata, ...(parsed.json || parsed) }; }
    // La respuesta multipart puede traer más de una parte binaria (audio,
    // waveform/artefactos). Elegimos siempre la mayor: la última parte no
    // necesariamente es el audio y en algunas respuestas nuevas era silencio.
    else if (body.length && (!audio || body.length > audio.length)) audio = body;
  }
  return { metadata, audio };
}

function normalizeWordTimestamps(items) {
  return (Array.isArray(items) ? items : []).map(item => {
    const text = clean(item.word ?? item.text ?? item.value, 100);
    const rawStart = item.start_ms ?? item.start_time_ms ?? item.start ?? item.start_time;
    const rawEnd = item.end_ms ?? item.end_time_ms ?? item.end ?? item.end_time;
    const milliseconds = item.start_ms != null || item.start_time_ms != null;
    return { text, start: Number(rawStart) / (milliseconds ? 1000 : 1), end: Number(rawEnd) / (milliseconds ? 1000 : 1) };
  }).filter(item => item.text && Number.isFinite(item.start) && Number.isFinite(item.end));
}

function groupTimedWords(words) {
  const lines = []; let current = null;
  for (const word of words) {
    if (!current) current = { text: "", start: word.start, end: word.end, count: 0 };
    const spacing = /^[,.;:!?)]/.test(word.text) || /^\s+$/.test(word.text);
    current.text += spacing ? word.text : `${current.text ? " " : ""}${word.text}`; current.end = word.end; current.count++;
    if (current.count >= 7 || /[.!?]$/.test(word.text)) { lines.push({ text: current.text.trim(), start: current.start, end: current.end }); current = null; }
  }
  if (current?.text.trim()) lines.push({ text: current.text.trim(), start: current.start, end: current.end });
  return lines;
}

async function makePackage(job) {
  const manifest = { artist: job.artist, album: job.albumTitle, genre: job.genre, releaseType: job.mode === "demo" ? "Demo" : job.tracks.length === 1 ? "Single" : "Album", generatedAt: new Date().toISOString(), aiDisclosure: "AI-assisted music and artwork", tracks: job.tracks.map(t => ({ position: t.trackNumber, title: t.songTitle, file: t.filename, durationMinutes: t.durationMinutes, lyrics: t.lyrics, bpm: t.musicProfile?.tempoBpm, key: t.musicProfile?.key })), artwork: job.covers.map(c => ({ title: c.title, file: c.filename, option: c.option })) };
  const manifestFile = `${job.id}-metadata.json`;
  await writeFile(join(OUTPUT, manifestFile), JSON.stringify(manifest, null, 2));
  const zipName = `${job.id}-${job.mode}.zip`;
  await execFileAsync(join(ROOT, ".venv", "bin", "python"), [join(ROOT, "scripts", "package_release.py"), join(OUTPUT, zipName), join(OUTPUT), manifestFile], { timeout: 60 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 });
  job.exportUrl = `/exports/${zipName}`;
}

function pcmToWav(pcm, sampleRate, channels, bits) {
  const header = Buffer.alloc(44); const byteRate = sampleRate * channels * bits / 8; const align = channels * bits / 8;
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(byteRate, 28); header.writeUInt16LE(align, 32); header.writeUInt16LE(bits, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40); return Buffer.concat([header, pcm]);
}

async function staticFile(pathname, res) {
  const path = pathname === "/" ? "/index.html" : pathname;
  const target = normalize(join(PUBLIC, path));
  if (!target.startsWith(PUBLIC)) return json(res, 403, { error: "No permitido" });
  try {
    const data = await readFile(target);
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
    res.writeHead(200, { "content-type": types[extname(target)] || "application/octet-stream" }); res.end(data);
  } catch { json(res, 404, { error: "No encontrado" }); }
}

async function ollama(path, body) {
  const response = await fetch(`${OLLAMA_BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OLLAMA_API_KEY}` }, body: JSON.stringify(body) });
  if (!response.ok) throw Object.assign(new Error(`El director creativo no respondió (${response.status}): ${clean(await response.text(), 300)}`), { status: 502 });
  return response.json();
}

function demoTrend(genre) {
  return { title: "Midnight Signal", albumTitle: "Afterlight", summary: `Una dirección ${genre} envolvente, pensada para escucha nocturna y retención visual.`, hook: "Texturas cálidas que se abren lentamente sobre un pulso hipnótico.", bpm: 78, mood: ["nocturno", "cinemático", "sereno"], instruments: ["piano felt", "pads analógicos", "percusión suave"], prompt: `Original ${genre} instrumental, nocturnal cinematic atmosphere, warm felt piano, evolving analog pads, restrained organic percussion, memorable but entirely original motif, spacious mix, gentle dynamic arc, seamless ending`, visualPrompt: "A solitary obsidian tower reflected in still violet water at blue hour, soft volumetric moonlight, subtle film grain, minimalist surrealism", trackTitles: ["Midnight Signal","Violet Static","Afterlight","Silent Meridian","Glass Horizon","Slow Orbit","Nocturnal Bloom","Distant Rooms","Pale Current","Last Frequency"], sources: [], live: false };
}

function splitDuration(total, max) { const out = []; let left = total; while (left > 0.001) { const n = Math.min(left, max); out.push(Math.round(n * 100) / 100); left -= n; } return out; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function clean(value, max = 0) { const text = String(value || "").replace(/[\u0000-\u001f]/g, " ").trim(); return max > 0 ? text.slice(0, max) : text; }
function cleanMultiline(value, max = 200) { return String(value || "").replace(/[\u0000-\u0009\u000b-\u001f]/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max); }
function parseModelJson(value) {
  const text = String(value).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf("{"); const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("JSON ausente");
  return JSON.parse(text.slice(start, end + 1));
}
function json(res, status, value) { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(value)); }
async function bodyJson(req) { let raw = ""; for await (const chunk of req) { raw += chunk; if (raw.length > 20000) throw Object.assign(new Error("Solicitud demasiado grande"), { status: 413 }); } try { return JSON.parse(raw || "{}"); } catch { throw Object.assign(new Error("JSON no válido"), { status: 400 }); } }
async function loadEnv() { try { const text = await readFile(join(ROOT, ".env"), "utf8"); for (const line of text.split(/\r?\n/)) { const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } } catch {} }
async function persistJob(job) {
  const previous = saveQueues.get(job.id) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const target = join(JOBS, `${job.id}.json`), temporary = join(JOBS, `${job.id}.tmp`);
    await writeFile(temporary, JSON.stringify(job, null, 2)); await rename(temporary, target);
  });
  saveQueues.set(job.id, next); await next;
}
async function loadJobs() {
  try {
    for (const name of await readdir(JOBS)) {
      if (!name.endsWith(".json")) continue;
      try {
        const job = JSON.parse(await readFile(join(JOBS, name), "utf8"));
        if (["queued", "generating"].includes(job.status)) { job.status = "interrupted"; job.phase = "Interrumpida por reinicio"; job.error = "La aplicación se reinició durante la producción. Los archivos terminados siguen disponibles."; }
        jobs.set(job.id, job);
      } catch {}
    }
  } catch {}
}
