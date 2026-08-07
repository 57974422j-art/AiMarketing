# -*- coding: utf-8 -*-
"""FunASR 常驻识别服务（2026-08-06）：模型只加载一次，后续识别秒级；asr 路由先调本服务，失败回退脚本模式"""
import os, json, tempfile
from http.server import HTTPServer, BaseHTTPRequestHandler

CACHE = os.path.join(os.path.expanduser('~'), '.cache', 'modelscope', 'models')
def m(name): return os.path.join(CACHE, name, 'snapshots', 'master')

from funasr import AutoModel
print('[funasr-server] loading model...', flush=True)
model = AutoModel(
    model=m('iic--speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch'),
    vad_model=m('iic--speech_fsmn_vad_zh-cn-16k-common-pytorch'),
    punc_model=m('iic--punc_ct-transformer_zh-cn-common-vocab272727-pytorch'),
    disable_update=True,
)
print('[funasr-server] ready', flush=True)

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self._send(200, {'status': 'ok'})
    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length) if length else b''
            tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
            try:
                tmp.write(body); tmp.close()
                res = model.generate(input=tmp.name, sentence_timestamp=False)
                text = ''
                if res and isinstance(res, list) and res[0].get('text'):
                    text = res[0]['text']
                self._send(200, {'text': text})
            finally:
                try: os.unlink(tmp.name)
                except: pass
        except Exception as e:
            self._send(500, {'error': str(e)})
    def _send(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def log_message(self, *a): pass

print('[funasr-server] listening 127.0.0.1:8765', flush=True)
HTTPServer(('127.0.0.1', 8765), H).serve_forever()
