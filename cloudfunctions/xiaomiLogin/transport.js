const https=require('https')
// Each function invocation has its own AuthClient/CookieJar. Redirects are handled
// explicitly by HttpClient, so every Set-Cookie is captured before the next hop.
function createPlatform() {
  return {
    getStorageSync:()=>null,setStorageSync:()=>{},removeStorageSync:()=>{},
    request(options) {
      const headers=Object.assign({},options.header)
      // Avoid chunked form uploads: Xiaomi's account endpoint expects a normal
      // application/x-www-form-urlencoded body with a known content length.
      if (options.data) headers['Content-Length']=Buffer.byteLength(options.data)
      const request=https.request(options.url,{
        method:options.method,headers
      },response=>{
        let size=0
        const chunks=[]
        response.on('data',chunk=>{
          size+=chunk.length
          if (size>1024*1024) return request.destroy(new Error('Response too large'))
          chunks.push(chunk)
        })
        response.on('error',()=>options.fail())
        response.on('end',()=>options.success({
          statusCode:response.statusCode,header:response.headers,
          cookies:response.headers['set-cookie']||[],data:Buffer.concat(chunks).toString('utf8')
        }))
      })
      request.setTimeout(Math.min(options.timeout||15000,15000),()=>request.destroy(new Error('Timeout')))
      request.on('error',()=>options.fail())
      // No WeChat Referer is forwarded to Xiaomi.
      if (options.data) request.write(options.data)
      request.end()
    }
  }
}
module.exports={createPlatform}
