const $ = selector => document.querySelector(selector);
const toolUrl = value => typeof value === "string" && value.startsWith("/") && !value.startsWith("/tools/music/") ? `/tools/music${value}` : value;
const genre = $("#genre"), promptInput = $("#prompt"), usePrompt = $("#usePrompt"), discover = $("#discover"), manual = $("#manual"), create = $("#create");
const slider = $("#minutes"), durationOut = $("#durationOut"), concept = $("#concept"), audio = $("#audioEngine");
let currentConcept = null, pollTimer = null, selectedCoverSeed = null, activeTrack = null, lastJob = null, activeLyricIndex = -1;
const configs = {
  long: { min: 3, max: 3, step: 1, value: 3, help: "Cada master final dura 3:00; aumenta la cantidad para una colección larga" },
  video: { min: 3, max: 3, step: 1, value: 3, help: "Cada canción final incluye WAV, portada y MP4 de 3:00" },
  short: { min: 3, max: 3, step: 1, value: 3, help: "El lanzamiento conserva masters completos de 3:00" }
};

document.querySelectorAll('[name="format"]').forEach(radio => radio.addEventListener("change", () => {
  document.querySelectorAll(".format").forEach(card => card.classList.toggle("selected", card.contains(radio)));
  const config = configs[radio.value]; Object.assign(slider, { min: config.min, max: config.max, step: config.step, value: config.value });
  $("#durationHelp").textContent = config.help; showDuration();
}));
slider.addEventListener("input", showDuration);
function showDuration() { const seconds = Math.round(Number(slider.value) * 60); durationOut.value = formatTime(seconds); }

discover.addEventListener("click", () => findConcept(true));
manual.addEventListener("click", () => findConcept(false));
async function findConcept(useTrends) {
  if (!genre.value.trim()) return genre.focus();
  const button = useTrends ? discover : manual, idle = useTrends ? "✦ Explorar tendencias" : "Usar mi género";
  setBusy(button, true, useTrends ? "Explorando…" : "Dirigiendo…"); concept.classList.add("hidden"); create.disabled = true;
  try {
    currentConcept = await api("/tools/music/api/trends", { genre: genre.value.trim(), useTrends });
    $("#conceptTitle").textContent = currentConcept.title; $("#conceptSummary").textContent = currentConcept.summary; $("#conceptHook").textContent = currentConcept.hook;
    $("#liveBadge").textContent = currentConcept.mode === "manual" ? "GÉNERO PROPIO" : currentConcept.live ? "RADAR EN VIVO" : "MODO DEMO";
    $("#conceptTags").innerHTML = [`${currentConcept.bpm} BPM`, ...(currentConcept.mood || []), ...(currentConcept.instruments || [])].map(tag => `<span>${escapeHtml(tag)}</span>`).join("");
    $("#sources").innerHTML = (currentConcept.sources || []).slice(0, 4).map(source => `<a href="${safeUrl(source.url)}" target="_blank" rel="noreferrer">↗ ${escapeHtml(source.title)}</a>`).join("");
    concept.classList.remove("hidden"); create.disabled = false;
  } catch (error) { notify(error.message); }
  finally { setBusy(button, false, idle); }
}

$("#studioForm").addEventListener("submit", event => { event.preventDefault(); if (!currentConcept && promptInput.value.trim()) usePrompt?.click(); if (currentConcept) generate("demo"); else promptInput.focus(); });
usePrompt?.addEventListener("click", () => {
  const value = promptInput.value.trim();
  if (!value) return promptInput.focus();
  currentConcept = { title: "Prompt personalizado", albumTitle: "Prompt personalizado", prompt: value, trackTitles: [], musicProfile: null, bpm: 100, instruments: [], visualPrompt: "" };
  $("#conceptTitle").textContent = "Prompt personalizado"; $("#conceptSummary").textContent = "La dirección creativa se enviará directamente al motor musical."; $("#conceptHook").textContent = value; $("#liveBadge").textContent = "PROMPT DIRECTO"; $("#conceptTags").innerHTML = ""; $("#sources").innerHTML = ""; concept.classList.remove("hidden"); create.disabled = false;
});
$("#approve").addEventListener("click", () => generate("album"));
async function generate(mode) {
  if (!currentConcept) return;
  if (mode === "demo") selectedCoverSeed = null;
  create.disabled = true; $("#approve").classList.add("hidden"); $("#download").classList.add("hidden");
  try {
    const { job } = await api("/tools/music/api/generate", {
      mode, genre: genre.value, artist: $("#artist").value, count: Number($("#count").value), format: $('[name="format"]:checked').value,
      minutes: Number(slider.value), instrumental: $("#instrumental").checked, title: currentConcept.title, albumTitle: currentConcept.albumTitle,
      trackTitles: currentConcept.trackTitles, musicProfile: currentConcept.musicProfile, bpm: currentConcept.bpm, instruments: currentConcept.instruments, visualPrompt: currentConcept.visualPrompt, prompt: promptInput.value.trim() || currentConcept.prompt, coverSeed: mode === "album" ? selectedCoverSeed : undefined
    });
    $("#jobPanel").classList.remove("hidden"); $("#jobPanel").scrollIntoView({ behavior: "smooth", block: "start" }); refreshLibrary(false); watch(job.id);
  } catch (error) { notify(error.message); create.disabled = false; }
}

