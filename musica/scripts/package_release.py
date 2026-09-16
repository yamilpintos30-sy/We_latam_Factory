#!/usr/bin/env python3
import csv
import io
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageFilter


target, root, manifest_name = sys.argv[1:4]
target, root = Path(target), Path(root)
meta = json.loads((root / manifest_name).read_text(encoding="utf-8"))
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()


def safe_name(value):
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", str(value)).strip(" .")
    return re.sub(r"\s+", " ", value)[:120] or "Sin titulo"


def csv_text(rows):
    stream = io.StringIO(newline="")
    csv.writer(stream).writerows(rows)
    return stream.getvalue()


def cover_for(track):
    exact = next((art for art in meta["artwork"] if art.get("title") == track["title"]), None)
    return exact or (meta["artwork"][0] if meta["artwork"] else None)


def make_art_frame(source, destination, width, height, foreground_size, image_format, **save_options):
    with Image.open(source).convert("RGB") as original:
        scale = max(width / original.width, height / original.height)
        background = original.resize((round(original.width * scale), round(original.height * scale)), Image.Resampling.LANCZOS)
        background = background.crop(((background.width - width) // 2, (background.height - height) // 2, (background.width + width) // 2, (background.height + height) // 2)).filter(ImageFilter.GaussianBlur(28))
        foreground = original.copy()
        foreground.thumbnail((foreground_size, foreground_size), Image.Resampling.LANCZOS)
        background.paste(foreground, ((width - foreground.width) // 2, (height - foreground.height) // 2))
        background.save(destination, image_format, **save_options)


def make_video(frame, audio, destination, title):
    command = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-framerate", "30", "-i", str(frame), "-i", str(audio),
        "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-profile:v", "high", "-preset", "veryfast", "-tune", "stillimage", "-crf", "18", "-pix_fmt", "yuv420p",
        "-r", "30", "-g", "15", "-keyint_min", "15", "-sc_threshold", "0", "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-ac", "2",
        "-shortest", "-movflags", "+faststart", "-metadata", f"title={title}", "-metadata", f"artist={meta['artist']}", "-metadata", f"album={meta['album']}", str(destination),
    ]
    subprocess.run(command, check=True, timeout=3600)


spotify_rows = [["track_number", "title", "artist", "album", "genre", "wav_file", "duration_minutes", "bpm", "key", "explicit", "songwriter", "composer", "producer", "isrc", "copyright"]]
youtube_rows = [["track_number", "video_title", "mp4_file", "thumbnail_file", "description"]]
generated = []

for sequence, track in enumerate(meta["tracks"], 1):
    number = int(track.get("position") or sequence)
    stem = f"{number:02d} - {safe_name(track['title'])}"
    art = cover_for(track)
    if not art:
        raise RuntimeError("No hay una portada terminada para crear los entregables.")
    cover_path, audio_path = root / art["file"], root / track["file"]
    video_path = root / f"{target.stem}-youtube-{number:02d}.mp4"
    thumbnail_path = root / f"{target.stem}-thumbnail-{number:02d}.jpg"
    frame_path = root / f"{target.stem}-frame-{number:02d}.jpg"
    make_art_frame(cover_path, thumbnail_path, 1280, 720, 680, "JPEG", quality=91, optimize=True, progressive=True)
    make_art_frame(cover_path, frame_path, 1920, 1080, 900, "JPEG", quality=95, optimize=True)
    make_video(frame_path, audio_path, video_path, track["title"])
    frame_path.unlink(missing_ok=True)
    generated.append((track, stem, art, video_path, thumbnail_path))
    spotify_rows.append([number, track["title"], meta["artist"], meta["album"], meta["genre"], f"audio/{stem}.wav", track.get("durationMinutes", 3), track.get("bpm", ""), track.get("key", ""), "No", "COMPLETAR", "COMPLETAR", meta["artist"], "", "COMPLETAR"])
    video_title = f"{meta['artist']} - {track['title']} (Official Audio)"
    description = f"{track['title']} — {meta['artist']}\nÁlbum: {meta['album']}\nGénero: {meta['genre']}\n\nProducción original."
    youtube_rows.append([number, video_title, f"videos/{stem}.mp4", f"thumbnails/{stem}.jpg", description])

spotify_readme = """PAQUETE PARA SPOTIFY / DISTRIBUIDORA

Spotify recibe música mediante una distribuidora, no mediante una carga directa en Spotify for Artists.
Incluye masters WAV PCM lossless, portada cuadrada de 3000x3000 y metadatos editables.
Antes de enviar completa compositor, autor, copyright, fecha de lanzamiento, ISRC/UPC si corresponde y revisa las reglas de tu distribuidora.
No declares contenido, voces, samples o derechos que no te pertenezcan.
"""
youtube_readme = """PAQUETE PARA YOUTUBE

Cada MP4 está codificado en H.264 High Profile, video progresivo 1080p 16:9, audio AAC estéreo 48 kHz y fast start.
Incluye thumbnail JPG 1280x720 y una planilla con título y descripción sugeridos.
Revisa título, descripción, audiencia, derechos y visibilidad antes de publicar.
"""

with zipfile.ZipFile(target, "w", zipfile.ZIP_STORED, allowZip64=True) as archive:
    archive.writestr("Spotify/LEEME.txt", spotify_readme)
    archive.writestr("Spotify/metadata/release.csv", csv_text(spotify_rows))
    archive.writestr("Spotify/metadata/release.json", json.dumps(meta, ensure_ascii=False, indent=2))
    archive.writestr("YouTube/LEEME.txt", youtube_readme)
    archive.writestr("YouTube/metadata/videos.csv", csv_text(youtube_rows))
    if meta["artwork"]:
        archive.write(root / meta["artwork"][0]["file"], "Spotify/artwork/cover.png")
    for track, stem, art, video_path, thumbnail_path in generated:
        archive.write(root / track["file"], f"Spotify/audio/{stem}.wav")
        archive.write(root / art["file"], f"Spotify/artwork/tracks/{stem}.png")
        archive.write(video_path, f"YouTube/videos/{stem}.mp4")
        archive.write(thumbnail_path, f"YouTube/thumbnails/{stem}.jpg")
