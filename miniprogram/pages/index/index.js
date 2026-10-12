const {XiaomiClient}=require('../../utils/xiaomi')
const config=require('../../config')
Page({
  data:{
    account:'',password:'',code:'',otp:false,otpMethod:'手机',loggedIn:false,
    busy:false,devices:[],selectedIndex:0,selectedDevice:null,
    audioTitle:config.audioTitle,audioUrl:config.audioUrl,
    statusText:'尚未查询',volumeText:'',message:'',error:''
  },
  onLoad() {
    this.client=new XiaomiClient(wx)
    this.setData({loggedIn:!!this.client.session})
    if (this.client.session) this.refreshDevices()
  },
  onInput(event) {
    const field=event.currentTarget.dataset.field
    if (['account','password','code'].includes(field)) this.setData({[field]:event.detail.value})
  },
  async run(action) {
    if (this.data.busy) return
    this.setData({busy:true,error:'',message:''})
    try { await action() }
    catch(error) {
      this.setData({error:error.message||'操作失败，请重试'})
    } finally {
      this.setData({busy:false,loggedIn:!!this.client.session})
      if (!this.client.session) this.setData({devices:[],selectedDevice:null,statusText:'尚未查询',volumeText:''})
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
    this.client.logout()
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
      message:devices.length?'请选择音箱并播放测试音乐':'账号下未找到小爱音箱'})
  },
  refreshDevices() { this.run(()=>this.loadDevices()) },
  selectDevice(event) {
    const index=Number(event.detail.value)
    this.setData({selectedIndex:index,selectedDevice:this.data.devices[index],statusText:'尚未查询',volumeText:'',message:'',error:''})
  },
  requireDevice() {
    const device=this.data.selectedDevice
    if (!this.client.session) throw new Error('请先登录小米账号')
    if (!device) throw new Error('请先选择音箱')
    if (device.presence!=='online') throw new Error('音箱离线，请先连接网络')
    return device
  },
  async loadStatus(device) {
    const status=await this.client.status(device)
    const labels={1:'播放中',2:'已暂停',3:'未播放'}
    this.setData({statusText:labels[status.status]||'设备未提供可识别的状态',
      volumeText:status.volume===undefined?'':status.volume+'%'})
  },
  play() {
    this.run(async()=>{
      const device=this.requireDevice()
      await this.client.play(device)
      this.setData({message:'播放指令已发送',statusText:'指令已发送，等待确认'})
      // A successful command response is not proof that the speaker fetched the MP3.
      await new Promise(resolve=>setTimeout(resolve,1200))
      await this.loadStatus(device)
    })
  },
  stop() {
    this.run(async()=>{
      const device=this.requireDevice()
      await this.client.stop(device)
      this.setData({message:'停止指令已发送'})
      await this.loadStatus(device)
    })
  },
  refreshStatus() { this.run(()=>this.loadStatus(this.requireDevice())) },
  copyDiagnostics() {
    const platform=wx.getDeviceInfo?wx.getDeviceInfo():{}
    const report=Object.assign(this.client.diagnostics(),{platform:platform.platform||'unknown'})
    wx.setClipboardData({data:JSON.stringify(report,null,2)})
  },
  logout() {
    if (this.data.busy) return
    this.client.logout()
    this.setData({loggedIn:false,otp:false,account:'',password:'',code:'',devices:[],selectedDevice:null,
      statusText:'尚未查询',volumeText:'',message:'已退出并清除本机登录凭证',error:''})
  }
})
