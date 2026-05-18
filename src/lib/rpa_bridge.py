"""
Q1 RPA SDK HTTP 桥接服务
调用方式：Node.js 后端通过 HTTP 调用此服务，转发到 Q1 RPA 端口 9083
"""
import sys, os, json, time, re
from http.server import HTTPServer, BaseHTTPRequestHandler

# 将 SDK 路径加入系统路径
sys.path.insert(0, '/opt/myt_rpa_sdk/demo_py')
from common.mytRpc import MytRpc

# 全局设备连接缓存
_device_clients: dict[str, MytRpc] = {}

class RPABridgeHandler(BaseHTTPRequestHandler):
    
    def log_message(self, format, *args):
        pass  # 静默日志
    
    def _get_client(self, host: str, port: int) -> MytRpc:
        key = f"{host}:{port}"
        if key in _device_clients:
            # 检查连接状态
            if _device_clients[key].check_connect_state():
                return _device_clients[key]
            del _device_clients[key]
        
        client = MytRpc()
        if not client.init(host, port, 10):
            raise Exception("连接设备失败")
        client.setRpaWorkMode(0)
        _device_clients[key] = client
        return client
    
    def _send_json(self, data: dict, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    
    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            host = body.get('host', '127.0.0.1')
            port = int(body.get('port', 9083))
            
            client = self._get_client(host, port)
            action = body.get('action', '')
            
            result = None
            
            if action == 'ping':
                result = {'ok': True, 'msg': 'connected'}
            
            elif action == 'screenshot':
                data = client.takeCaptrueCompress(0, 90)
                if data and len(data) > 0:
                    import base64
                    result = {'ok': True, 'data': base64.b64encode(data).decode(), 'format': 'png'}
                else:
                    result = {'ok': False, 'msg': '截图失败'}
            
            elif action == 'dumpNodeXml':
                xml = client.dumpNodeXml(True)
                if xml:
                    result = {'ok': True, 'data': xml}
                else:
                    result = {'ok': False, 'msg': '导出节点失败'}
            
            elif action == 'click':
                x = int(body.get('x', 0))
                y = int(body.get('y', 0))
                client.touchClick(1, x, y)
                result = {'ok': True, 'msg': f'click ({x},{y})'}
            
            elif action == 'sendText':
                text = body.get('text', '')
                if client.sendText(text):
                    result = {'ok': True, 'msg': f'sendText OK'}
                else:
                    result = {'ok': False, 'msg': 'sendText 失败'}
            
            elif action == 'openApp':
                pkg = body.get('package', '')
                if client.openApp(pkg):
                    result = {'ok': True, 'msg': f'openApp {pkg} OK'}
                else:
                    result = {'ok': False, 'msg': 'openApp 失败'}
            
            elif action == 'stopApp':
                pkg = body.get('package', '')
                if client.stopApp(pkg):
                    result = {'ok': True, 'msg': f'stopApp {pkg} OK'}
                else:
                    result = {'ok': False, 'msg': 'stopApp 失败'}
            
            elif action == 'execCmd':
                cmd = body.get('cmd', '')
                out = client.exec_cmd(cmd)
                result = {'ok': True, 'data': out or ''}
            
            elif action == 'keyPress':
                key = int(body.get('key', 0))
                if client.keyPress(key):
                    result = {'ok': True, 'msg': f'keyPress {key}'}
                else:
                    result = {'ok': False, 'msg': 'keyPress 失败'}
            
            elif action == 'swipe':
                x1, y1, x2, y2 = int(body.get('x1')), int(body.get('y1')), int(body.get('x2')), int(body.get('y2'))
                dur = int(body.get('duration', 2000))
                client.swipe(1, x1, y1, x2, y2, dur)
                result = {'ok': True, 'msg': f'swipe ({x1},{y1})->({x2},{y2})'}
            
            elif action == 'findAndClick':
                """按文字找按钮并点击 — 核心功能"""
                text = body.get('text', '')
                selector = client.create_selector()
                with selector:
                    selector.addQuery_TextContainWith(text)
                    node = selector.execQueryOne(int(body.get('timeout', 200)))
                    if node is not None:
                        node.Click_events()
                        bounds = re.findall(r'\[(\d+),(\d+),(\d+),(\d+)\]', str(node.getNodeJson()))
                        result = {'ok': True, 'msg': f'found and clicked "{text}"', 'bounds': bounds[0] if bounds else ''}
                    else:
                        result = {'ok': False, 'msg': f'未找到含"{text}"的按钮'}
            
            elif action == 'findNode':
                """按文字查找按钮，返回位置"""
                text = body.get('text', '')
                selector = client.create_selector()
                with selector:
                    selector.addQuery_TextContainWith(text)
                    node = selector.execQueryOne(int(body.get('timeout', 200)))
                    if node is not None:
                        info = json.loads(node.getNodeJson())
                        result = {'ok': True, 'data': info}
                    else:
                        result = {'ok': False, 'msg': f'未找到含"{text}"的节点'}
            
            else:
                result = {'ok': False, 'msg': f'未知操作: {action}'}
            
            self._send_json(result)
        
        except Exception as e:
            self._send_json({'ok': False, 'msg': str(e)})

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9100
    server = HTTPServer(('0.0.0.0', port), RPABridgeHandler)
    print(f'RPA Bridge 已启动, 端口 {port}')
    server.serve_forever()
