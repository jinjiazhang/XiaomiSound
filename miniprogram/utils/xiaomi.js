const {HttpClient}=require('./http')
const config=require('../config')
const MINA='https://api2.mina.mi.com'
const UA_MINA='MiHome/6.0.103 (com.xiaomi.mihome; build:6.0.103.1; iOS 14.4.0) Alamofire/6.0.103 MICO/iOSApp/appStore/6.0.103'
const MUSIC_API=['LX04','LX05','L05B','L05C','L06','L06A','X08A','X10A','X08C','X08E','X8F','X4B','OH2','OH2P','X6A']
function id() { return 'WX'+Date.now().toString(16)+Math.random().toString(16).slice(2,14) }
function check(result, label, allowMissing=false) {
  if (!result || (result.code!==0 && !(allowMissing && result.code===undefined))) {
    throw new Error(label+'失败（代码 '+(result && result.code!==undefined?result.code:'未知')+'）')
  }
  return result
}
class XiaomiClient {
  constructor(platform) {
    this.platform=platform
    this.http=new HttpClient(platform,config.allowedHosts)
    this.pending=null
    const saved=platform.getStorageSync(config.storageKey)
    this.session=saved && saved.userId && saved.serviceToken ? saved : null
  }
  async callLogin(action,data={}) {
    if (!config.cloudEnv) throw new Error('请先配置微信云开发环境 ID')
    if (!this.platform.cloud) throw new Error('当前微信版本不支持云开发，请更新微信')
    let response
    try {
      response=await this.platform.cloud.callFunction({
        name:config.loginFunction,config:{env:config.cloudEnv},data:{action,...data}
      })
    } catch (_) { throw new Error('云函数调用失败，请确认环境关联、函数部署及云开发额度') }
    const result=response.result
    this.cloudDiagnostics=result && Array.isArray(result.diagnostics)?result.diagnostics:[]
    if (!result || !result.ok) throw new Error(result && result.message || '云端登录失败')
    return result
  }
  acceptSession(session) {
    if (!session || typeof session.userId!=='string' || typeof session.serviceToken!=='string' || !session.serviceToken) {
      throw new Error('云端未返回有效登录凭证')
    }
    this.platform.setStorageSync(config.storageKey,session)
    this.session=session
    this.pending=null
  }
  async startLogin(username,password) {
    this.pending=null
    const result=await this.callLogin('startLogin',{account:username,password})
    if (result.otp) {
      this.pending={sessionId:result.sessionId}
      return {otp:true,method:result.method}
    }
    this.acceptSession(result.session)
    return {otp:false}
  }
  async submitCode(code) {
    if (!this.pending) throw new Error('请先登录并获取验证码')
    const result=await this.callLogin('submitCode',{sessionId:this.pending.sessionId,code:code.trim()})
    this.acceptSession(result.session)
  }
  cancelVerification() {
    const pending=this.pending
    this.pending=null
    if (pending) this.callLogin('cancel',{sessionId:pending.sessionId}).catch(()=>{})
  }
  async api(path,data,session=this.session) {
    if (!session) throw new Error('请先登录小米账号')
    const requestId='app_ios_'+id()
    const url=MINA+path+(data?'':(path.includes('?')?'&':'?')+'requestId='+requestId)
    let result
    try {
      result=await this.http.json(url,{
        stage:path.startsWith('/admin/')?'查询音箱列表':'控制音箱',
        data:data?Object.assign({},data,{requestId}):undefined,
        headers:{'User-Agent':UA_MINA},cookies:{userId:session.userId,serviceToken:session.serviceToken}
      })
    } catch (error) {
      if (error.statusCode===401) {
        this.logout()
        throw new Error('登录凭证已失效，请重新登录')
      }
      throw error
    }
    if (result.code!==0) {
      if (/auth|token|login/i.test(result.message||'')) {
        this.logout()
        throw new Error('登录凭证已失效，请重新登录')
      }
      check(result,'音箱请求')
    }
    return result
  }
  async devices() { const result=await this.api('/admin/v2/device_list?master=0'); return Array.isArray(result.data)?result.data:[] }
  async ubus(device,method,message) {
    const result=await this.api('/remote/ubus',{deviceId:device.deviceID,method,path:'mediaplayer',message:JSON.stringify(message)})
    if (result.data && typeof result.data==='object' && result.data.code!==undefined && result.data.code!==0) check(result.data,'设备执行')
    return result.data
  }
  async play(device,audioUrl=config.audioUrl) {
    const url=typeof audioUrl==='string'?audioUrl.trim():''
    if (!url) throw new Error('请填写音频地址')
    if (!/^https?:\/\/[^/?#\s]+(?:[/?#][^\s]*)?$/i.test(url)) throw new Error('请填写有效的 HTTP 或 HTTPS 音频地址')
    if (!MUSIC_API.includes(device.hardware)) return this.ubus(device,'player_play_url',{url,type:2,media:'app_ios'})
    const audioId=String(Date.now())
    const music={payload:{audio_type:'',audio_items:[{
      item_id:{audio_id:audioId,cp:{album_id:'-1',episode_index:0,id:'355454500',name:'xiaowei'}},stream:{url}
    }],list_params:{listId:'-1',loadmore_offset:0,origin:'xiaowei',type:'MUSIC'}},play_behavior:'REPLACE_ALL'}
    return this.ubus(device,'player_play_music',{startaudioid:audioId,music:JSON.stringify(music)})
  }
  pause(device) { return this.ubus(device,'player_play_operation',{action:'pause',media:'app_ios'}) }
  resume(device) { return this.ubus(device,'player_play_operation',{action:'play',media:'app_ios'}) }
  setVolume(device,volume) {
    if (!Number.isInteger(volume) || volume<0 || volume>100) throw new Error('音量应为 0 到 100 的整数')
    return this.ubus(device,'player_set_volume',{volume,media:'app_ios'})
  }
  setLoop(device,type) {
    if (![0,1,2].includes(type)) throw new Error('播放模式无效')
    if (MUSIC_API.includes(device.hardware)) throw new Error('当前机型暂不支持远程切换循环模式')
    return this.ubus(device,'player_set_loop',{media:'common',type})
  }
  stop(device) { return this.ubus(device,'player_play_operation',{action:'stop',media:'app_ios'}) }
  async status(device) {
    const data=await this.ubus(device,'player_get_play_status',{media:'app_ios'})
    if (!data) throw new Error('设备未返回播放状态')
    if (typeof data.info==='string') {
      try { return JSON.parse(data.info) } catch (_) { throw new Error('设备播放状态格式异常') }
    }
    return data
  }
  diagnostics() { return {version:'0.3.3',requests:[...(this.cloudDiagnostics||[]),...this.http.diagnostics]} }
  logout() {
    this.cancelVerification()
    this.session=null; this.pending=null
    this.http=new HttpClient(this.platform,config.allowedHosts)
    this.platform.removeStorageSync(config.storageKey)
  }
}
module.exports={XiaomiClient}
