import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const FREE_MUSIC = [
  { name: '轻松愉快 (Upbeat Pop)', url: 'https://assets.mixkit.co/music/preview/mixkit-upbeat-funk-pop-136.mp3', duration: '2:30', mood: '欢快' },
  { name: '温暖钢琴 (Piano)', url: 'https://assets.mixkit.co/music/preview/mixkit-piano-ambient-179.mp3', duration: '2:00', mood: '温馨' },
  { name: '电子节奏 (Electronic)', url: 'https://assets.mixkit.co/music/preview/mixkit-tech-house-vibes-130.mp3', duration: '3:00', mood: '动感' },
  { name: '轻松吉它 (Acoustic)', url: 'https://assets.mixkit.co/music/preview/mixkit-acoustic-guitar-159.mp3', duration: '2:15', mood: '轻松' },
  { name: '鼓舞人心 (Cinematic)', url: 'https://assets.mixkit.co/music/preview/mixkit-inspiring-cinematic-208.mp3', duration: '2:45', mood: '大气' },
  { name: '梦幻氛围 (Ambient)', url: 'https://assets.mixkit.co/music/preview/mixkit-dreamy-ambient-206.mp3', duration: '3:10', mood: '梦幻' },
  { name: '轻快流行 (Pop)', url: 'https://assets.mixkit.co/music/preview/mixkit-happy-pop-163.mp3', duration: '2:20', mood: '快乐' },
  { name: '柔和抒情 (Soft)', url: 'https://assets.mixkit.co/music/preview/mixkit-soft-rain-193.mp3', duration: '2:50', mood: '抒情' },
]

export async function GET() {
  return NextResponse.json({ success: true, data: FREE_MUSIC })
}
