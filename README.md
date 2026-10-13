# XiaomiSound

“天昊故事”微信小程序的音箱遥控原型。小米账号和验证码登录由微信云函数处理，登录后小程序直接调用 MiNA 控制音箱。固定音频为 `https://samplelib.com/mp3/sample-12s.mp3`；支持音箱选择、播放、停止、状态查询和退出登录。

## 当前状态

版本 0.2.0 已完成云函数迁移。部署需要提供 **云开发环境 ID**，并将环境关联到 AppID `wxa0a6030da19850ad`。`miniprogram/config.js` 的 `cloudEnv` 为空时登录会提示配置环境，不会回退到已经失败的前端密码登录方式。

## 为什么迁移登录

iOS 微信真机上 `/pass/serviceLogin` GET 返回 200，`/pass/serviceLoginAuth2` POST 返回 403。本地使用同一组登录参数对照后复现：POST 带 `https://servicewechat.com/wxa0a6030da19850ad/0/page-frame.html` Referer 返回 403，不带时返回正常账号校验 JSON。云函数以 Node.js HTTPS 发起小米认证，不转发该 Referer。

云端 Node.js 认证代码已在本机使用虚构账号验证：GET、POST 均返回 HTTP 200，并得到预期的账号校验失败结果。这验证了请求协议，未证明腾讯云出口 IP 或真实账号登录一定通过小米风控。

## 开通与部署

1. 在微信开发者工具“云开发”创建环境，记录环境 ID。选免费体验环境时先检查该账号的资格和有效期，不需要为本原型开通超限按量。
2. 将云环境关联到“天昊故事” AppID。使用有开发权限的微信导入本仓库。
3. 云数据库新建集合 **`xiaomi_login_sessions`**。设置自定义安全规则为：

   ```json
   { "read": false, "write": false }
   ```

   这是仅允许服务端访问的集合；不要设置客户端可读。`cloudfunctions/database.rules.json` 是规则参考，不会因为上传函数而自动应用。
4. 在集合为 `expiresOn` 字段创建 TTL 索引，过期时间设置为 0 秒。业务逻辑会拒绝超过 10 分钟的会话；TTL 索引用于自动清除无人继续操作的会话 Cookie。未创建 TTL 索引时业务过期检查仍有效，但废弃会话只能在用户再次登录时清理。
5. 右键 `cloudfunctions/xiaomiLogin`，选择“上传并部署：云端安装依赖”。运行时使用控制台支持的 Node.js 版本（建议 Node.js 20），内存 256MB，函数超时 60 秒。函数不会在运行时等待用户输入验证码，两次提交分别执行。
6. 在 `miniprogram/config.js` 填入 `cloudEnv` 环境 ID。
7. 在微信后台配置 **request 合法域名 `https://api2.mina.mi.com`**。账号认证域名不再由前端访问；仅遥控音箱无需配置音频域名为 downloadFile 合法域名。
8. 上传/预览小程序，输入小米账号密码。收到短信或邮箱验证码后输入完成登录，再选择在线音箱播放。

云函数上传也可以使用官方 `miniprogram-ci`：

```sh
# 先安装 miniprogram-ci，密钥应位于仓库之外。
export XIAOMI_CLOUD_ENV='你的环境ID'
export MINIPROGRAM_PRIVATE_KEY_PATH='/你的密钥路径/private.wxa0a6030da19850ad.key'
npm run deploy:cloud
```

脚本上传云函数成功后会写入客户端环境 ID；数据库权限、TTL 索引和运行时超时仍需按上面的步骤设置。上传云函数和上传小程序是两个独立操作。

## 首次部署记录（2026-10-13）

- 已通过 CloudBase 网页部署 `xiaomiLogin`，运行状态正常，Node.js 20.19，256 MB，自动安装依赖。
- 已创建 `xiaomi_login_sessions`，权限为 ADMINONLY（客户端无读写权限）。
- 控制台冒烟测试成功执行，并拒绝没有微信身份的请求。该测试未验证真实小米登录。
- 客户端已配置 `xiaomi-sound-d5gon4j9x46357e9c`；0.2.1 小程序已上传并生成预览二维码。
- 当前体验版执行超时固定为 3 秒；真机前四步累计网络耗时 575 ms，完整流程耗时仍需验证；尚未升级付费套餐。
- 官方 CI 对云函数上传返回 `env not found`，网页上传成功。真机 0.2.0 已验证客户端可以调用该环境，并完成小米认证前四步 HTTP 200；云函数上传仍需网页操作。
- 网页新建索引界面未提供 TTL 选项，尚未建立自动清理索引。代码会拒绝过期会话并在本人下次登录时清理；自动清理仍是正式使用前的待办。

0.2.1 修复验证方式发现接口返回代码 2 时的短信回退，与 MiService 的现有行为保持一致；短信验证初始化和发送接口仍必须返回成功。

## 数据与会话

- 密码不写入文件、数据库或日志，仅在单次调用中提交给小米；前端请求结束后清除密码输入。
- 云函数每次创建独立认证客户端。验证码阶段仅暂存 Cookie、验证方式及随机设备标识，不暂存密码。
- 会话以 48 位随机十六进制 ID 标识，并绑定 `cloud.getWXContext()` 提供的 OPENID。前端传入的用户 ID 不作为身份依据；仅接受指定 AppID 调用。
- 同一微信用户最多每 60 秒发起一次登录，单个验证码会话最多验证 5 次；条件更新防止两个实例同时使用会话。
- 验证码会话有效期 10 分钟，成功或取消后删除。数据库中 Cookie 属于敏感凭证，需要按上文设置服务端专用权限和 TTL。
- 最终只把 `userId`、`serviceToken` 返回到当前调用者，并保存在小程序本地。退出后清除；本地存储不是系统安全钥匙串。
- 诊断仅记录步骤、域名/路径、HTTP 状态、耗时和可见 Cookie 数量，不记录查询参数、账号、密码、验证码、Cookie 值或响应正文。不要给函数添加打印 `event` 或认证响应的日志。

## 验证边界

- Python 中已实测 L16B 的播放、状态和停止。当前小程序播放仍需真机验证；指令被接受不代表现场已出声。
- 音箱使用当前音量，若音频重复播放可点击停止。
- 部分机型使用 `player_play_music`，当前有适配但未实机测试。
- 小米认证仍可能触发图形验证码、网页验证、限流或云端 IP 风控；当前支持短信/邮箱验证。
- 云函数迁移不代表拥有小米官方稳定接口支持。

## 本地检查

```sh
npm test
```

覆盖认证请求、Cookie 隔离、跨实例验证码会话恢复、用户隔离、过期、限流、验证次数、取消和前端云调用。模拟测试不替代云端部署及真机联调。

## 资料

- https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram
- https://docs.cloudbase.net/database/security-rules
- https://github.com/wechat-miniprogram/miniprogram-ci-dist
- https://github.com/Yonsm/MiService

认证流程参考 MiService 3.0.1；没有导入 MiService。云端使用 Node.js 原生 HTTPS 和 crypto，微信环境访问使用 wx-server-sdk。
