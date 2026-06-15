# GitHub 账号装修建议

当前账号 `mangniu0515-glitch` 已能正常推送项目，但公开资料还比较空。下面是建议完善项。

## 账号资料

建议进入 GitHub 的 **Settings -> Public profile** 完善：

- **Name**：填写真实姓名、公司简称或常用中文名。
- **Profile picture**：上传清晰头像或团队 Logo。
- **Bio**：用一句话说明你做什么，例如：
  - `内网工具与浏览器自动化系统开发`
  - `专注企业内部流程自动化、数据采集和管理后台建设`
- **Company**：如适合公开，可填写公司或团队名称。
- **Location**：可填写城市或地区。

## 置顶项目

建议把这个仓库 pin 到个人主页。公开展示时可以说明：

> 一个面向内网受管终端的验证码采集与授权管理系统，集成 Chrome 扩展、IP 授权、二维码自动上传、邮箱验证码回填和后台统一管理。

## 仓库命名建议

当前仓库名是 `project`，展示性偏弱。后续可以考虑重命名为：

- `verification-automation-platform`
- `web-verification-assistant`
- `qrcode-email-verification-system`
- `internal-verification-manager`

重命名会改变仓库 URL。GitHub 会做重定向，但如果已经给别人发过链接，建议等项目稳定后再改。

## 可选：个人主页 README

如果希望 GitHub 首页更像个人名片，可以新建一个和账号同名的仓库：

```text
mangniu0515-glitch/mangniu0515-glitch
```

然后添加 `README.md`。可用以下模板：

```markdown
# 你好，我是 mangniu0515-glitch

我主要做企业内网工具、浏览器自动化和管理后台系统，关注把重复操作变成可管理、可审计、可部署的流程。

## 代表项目

- 网页验证码采集与授权管理系统：Chrome 扩展 + 后台管理 + IP 授权 + 二维码/邮箱验证码自动化

## 技术方向

- Node.js / Express
- Vue 3 / Element Plus
- Chrome Extension MV3
- SQLite / 内网部署
```

## 安全设置

建议至少完成：

- 开启 two-factor authentication。
- 检查邮箱是否需要公开显示。
- GitHub token 只给最小权限。
- 不在公开仓库提交 `.env`、数据库、授权码、截图或服务器密码。
