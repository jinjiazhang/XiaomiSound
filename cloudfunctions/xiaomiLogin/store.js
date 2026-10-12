const crypto=require('crypto')
const {PublicError}=require('./service')
function createStore(db) {
  const sessions=db.collection('xiaomi_login_sessions')
  const command=db.command
  const userKey=owner=>'user-'+crypto.createHash('sha256').update(owner).digest('hex')
  return {
    async rateLimit(owner,time) {
      const id=userKey(owner)
      // A unique document ID prevents two cold instances from starting a first
      // login concurrently. Subsequent claims are a conditional atomic update.
      try { await sessions.add({data:{_id:id,owner,kind:'rate-limit',lastStartedAt:0}}) }
      catch (_) {
        // Continue only if this owner's guard actually exists; don't hide DB failures.
        const existing=await sessions.doc(id).get()
        if (!existing.data || existing.data.owner!==owner) throw new PublicError('登录限流配置不可用')
      }
      const result=await sessions.where({_id:id,owner,lastStartedAt:command.lte(time-60000)}).update({data:{lastStartedAt:time}})
      if (!result.stats || result.stats.updated!==1) throw new PublicError('请等待 60 秒后再发起登录')
    },
    async removeExpired(owner,time) {
      await sessions.where({owner,expiresAt:command.lte(time)}).remove()
    },
    save:async(id,data)=>{await sessions.doc(id).set({data})},
    async acquire(id,owner,time) {
      const result=await sessions.where({
        _id:id,owner,state:'ready',expiresAt:command.gt(time),attempts:command.lt(5)
      }).update({data:{state:'processing',attempts:command.inc(1)}})
      if (!result.stats || result.stats.updated!==1) return null
      const saved=await sessions.doc(id).get()
      return saved.data
    },
    release:async(id,owner,auth)=>{
      await sessions.where({_id:id,owner,state:'processing'}).update({data:{state:'ready',auth}})
    },
    remove:async(id,owner)=>{await sessions.where({_id:id,owner}).remove()}
  }
}
module.exports={createStore}
