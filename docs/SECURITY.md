# 安全说明

本项目面向内网受管终端，仍然需要把账号、邮箱、插件和运行时数据分开保护。

## 不应提交到 Git 的内容

仓库 `.gitignore` 已排除以下内容：

```text
.env
.env.*
server/data/
server/uploads/
uploads/
*.db
*.sqlite
*.sqlite3
*.pem
node_modules/
dist/
.codex-logs/
```

提交前可用以下命令复查：

```bash
git check-ignore -v server/data/qrcodes.db server/data/extension-key.pem server/uploads .env
git ls-files server/data server/uploads .env admin-panel/dist .codex-logs node_modules
```

第二条命令应无输出。

## 管理员账号

- 管理员账号用于后台配置规则和授权客户端，应使用强密码。
- 默认或测试密码不应进入生产环境。
- 如果 GitHub 账号用于发布代码，建议开启两步验证。

## 客户端授权

- 普通用户和组长通过 IP 授权获得能力。
- 未授权或禁用 IP 不应获得 policy、上传接口或邮箱验证码消费能力。
- 普通用户的“二维码采集”和“邮箱验证码”能力可以单独关闭。

## 邮箱池

- 邮箱授权码属于高敏感信息，只应保存在服务器运行时数据库中。
- 监听规则应限制可信发件人，例如只监听指定验证码来源。
- 邮箱验证码任务应由用户点击发送按钮触发，避免无差别扫描邮箱。

## 插件包

- 插件包中的 `extension-config.js` 只包含服务器地址配置。
- 插件业务代码随 ZIP 一起发布，不从远程服务器加载执行脚本。
- 生产分发前应从目标后台重新下载 ZIP，确保连接地址正确。

## GitHub 仓库公开性

当前仓库是公开仓库。公开仓库适合展示项目能力，但要确保：

- 不包含真实数据库。
- 不包含上传截图。
- 不包含服务器密码、邮箱授权码、JWT 密钥。
- 不包含内网部署脚本中的真实密码。

如果后续需要长期保存生产部署脚本，建议改为私有仓库或拆分公开展示版与内部部署版。
