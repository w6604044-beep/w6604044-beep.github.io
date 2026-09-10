# 🎮 魏子瑶 · 游戏 2D 动画 / Spine 动效作品集

网址：**https://w6604044-beep.github.io/**

深色游戏风个人作品集 v0.1 —— 前端原生 HTML/CSS/JS，零依赖，免费托管在 GitHub Pages。

## 项目结构

```
portfolio-site/
├── index.html      页面结构（内容改这里）
├── css/style.css   全部样式（配色/布局改这里）
├── js/main.js      交互脚本（作品清单登记在这里）
└── assets/
    ├── videos/     ⭐ 把导出的 Spine 动画 MP4 放这里
    └── images/     封面图 / 头像等
```

## 本地预览（改代码时用）

- 最快：直接双击 `index.html` 用浏览器打开；
- 推荐：用 VS Code 装 **Live Server** 插件 → 右键 `index.html` → Open with Live Server（改代码自动刷新）。

## 新增一个作品（3 步）

1. MP4 放进 `assets/videos/`（720p 以上、≤20 秒、循环动作最佳）；
2. 打开 `js/main.js`，在 `WORKS` 数组加一行：
   ```js
   { title: "作品名", file: "assets/videos/你的文件.mp4" }
   ```
3. 刷新页面即可看到卡片。

## 上线部署（推送到 GitHub）

仓库名必须为 `w6604044-beep.github.io`（= GitHub 用户名），站点会自动出现在 https://w6604044-beep.github.io/

命令行方式（在项目目录 `portfolio-site` 下）：
```bash
git init -b main
git add .
git commit -m "portfolio site v0.1"
git branch -M main
git remote add origin https://github.com/w6604044-beep/w6604044-beep.github.io.git
git push -u origin main
```
首次 push 会要求登录：推荐用 **GitHub CLI（gh auth login）** 或 **Personal Access Token**（见正文说明）。

> ⚠️ 不要在任何聊天里粘贴你的 Token。
