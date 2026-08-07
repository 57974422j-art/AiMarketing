#!/usr/bin/env python3
"""
FunASR 语音识别脚本
用法: python funasr_asr.py <音频文件路径>
输出: JSON 到 stdout
"""

import json
import sys
import os
# 2026-08-06：固定 modelscope 本地缓存（模型已下载，避免每次重复下载）
MODELSCOPE_CACHE = os.path.join(os.path.expanduser('~'), '.cache', 'modelscope', 'models')
def _m(name):
    return os.path.join(MODELSCOPE_CACHE, name, 'snapshots', 'master')
ASR_MODEL = _m('iic--speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch')
VAD_MODEL = _m('iic--speech_fsmn_vad_zh-cn-16k-common-pytorch')
PUNC_MODEL = _m('iic--punc_ct-transformer_zh-cn-common-vocab272727-pytorch')
SV_MODEL = _m('iic--speech_campplus_sv_zh-cn_16k-common')
if not os.path.exists(ASR_MODEL):
    os.environ.setdefault('MODELSCOPE_CACHE', MODELSCOPE_CACHE)
import re
from contextlib import redirect_stdout


def json_print(obj):
    text = json.dumps(obj, ensure_ascii=False) + '\n'
    data = text.encode('utf-8')
    try:
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
    except Exception:
        try:
            sys.stderr.buffer.write(data)
            sys.stderr.flush()
        except Exception:
            print(json.dumps(obj, ensure_ascii=True))


def build_sentences_from_ts(text, char_ts):
    if not text or not char_ts:
        return []

    def pick(i):
        if 0 <= i < len(char_ts):
            t = char_ts[i]
            if isinstance(t, (list, tuple)) and len(t) >= 2:
                return float(t[0]), float(t[1])
        return None, None

    def seg(start_pos, end_pos, txt):
        sm, _ = pick(start_pos)
        _, em = pick(min(end_pos, len(char_ts) - 1))
        if sm is None:
            sm = 0.0
        if em is None or em <= sm:
            em = sm + 1.0
        return {
            "text": txt.strip(),
            "start": round(sm / 1000.0, 3),
            "end": round(em / 1000.0, 3),
            "speaker": "",
        }

    punct_re = re.compile(r'([。！？，])')
    parts = punct_re.split(text)

    sentences = []
    char_idx = 0
    tot_len = len(text)

    i = 0
    while i < len(parts):
        tp = parts[i]
        if not tp.strip():
            char_idx += len(tp)
            i += 1
            continue
        pk = ''
        if i + 1 < len(parts) and parts[i + 1] in ('。', '？', '！', '，'):
            pk = parts[i + 1]
            i += 2
        else:
            i += 1
        st = (tp + pk).strip()
        rl = len(tp) + len(pk)
        if st and char_idx < tot_len:
            end_pos = min(char_idx + rl, tot_len)
            sentences.append(seg(char_idx, end_pos, st))
        char_idx += rl

    if not sentences:
        return [seg(0, len(text), text)]

    return sentences


def assign_speakers(sentences, spk_segments):
    """
    根据说话人段的时间戳，为每个 ASR 句子分配说话人。
    spk_segments: [{start_ms, end_ms, speaker}, ...]
    """
    if not spk_segments:
        return sentences

    def overlap(a_start, a_end, b_start, b_end):
        return max(0, min(a_end, b_end) - max(a_start, b_start))

    speaker_name_map = {}
    speaker_idx = 0

    for s in sentences:
        s_start = s["start"] * 1000  # 转毫秒
        s_end = s["end"] * 1000
        best_overlap = 0
        best_speaker = ""

        for spk in spk_segments:
            spk_start = spk.get("start", 0)
            spk_end = spk.get("end", 0)
            o = overlap(s_start, s_end, spk_start, spk_end)
            if o > best_overlap:
                best_overlap = o
                best_speaker = spk.get("speaker", "")

        if best_speaker and best_speaker not in speaker_name_map:
            speaker_idx += 1
            speaker_name_map[best_speaker] = f"SPEAKER_{speaker_idx:02d}"

        s["speaker"] = speaker_name_map.get(best_speaker, best_speaker) if best_overlap > 0 else ""

    return sentences


