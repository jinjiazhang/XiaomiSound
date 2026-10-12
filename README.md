# XiaomiSound

微信小程序原型：前端登录小米账号，选择在线小爱音箱，播放固定 MP3。无后端、无运行时第三方依赖。

固定音频：`https://samplelib.com/mp3/sample-12s.mp3`，可在 `miniprogram/config.js` 中修改。应用还提供停止、状态查询和退出登录。

## 在微信开发者工具运行

1. 导入本仓库目录，项目已配置“天昊故事” AppID `wxa0a6030da19850ad`；导入者需要拥有该小程序的开发权限。
2. 在小程序后台的服务器域名配置中添加以下 **request 合法域名**：
   - `https://account.xiaomi.com`
   - `https://api2.mina.mi.com`
   - `https://sts.api.mina.mi.com`（登录凭证换取可能用到的域名，以实际跳转为准）
3. 如果小米登录返回其他域名，确认它确属登录链路后，在 `config.js` 的 `allowedHosts` 和微信后台中同时添加。程序拒绝未配置的目标，不会将凭证随意发送给陌生域名。
4. 登录绑定音箱的小米账号；需要短信或邮箱验证时填写验证码。
5. 选择在线音箱，点击“在音箱播放”，然后查询状态并在现场确认是否出声。若重复播放，点击停止。

音箱自行读取音频 URL，小程序不下载音频，因此仅远程播放无需配置音频域名为 downloadFile 合法域名。项目默认开启域名校验；开发工具中临时跳过校验不代表正式版能访问这些域名。

## 当前验证边界

- 项目前端登录尚需在微信开发者工具和 iOS/Android 真机验证，不能将 Python 登录成功当作小程序登录成功。
- `wx.request` 可能自动处理重定向并隐藏中间响应。本项目管理可见的 Cookie 和跳转；若中间的 `serviceToken` 不可读取，明确报错，不会伪造登录成功。纯前端方案在该运行环境下可能无法完成。
- 请求采用 MiService 中使用的 User-Agent，但微信运行环境可能覆盖或限制请求头；需要真机确认。登录风控可能要求图形验证码或网页验证，当前不支持这些额外验证。
- 小米接口属于第三方客户端使用的接口，没有已确认的公开稳定性承诺。以实际后台域名校验结果为准。
- L16B 的 URL 播放、状态、音量及停止此前在 Python 中实测成功；本项目不自动调整音量。其他机型的音乐接口有适配分支，尚未实测。
- API 接受指令和设备报告播放状态均不等同于现场已听到声音。

## 凭证处理

账号和密码由用户输入，无内置账号、密码或 Token。密码在登录请求结束后从页面状态清除，不持久化。仅 `userId` 和 `serviceToken` 保存到小程序本地存储；本地存储不是系统安全钥匙串，退出登录会清除本应用保存的凭证和 Cookie。日志不打印认证响应。Token 失效后提示重新登录，避免自动反复触发验证码。

## 校验

```sh
npm test
```

测试覆盖登录所需散列、Cookie 域/路径隔离、验证码流程、凭证缺失、设备返回错误及播放请求结构。测试通过不代表微信原生网络栈与小米认证兼容。

## 实现参考

- https://github.com/Yonsm/MiService/blob/main/miservice/miaccount.py
- https://github.com/Yonsm/MiService/blob/main/miservice/minaservice.py
- https://developers.weixin.qq.com/miniprogram/dev/api/network/request/wx.request.html

接口流程参考本机 MiService 3.0.1，代码未导入该库。
