function parseUrl(url) {
  const match = /^https:\/\/([a-z0-9.-]+)(\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/i.exec(url)
  if (!match) throw new Error('只支持 HTTPS 地址')
  return { host: match[1].toLowerCase(), path: match[2] || '/' }
}
function form(data) {
  return Object.keys(data).map(k => encodeURIComponent(k)+'='+encodeURIComponent(data[k])).join('&')
}
function headerValue(headers, name) {
  const key = Object.keys(headers || {}).find(k => k.toLowerCase() === name.toLowerCase())
  return key ? headers[key] : undefined
}
class CookieJar {
  constructor() { this.cookies = [] }
  capture(url, response) {
    const origin = parseUrl(url)
    const raw = headerValue(response.header, 'set-cookie')
    const entries = Array.isArray(response.cookies) && response.cookies.length ? response.cookies :
      (Array.isArray(raw) ? raw : raw ? [raw] : [])
    entries.forEach(entry => String(entry).split(/,(?=\s*[^;,=\s]+\s*=)/).forEach(line => {
      const parts = line.split(';').map(p => p.trim())
      const pos = parts[0].indexOf('=')
      if (pos < 1) return
      const cookie = {
        name: parts[0].slice(0,pos), value: parts[0].slice(pos+1), domain: origin.host,
        hostOnly: true, path: origin.path.slice(0, origin.path.lastIndexOf('/')) || '/', expires: Infinity
      }
      let maxAge
      parts.slice(1).forEach(part => {
        const i=part.indexOf('='), key=(i<0?part:part.slice(0,i)).toLowerCase(), value=i<0?'':part.slice(i+1)
        if (key === 'domain') { cookie.domain=value.replace(/^\./,'').toLowerCase(); cookie.hostOnly=false }
        if (key === 'path' && value.startsWith('/')) cookie.path=value
        if (key === 'max-age' && /^-?\d+$/.test(value)) maxAge=Number(value)
        if (key === 'expires') { const time=Date.parse(value); if (!isNaN(time)) cookie.expires=time }
      })
      if (maxAge !== undefined) cookie.expires=Date.now()+maxAge*1000
      if (cookie.domain !== origin.host && !origin.host.endsWith('.'+cookie.domain)) return
      // Reject a super-cookie for a public suffix, including the parent .com.
      if (!cookie.hostOnly && !['xiaomi.com','mi.com'].some(d => cookie.domain === d || cookie.domain.endsWith('.'+d))) return
      this.cookies=this.cookies.filter(c => !(c.name===cookie.name && c.domain===cookie.domain && c.path===cookie.path))
      if (cookie.expires > Date.now()) this.cookies.push(cookie)
    }))
  }
  values(url) {
    const {host,path}=parseUrl(url)
    return this.cookies.filter(c => c.expires>Date.now() &&
      (host===c.domain || (!c.hostOnly && host.endsWith('.'+c.domain))) &&
      (path===c.path || (path.startsWith(c.path) && (c.path.endsWith('/') || path[c.path.length]==='/'))))
      .sort((a,b)=>b.path.length-a.path.length)
  }
  get(url,name) { const c=this.values(url).find(c=>c.name===name); return c && c.value }
  header(url, extra) {
    const values={}
    this.values(url).forEach(c => { if (!(c.name in values)) values[c.name]=c.value })
    Object.assign(values, extra || {})
    return Object.keys(values).map(k=>k+'='+values[k]).join('; ')
  }
}
class HttpClient {
  constructor(platform, allowedHosts) { this.platform=platform; this.allowedHosts=allowedHosts; this.jar=new CookieJar() }
  async request(url, options={}, depth=0) {
    const {host}=parseUrl(url)
    if (!this.allowedHosts.includes(host)) throw new Error('登录跳转需要额外的域名配置：'+host)
    const header=Object.assign({},options.headers)
    const cookie=this.jar.header(url,options.cookies)
    if (cookie) header.Cookie=cookie
    if (options.data) header['Content-Type']='application/x-www-form-urlencoded'
    const response=await new Promise((resolve,reject)=>this.platform.request({
      url, method:options.method || (options.data?'POST':'GET'), header,
      data:options.data ? form(options.data) : undefined, dataType:'text', timeout:20000,
      success:resolve,
      fail:()=>reject(new Error('请求 '+host+' 失败，请检查网络、合法域名和 HTTPS 配置'))
    }))
    this.jar.capture(url,response)
    // Some runtimes follow redirects internally. Only visible hops can be handled here.
    const location=headerValue(response.header,'location')
    if (response.statusCode>=300 && response.statusCode<400 && location) {
      if (depth>=5) throw new Error('登录跳转次数过多')
      const next=location.startsWith('/') ? 'https://'+host+location : location
      return this.request(next,{headers:options.headers},depth+1)
    }
    if (response.statusCode<200 || response.statusCode>=300) {
      const error=new Error('请求 '+host+' 返回 HTTP '+response.statusCode)
      error.statusCode=response.statusCode
      throw error
    }
    return {response,url}
  }
  async json(url,options) {
    const {response}=await this.request(url,options)
    const body=response.data
    if (typeof body==='object' && body!==null) return body
    try { return JSON.parse(String(body).replace(/^&&&START&&&/,'')) }
    catch (_) { throw new Error('小米返回了非 JSON 内容，可能需要网页验证') }
  }
}
module.exports={CookieJar,HttpClient,form,parseUrl}