def run_speaker_diarization(audio_path, sentences=None):
    """
    独立运行 Cam++ 说话人分离。
    先用 VAD 分段，然后提取说话人嵌入，再用聚类分配说话人标签。
    如果失败，降级为无标签。
    """
    try:
        with redirect_stdout(sys.stderr):
            from funasr import AutoModel

            # 加载说话人嵌入模型（已下载）
            sv_model = AutoModel(
                model=SV_MODEL,
                disable_update=True,
            )

        # 如果传入了 ASR 句子时间戳，直接用它分段
        if sentences and len(sentences) > 0:
            print(f"[Diarization] 使用 {len(sentences)} 个 ASR 句段时间戳", file=sys.stderr)
            import subprocess
            import tempfile
            import numpy as np

            embeddings = []
            valid_segments = []

            for i, s in enumerate(sentences):
                start_sec = s.get("start", 0)
                end_sec = s.get("end", 0)
                duration = end_sec - start_sec
                if duration < 0.3 or duration > 60:
                    continue  # 跳过太短或太长的段

                # 用 FFmpeg 截取该段的音频片段到临时文件
                tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
                tmp_name = tmp.name
                tmp.close()
                try:
                    subprocess.run(
                        ["ffmpeg", "-y", "-i", audio_path, "-ss", str(start_sec),
                         "-to", str(end_sec), "-ar", "16000", "-ac", "1",
                         "-f", "wav", tmp_name],
                        capture_output=True, timeout=30,
                    )
                    with redirect_stdout(sys.stderr):
                        emb_result = sv_model.generate(input=tmp_name)
                    if emb_result and len(emb_result) > 0:
                        emb = emb_result[0]
                        if isinstance(emb, dict):
                            emb_vec = emb.get("spk_embedding", emb.get("embedding", emb.get("emb", None)))
                        elif isinstance(emb, (list, np.ndarray)):
                            emb_vec = emb
                        else:
                            emb_vec = None
                        if emb_vec is not None and hasattr(emb_vec, '__len__') and len(emb_vec) > 0:
                            embeddings.append(np.array(emb_vec, dtype=np.float32))
                            valid_segments.append({"start": start_sec * 1000, "end": end_sec * 1000})
                except Exception as e:
                    print(f"[Diarization] 段 {i} 嵌入失败: {e}", file=sys.stderr)
                finally:
                    try:
                        os.unlink(tmp_name)
                    except:
                        pass

            # 聚类
            if len(embeddings) >= 2:
                from sklearn.cluster import AgglomerativeClustering
                emb_array = np.array(embeddings)
                clustering = AgglomerativeClustering(n_clusters=min(4, len(embeddings)), metric="cosine", linkage="average")
                labels = clustering.fit_predict(emb_array)

                # 分配说话人标签
                speaker_map = {}
                spk_idx = 0
                for i, label in enumerate(labels):
                    label_str = str(label)
                    if label_str not in speaker_map:
                        spk_idx += 1
                        speaker_map[label_str] = f"SPEAKER_{spk_idx:02d}"
                    valid_segments[i]["speaker"] = speaker_map[label_str]

                print(f"[Diarization] 聚类完成: {spk_idx} 个说话人, {len(valid_segments)} 段", file=sys.stderr)
                return valid_segments
            elif len(embeddings) == 1:
                valid_segments[0]["speaker"] = "SPEAKER_01"
                return valid_segments

        print("[Diarization] 嵌入数不足，无法聚类", file=sys.stderr)
        return None

    except Exception as e:
        print(f"[Diarization] 失败（可忽略）: {e}", file=sys.stderr)
        return None


def main():
    if len(sys.argv) < 2:
        json_print({"success": False, "error": "missing audio path"})
        sys.exit(1)

    audio_path = sys.argv[1]
    if not os.path.isfile(audio_path):
        json_print({"success": False, "error": f"file not found: {audio_path}"})
        sys.exit(1)

    try:
        with redirect_stdout(sys.stderr):
            from funasr import AutoModel

            model = AutoModel(
                model=ASR_MODEL,
                vad_model=VAD_MODEL,
                punc_model=PUNC_MODEL,
                disable_update=True,
            )

        with redirect_stdout(sys.stderr):
            res = model.generate(input=audio_path, sentence_timestamp=True)

        if not res or not isinstance(res, list) or len(res) == 0:
            json_print({"success": False, "error": "no result from model"})
            sys.exit(1)

        data = res[0]
        full_text = data.get("text", "").replace(" ", "")
        char_ts = data.get("timestamp", [])
        debug_keys = list(data.keys())

        # 重建句子（使用全局 char_ts）
        if full_text and char_ts:
            sentences = build_sentences_from_ts(full_text, char_ts)
        elif full_text:
            sentences = [{"text": full_text, "start": 0.0, "end": 0.0, "speaker": ""}]
        else:
            sentences = []

        # 说话人分离（使用 ASR 句段时间戳 + Cam++ 嵌入聚类）
        spk_segments = run_speaker_diarization(audio_path, sentences)
        if spk_segments:
            print(f"[Diarization] 检测到 {len(spk_segments)} 个说话人段", file=sys.stderr)
            sentences = assign_speakers(sentences, spk_segments)
        else:
            print("[Diarization] 说话人分离未生效", file=sys.stderr)

        # 统计说话人
        speaker_set = set(s["speaker"] for s in sentences if s["speaker"])
        speakers = sorted(speaker_set)
        speaker_count = len(speakers) or 1

        json_print({
            "success": True,
            "text": full_text,
            "sentences": sentences,
            "words": char_ts,
            "timestamp": char_ts,
            "_debug_keys": debug_keys,
            "speaker_count": speaker_count,
            "speakers": speakers if speakers else ["SPEAKER_00"],
            "sentence_count": len(sentences),
            "ts_count": len(char_ts),
        })

    except Exception as e:
        json_print({"success": False, "error": str(e)})
        sys.exit(1)


if __name__ == "__main__":
    main()
