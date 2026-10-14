const {XiaomiClient}=require('../../utils/xiaomi')
const config=require('../../config')
const {LIBRARY_KEY,track,library,playback}=require('../../utils/player')
Page({
  data:{
    account:'',password:'',code:'',otp:false,otpMethod:'手机',loggedIn:false,
    busy:false,devices:[],selectedIndex:0,selectedDevice:null,
    audioTitle:config.audioTitle,audioUrl:config.audioUrl,
    statusText:'尚未查询',volumeText:'',message:'',error:'',
    playerOpen:false,queueOpen:false,volumeOpen:false,queue:[],favorites:[],currentIndex:0,currentTitle:config.audioTitle,
    currentArtist:'自定义音频',playbackState:0,isPlaying:false,volume:0,volumeKnown:false,volumeDragging:false,
    positionText:'00:00',durationText:'--:--',duration:0,progress:0,loopType:null,isFavorite:false,canFavorite:false
  },
  onLoad() {
    this.client=new XiaomiClient(wx)
    const saved=library(wx.getStorageSync(LIBRARY_KEY))
    this.setData({loggedIn:!!this.client.session,queue:saved.tracks,favorites:saved.favorites,
      currentTitle:saved.tracks[0].title,isFavorite:saved.favorites.includes(saved.tracks[0].url)})
    if (this.client.session) this.refreshDevices()
  },
  onShow() {
    this.visible=true
    this.startPolling()
  },
  onHide() { this.visible=false; this.stopPolling(); this.setData({volumeDragging:false,volumeOpen:false}) },
  onUnload() { this.visible=false; this.stopPolling(); this.disposed=true },
  startPolling() {
    this.stopPolling()
    this.pollTimer=setInterval(()=>{
      if (this.visible && !this.data.busy && !this.polling && this.client && this.client.session &&
          this.data.selectedDevice && this.data.selectedDevice.presence==='online') {
        this.polling=true
        this.loadStatus(this.data.selectedDevice).catch(error=>{
          if (!this.disposed) this.setData({error:error.message,loggedIn:!!this.client.session,...(!this.client.session?{playerOpen:false,queueOpen:false,volumeOpen:false,selectedDevice:null}:{} )})
        }).finally(()=>{this.polling=false})
      }
    },4000)
  },
  stopPolling() { if (this.pollTimer) clearInterval(this.pollTimer); this.pollTimer=null },
  onInput(event) {
    const field=event.currentTarget.dataset.field
    if (['account','password','code','audioUrl'].includes(field)) {
      const value=event.detail.value
      this.setData({[field]:value})
      if (field==='audioUrl') this.setData({audioTitle:value.trim()===config.audioUrl?config.audioTitle:'自定义音频'})
    }
  },
  async run(action) {
    if (this.data.busy) return
    this.setData({busy:true,error:'',message:''})
    try { await action() }
    catch(error) {
      if (this.disposed) return
      this.setData({error:error.message||'操作失败，请重试'})
    } finally {
      if (this.disposed) return
      this.setData({busy:false,loggedIn:!!this.client.session})
      if (!this.client.session) this.setData({devices:[],selectedDevice:null,playerOpen:false,queueOpen:false,volumeOpen:false,statusText:'尚未查询',volumeText:'',isPlaying:false,volumeKnown:false})
    }
  },
  login() {
    const account=this.data.account.trim(),password=this.data.password
    if (!account || !password) return this.setData({error:'请输入小米账号和密码'})
    this.run(async()=>{
      try {
        const result=await this.client.startLogin(account,password)
        if (result.otp) this.setData({otp:true,otpMethod:result.method,code:'',message:'请填写收到的'+result.method+'验证码'})
        else { this.setData({otp:false,code:'',loggedIn:true}); await this.loadDevices() }
      } finally { this.setData({password:''}) }
    })
  },
  verify() {
    if (!this.data.code.trim()) return this.setData({error:'请输入验证码'})
    this.run(async()=>{
      await this.client.submitCode(this.data.code)
      this.setData({otp:false,code:'',loggedIn:true})
      await this.loadDevices()
    })
  },
  cancelVerification() {
    if (this.data.busy) return
    this.client.cancelVerification()
    this.setData({otp:false,code:'',password:'',error:'',message:''})
  },
  async loadDevices() {
    const previous=this.data.selectedDevice && this.data.selectedDevice.deviceID
    const devices=(await this.client.devices()).map(device=>({
      deviceID:device.deviceID,name:device.alias||device.name||'小爱音箱',
      hardware:device.hardware,presence:device.presence,
      label:(device.alias||device.name||'小爱音箱')+' · '+(device.presence==='online'?'在线':'离线')
    }))
    let selectedIndex=devices.findIndex(d=>d.deviceID===previous)
    if (selectedIndex<0) selectedIndex=Math.max(0,devices.findIndex(d=>d.presence==='online'))
    this.setData({devices,selectedIndex,selectedDevice:devices[selectedIndex]||null,statusText:'尚未查询',volumeText:'',
      message:devices.length?'':'账号下未找到小爱音箱'})
    if (devices[selectedIndex] && devices[selectedIndex].presence==='online') await this.loadStatus(devices[selectedIndex])
  },
  refreshDevices() { this.run(()=>this.loadDevices()) },
  selectDevice(event) {
    const index=Number(event.detail.value)
    this.commandGeneration=(this.commandGeneration||0)+1
    this.setData({selectedIndex:index,selectedDevice:this.data.devices[index],statusText:'尚未查询',volumeText:'',message:'',error:'',
      playbackState:0,isPlaying:false,volume:0,volumeKnown:false,volumeDragging:false,positionText:'00:00',durationText:'--:--',duration:0,progress:0,loopType:null,canFavorite:false,volumeOpen:false})
    if (this.data.selectedDevice && this.data.selectedDevice.presence==='online') this.refreshStatus()
  },
  requireDevice() {
    const device=this.data.selectedDevice
    if (!this.client.session) throw new Error('请先登录小米账号')
    if (!device) throw new Error('请先选择音箱')
    if (device.presence!=='online') throw new Error('音箱离线，请先连接网络')
    return device
  },
  async loadStatus(device) {
    const generation=this.commandGeneration || 0
    const status=await this.client.status(device)
    if (this.disposed || !this.client.session || !this.data.selectedDevice ||
        this.data.selectedDevice.deviceID!==device.deviceID || generation!==(this.commandGeneration||0)) return
    const state=playback(status)
    const current=this.data.queue[this.data.currentIndex]
    const ownTrack=this.currentDeviceID===device.deviceID
    const patch={...state,canFavorite:ownTrack,currentTitle:state.remoteTitle || (ownTrack && current?current.title:([1,2].includes(state.playbackState)?'音箱当前音频':(current?current.title:this.data.audioTitle))),
      currentArtist:state.remoteArtist || '自定义音频 · '+device.name,
      volumeText:state.volumeKnown?state.volume+'%':''}
    if (this.data.volumeDragging) { delete patch.volume; delete patch.volumeKnown }
    if ([0,1,2].includes(status.loop_type)) patch.loopType=status.loop_type
    this.setData(patch)
  },
  saveLibrary() { wx.setStorageSync(LIBRARY_KEY,{tracks:this.data.queue,favorites:this.data.favorites}) },
  addTrack() {
    try {
      const item=track(this.data.audioUrl)
      if (this.data.queue.some(t=>t.url===item.url)) return this.setData({message:'这首音频已在播放列表中',error:''})
      if (this.data.queue.length>=100) throw new Error('播放列表最多保存 100 首音频')
      this.setData({queue:[...this.data.queue,item],message:'已加入播放列表',error:''})
      this.saveLibrary()
    } catch(error) { this.setData({error:error.message}) }
  },
  async startTrack(index) {
    const device=this.requireDevice(),item=this.data.queue[index]
    if (!item) throw new Error('请先添加音频')
    this.commandGeneration=(this.commandGeneration||0)+1
    await this.client.play(device,item.url)
    this.currentDeviceID=device.deviceID
    this.setData({currentIndex:index,currentTitle:item.title,currentArtist:'自定义音频 · '+device.name,
      isFavorite:this.data.favorites.includes(item.url),canFavorite:true,progress:0,positionText:'00:00',durationText:'--:--',duration:0,
      message:'播放指令已发送',statusText:'等待音箱确认',playbackState:0,isPlaying:false})
    await this.loadStatus(device)
  },
  play() {
    return this.run(async()=>{
      this.requireDevice()
      const item=track(this.data.audioUrl)
      let index=this.data.queue.findIndex(t=>t.url===item.url)
      if (index<0) {
        if (this.data.queue.length>=100) throw new Error('播放列表已满，请先移除音频')
        index=this.data.queue.length
        this.setData({queue:[...this.data.queue,item]}); this.saveLibrary()
      }
      await this.startTrack(index)
    })
  },
  togglePlayback() {
    return this.run(async()=>{
      const device=this.requireDevice()
      this.commandGeneration=(this.commandGeneration||0)+1
      if (this.data.playbackState===1) await this.client.pause(device)
      else if (this.data.playbackState===2) await this.client.resume(device)
      else return this.startTrack(this.data.currentIndex)
      await this.loadStatus(device)
    })
  },
  changeTrack(event) {
    return this.run(async()=>{
      if (this.data.queue.length<2) throw new Error('请先在播放列表添加另一首音频')
      const step=Number(event.currentTarget.dataset.step)
      const index=(this.data.currentIndex+step+this.data.queue.length)%this.data.queue.length
      await this.startTrack(index)
    })
  },
  selectTrack(event) {
    const index=Number(event.currentTarget.dataset.index)
    return this.run(()=>this.startTrack(index))
  },
  removeTrack(event) {
    if (this.data.busy) return
    const index=Number(event.currentTarget.dataset.index)
    if (this.data.queue.length===1) return this.setData({error:'请至少保留一首音频'})
    if (index===this.data.currentIndex) return this.setData({error:'当前音频正在使用，请先切换到另一首'})
    const queue=this.data.queue.filter((_,i)=>i!==index)
    const currentIndex=index<this.data.currentIndex?this.data.currentIndex-1:this.data.currentIndex
    const favorites=this.data.favorites.filter(u=>queue.some(t=>t.url===u))
    this.setData({queue,currentIndex,favorites});this.saveLibrary()
  },
  openPlayer() { this.setData({playerOpen:true}) },
  closePlayer() { this.setData({playerOpen:false,volumeOpen:false,volumeDragging:false}) },
  openQueue() { this.setData({queueOpen:true,volumeOpen:false,volumeDragging:false}) },
  openVolume() {
    this.setData({volumeOpen:true,queueOpen:false})
    this.refreshStatus()
  },
  closeVolume() { this.setData({volumeOpen:false,volumeDragging:false}) },
  closeQueue() { this.setData({queueOpen:false}) },
  noop() {},
  toggleFavorite() {
    const item=this.data.queue[this.data.currentIndex]
    if (!item || !this.data.canFavorite) return
    const favorite=!this.data.favorites.includes(item.url)
    this.setData({favorites:favorite?[...this.data.favorites,item.url]:this.data.favorites.filter(u=>u!==item.url),isFavorite:favorite})
    this.saveLibrary()
  },
  changeLoop() {
    return this.run(async()=>{
      const device=this.requireDevice()
      const type=this.data.loopType===null?0:(this.data.loopType+1)%3
      this.commandGeneration=(this.commandGeneration||0)+1
      await this.client.setLoop(device,type)
      this.setData({message:'播放模式指令已发送'})
      await this.loadStatus(device)
    })
  },
  onVolumeChanging(event) { this.setData({volume:Number(event.detail.value),volumeDragging:true}) },
  changeVolume(event) {
    const volume=Math.round(Number(event.detail.value))
    this.setData({volumeDragging:false})
    return this.run(async()=>{
      const device=this.requireDevice()
      this.commandGeneration=(this.commandGeneration||0)+1
      try { await this.client.setVolume(device,volume) }
      finally { await this.loadStatus(device) }
    })
  },
  stop() {
    return this.run(async()=>{
      const device=this.requireDevice()
      this.commandGeneration=(this.commandGeneration||0)+1
      await this.client.stop(device)
      this.setData({message:'停止指令已发送'})
      await this.loadStatus(device)
    })
  },
  refreshStatus() { return this.run(()=>this.loadStatus(this.requireDevice())) },
  copyDiagnostics() {
    const platform=wx.getDeviceInfo?wx.getDeviceInfo():{}
    const report=Object.assign(this.client.diagnostics(),{platform:platform.platform||'unknown'})
    wx.setClipboardData({data:JSON.stringify(report,null,2)})
  },
  logout() {
    if (this.data.busy) return
    this.client.logout()
    this.currentDeviceID=null
    this.setData({loggedIn:false,otp:false,account:'',password:'',code:'',devices:[],selectedDevice:null,
      statusText:'尚未查询',volumeText:'',message:'已退出并清除本机登录凭证',error:'',playerOpen:false,queueOpen:false,volumeOpen:false,isPlaying:false,volumeKnown:false})
  }
})
