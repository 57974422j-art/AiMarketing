#!/usr/bin/env python3
"""
AI 人声分离脚本
用法: python vocal_separate.py <输入音频/视频> <输出背景音路径>
先 FFmpeg 提取 WAV，再送 Demucs 分离
"""
import sys
import os
import json
import subprocess
import tempfile


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "missing args"}))
        sys.exit(1)

    input_path = sys.argv[1]
    output_bg = sys.argv[2]

    if not os.path.isfile(input_path):
        print(json.dumps({"success": False, "error": f"file not found: {input_path}"}))
        sys.exit(1)

    try:
        from demucs.apply import apply_model
        from demucs.pretrained import get_model
        import torch

        print("[VocalSeparate] 加载 Demucs 模型...", file=sys.stderr)
        model = get_model("htdemucs")
        model.cpu()
        model.eval()

        # 用 FFmpeg 提取 WAV（避开 torchcodec 的 FFmpeg DLL 依赖）
        print("[VocalSeparate] 提取音频...", file=sys.stderr)
        wav_path = os.path.join(tempfile.gettempdir(), "demucs_input.wav")
        subprocess.run(
            ["ffmpeg", "-y", "-i", input_path, "-vn", "-acodec", "pcm_s16le",
             "-ar", "44100", "-ac", "2", wav_path],
            capture_output=True, timeout=120, check=True,
        )

        import soundfile as sf
        print("[VocalSeparate] 加载音频...", file=sys.stderr)
        data, sr = sf.read(wav_path)  # [T, C]
        wav = torch.from_numpy(data.T).float()  # [C, T]
        os.unlink(wav_path)

        print(f"[VocalSeparate] 音频: {wav.shape}, 采样率: {sr}Hz", file=sys.stderr)

        # 分块处理避免 OOM
        chunk_size = int(30 * sr)
        all_sources = None
        for start in range(0, wav.shape[-1], chunk_size):
            chunk = wav[..., start:start + chunk_size]
            if chunk.shape[-1] < sr:
                break
            with torch.no_grad():
                sources = apply_model(model, chunk.unsqueeze(0), device='cpu')[0]
            if all_sources is None:
                all_sources = sources
            else:
                all_sources = torch.cat([all_sources, sources], dim=-1)

        if all_sources is None:
            with torch.no_grad():
                all_sources = apply_model(model, wav.unsqueeze(0), device='cpu')[0]

        # 背景音 = drums + bass + other (不含 vocals, index=3)
        bg = all_sources[:3].sum(dim=0)
        # 防削波
        peak = bg.abs().max()
        if peak > 0:
            bg = bg / peak * 0.9
        bg = bg.cpu()

        print(f"[VocalSeparate] 分离完成, 输出: {output_bg}", file=sys.stderr)
        bg_wav = os.path.join(tempfile.gettempdir(), "bg_out.wav")
        sf.write(bg_wav, bg.T.numpy(), sr)

        subprocess.run(
            ["ffmpeg", "-y", "-i", bg_wav, "-c:a", "aac", "-b:a", "128k", output_bg],
            capture_output=True, timeout=60, check=True,
        )
        os.unlink(bg_wav)

        if os.path.isfile(output_bg) and os.path.getsize(output_bg) > 1000:
            print(json.dumps({"success": True, "output": output_bg}))
            sys.exit(0)

        print(json.dumps({"success": False, "error": "output file error"}))
        sys.exit(1)

    except ImportError as e:
        print(f"[VocalSeparate] Demucs 未安装: {e}", file=sys.stderr)
        print(json.dumps({"success": False, "error": "demucs not installed"}))
        sys.exit(1)
    except Exception as e:
        import traceback
        print(f"[VocalSeparate] 失败: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