async function watch(id) {
  clearTimeout(pollTimer);
  try {
    const response = await fetch(`/tools/music/api/jobs/${id}`); const { job } = await response.json(); lastJob = job; renderJob(job);
    if (!["complete", "failed", "demo"].includes(job.status)) pollTimer = setTimeout(() => watch(id), 1200); else create.disabled = false;
  } catch { pollTimer = setTimeout(() => watch(id), 2500); }
}

function renderJob(job) {
  $("#jobTitle").textContent = job.albumTitle || job.title; $("#progressText").textContent = `${job.progress}%`; $("#progressBar").style.width = `${job.progress}%`;
  $("#jobMessage").textContent = jobMessage(job);
  $("#tracks").innerHTML = job.tracks.length ? job.tracks.map(track => `<div class="track ${activeTrack?.filename === track.filename ? "playing" : ""}"><button class="track-main" data-track="${escapeHtml(track.filename)}" type="button"><span class="track-play">${activeTrack?.filename === track.filename && !audio.paused ? "Ⅱ" : "▶"}</span><span class="track-copy"><p>${escapeHtml(track.name)}</p><small>${escapeHtml(job.artist)} · WAV 48 kHz${track.musicProfile?.tempoBpm ? ` · ${track.musicProfile.tempoBpm} BPM` : ""}${track.lyrics?.length ? " · con letra" : " · instrumental"}</small></span><time>${formatTime(track.durationMinutes * 60)}</time></button><a class="track-download" href="${toolUrl(track.url)}" download="${escapeHtml(track.filename)}" title="Descargar ${escapeHtml(track.songTitle)} en WAV"><b>↓</b><span>WAV</span></a></div>`).join("") : `<div class="empty-state"><span>✦</span><p>Primero investigamos la identidad de cada canción.<br>El audio aparecerá sin esperar a las portadas.</p></div>`;
  if (job.mode === "demo" && !selectedCoverSeed && job.covers[0]) selectedCoverSeed = job.covers[0].seed;
  $("#covers").innerHTML = job.covers.length ? job.covers.map(cover => `<button class="cover-card ${cover.seed === selectedCoverSeed ? "selected" : ""}" data-seed="${cover.seed}" data-option="${cover.option}" type="button"><img src="${toolUrl(cover.url)}" alt="Opción ${cover.option} para ${escapeHtml(cover.title)}"><small>0${cover.option}${cover.seed === selectedCoverSeed ? " · SELECCIONADA" : " · ELEGIR"}</small></button>`).join("") : `<div class="empty-state">Creando arte en tu CPU…</div>`;
  if (!activeTrack && job.tracks[0]) loadTrack(job.tracks[0], false, job);
  if (job.status === "complete" && job.mode === "demo") $("#approve").classList.remove("hidden");
  if (job.status === "complete" && job.exportUrl) { $("#download").href = toolUrl(job.exportUrl); $("#download").classList.remove("hidden"); }
  renderVideoActions();
}

$("#tracks").addEventListener("click", event => { const button = event.target.closest("[data-track]"); if (!button || !lastJob) return; const track = lastJob.tracks.find(item => item.filename === button.dataset.track); if (!track) return; if (activeTrack?.filename === track.filename) togglePlay(); else loadTrack(track, true, lastJob); });
$("#covers").addEventListener("click", event => { const card = event.target.closest("[data-seed]"); if (!card) return; selectedCoverSeed = Number(card.dataset.seed); document.querySelectorAll(".cover-card").forEach(item => { item.classList.toggle("selected", item === card); item.querySelector("small").textContent = `0${item.dataset.option}${item === card ? " · SELECCIONADA" : " · ELEGIR"}`; }); if (activeTrack) updatePlayerCover(); });

