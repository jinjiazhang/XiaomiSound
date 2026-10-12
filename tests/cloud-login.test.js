const test=require('node:test')
const assert=require('node:assert/strict')
const {createHandler,APPID,TTL,PublicError}=require('../cloudfunctions/xiaomiLogin/service')
const {XiaomiClient}=require('../miniprogram/utils/xiaomi')
const config=require('../miniprogram/config')
const identity={OPENID:'owner-a',APPID}
const sessionId='a'.repeat(48)
function memoryStore() {
  const records=new Map(),rates=new Map()
  return {
    records,
    async rateLimit(owner,time) {
      if (rates.has(owner) && time-rates.get(owner)<60000) throw new PublicError('请等待 60 秒后再发起登录')
      rates.set(owner,time)
    },
    async removeExpired(owner,time) {
      for (const [id,record] of records) if (record.owner===owner && record.expiresAt<=time) records.delete(id)
    },
    async save(id,data) { records.set(id,JSON.parse(JSON.stringify(data))) },
    async acquire(id,owner,time) {
      const record=records.get(id)
      if (!record || record.owner!==owner || record.expiresAt<=time || record.state!=='ready' || record.attempts>=5) return null
      record.state='processing';record.attempts++
      return structuredClone(record)
    },
    async release(id,owner,auth) { const r=records.get(id);if(r && r.owner===owner){r.state='ready';r.auth=auth} },
    async remove(id,owner) { if(records.get(id)?.owner===owner) records.delete(id) }
  }
}
function setup({failCode=false}={}) {
  let time=100000,created=0
  const store=memoryStore()
  const handler=createHandler({store,now:()=>time,randomId:()=>sessionId,createAuth:()=>{
    created++
    return {
      state:null,http:{diagnostics:[]},
      async startLogin(){this.state={seed:'fixture',pending:{flag:4,method:'Phone'},cookies:[{name:'verify_session',value:'private',expires:null}]};return {otp:true,method:'手机'}},
      exportState(){return this.state},restore(state){this.state=state},
      async submitCode(){
        assert.equal(this.state.cookies[0].value,'private')
        if(failCode) throw new Error('验证码验证失败（代码 70014）')
        this.session={userId:'xiaomi-user',serviceToken:'fixture-token'}
      }
    }
  }})
  return {store,handler,advance:t=>time+=t,count:()=>created}
}
test('OTP survives a new instance and completion deletes the challenge',async()=>{
  const s=setup()
  const first=await s.handler({action:'startLogin',account:'fixture',password:'never-store-this'},identity)
  assert.equal(first.sessionId,sessionId)
  assert.ok(!JSON.stringify([...s.store.records.values()]).includes('never-store-this'))
  assert.ok(!JSON.stringify(first).includes('private'))
  const result=await s.handler({action:'submitCode',sessionId,code:'123456'},identity)
  assert.equal(s.count(),2)
  assert.deepEqual(result.session,{userId:'xiaomi-user',serviceToken:'fixture-token'})
  assert.equal(s.store.records.size,0)
})
test('other users, forged identity fields and wrong AppIDs cannot use a challenge',async()=>{
  const s=setup()
  await s.handler({action:'startLogin',account:'fixture',password:'p'},identity)
  const result=await s.handler({action:'submitCode',sessionId,code:'123456',OPENID:'owner-a'},{OPENID:'owner-b',APPID})
  assert.equal(result.ok,false)
  assert.equal(s.store.records.get(sessionId).attempts,0)
  assert.equal((await s.handler({action:'cancel',sessionId},{OPENID:'owner-a',APPID:'wrong-app'})).ok,false)
  assert.equal((await s.handler({action:'cancel',sessionId},{})).ok,false)
})
test('expired challenges and repeated invalid codes cannot be replayed',async()=>{
  const s=setup({failCode:true})
  await s.handler({action:'startLogin',account:'fixture',password:'p'},identity)
  for(let i=0;i<5;i++) assert.equal((await s.handler({action:'submitCode',sessionId,code:'123456'},identity)).ok,false)
  assert.equal(s.store.records.get(sessionId).attempts,5)
  await s.handler({action:'submitCode',sessionId,code:'123456'},identity)
  assert.equal(s.count(),6)
  s.advance(TTL+1)
  assert.equal((await s.handler({action:'submitCode',sessionId,code:'123456'},identity)).ok,false)
})
test('cancellation is owner scoped and login starts are rate limited',async()=>{
  const s=setup()
  await s.handler({action:'startLogin',account:'fixture',password:'p'},identity)
  assert.equal((await s.handler({action:'startLogin',account:'fixture',password:'p'},identity)).ok,false)
  await s.handler({action:'cancel',sessionId},{OPENID:'owner-b',APPID})
  assert.equal(s.store.records.size,1)
  await s.handler({action:'cancel',sessionId},identity)
  assert.equal(s.store.records.size,0)
})
test('frontend sends credentials only to cloud functions and stores only validated tokens',async()=>{
  const oldEnv=config.cloudEnv
  config.cloudEnv='fixture-env'
  const saved=new Map(),calls=[]
  const platform={
    getStorageSync:k=>saved.get(k),setStorageSync:(k,v)=>saved.set(k,v),removeStorageSync:k=>saved.delete(k),
    request(){throw new Error('Login must not use wx.request')},
    cloud:{async callFunction(options){
      calls.push(options)
      return {result:calls.length===1?{ok:true,otp:true,method:'手机',sessionId}:{ok:true,session:{userId:'fixture',serviceToken:'token'}}}
    }}
  }
  try {
    const client=new XiaomiClient(platform)
    assert.deepEqual(await client.startLogin('fixture-account','fixture-password'),{otp:true,method:'手机'})
    assert.equal(saved.size,0)
    await client.submitCode('123456')
    assert.equal(calls[0].name,'xiaomiLogin')
    assert.equal(calls[0].data.action,'startLogin')
    assert.equal(calls[1].data.sessionId,sessionId)
    assert.deepEqual(saved.get(config.storageKey),{userId:'fixture',serviceToken:'token'})
    assert.ok(!JSON.stringify([...saved.values()]).includes('fixture-password'))
  } finally {config.cloudEnv=oldEnv}
})
test('frontend gives a configuration error before sending a password without an env',async()=>{
  const oldEnv=config.cloudEnv
  config.cloudEnv=''
  try { await assert.rejects(()=>new XiaomiClient({getStorageSync:()=>null}).startLogin('user','password'),/环境 ID/) }
  finally {config.cloudEnv=oldEnv}
})
