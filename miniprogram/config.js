module.exports = {
  audioUrl: 'https://samplelib.com/mp3/sample-12s.mp3',
  audioTitle: '12 秒测试音乐',
  storageKey: 'xiaomi-sound.session.v1',
  // Only authentication/control destinations are permitted, never the audio URL.
  allowedHosts: ['account.xiaomi.com', 'api2.mina.mi.com', 'sts.api.mina.mi.com']
}
