const crypto=require('crypto')
class PublicError extends Error {}
const TTL=10*60*1000
const APPID='wxa0a6030da19850ad'
function createHandler({store,createAuth,now=Date.now,randomId=()=>crypto.randomBytes(24).toString('hex')}) {
  return async function handle(event,identity) {
    let auth
    try {
      if (!identity || !identity.OPENID || identity.APPID!==APPID) throw new PublicError('无法验证当前微信用户')
      const owner=identity.OPENID
      if (!event || !['startLogin','submitCode','cancel'].includes(event.action)) throw new PublicError('不支持的登录操作')
      if (event.action==='startLogin') {
        if (typeof event.account!=='string' || !event.account.trim() || event.account.length>128 ||
            typeof event.password!=='string' || !event.password || event.password.length>256) throw new PublicError('请输入有效的账号和密码')
        await store.rateLimit(owner,now())
        await store.removeExpired(owner,now())
        auth=createAuth()
        const result=await auth.startLogin(event.account.trim(),event.password)
        if (!result.otp) return {ok:true,otp:false,session:auth.session,diagnostics:auth.http.diagnostics}
        const sessionId=randomId()
        await store.save(sessionId,{
          owner,state:'ready',attempts:0,expiresAt:now()+TTL,
          expiresOn:new Date(now()+TTL),auth:auth.exportState()
        })
        return {ok:true,otp:true,method:result.method,sessionId,diagnostics:auth.http.diagnostics}
      }
      if (typeof event.sessionId!=='string' || !/^[a-f0-9]{48}$/.test(event.sessionId)) throw new PublicError('验证会话无效，请重新登录')
      if (event.action==='cancel') {
        await store.remove(event.sessionId,owner)
        return {ok:true}
      }
      if (typeof event.code!=='string' || !/^[0-9]{4,10}$/.test(event.code.trim())) throw new PublicError('请输入有效验证码')
      const session=await store.acquire(event.sessionId,owner,now())
      if (!session) throw new PublicError('验证会话已过期、正在验证或次数已用完，请重新登录')
      auth=createAuth()
      auth.restore(session.auth)
      try {
        await auth.submitCode(event.code.trim())
        await store.remove(event.sessionId,owner)
        return {ok:true,otp:false,session:auth.session,diagnostics:auth.http.diagnostics}
      } catch (error) {
        // Persist any fresh cookies after a failed attempt. Keep the original TTL.
        await store.release(event.sessionId,owner,auth.exportState())
        throw error
      }
    } catch (error) {
      const diagnostics=auth?auth.http.diagnostics:[]
      // Auth errors are generated locally, never contain Xiaomi response bodies.
      const message=error instanceof PublicError ? error.message :
        auth && error.message && !/database|collection|document|db\./i.test(error.message) ? error.message :
          '云端登录暂不可用，请检查会话数据库、函数配置和网络'
      return {ok:false,message,diagnostics}
    }
  }
}
module.exports={createHandler,TTL,APPID,PublicError}
