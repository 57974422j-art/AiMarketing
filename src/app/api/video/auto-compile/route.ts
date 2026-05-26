import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
const OUT = '/root/AiMarketing/public/generated'
const PUB = '/generated'
const RATIOS: Record<string,{w:number;h:number}> = {
  '16:9':{w:1920,h:1080}, '9:16':{w:1080,h:1920}, '1:1':{w:1080,h:1080}, '4:3':{w:1440,h:1080}
}
function dir(){if(!fs.existsSync(OUT))fs.mkdirSync(OUT,{recursive:true})}

async function tts(text:string,voice:string){
  const r=await fetch('http://localhost:3000/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,voice})})
  const d=await r.json();if(!d.audioUrl)throw new Error('TTS失败');return d.audioUrl
}

export async function POST(req:NextRequest){
  try{
    const f=await req.formData()
    const text=(f.get('text')as string)||'',voice=(f.get('voice')as string)||'zh_female_vv_uranus_bigtts'
    const bgmFile=f.get('bgm')as File|null,bgmUrl=(f.get('bgmUrl')as string)||'',mode=(f.get('mode')as string)||'free'
    const ratio=(f.get('ratio')as string)||'16:9',res=(f.get('resolution')as string)||'1080p',fsize=parseInt((f.get('subtitleSize')as string)||'36')

    const dims=RATIOS[ratio]||{w:1920,h:1080}
    const sc=res==='720p'?0.5:1;const W=Math.round(dims.w*sc),H=Math.round(dims.h*sc)
    const sf=`scale=${W}:${H}:force_original_aspect_ratio=1,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`

    dir();const id=crypto.randomUUID().slice(0,8),wd=path.join(OUT,id);fs.mkdirSync(wd,{recursive:true})
    const mp:string[]=[]

    if(mode==='smart'){
      const urls:string[]=JSON.parse((f.get('imageUrls')as string)||'[]')
      if(!urls.length)return NextResponse.json({success:false,message:'无图片URL'},{status:400})
      for(let i=0;i<urls.length;i++){const p=path.join(wd,`i${i}.${urls[i].match(/\.(jpg|jpeg|png|webp|gif)/i)?.[1]||'jpg'}`);execSync(`curl -s -L -o "${p}" "${urls[i]}"`,{timeout:15000});mp.push(p)}
    }else{
      const mf=f.getAll('media')as File[]
      if(!mf.length)return NextResponse.json({success:false,message:'请上传素材'},{status:400})
      for(let i=0;i<mf.length;i++){const b=Buffer.from(await mf[i].arrayBuffer());const p=path.join(wd,`m${i}.${mf[i].name.split('.').pop()||'mp4'}`);fs.writeFileSync(p,b);mp.push(p)}
    }

    let bgp=''
    if(bgmFile){bgp=path.join(wd,'b.'+(bgmFile.name.split('.').pop()||'mp3'));fs.writeFileSync(bgp,Buffer.from(await bgmFile.arrayBuffer()))}
    else if(bgmUrl){bgp=path.join(wd,'b.mp3');execSync(`curl -s -L -o "${bgp}" "${bgmUrl}"`,{timeout:15000})}

    const au=await tts(text,voice),ap=path.join(wd,'t.mp3')
    execSync(`curl -s -o "${ap}" "${au}"`,{timeout:30000})
    const dd=execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${ap}"`,{timeout:10000}).toString().trim()
    const ad=parseFloat(dd)||10,sd=ad/mp.length

    const ln=text.split('\n').filter(Boolean),pt=ad/Math.max(ln.length,1)
    const ft=(t:number)=>{const h=Math.floor(t/3600),m=Math.floor((t%3600)/60),s=Math.floor(t%60),ms=Math.floor((t%1)*1000);return`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`}
    const sp=path.join(wd,'s.srt')
    fs.writeFileSync(sp,ln.map((l,i)=>{const st=i*pt,et=Math.min((i+1)*pt,ad);return`${i+1}\n${ft(st)} --> ${ft(et)}\n${l}\n\n`}).join(''))

    const cl:string[]=[]
    for(let i=0;i<mp.length;i++){const c=path.join(wd,`c${i}.mp4`);execSync(`ffmpeg -y -loop 1 -i "${mp[i]}" -vf "${sf},fade=t=in:st=0:d=0.5,fade=t=out:st=${(sd-0.5).toFixed(2)}:d=0.5" -t ${sd.toFixed(2)} -c:v libx264 -preset fast -pix_fmt yuv420p "${c}"`,{timeout:60000});cl.push(c)}

    const ct=path.join(wd,'c.txt');fs.writeFileSync(ct,cl.map(p=>`file '${p}'`).join('\n'))
    const mv=path.join(wd,'m.mp4');execSync(`ffmpeg -y -f concat -safe 0 -i "${ct}" -c copy "${mv}"`,{timeout:120000})

    let ai=ap
    if(bgp){const mx=path.join(wd,'x.mp3');execSync(`ffmpeg -y -i "${ap}" -i "${bgp}" -filter_complex "[0:a]volume=1[a1];[1:a]volume=0.25[a2];[a1][a2]amix=inputs=2:duration=first" -ac 2 "${mx}"`,{timeout:30000});ai=mx}

    const op=path.join(OUT,`${id}.mp4`)
    execSync(`ffmpeg -y -i "${mv}" -i "${ai}" -vf "subtitles='${sp}':force_style='FontSize=${fsize},Alignment=2'" -c:v libx264 -preset medium -crf 23 -c:a aac -map 0:v -map 1:a -shortest "${op}"`,{timeout:120000})

    fs.rmSync(wd,{recursive:true,force:true})
    return NextResponse.json({success:true,data:{videoUrl:`${PUB}/${id}.mp4`}})
  }catch(e:any){console.error('auto-compile:',e);return NextResponse.json({success:false,error:e.message})}
}