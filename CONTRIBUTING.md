# 贡献说明

这个项目目前以内部迭代为主。提交修改时建议遵守以下原则：

## 开发前

- 确认需求属于后端、后台前端还是 Chrome 扩展。
- 涉及线上部署或数据结构变更前先做备份。
- 不提交 `.env`、数据库、上传文件、授权码或服务器密码。

## 提交前检查

```bash
node --check server/src/index.js server/src/routes/*.js server/src/middleware/*.js server/src/utils/*.js
node --check chrome-extension/background.js chrome-extension/content.js chrome-extension/extension-config.js
cd admin-panel && npm run build
```

## 提交信息建议

使用简短清晰的提交信息：

```text
docs: polish GitHub project page
feat: add email verification rule management
fix: handle expired admin session
```

## 代码边界

- 后端接口权限必须区分管理员、组长、普通用户。
- 插件端不能依赖 popup，核心交互应保持在页面右侧抽屉。
- 邮箱验证码只处理已配置监听规则匹配的邮件来源。
- 存储增长相关改动必须考虑清理和覆盖策略。