function loadTrack(track, autoplay = false, job = lastJob) {
  activeTrack = track; audio.src = toolUrl(track.url); audio.load(); audio.volume = Number($("#volume").value); $("#playerDock").classList.remove("hidden");
  $("#nowTitle").textContent = track.songTitle; $("#nowArtist").textContent = job?.artist || "Nocturne"; $("#lyricsTitle").textContent = track.songTitle;
  renderLyrics(track); updatePlayerCover(); renderJobPlayingState(); renderVideoActions(); if (autoplay) audio.play().catch(() => {});
}
function renderVideoActions() {
  const button = $("#makeVideo"), download = $("#videoDownload");
  button.classList.toggle("hidden", !activeTrack || !lastJob);
  const ready = Boolean(activeTrack?.videoUrl);
  download.classList.toggle("hidden", !ready);
  if (ready) { download.href = toolUrl(activeTrack.videoUrl); download.download = activeTrack.videoFilename || "video-musical.mp4"; }
}
$("#makeVideo").addEventListener("click", async () => {
  if (!activeTrack || !lastJob) return;
  const button = $("#makeVideo");
  button.disabled = true;
  button.innerHTML = `<span><b>Creando vídeo…</b><small>Conservando el vídeo 1080p y reemplazando el audio</small></span><i>⋯</i>`;
  try {
    const { video } = await api("/tools/music/api/video", { jobId: lastJob.id, filename: activeTrack.filename });
    Object.assign(activeTrack, { videoUrl: video.url, videoFilename: video.filename, videoDurationSeconds: video.durationSeconds });
    renderVideoActions();
  } catch (error) { notify(error.message); }
  finally {
    button.disabled = false;
    button.innerHTML = `<span><b>Crear vídeo con la canción seleccionada</b><small>El vídeo se adapta a la duración de la canción</small></span><i>▶</i>`;
  }
});
function updatePlayerCover() { const selected = lastJob?.covers.find(cover => cover.seed === selectedCoverSeed) || lastJob?.covers[0]; $("#nowCover").innerHTML = selected ? `<img src="${toolUrl(selected.url)}" alt="">` : `<span>✦</span>`; }
function togglePlay() { if (!activeTrack) return; audio.paused ? audio.play().catch(() => {}) : audio.pause(); }
$("#playButton").addEventListener("click", togglePlay);
audio.addEventListener("play", renderJobPlayingState); audio.addEventListener("pause", renderJobPlayingState); audio.addEventListener("ended", renderJobPlayingState);
function renderJobPlayingState() { $("#playButton span").textContent = audio.paused ? "▶" : "Ⅱ"; document.querySelectorAll("[data-track]").forEach(button => { const playing = button.dataset.track === activeTrack?.filename; button.closest(".track")?.classList.toggle("playing", playing); button.querySelector(".track-play").textContent = playing && !audio.paused ? "Ⅱ" : "▶"; }); }
audio.addEventListener("loadedmetadata", () => { $("#durationTime").textContent = formatTime(audio.duration); });
audio.addEventListener("timeupdate", () => { $("#currentTime").textContent = formatTime(audio.currentTime); $("#seek").value = audio.duration ? Math.round(audio.currentTime / audio.duration * 1000) : 0; syncLyrics(); });
$("#seek").addEventListener("input", event => { if (audio.duration) audio.currentTime = Number(event.target.value) / 1000 * audio.duration; });
$("#volume").addEventListener("input", event => { audio.volume = Number(event.target.value); });

$("#lyricsToggle").addEventListener("click", () => $("#lyricsPanel").classList.add("open")); $("#lyricsClose").addEventListener("click", () => $("#lyricsPanel").classList.remove("open"));
function renderLyrics(track = {}) {
  activeLyricIndex = -1;
  const body = $("#lyricsBody"), synced = Array.isArray(track.syncedLyrics) ? track.syncedLyrics.filter(line => Number.isFinite(Number(line.start))) : [];
  body.className = "lyrics-body";
  if (synced.length) {
    body.innerHTML = synced.map((line, index) => `<span data-line="${index}" data-start="${Number(line.start)}" data-end="${Number(line.end)}">${escapeHtml(line.text)}</span>`).join("");
  } else if (track.lyrics?.length) {
    body.innerHTML = `<small class="lyrics-note">Esta generación anterior no incluye tiempos de voz.</small>${track.lyrics.map(line => `<span>${escapeHtml(line)}</span>`).join("")}`;
  } else {
    body.innerHTML = `<span>Esta pieza es instrumental.<br><br>Déjate llevar por el paisaje sonoro.</span>`;
  }
}
function syncLyrics() {
  const lines = [...document.querySelectorAll("#lyricsBody [data-start]")];
  if (!lines.length) return;
  const time = audio.currentTime;
  let active = -1;
  for (let index = 0; index < lines.length; index++) {
    if (time + .04 >= Number(lines[index].dataset.start)) active = index; else break;
  }
  if (active === activeLyricIndex) return;
  activeLyricIndex = active;
  lines.forEach((line, index) => { line.classList.toggle("active", index === active); line.classList.toggle("past", index < active); });
  if (active >= 0) lines[active].scrollIntoView({ block: "center", behavior: "smooth" });
}

