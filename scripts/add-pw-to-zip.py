# -*- coding: utf-8 -*-
"""把 playwright(+greenlet/pyee) 追加进 python-bu.zip"""
import sys, os, zipfile, time
sys.stdout.reconfigure(encoding='utf-8')
SP = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Programs', 'Python', 'Python314', 'Lib', 'site-packages')
if not os.path.isdir(SP):
    SP = r"C:\Users\wo'shen\AppData\Local\Programs\Python\Python314\Lib\site-packages"
ZIP = r'D:\AiMarketing\python-bu-test.zip'
PKG_PREFIX = 'buvenv-test/Lib/site-packages/'
BS = chr(92)
t0 = time.time()
added = 0
PKGS = ['playwright', 'playwright-1.62.0.dist-info', 'greenlet', 'greenlet-3.2.4.dist-info', 'pyee', 'pyee-13.0.1.dist-info']
z = zipfile.ZipFile(ZIP, 'a', zipfile.ZIP_DEFLATED, compresslevel=6)
for pkg in PKGS:
    src = os.path.join(SP, pkg)
    if not os.path.exists(src):
        print('skip(not found):', pkg)
        continue
    for root, dirs, files in os.walk(src):
        if pkg == 'playwright' and 'driver' in dirs:
            dirs.remove('driver')   # driver/ 是 playwright 自带浏览器运行时（连系统 Chrome 用不到，省 50MB）
        for f in files:
            fp = os.path.join(root, f)
            rel = os.path.relpath(fp, SP).replace(BS, '/')
            z.write(fp, PKG_PREFIX + rel)
            added += 1
z.close()
print('added entries:', added, '(%ds)' % int(time.time() - t0))
print('new zip size:', round(os.path.getsize(ZIP) / 1048576, 1), 'MB')
z2 = zipfile.ZipFile(ZIP)
n = z2.namelist()
for kw in ['playwright', 'greenlet', 'pyee', '_greenlet.cp314']:
    print('  %-20s -> %d' % (kw, sum(1 for x in n if kw in x.lower())))
