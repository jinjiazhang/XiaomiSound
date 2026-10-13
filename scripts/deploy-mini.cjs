const fs=require('fs')
const path=require('path')
const root=path.resolve(__dirname,'..')
async function main() {
  if (process.argv.includes('--help')) {
    console.log('npm run deploy:mini [-- --preview]\n默认上传当前版本并生成二维码；--preview 仅生成二维码。密钥默认读取 .private/，可用 MINIPROGRAM_PRIVATE_KEY_PATH 覆盖。')
    return
  }
  const ci=require('miniprogram-ci')
  const privateKeyPath=process.env.MINIPROGRAM_PRIVATE_KEY_PATH || path.join(root,'.private/private.wxa0a6030da19850ad.key')
  if (!fs.existsSync(privateKeyPath)) throw new Error('找不到本地小程序上传密钥')
  const project=new ci.Project({appid:require('../project.config.json').appid,type:'miniProgram',projectPath:root,privateKeyPath,
    ignores:['node_modules/**/*','.git/**/*','.private/**/*','tests/**/*','**/*.key','**/*.token']})
  const setting={es6:true,es7:true,minify:true,minifyJS:true,minifyWXML:true,minifyWXSS:true}
  const version=require('../package.json').version
  const common={project,setting,robot:1,threads:2,onProgressUpdate:()=>{}}
  if (!process.argv.includes('--preview')) {
    await ci.upload({...common,version,desc:'天昊故事 '+version+' 家庭音箱'})
    console.log('小程序上传成功：'+version)
  }
  const output=path.join(root,'.private','preview-'+version+'.png')
  fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700})
  await ci.preview({...common,desc:'天昊故事 '+version+' 家庭音箱',qrcodeFormat:'image',qrcodeOutputDest:output,pagePath:'pages/index/index'})
  console.log('预览二维码：'+output)
}
main().catch(()=>{console.error('上传未完成，请检查上传密钥、CI IP 白名单及网络。');process.exitCode=1})