function jobMessage(job) { if (job.status === "complete" && job.mode === "demo") return "Demo terminada. Escucha, elige una portada y aprueba el universo."; if (job.status === "complete") return "Lanzamiento listo para descargar."; if (job.status === "failed") return `La producción se detuvo: ${job.error}`; if (job.status === "demo") return job.error; const ready = job.tracks.length ? `${job.tracks.length} audio${job.tracks.length > 1 ? "s" : ""} listo${job.tracks.length > 1 ? "s" : ""} para escuchar` : "El primer audio está en proceso"; return `${job.phase || "Produciendo"} · ${ready}.`; }
async function api(url, body) { const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "No se pudo completar"); return data; }
function setBusy(button, busy, text) { button.disabled = busy; button.textContent = text; }
function notify(message) { window.alert(message); }
function formatTime(value) { if (!Number.isFinite(Number(value))) return "0:00"; const seconds = Math.max(0, Math.round(Number(value))); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
function escapeHtml(value) { const node = document.createElement("div"); node.textContent = value ?? ""; return node.innerHTML; }
function safeUrl(value) { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : "#"; } catch { return "#"; } }
fetch("/tools/music/api/health").then(response => response.json()).then(state => { $("#apiStatus").textContent = state.creativeEngine && state.musicEngine ? "STUDIO ONLINE" : "CONFIGURACIÓN INCOMPLETA"; });

$("#refreshLibrary").addEventListener("click", () => refreshLibrary(false));
$("#historyGrid").addEventListener("click", async event => {
  const card = event.target.closest("[data-job]"); if (!card) return;
  try { const { job } = await fetch(`/tools/music/api/jobs/${card.dataset.job}`).then(response => response.json()); openSavedJob(job); }
  catch { notify("No se pudo abrir esta sesión."); }
});

async function refreshLibrary(restoreActive = false) {
  try {
    const { jobs } = await fetch("/tools/music/api/jobs").then(response => response.json());
    $("#historyGrid").innerHTML = jobs.length ? jobs.map(job => {
      const cover = job.covers?.[0]; const date = new Date(job.createdAt).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" });
      return `<button class="history-card" data-job="${job.id}" type="button"><span class="history-status ${job.status}"></span><span class="history-art">${cover ? `<img src="${toolUrl(cover.url)}" alt="">` : "<span>✦</span>"}</span><span class="history-copy"><small>${statusLabel(job.status)} · ${job.progress || 0}%</small><b>${escapeHtml(job.albumTitle || job.title)}</b><span>${escapeHtml(job.artist)} · ${job.tracks?.length || 0} pista${job.tracks?.length === 1 ? "" : "s"} · ${date}</span></span></button>`;
    }).join("") : `<div class="history-empty">Tu archivo creativo está vacío. La próxima generación aparecerá aquí.</div>`;
    if (restoreActive) {
      const active = jobs.find(job => ["queued", "generating"].includes(job.status));
      if (active) openSavedJob(active, true);
    }
  } catch {}
}

function openSavedJob(job, keepPosition = false) {
  audio.pause(); activeTrack = null; lastJob = job; selectedCoverSeed = job.coverSeed || job.covers?.[0]?.seed || null;
  currentConcept = { title: job.title, albumTitle: job.albumTitle, prompt: job.source?.prompt, trackTitles: job.source?.trackTitles || [], musicProfile: job.source?.musicProfile || job.musicProfile, visualPrompt: job.source?.visualPrompt || job.visualPrompt };
  genre.value = job.genre || genre.value; $("#artist").value = job.artist || ""; $("#count").value = job.source?.count || 1; $("#instrumental").checked = Boolean(job.source?.instrumental);
  if (job.source?.minutes) { slider.value = job.source.minutes; showDuration(); }
  $("#jobPanel").classList.remove("hidden"); renderJob(job);
  if (!keepPosition) $("#jobPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  if (["queued", "generating"].includes(job.status)) watch(job.id);
}
function statusLabel(status) { return ({ queued: "EN COLA", generating: "GENERANDO", complete: "LISTO", failed: "ERROR", interrupted: "INTERRUMPIDO", demo: "DEMO" })[status] || String(status).toUpperCase(); }

refreshLibrary(true);
setInterval(() => refreshLibrary(false), 5000);
