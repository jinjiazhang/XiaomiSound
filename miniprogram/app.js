const config=require('./config')
App({
  onLaunch() {
    if (wx.cloud && config.cloudEnv) wx.cloud.init({env:config.cloudEnv,traceUser:false})
  }
})
