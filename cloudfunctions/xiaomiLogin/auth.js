const crypto=require('crypto')
const md5=text=>crypto.createHash('md5').update(text).digest('hex')
const sha1=text=>crypto.createHash('sha1').update(text).digest()
const base64=bytes=>Buffer.from(bytes).toString('base64')
const {HttpClient,form}=require('./http')
const config={allowedHosts:['account.xiaomi.com','api2.mina.mi.com','sts.api.mina.mi.com']}
const ACCOUNT='https://account.xiaomi.com'
const MINA='https://api2.mina.mi.com'
const UA_LOGIN='APP/com.xiaomi.mihome APPV/11.3.203 iosPassportSDK/4.2.50 iOS/26.3.1 MK/aVBob25lMTcsMg== DEVT/aVBob25l DEVS/aU9T BRA/QXBwbGU= L/zh_CN'
const UA_OTP='Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 iOS/26.3.1 MiHome/11.3.203 iPhone/iPhone17,2 DeviceId/D84D9205859533D504042022029B988E6F7DD180 UserId/8816080 APP/com.xiaomi.mihome APPV/11.3.203 Platform/iPhone Region/CN /xiaomi/miuibrowser/4.3/smartHome/ios/iPhone17,2/11.3.203 APP/com.xiaomi.mihome APPV/11.3.203 iosPassportSDK/4.2.50 iOS/26.3.1 MK/aVBob25lMTcsMg== DEVT/aVBob25l DEVS/aU9T BRA/QXBwbGU= L/zh_CN'
const UA_MINA='MiHome/6.0.103 (com.xiaomi.mihome; build:6.0.103.1; iOS 14.4.0) Alamofire/6.0.103 MICO/iOSApp/appStore/6.0.103'
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
class AuthClient {
  constructor(platform) {
    this.platform=platform
    this.http=new HttpClient(platform,config.allowedHosts)
    this.seed=crypto.randomBytes(8).toString('hex').toUpperCase()
    this.pending=null
    this.session=null
  }
  accountOptions(data,otp=false,stage='账号认证') {
    return {data,stage,headers:{'User-Agent':otp?UA_OTP:UA_LOGIN},cookies:{deviceId:this.seed,sdkVersion:'3.9'}}
  }
  async startLogin(username,password) {
    this.pending=null
    this.http=new HttpClient(this.platform,config.allowedHosts)
    this.seed=crypto.randomBytes(8).toString('hex').toUpperCase()
    const first=await this.http.json(ACCOUNT+'/pass/serviceLogin?sid=micoapi&_json=true',this.accountOptions(undefined,false,'获取登录参数'))
    let result=first
    if (first.code!==0) {
      if (!first.qs || !first._sign || !first.callback) throw new Error('无法取得登录参数，请稍后重试')
      result=await this.http.json(ACCOUNT+'/pass/serviceLoginAuth2',this.accountOptions({
        _json:'true',qs:first.qs,sid:'micoapi',_sign:first._sign,callback:first.callback,
        user:username,hash:md5(password).toUpperCase()
      },false,'提交账号密码'))
    }
    check(result,'账号登录')
    if (result.notificationUrl) return this.startVerification(result.notificationUrl)
    await this.finishLogin(result)
    return {otp:false}
  }
  async startVerification(notificationUrl) {
    const url=notificationUrl.startsWith('/')?ACCOUNT+notificationUrl:notificationUrl
    await this.http.request(url,this.accountOptions(undefined,true,'建立验证会话'))
    const result=check(await this.http.json(ACCOUNT+'/identity/list?'+form({
      sid:queryValue(url,'sid')||'micoapi',supportedMask:0,_locale:'zh_CN',context:queryValue(url,'context')
    }),this.accountOptions(undefined,true,'查询验证方式')),'查询验证方式',true)
    const flag=result.flag===undefined?4:result.flag
    if (flag!==4 && flag!==8) throw new Error('需要额外网页验证，当前支持短信或邮箱验证码登录')
    const method=flag===8?'Email':'Phone'
    check(await this.http.json(ACCOUNT+'/identity/auth/verify'+method+'?_flag='+flag+'&_json=true',this.accountOptions(undefined,true,'初始化验证码验证')),'初始化验证',true)
    if (method==='Phone') {
      check(await this.http.json(ACCOUNT+'/identity/auth/sendPhoneTicket',this.accountOptions({retry:'0',icode:'',_json:'true'},true,'发送短信验证码')),'发送验证码',true)
    }
    this.pending={flag,method}
    return {otp:true,method:method==='Phone'?'手机':'邮箱'}
  }
  async submitCode(code) {
    if (!this.pending) throw new Error('请先登录并获取验证码')
    const {flag,method}=this.pending
    const result=await this.http.json(ACCOUNT+'/identity/auth/verify'+method+'?_dc='+Date.now(),this.accountOptions({
      _flag:String(flag),ticket:code.trim(),trust:'false',_json:'true'
    },true,'提交验证码'))
    check(result,'验证码验证',true)
    if (!result.location) throw new Error('验证未完成，请检查验证码或重新登录')
    await this.http.request(result.location.startsWith('/')?ACCOUNT+result.location:result.location,this.accountOptions(undefined,true,'完成验证跳转'))
    const auth=check(await this.http.json(ACCOUNT+'/pass/serviceLogin?sid=micoapi&_json=true',this.accountOptions(undefined,false,'恢复登录会话')),'完成登录')
    await this.finishLogin(auth)
    this.pending=null
  }
  async finishLogin(auth) {
    if (!auth.userId || !auth.ssecurity || !auth.location || auth.nonce===undefined) throw new Error('登录响应缺少凭证字段')
    const sign=base64(sha1('nonce='+auth.nonce+'&'+auth.ssecurity))
    const url=auth.location+(auth.location.includes('?')?'&':'?')+'clientSign='+encodeURIComponent(sign)
    const exchange=await this.http.request(url,{stage:'换取登录凭证'})
    const serviceToken=this.http.jar.get(exchange.url,'serviceToken') || this.http.jar.get(MINA+'/','serviceToken')
    if (!serviceToken) throw new Error('小米登录未返回 serviceToken，登录未完成')
    const session={userId:String(auth.userId),serviceToken}
    // Validate the token before returning it. Never persist the password.
    await this.api('/admin/v2/device_list?master=0',null,session)
    this.session=session
  }
  async api(path,data,session=this.session) {
    return check(await this.http.json(MINA+path,{
      data,stage:'验证登录凭证',headers:{'User-Agent':UA_MINA},
      cookies:{userId:session.userId,serviceToken:session.serviceToken}
    }),'验证登录凭证')
  }
  exportState() {
    return {seed:this.seed,pending:this.pending,cookies:this.http.jar.cookies
      .filter(c=>c.expires>Date.now()).map(c=>({...c,expires:Number.isFinite(c.expires)?c.expires:null}))}
  }
  restore(state) {
    this.seed=state.seed;this.pending=state.pending
    this.http.jar.cookies=state.cookies.map(c=>({...c,expires:c.expires===null?Infinity:c.expires}))
  }
}
module.exports={AuthClient}
