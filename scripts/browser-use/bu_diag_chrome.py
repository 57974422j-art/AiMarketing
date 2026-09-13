# -*- coding: utf-8 -*-
# 诊断：Chrome 带调试端口为什么起不来
import subprocess, time, os, socket
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
UD = os.environ['LOCALAPPDATA'] + r'\Google\Chrome\User Data'

print('启动 Chrome（Default + 9222）...')
p = subprocess.Popen(
    [CHROME, '--remote-debugging-port=9222', '--user-data-dir=' + UD, '--profile-directory=Default',
     '--no-first-run', '--no-default-browser-check', 'about:blank'],
    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
)
time.sleep(8)
# 检查端口
def port_open(port):
    s = socket.socket()
    s.settimeout(2)
    try:
        s.connect(('127.0.0.1', port)); s.close(); return True
    except Exception:
        return False
print('9222 端口:', 'OPEN' if port_open(9222) else 'CLOSED')
print('Chrome 进程存活:', p.poll() is None)
# 读 stderr（Chrome 的报错）
try:
    import select
    err = p.stderr.read(2000) if p.stderr else b''
    print('stderr:', err.decode('utf-8', 'ignore')[:500])
except Exception as e:
    print('stderr 读失败:', e)
# 检查 DevTools 端点
try:
    import urllib.request
    r = urllib.request.urlopen('http://127.0.0.1:9222/json/version', timeout=3).read()
    print('DevTools 端点:', r[:200])
except Exception as e:
    print('DevTools 端点失败:', e)
