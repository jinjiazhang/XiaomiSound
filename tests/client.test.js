const test=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('node:crypto')
const md5=text=>crypto.createHash('md5').update(text).digest('hex')
const sha1=text=>crypto.createHash('sha1').update(text).digest()
const base64=bytes=>Buffer.from(bytes).toString('base64')
const {AuthClient}=require('../cloudfunctions/xiaomiLogin/auth')
const AUTH_HOSTS=['account.xiaomi.com','api2.mina.mi.com','sts.api.mina.mi.com']
const {CookieJar,HttpClient}=require('../miniprogram/utils/http')
const {XiaomiClient}=require('../miniprogram/utils/xiaomi')
const config=require('../miniprogram/config')
function platform(steps, saved) {
  const storage=new Map(saved?[[config.storageKey,saved]]:[])
  const calls=[]
  return {
    storage,calls,
    getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),
    request(options) {
      calls.push(options)
      const step=steps.shift()
      assert.ok(step,'Unexpected request')
      assert.ok(options.url.includes(step.url),options.url+' does not contain '+step.url)
      if (step.inspect) step.inspect(options)
      if (step.fail) return options.fail({errMsg:'sensitive URL must not be propagated'})
      options.success({statusCode:step.status||200,header:step.header||{},cookies:step.cookies||[],data:JSON.stringify(step.data||{code:0})})
    }
  }
}
const auth={code:0,userId:'test-user',ssecurity:'security',nonce:123,
  location:'https://sts.api.mina.mi.com/sts?ticket=example'}
