const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const vm=require('node:vm')
const path=require('node:path')
const {createRequire}=require('node:module')
const {XiaomiClient}=require('../miniprogram/utils/xiaomi')
const {playback,library,track}=require('../miniprogram/utils/player')
function page() {
  let definition
  const filename=path.resolve(__dirname,'../miniprogram/pages/index/index.js')
  const timers=new Map();let next=0
  const wx={setStorageSync:()=>{},getStorageSync:()=>null}
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{
    require:createRequire(filename),Page:value=>{definition=value},wx,
    setInterval:fn=>{timers.set(++next,fn);return next},clearInterval:id=>timers.delete(id),setTimeout:fn=>{fn();return 0}
  },{filename})
  const p={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(patch){Object.assign(this.data,patch)}}
  p.data.queue=[track('https://example.com/one.mp3'),track('https://example.com/two.mp3')]
  p.data.selectedDevice={deviceID:'speaker',hardware:'L16B',presence:'online',name:'客厅'}
  p.client={session:{userId:'fixture'}}
  return {p,timers}
}
test('pause, resume, volume and loop use the correct speaker commands',async()=>{
  const requests=[]
  const c=new XiaomiClient({getStorageSync:()=>({userId:'fixture',serviceToken:'fixture'}),request:r=>{
    const body=new URLSearchParams(r.data);requests.push([body.get('method'),JSON.parse(body.get('message'))]);
    r.success({statusCode:200,header:{},data:{code:0,data:{code:0}}})
  }})
  const d={deviceID:'speaker',hardware:'L16B'}
  await c.pause(d);await c.resume(d);await c.setVolume(d,35);await c.setLoop(d,0)
  assert.deepEqual(requests,[
    ['player_play_operation',{action:'pause',media:'app_ios'}],
    ['player_play_operation',{action:'play',media:'app_ios'}],
    ['player_set_volume',{volume:35,media:'app_ios'}],
    ['player_set_loop',{media:'common',type:0}]
  ])
  for(const value of [-1,101,NaN,0.5]) assert.throws(()=>c.setVolume(d,value))
  assert.throws(()=>c.setLoop({...d,hardware:'L05B'},0),/当前机型/)
  assert.equal(requests.length,4)
})
test('device progress uses milliseconds, clamps to duration and handles missing metadata',()=>{
  const s=playback({status:1,volume:38,play_song_detail:{duration:306000,position:2000,title:'音频'}})
  assert.equal(s.positionText,'00:02');assert.equal(s.durationText,'05:06');assert.equal(s.volume,38)
  assert.equal(s.isPlaying,true)
  assert.equal(playback({status:2}).durationText,'--:--')
  assert.equal(playback({volume:null}).volumeKnown,false)
  assert.equal(playback({play_song_detail:{duration:1000,position:3000}}).progress,100)
  assert.equal(playback({play_song_detail:{duration:-1,position:-1}}).positionText,'00:00')
})
test('library rejects invalid saved URLs and keeps a usable default',()=>{
  assert.equal(library({tracks:[{url:'file:///private'}]}).tracks.length,1)
  assert.equal(library({tracks:[track('https://example.com/a.mp3'),track('https://example.com/a.mp3')],favorites:['missing']}).tracks.length,1)
  assert.throws(()=>track('javascript:alert(1)'))
})
test('pausing and resuming never restart the audio URL',async()=>{
  const {p}=page();let pause=0,resume=0
  p.client.pause=async()=>{pause++};p.client.resume=async()=>{resume++}
  p.client.status=async()=>({status:pause>resume?2:1,volume:20})
  p.data.playbackState=1
  await p.togglePlayback();assert.equal(pause,1);assert.equal(p.data.playbackState,2)
  await p.togglePlayback();assert.equal(resume,1);assert.equal(p.data.playbackState,1)
})
test('next and previous play local queue URLs and wrap around',async()=>{
  const {p}=page(),urls=[]
  p.client.play=async(d,url)=>urls.push(url);p.client.status=async()=>({status:1})
  await p.changeTrack({currentTarget:{dataset:{step:1}}})
  await p.changeTrack({currentTarget:{dataset:{step:1}}})
  await p.changeTrack({currentTarget:{dataset:{step:-1}}})
  assert.deepEqual(urls,['https://example.com/two.mp3','https://example.com/one.mp3','https://example.com/two.mp3'])
})
test('old poll responses cannot overwrite a command result or another device',async()=>{
  const {p}=page();let resolve
  p.client.status=()=>new Promise(r=>{resolve=r})
  const request=p.loadStatus(p.data.selectedDevice)
  p.commandGeneration=1
  resolve({status:1,volume:100});await request
  assert.equal(p.data.volume,0)
  const request2=p.loadStatus(p.data.selectedDevice)
  p.data.selectedDevice={deviceID:'other'}
  resolve({status:1,volume:80});await request2
  assert.equal(p.data.volume,0)
})
test('page lifecycle clears polling on hide and unload',()=>{
  const {p,timers}=page()
  p.refreshStatus=()=>{}
  p.onShow();assert.equal(timers.size,1)
  p.onShow();assert.equal(timers.size,1)
  p.onHide();assert.equal(timers.size,0)
  p.onShow();p.onUnload();assert.equal(timers.size,0)
})
test('switching speakers preserves the queue and favorites, clears old playback and refreshes',()=>{
  const {p}=page();const queue=p.data.queue
  p.data.favorites=[queue[0].url]
  p.data.devices=[{deviceID:'new',presence:'online'}]
  let refreshed=0;p.refreshStatus=()=>{refreshed++}
  p.data.isPlaying=true;p.data.volumeKnown=true
  p.selectDevice({detail:{value:'0'}})
  assert.equal(p.data.queue,queue)
  assert.deepEqual(p.data.favorites,[queue[0].url])
  assert.equal(p.data.isPlaying,false);assert.equal(p.data.volumeKnown,false)
  assert.equal(refreshed,1)
})

