// Small, dependency-free implementations of the hashes used by Xiaomi login.
function bytes(text) {
  const encoded = unescape(encodeURIComponent(String(text)))
  return Array.from(encoded, c => c.charCodeAt(0))
}
function rotate(n, bits) { return (n << bits) | (n >>> (32 - bits)) }
function padded(input, little) {
  const out = input.slice()
  const bits = input.length * 8
  out.push(128)
  while (out.length % 64 !== 56) out.push(0)
  const low = bits >>> 0, high = Math.floor(bits / 4294967296)
  const words = little ? [low, high] : [high, low]
  words.forEach(w => {
    for (let i = 0; i < 4; i++) out.push((w >>> ((little ? i : 3 - i) * 8)) & 255)
  })
  return out
}
function digestBytes(words, little) {
  const out = []
  words.forEach(w => {
    for (let i = 0; i < 4; i++) out.push((w >>> ((little ? i : 3 - i) * 8)) & 255)
  })
  return out
}
function md5(text) {
  const data = padded(bytes(text), true)
  const shifts = [7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21]
  const k = Array.from({length: 64}, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0)
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476
  for (let offset = 0; offset < data.length; offset += 64) {
    const w = []
    for (let j = 0; j < 16; j++) {
      const p = offset + j * 4
      w[j] = data[p] | (data[p+1] << 8) | (data[p+2] << 16) | (data[p+3] << 24)
    }
    let a = a0, b = b0, c = c0, d = d0
    for (let i = 0; i < 64; i++) {
      let f, g
      if (i < 16) { f = (b & c) | (~b & d); g = i }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5*i+1)%16 }
      else if (i < 48) { f = b ^ c ^ d; g = (3*i+5)%16 }
      else { f = c ^ (b | ~d); g = (7*i)%16 }
      const next = (b + rotate((a + f + k[i] + w[g]) | 0, shifts[(i >> 4)*4 + i%4])) | 0
      a = d; d = c; c = b; b = next
    }
    a0 = (a0+a)|0; b0 = (b0+b)|0; c0 = (c0+c)|0; d0 = (d0+d)|0
  }
  return digestBytes([a0,b0,c0,d0], true).map(b => ('0'+b.toString(16)).slice(-2)).join('')
}
function sha1(text) {
  const data = padded(bytes(text), false)
  const h = [0x67452301,0xefcdab89|0,0x98badcfe|0,0x10325476,0xc3d2e1f0|0]
  for (let offset = 0; offset < data.length; offset += 64) {
    const w = []
    for (let j = 0; j < 16; j++) {
      const p = offset+j*4
      w[j] = (data[p]<<24)|(data[p+1]<<16)|(data[p+2]<<8)|data[p+3]
    }
    for (let j = 16; j < 80; j++) w[j] = rotate(w[j-3]^w[j-8]^w[j-14]^w[j-16], 1)
    let [a,b,c,d,e] = h
    for (let j = 0; j < 80; j++) {
      let f, k
      if (j < 20) { f = (b&c)|(~b&d); k=0x5a827999 }
      else if (j < 40) { f=b^c^d; k=0x6ed9eba1 }
      else if (j < 60) { f=(b&c)|(b&d)|(c&d); k=0x8f1bbcdc }
      else { f=b^c^d; k=0xca62c1d6 }
      const t = (rotate(a,5)+f+e+k+w[j])|0
      e=d; d=c; c=rotate(b,30); b=a; a=t
    }
    const next = [a,b,c,d,e]
    for (let j=0; j<5; j++) h[j]=(h[j]+next[j])|0
  }
  return digestBytes(h, false)
}
function base64(data) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i=0; i<data.length; i+=3) {
    const n=(data[i]<<16)|((data[i+1]||0)<<8)|(data[i+2]||0)
    out += chars[(n>>>18)&63]+chars[(n>>>12)&63]
    out += i+1<data.length ? chars[(n>>>6)&63] : '='
    out += i+2<data.length ? chars[n&63] : '='
  }
  return out
}
module.exports = { md5, sha1, base64 }