test('Cookie jar respects host, domain, path boundary, expiry and combined Expires headers',()=>{
  const jar=new CookieJar()
  jar.capture('https://account.xiaomi.com/pass/login',{header:{'Set-Cookie':
    'host=one; Path=/pass, root=two; Domain=.xiaomi.com; Path=/; Expires=Wed, 01 Jan 2031 00:00:00 GMT'}})
  assert.equal(jar.header('https://account.xiaomi.com/pass/next'),'host=one; root=two')
  assert.equal(jar.header('https://account.xiaomi.com/passage'),'root=two')
  assert.equal(jar.header('https://other.xiaomi.com/'),'root=two')
  assert.equal(jar.header('https://api2.mina.mi.com/'),'')
  jar.capture('https://account.xiaomi.com/',{cookies:['evil=x; Domain=.com; Path=/','bad=x; Domain=.mi.com; Path=/','root=gone; Domain=.xiaomi.com; Path=/; Max-Age=0']})
  assert.equal(jar.header('https://account.xiaomi.com/'),'')
})
test('visible redirects capture cookies and do not leak explicit cookies cross-host',async()=>{
  const p=platform([
    {url:'account.xiaomi.com/pass/login',status:302,header:{Location:'https://sts.api.mina.mi.com/next'},cookies:['private=x; Path=/']},
    {url:'sts.api.mina.mi.com/next',inspect:r=>assert.equal(r.header.Cookie,undefined)}
  ])
  await new HttpClient(p,AUTH_HOSTS).request('https://account.xiaomi.com/pass/login',{cookies:{password:'secret'}})
})
test('unknown domains blocked and network errors do not expose URLs or tokens',async()=>{
  const client=new HttpClient(platform([{url:'account.xiaomi.com',fail:true}]),AUTH_HOSTS)
  await assert.rejects(()=>client.request('https://evil.example/'),/额外的域名/)
  await assert.rejects(()=>client.request('https://account.xiaomi.com/pass?token=secret'),error=>!error.message.includes('secret'))
})
test('403 identifies the login step and diagnostic output excludes credentials',async()=>{
  const p=platform([{url:'serviceLoginAuth2',status:403,header:{'Set-Cookie':'secret=value'},data:{token:'hidden'}}])
  const http=new HttpClient(p,AUTH_HOSTS)
  await assert.rejects(()=>http.json('https://account.xiaomi.com/pass/serviceLoginAuth2?token=secret',{
    stage:'提交账号密码',data:{user:'private-user',hash:'private-hash'},cookies:{passToken:'private-token'}
  }),error=>error.message.includes('提交账号密码') && error.message.includes('/pass/serviceLoginAuth2') && !error.message.includes('?'))
  const report=JSON.stringify(http.diagnostics)
  assert.ok(report.includes('403'))
  for (const secret of ['private-user','private-hash','private-token','hidden','value','token=secret']) assert.ok(!report.includes(secret))
})
test('password login validates token and stores no password',async()=>{
  const p=platform([
    {url:'serviceLogin?',data:{code:70016,qs:'query',_sign:'sign',callback:'callback'}},
    {url:'serviceLoginAuth2',data:auth,inspect:r=>{
      const body=new URLSearchParams(r.data)
      assert.equal(body.get('hash'),md5('fixture-password').toUpperCase())
      assert.ok(!r.data.includes('fixture-password'))
    }},
    {url:'clientSign=',cookies:['serviceToken=fixture-token; Path=/'],inspect:r=>{
      assert.equal(new URL(r.url).searchParams.get('clientSign'),base64(sha1('nonce=123&security')))
    }},
    {url:'/admin/v2/device_list',data:{code:0,data:[]},inspect:r=>assert.equal(r.header.Cookie,'userId=test-user; serviceToken=fixture-token')}
  ])
  const client=new AuthClient(p)
  assert.deepEqual(await client.startLogin('fixture-user','fixture-password'),{otp:false})
  assert.deepEqual(client.session,{userId:'test-user',serviceToken:'fixture-token'})
  assert.equal(p.storage.size,0)
})
test('OTP login keeps verification cookies and completes without storing credentials',async()=>{
  const p=platform([
    {url:'serviceLogin?',data:{code:1,qs:'q',_sign:'s',callback:'c'}},
    {url:'serviceLoginAuth2',data:{code:0,notificationUrl:'/fe/service/identity/authStart?context=hello%2Bworld&sid=micoapi'}},
    {url:'/fe/service/identity/authStart',cookies:['verify_session=test; Path=/identity']},
    {url:'/identity/list?',data:{code:0,flag:4},inspect:r=>{
      assert.ok(r.header.Cookie.includes('verify_session=test'))
      assert.equal(new URL(r.url).searchParams.get('context'),'hello+world')
    }},
    {url:'/identity/auth/verifyPhone?',data:{code:0}},
    {url:'/identity/auth/sendPhoneTicket',data:{code:0}},
    {url:'/identity/auth/verifyPhone?_dc=',data:{code:0,location:'/pass/verified'}},
    {url:'/pass/verified'},
    {url:'serviceLogin?',data:auth},
    {url:'clientSign=',cookies:['serviceToken=fixture-token; Path=/']},
    {url:'/admin/v2/device_list',data:{code:0,data:[]}}
  ])
  const client=new AuthClient(p)
  assert.deepEqual(await client.startLogin('fixture-user','fixture-password'),{otp:true,method:'手机'})
  assert.equal(p.storage.size,0)
  await client.submitCode('123456')
  assert.equal(client.pending,null)
  assert.ok(client.session)
  assert.equal(p.calls.length,11)
})
test('OTP account redirects stop before unsigned STS and exchange with clientSign',async()=>{
  const p=platform([
    {url:'/identity/auth/verifyPhone?_dc=',data:{code:0,location:'/identity/result/check'}},
    {url:'/identity/result/check',status:302,header:{Location:'/pass/serviceLoginAuth2/end'},cookies:['verification=accepted; Path=/']},
    {url:'/pass/serviceLoginAuth2/end',status:302,header:{Location:'https://api2.mina.mi.com/sts?ticket=unsigned'},cookies:['passToken=account-token; Path=/']},
    {url:'/pass/serviceLogin?',data:{...auth,location:'https://api2.mina.mi.com/sts?ticket=fresh'},inspect:r=>assert.ok(r.header.Cookie.includes('passToken=account-token'))},
    {url:'https://api2.mina.mi.com/sts?',cookies:['serviceToken=validated-token; Path=/'],inspect:r=>{
      const url=new URL(r.url)
      assert.equal(url.searchParams.get('ticket'),'fresh')
      assert.equal(url.searchParams.get('clientSign'),base64(sha1('nonce=123&security')))
      assert.ok(!(r.header.Cookie||'').includes('account-token'))
    }},
    {url:'/admin/v2/device_list',data:{code:0,data:[]}}
  ])
  const client=new AuthClient(p)
  client.pending={flag:4,method:'Phone'}
  await client.submitCode('123456')
  assert.equal(client.session.serviceToken,'validated-token')
  assert.equal(client.pending,null)
  assert.equal(p.calls.length,6)
  assert.ok(!p.calls.some(r=>r.url.includes('ticket=unsigned')))
})
test('OTP account redirect errors are not swallowed',async()=>{
  const p=platform([
    {url:'/identity/auth/verifyPhone?_dc=',data:{code:0,location:'/identity/result/check'}},
    {url:'/identity/result/check',status:401}
  ])
  const client=new AuthClient(p)
  client.pending={flag:4,method:'Phone'}
  await assert.rejects(()=>client.submitCode('123456'),/HTTP 401/)
  assert.equal(client.session,null)
})
test('discovery code 2 falls back to SMS only after verification and sending succeed',async()=>{
  for (const sendCode of [0, 70001]) {
    const p=platform([
      {url:'/fe/service/identity/authStart'},
      {url:'/identity/list?',data:{code:2}},
      {url:'/identity/auth/verifyPhone?',data:{code:0}},
      {url:'/identity/auth/sendPhoneTicket',data:{code:sendCode}}
    ])
    const client=new AuthClient(p)
    if (sendCode===0) assert.deepEqual(await client.startVerification('/fe/service/identity/authStart?context=fixture'),{otp:true,method:'手机'})
    else {
      await assert.rejects(()=>client.startVerification('/fe/service/identity/authStart?context=fixture'),/发送验证码失败/)
      assert.equal(client.pending,null)
    }
  }
})
test('other discovery errors are rejected before a verification request',async()=>{
  const p=platform([
    {url:'/fe/service/identity/authStart'},
    {url:'/identity/list?',data:{code:99}}
  ])
  const client=new AuthClient(p)
  await assert.rejects(()=>client.startVerification('/fe/service/identity/authStart?context=fixture'),/查询验证方式失败/)
  assert.equal(client.pending,null)
})
test('missing redirect cookie fails explicitly without persisting a session',async()=>{
  const p=platform([{url:'serviceLogin?',data:auth},{url:'clientSign='}])
  const client=new AuthClient(p)
  await assert.rejects(()=>client.startLogin('fixture','password'),/未返回 serviceToken/)
  assert.equal(p.storage.size,0)
})
test('fixed URL play and status are correctly encoded; inner errors are not accepted',async()=>{
  const saved={userId:'fixture-user',serviceToken:'fixture-token'}
  const p=platform([
    {url:'/remote/ubus',data:{code:0,data:{code:0}},inspect:r=>{
      const body=new URLSearchParams(r.data)
      assert.equal(body.get('method'),'player_play_url')
      assert.equal(body.get('deviceId'),'speaker-uuid')
      assert.deepEqual(JSON.parse(body.get('message')),{url:config.audioUrl,type:2,media:'app_ios'})
    }},
    {url:'/remote/ubus',data:{code:0,data:{code:0,info:'{"status":1,"volume":30}'}}},
    {url:'/remote/ubus',data:{code:0,data:{code:-101}}}
  ],saved)
  const client=new XiaomiClient(p),device={deviceID:'speaker-uuid',hardware:'L16B'}
  await client.play(device)
  assert.deepEqual(await client.status(device),{status:1,volume:30})
  await assert.rejects(()=>client.stop(device),/设备执行失败/)
})
test('expired token clears local session and requests login',async()=>{
  const p=platform([{url:'/admin/v2/device_list',data:{code:401,message:'auth invalid'}}],{userId:'fixture',serviceToken:'token'})
  const client=new XiaomiClient(p)
  await assert.rejects(()=>client.devices(),/已失效/)
  assert.equal(client.session,null)
  assert.equal(p.storage.size,0)
})
test('HTTP 401 also clears saved credentials',async()=>{
  const p=platform([{url:'/admin/v2/device_list',status:401}],{userId:'fixture',serviceToken:'token'})
  const client=new XiaomiClient(p)
  await assert.rejects(()=>client.devices(),/已失效/)
  assert.equal(p.storage.size,0)
})
test('music API models receive the fixed URL in the music payload',async()=>{
  const p=platform([{url:'/remote/ubus',inspect:r=>{
    const body=new URLSearchParams(r.data),message=JSON.parse(body.get('message'))
    assert.equal(body.get('method'),'player_play_music')
    assert.equal(JSON.parse(message.music).payload.audio_items[0].stream.url,config.audioUrl)
  }}],{userId:'fixture',serviceToken:'token'})
  await new XiaomiClient(p).play({deviceID:'speaker',hardware:'L05B'})
})
