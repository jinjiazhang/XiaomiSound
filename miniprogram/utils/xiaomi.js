const {md5,sha1,base64}=require('./crypto')
const {HttpClient,form}=require('./http')
const config=require('../config')
const ACCOUNT='https://account.xiaomi.com'
const MINA='https://api2.mina.mi.com'
const UA_LOGIN='APP/com.xiaomi.mihome APPV/11.3.203 iosPassportSDK/4.2.50 iOS/26.3.1 MK/aVBob25lMTcsMg== DEVT/aVBob25l DEVS/aU9T BRA/QXBwbGU= L/zh_CN'
const UA_OTP='Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MiHome/11.3.203 APP/com.xiaomi.mihome Platform/iPhone Region/CN'
const UA_MINA='MiHome/6.0.103 (com.xiaomi.mihome; build:6.0.103.1; iOS 14.4.0) Alamofire/6.0.103 MICO/iOSApp/appStore/6.0.103'
const MUSIC_API=['LX04','LX05','L05B','L05C','L06','L06A','X08A','X10A','X08C','X08E','X8F','X4B','OH2','OH2P','X6A']
function id() { return 'WX'+Date.now().toString(16)+Math.random().toString(16).slice(2,14) }
function check(result, label, allowMissing=false) {
  if (!result || (result.code!==0 && !(allowMissing && result.code===undefined))) {
    throw new Error(label+'失败（代码 '+(result && result.code!==undefined?result.code:'未知')+'）')
  }
  return result
}
function queryValue(url,key) {
  const query=(url.split('?')[1]||'').split('#')[0]
  for (const item of query.split('&')) {
    const i=item.indexOf('=')
    if (decodeURIComponent(i<0?item:item.slice(0,i))===key) return decodeURIComponent((i<0?'':item.slice(i+1)).replace(/\+/g,' '))
  }
  return ''
}
class XiaomiClient {
  constructor(platform) {
    this.platform=platform
    this.http=new HttpClient(platform,config.allowedHosts)
    this.seed=id().slice(0,16).toUpperCase()
    this.pending=null
    const saved=platform.getStorageSync(config.storageKey)
    this.session=saved && saved.userId && saved.serviceToken ? saved : null
  }
  accountOptions(data,otp=false) {
    return {data,headers:{'User-Agent':otp?UA_OTP:UA_LOGIN},cookies:{deviceId:this.seed,sdkVersion:'3.9'}}
  }
  async startLogin(username,password) {
    this.pending=null
    this.http=new HttpClient(this.platform,config.allowedHosts)
    this.seed=id().slice(0,16).toUpperCase()
    const first=await this.http.json(ACCOUNT+'/pass/serviceLogin?sid=micoapi&_json=true',this.accountOptions())
    let result=first
    if (first.code!==0) {
      if (!first.qs || !first._sign || !first.callback) throw new Error('无法取得登录参数，请稍后重试')
      result=await this.http.json(ACCOUNT+'/pass/serviceLoginAuth2',this.accountOptions({
        _json:'true',qs:first.qs,sid:'micoapi',_sign:first._sign,callback:first.callback,
        user:username,hash:md5(password).toUpperCase()
      }))
    }
    check(result,'账号登录')
    if (result.notificationUrl) return this.startVerification(result.notificationUrl)
    await this.finishLogin(result)
    return {otp:false}
  }
  async startVerification(notificationUrl) {
    const url=notificationUrl.startsWith('/')?ACCOUNT+notificationUrl:notificationUrl
    await this.http.request(url,this.accountOptions(undefined,true))
    const result=check(await this.http.json(ACCOUNT+'/identity/list?'+form({
      sid:queryValue(url,'sid')||'micoapi',supportedMask:0,_locale:'zh_CN',context:queryValue(url,'context')
    }),this.accountOptions(undefined,true)),'查询验证方式',true)
    const flag=result.flag===undefined?4:result.flag
    if (flag!==4 && flag!==8) throw new Error('需要额外网页验证，当前支持短信或邮箱验证码登录')
    const method=flag===8?'Email':'Phone'
    check(await this.http.json(ACCOUNT+'/identity/auth/verify'+method+'?_flag='+flag+'&_json=true',this.accountOptions(undefined,true)),'初始化验证',true)
    if (method==='Phone') {
      check(await this.http.json(ACCOUNT+'/identity/auth/sendPhoneTicket',this.accountOptions({retry:'0',icode:'',_json:'true'},true)),'发送验证码',true)
    }
    this.pending={flag,method}
    return {otp:true,method:method==='Phone'?'手机':'邮箱'}
  }
  async submitCode(code) {
    if (!this.pending) throw new Error('请先登录并获取验证码')
    const {flag,method}=this.pending
    const result=await this.http.json(ACCOUNT+'/identity/auth/verify'+method+'?_dc='+Date.now(),this.accountOptions({
      _flag:String(flag),ticket:code.trim(),trust:'false',_json:'true'
    },true))
    check(result,'验证码验证',true)
    if (!result.location) throw new Error('验证未完成，请检查验证码或重新登录')
    await this.http.request(result.location.startsWith('/')?ACCOUNT+result.location:result.location,this.accountOptions(undefined,true))
    const auth=check(await this.http.json(ACCOUNT+'/pass/serviceLogin?sid=micoapi&_json=true',this.accountOptions()),'完成登录')
    await this.finishLogin(auth)
    this.pending=null
  }
  async finishLogin(auth) {
    if (!auth.userId || !auth.ssecurity || !auth.location || auth.nonce===undefined) throw new Error('登录响应缺少凭证字段')
    const sign=base64(sha1('nonce='+auth.nonce+'&'+auth.ssecurity))
    const url=auth.location+(auth.location.includes('?')?'&':'?')+'clientSign='+encodeURIComponent(sign)
    const exchange=await this.http.request(url)
    const serviceToken=this.http.jar.get(exchange.url,'serviceToken') || this.http.jar.get(MINA+'/','serviceToken')
    if (!serviceToken) throw new Error('未取得 serviceToken：微信可能隐藏了跳转中的 Cookie，当前环境未完成登录')
    const session={userId:String(auth.userId),serviceToken}
    // Validate the token before persisting it. Do not store the account password.
    await this.api('/admin/v2/device_list?master=0',null,session)
    this.platform.setStorageSync(config.storageKey,session)
    this.session=session
  }
  async api(path,data,session=this.session) {
    if (!session) throw new Error('请先登录小米账号')
    const requestId='app_ios_'+id()
    const url=MINA+path+(data?'':(path.includes('?')?'&':'?')+'requestId='+requestId)
    let result
    try {
      result=await this.http.json(url,{
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
  async play(device) {
    if (!MUSIC_API.includes(device.hardware)) return this.ubus(device,'player_play_url',{url:config.audioUrl,type:2,media:'app_ios'})
    const audioId=String(Date.now())
    const music={payload:{audio_type:'',audio_items:[{
      item_id:{audio_id:audioId,cp:{album_id:'-1',episode_index:0,id:'355454500',name:'xiaowei'}},stream:{url:config.audioUrl}
    }],list_params:{listId:'-1',loadmore_offset:0,origin:'xiaowei',type:'MUSIC'}},play_behavior:'REPLACE_ALL'}
    return this.ubus(device,'player_play_music',{startaudioid:audioId,music:JSON.stringify(music)})
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
  logout() {
    this.session=null; this.pending=null
    this.http=new HttpClient(this.platform,config.allowedHosts)
    this.platform.removeStorageSync(config.storageKey)
  }
}
module.exports={XiaomiClient}
