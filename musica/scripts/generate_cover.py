#!/usr/bin/env python3
import argparse, os
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--prompt")
parser.add_argument("--output")
parser.add_argument("--seed", type=int, default=42)
parser.add_argument("--warmup", action="store_true")
args = parser.parse_args()

os.environ.setdefault("HF_HOME", str(Path(__file__).resolve().parents[1] / ".cache" / "huggingface"))
import torch
from diffusers import AutoPipelineForText2Image
from PIL import Image

model = os.environ.get("COVER_MODEL", "stabilityai/sd-turbo")
pipe = AutoPipelineForText2Image.from_pretrained(model, torch_dtype=torch.float32, local_files_only=not args.warmup)
pipe.to("cpu")
if args.warmup:
    print(f"{model} descargado")
    raise SystemExit(0)
if not args.prompt or not args.output:
    parser.error("--prompt y --output son obligatorios")

torch.set_num_threads(max(1, (os.cpu_count() or 4) - 2))
generator = torch.Generator(device="cpu").manual_seed(args.seed)
prompt = f"{args.prompt}, square album cover artwork, premium editorial composition, no text, no letters, no logos, no watermark"
image = pipe(prompt=prompt, num_inference_steps=4, guidance_scale=0.0, generator=generator, height=512, width=512).images[0]
image.resize((3000, 3000), Image.Resampling.LANCZOS).convert("RGB").save(args.output, "PNG", optimize=True)
