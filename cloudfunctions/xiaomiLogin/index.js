const cloud=require('wx-server-sdk')
const {AuthClient}=require('./auth')
const {createPlatform}=require('./transport')
const {createStore}=require('./store')
const {createHandler}=require('./service')
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV})
exports.main=async event=>{
  // Rebuild state per invocation. A warm instance must never share cookies or
  // authentication state across different WeChat users.
  const handler=createHandler({
    store:createStore(cloud.database()),createAuth:()=>new AuthClient(createPlatform())
  })
  return handler(event,cloud.getWXContext())
}
