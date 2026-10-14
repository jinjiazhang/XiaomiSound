const config=require('../config')
const LIBRARY_KEY='xiaomi-sound.library.v1'
function validUrl(value) { return typeof value==='string' && /^https?:\/\/[^/?#\s]+(?:[/?#][^\s]*)?$/i.test(value.trim()) }
function track(url,title) {
  url=typeof url==='string'?url.trim():''
  if (!validUrl(url)) throw new Error('请填写有效的 HTTP 或 HTTPS 音频地址')
  let filename=url.split('?')[0].split('/').pop() || '自定义音频'
  try { filename=decodeURIComponent(filename) } catch (_) {}
  return {url,title:(typeof title==='string' && title.trim()) || (url===config.audioUrl?config.audioTitle:filename.replace(/\.[^.]+$/,''))}
}
function library(value) {
  const source=value && Array.isArray(value.tracks)?value.tracks:[]
  const tracks=[]
  for (const item of source.slice(0,100)) {
    if (item && validUrl(item.url) && !tracks.some(t=>t.url===item.url.trim())) tracks.push(track(item.url,item.title))
  }
  if (!tracks.length) tracks.push(track(config.audioUrl,config.audioTitle))
  const favorites=value && Array.isArray(value.favorites)?value.favorites.filter(u=>tracks.some(t=>t.url===u)):[]
  return {tracks,favorites}
}
function time(seconds) {
  if (!Number.isFinite(seconds) || seconds<0) return '00:00'
  seconds=Math.floor(seconds)
  return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')
}
function playback(status) {
  const song=status.play_song_detail || {}
  const duration=Number(song.duration===undefined?status.duration:song.duration)
  const position=Number(song.position===undefined?status.position:song.position)
  const seconds=Number.isFinite(duration)&&duration>0?duration/1000:0
  const elapsed=Number.isFinite(position)&&position>=0?position/1000:0
  const volume=Number(status.volume)
  return {
    playbackState:Number(status.status),isPlaying:Number(status.status)===1,
    statusText:({0:'未播放',1:'播放中',2:'已暂停',3:'未播放'})[status.status]||'状态未知',
    duration:seconds,position:seconds?Math.min(elapsed,seconds):elapsed,
    positionText:time(seconds?Math.min(elapsed,seconds):elapsed),durationText:seconds?time(seconds):'--:--',
    progress:seconds?Math.min(100,Math.max(0,elapsed/seconds*100)):0,
    volumeKnown:status.volume!==undefined && status.volume!==null && Number.isFinite(volume) && volume>=0 && volume<=100,
    volume:Number.isFinite(volume)?Math.round(Math.min(100,Math.max(0,volume))):0,
    remoteTitle:typeof song.title==='string'?song.title:'',
    remoteArtist:typeof song.artist==='string'?song.artist:''
  }
}
module.exports={LIBRARY_KEY,track,library,time,playback}