test('pause waits for the new device state when the first query is stale',async()=>{
  const {p}=page();let reads=0
  p.data.playbackState=1;p.data.isPlaying=true
  p.client.pause=async()=>{}
  p.client.status=async()=>({status:++reads===1?1:2})
  await p.togglePlayback()
  assert.equal(reads,2);assert.equal(p.data.playbackState,2);assert.equal(p.data.isPlaying,false)
})
test('resume switches back to the pause button after delayed confirmation',async()=>{
  const {p}=page();let reads=0
  p.data.playbackState=2;p.data.isPlaying=false
  p.client.resume=async()=>{}
  p.client.status=async()=>({status:++reads===1?2:1})
  await p.togglePlayback()
  assert.equal(reads,2);assert.equal(p.data.playbackState,1);assert.equal(p.data.isPlaying,true)
})
test('APK controls preserve path, misspelled seek method, milliseconds and timer fields',async()=>{
  const requests=[]
  const c=new XiaomiClient({getStorageSync:()=>null})
  c.api=async(path,data)=>{requests.push({...data,message:JSON.parse(data.message)});return {code:0,data:{code:0}}}
  const d={deviceID:'speaker',hardware:'L16B'}
  await c.seek(d,12500);await c.speak(d,'  开饭了  ');await c.setTimer(d,90);await c.setTimer(d,0);await c.setLoop(d,3)
  assert.deepEqual(requests.map(r=>[r.path,r.method,r.message]),[
    ['mediaplayer','player_set_positon',{position:12500,media:'app_android'}],
    ['mibrain','text_to_speech',{text:'开饭了'}],
    ['mediaplayer','player_set_shutdown_timer',{action:'pause_later',hour:1,minute:30,second:0}],
    ['mediaplayer','player_set_shutdown_timer',{action:'cancel_ending'}],
    ['mediaplayer','player_set_loop',{media:'common',type:3}]
  ])
  for (const value of [-1,NaN,1.5]) assert.throws(()=>c.seek(d,value))
  for (const value of [-1,1441,0.5]) assert.throws(()=>c.setTimer(d,value))
  assert.throws(()=>c.speak(d,'  '));assert.throws(()=>c.speak(d,'字'.repeat(501)))
  assert.throws(()=>c.setLoop(d,4))
})
test('night mode writes only validated fields and decodes info envelopes',async()=>{
  const c=new XiaomiClient({getStorageSync:()=>null}),d={deviceID:'speaker'}
  const settings={total:'night',light:'normal',volume:'night',start:'22:30',stop:'07:00'}
  let sent
  c.api=async(path,data)=>{sent=data;return {code:0,data:{code:0,info:JSON.stringify(settings)}}}
  assert.deepEqual(await c.nightMode(d),settings)
  await c.setNightMode(d,{...settings,extra:'discard'})
  assert.equal(sent.path,'nightmode');assert.equal(sent.method,'set');assert.deepEqual(JSON.parse(sent.message),settings)
  assert.throws(()=>c.setNightMode(d,{...settings,start:'24:00'}))
  assert.throws(()=>c.setNightMode(d,{...settings,stop:settings.start}))
  c.api=async()=>({code:0,data:{code:9}})
  await assert.rejects(c.nightMode(d),/设备执行失败/)
  c.api=async()=>({code:0,data:{code:0,info:'invalid'}})
  await assert.rejects(c.nightMode(d),/格式异常/)
})
test('seek converts percentage to milliseconds and polling does not move a dragged thumb',async()=>{
  const {p}=page();let position
  p.client.status=async()=>({status:1,play_song_detail:{duration:200000,position:1000}})
  p.client.seek=async(d,value)=>{position=value}
  p.data.duration=200
  p.onSeekChanging({detail:{value:25}})
  await p.loadStatus(p.data.selectedDevice)
  assert.equal(p.data.progress,25);assert.equal(p.data.positionText,'00:50')
  await p.seek({detail:{value:25}})
  assert.equal(position,50000);assert.equal(p.data.seekDragging,false);assert.equal(p.data.progress,0.5)
})
test('filtered library retains original queue indexes and history ordering',()=>{
  const {p}=page()
  p.data.favorites=[p.data.queue[1].url]
  p.data.libraryFilter='favorites';p.updateLibraryView()
  assert.equal(p.data.visibleTracks.length,1);assert.equal(p.data.visibleTracks[0].index,1)
  p.data.history=[p.data.queue[1].url,p.data.queue[0].url];p.data.libraryFilter='recent';p.updateLibraryView()
  assert.equal(p.data.visibleTracks[0].index,1)
  p.data.search='one';p.updateLibraryView();assert.equal(p.data.visibleTracks[0].index,0)
  const saved=library({tracks:p.data.queue,history:[p.data.queue[1].url,'missing',p.data.queue[1].url]})
  assert.deepEqual(saved.history,[p.data.queue[1].url])
})
test('settings responses cannot populate a different device or enable incomplete night settings',async()=>{
  const {p}=page();let finish
  p.data.toolOpen='night'
  p.client.nightMode=()=>new Promise(resolve=>{finish=resolve})
  const pending=p.readTool('night',p.data.selectedDevice)
  p.data.selectedDevice={deviceID:'other'}
  finish({total:'night',light:'night',volume:'night',start:'22:00',stop:'07:00'})
  await pending;assert.equal(p.data.nightReady,false)
  p.client.nightMode=async()=>({total:'night'})
  await assert.rejects(p.readTool('night',p.data.selectedDevice),/完整夜间设置/)
  assert.equal(p.data.nightReady,false)
})
test('timer readback uses seconds; failed writes never display success',async()=>{
  const {p}=page()
  p.data.toolOpen='timer';p.client.timer=async()=>({type:1,remain_time:90})
  await p.readTool('timer',p.data.selectedDevice)
  assert.match(p.data.timerText,/01:30/)
  p.client.setTimer=async()=>{throw new Error('机型不支持')}
  await p.chooseTimer({currentTarget:{dataset:{minutes:30}}})
  assert.equal(p.data.message,'');assert.equal(p.data.error,'机型不支持')
  assert.equal(p.data.busy,false)
})
test('new control commands require an explicit device acknowledgement',async()=>{
  const c=new XiaomiClient({getStorageSync:()=>null})
  c.api=async()=>({code:0})
  await assert.rejects(c.speak({deviceID:'speaker'},'你好'),/设备执行失败/)
})
test('refreshing an offline device clears its previous playback state',async()=>{
  const {p}=page()
  p.data.isPlaying=true;p.data.duration=200;p.data.loopType=3;p.data.volumeKnown=true
  p.client.devices=async()=>[{deviceID:'speaker',name:'客厅',presence:'offline',hardware:'L16B'}]
  await p.loadDevices()
  assert.equal(p.data.isPlaying,false);assert.equal(p.data.duration,0)
  assert.equal(p.data.volumeKnown,false);assert.equal(p.data.loopType,null)
})
