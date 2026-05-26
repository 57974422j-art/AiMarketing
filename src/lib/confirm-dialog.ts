// 自定义确认弹窗，替代浏览器 confirm()
export function showConfirm(message: string): Promise<boolean> {
  return new Promise(resolve => {
    const div = document.createElement('div')
    div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center'
    div.innerHTML = `
      <div style="background:#111827;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:24px;width:320px;color:white;font-size:14px">
        <p style="margin:0 0 20px;line-height:1.5">${message}</p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="dc-cancel" style="padding:6px 16px;background:transparent;border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#9ca3af;font-size:13px;cursor:pointer">取消</button>
          <button id="dc-ok" style="padding:6px 16px;background:#10b981;border:none;border-radius:8px;color:white;font-size:13px;cursor:pointer">确定</button>
        </div>
      </div>
    `
    document.body.appendChild(div)
    const cleanup = () => { div.remove(); document.removeEventListener('keydown', onKey) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { cleanup(); resolve(false) } }
    document.addEventListener('keydown', onKey)
    div.querySelector('#dc-cancel')!.addEventListener('click', () => { cleanup(); resolve(false) })
    div.querySelector('#dc-ok')!.addEventListener('click', () => { cleanup(); resolve(true) })
    div.addEventListener('click', e => { if (e.target === div) { cleanup(); resolve(false) } })
  })
}
