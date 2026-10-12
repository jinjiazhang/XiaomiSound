// Run with NODE_PATH pointing to your miniprogram-ci installation, or install
// miniprogram-ci locally. The upload private key is never copied into the repo.
const fs=require('fs')
const path=require('path')
const root=path.resolve(__dirname,'..')
async function main() {
  const env=process.env.XIAOMI_CLOUD_ENV
  const privateKeyPath=process.env.MINIPROGRAM_PRIVATE_KEY_PATH
  if (!env || !/^[a-zA-Z0-9_-]+$/.test(env)) throw new Error('请设置 XIAOMI_CLOUD_ENV 环境 ID')
  if (!privateKeyPath || !fs.existsSync(privateKeyPath)) throw new Error('请设置 MINIPROGRAM_PRIVATE_KEY_PATH 上传密钥路径')
  const ci=require('miniprogram-ci')
  const project=new ci.Project({appid:'wxa0a6030da19850ad',type:'miniProgram',projectPath:root,privateKeyPath,
    ignores:['node_modules/**/*','.git/**/*','tests/**/*','*.key','*.token']})
  await ci.cloud.uploadFunction({project,env,name:'xiaomiLogin',path:path.join(root,'cloudfunctions/xiaomiLogin'),remoteNpmInstall:true})
  // Update the client env only after the function upload succeeds. Database rules
  // and runtime settings must be configured in CloudBase before testing login.
  const config=path.join(root,'miniprogram/config.js')
  fs.writeFileSync(config,fs.readFileSync(config,'utf8').replace(/cloudEnv: '[^']*'/,"cloudEnv: '"+env+"'"))
  console.log('云函数上传成功，客户端环境 ID 已配置。请确认数据库权限及函数超时后上传小程序。')
}
main().catch(()=>{console.error('部署未完成。请检查环境 ID、上传密钥、云环境关联和部署权限。');process.exitCode=1})
