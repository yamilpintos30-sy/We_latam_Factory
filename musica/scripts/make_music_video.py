#!/usr/bin/env python3
import argparse
import json
import re
import subprocess
from pathlib import Path

import imageio_ffmpeg


def media_duration(ffmpeg: str, media: Path) -> float:
    probe = subprocess.run(
        [ffmpeg, "-hide_banner", "-i", str(media)],
        capture_output=True,
        text=True,
        timeout=60,
    )
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", probe.stderr)
    if not match:
        raise RuntimeError("No se pudo determinar la duración del archivo")
    hours, minutes, seconds = match.groups()
    duration = int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    if duration <= 0:
        raise RuntimeError("El archivo no tiene una duración válida")
    return duration


def main() -> None:
    parser = argparse.ArgumentParser(description="Sustituye el audio de un vídeo por una canción.")
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--audio", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--title", default="")
    parser.add_argument("--artist", default="")
    args = parser.parse_args()

    if not args.video.is_file():
        raise FileNotFoundError("No se encontró el vídeo base")
    if not args.audio.is_file():
        raise FileNotFoundError("No se encontró la canción seleccionada")

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    duration = media_duration(ffmpeg, args.audio)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".tmp.mp4")
    command = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-stream_loop", "-1", "-i", str(args.video),
        "-i", str(args.audio),
        "-map", "0:v:0", "-map", "1:a:0",
        "-map_metadata", "0",
        "-vf", "fps=24,format=yuv420p",
        "-c:v", "libx264", "-profile:v", "high", "-preset", "veryfast", "-crf", "18",
        "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-ac", "2",
        "-t", f"{duration:.6f}",
        "-shortest",
        "-movflags", "+faststart",
        "-metadata", f"title={args.title}",
        "-metadata", f"artist={args.artist}",
        str(temporary),
    ]
    try:
        subprocess.run(command, check=True, timeout=1800)
        temporary.replace(args.output)
    finally:
        temporary.unlink(missing_ok=True)

    print(json.dumps({"durationSeconds": duration, "output": str(args.output)}))


if __name__ == "__main__":
    main()
