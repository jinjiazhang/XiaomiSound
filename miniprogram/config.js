module.exports = {
  audioUrl: 'https://samplelib.com/mp3/sample-12s.mp3',
  audioTitle: '12 秒测试音乐',
  storageKey: 'xiaomi-sound.session.v1',
  cloudEnv: 'xiaomi-sound-d5gon4j9x46357e9c',
  loginFunction: 'xiaomiLogin',
  // Only authentication/control destinations are permitted, never the audio URL.
  allowedHosts: ['api2.mina.mi.com']
}
