# 另一个我

一个问题一个问题地记下自己的人生。问题来自 McAdams 的生命故事访谈；保留原话和每一次修改；能记下模糊的日期；手机和电脑同步，断网也能写；随时导出带校验码的记忆包。

这个仓库只有代码。记忆存在你自己的 Supabase 数据库里，从不进入这个仓库。

---

## 部署说明

只需要做一次，大约 15 分钟。

### 1. 开一个 Supabase 项目（存放记忆的云端）

1. 打开 [supabase.com](https://supabase.com)，注册并登录。
2. 点 **New project**。名字随意，比如 `another-me`；设一个数据库密码并记下来；地区选离你最近的。免费方案就够用。
3. 等项目创建好（约 1 分钟）。

### 2. 建表

1. 左侧菜单 **SQL Editor** → **New query**。
2. 把本仓库 [`supabase/schema.sql`](supabase/schema.sql) 的全部内容粘贴进去，点 **Run**。
3. 看到 `Success. No rows returned` 就对了。

它会建好记忆表和存放录音照片的私有空间，并打开行级权限：只有登录你的账号，才能读写你的数据。

### 3. 创建你的账号，然后关掉注册

1. 左侧 **Authentication** → **Users** → **Add user** → **Create new user**。
2. 填你的邮箱和一个密码，勾选 **Auto Confirm User**，创建。
3. 去 **Authentication** → **Sign In / Providers**，把 **Allow new users to sign up** 关掉。

这样，世界上只有这一个账号能登录。应用里也没有注册入口。

### 4. 拿到连接信息

左侧 **Project Settings** → **API**（或 **Data API**），复制：

- **Project URL**，形如 `https://xxxx.supabase.co`
- **anon public** 密钥，一长串以 `eyJ` 开头的字符

把它们填进 [`config.js`](config.js)。这个密钥本来就是公开的：真正保护数据的是第 2 步的行级权限。

> 不想写进代码，也可以留空。第一次打开应用时，会出现「连接云端」页，在每台设备上填一次即可。

### 5. 发布到 GitHub Pages

仓库 **Settings** → **Pages** → Source 选 **Deploy from a branch**，分支 `main`，目录 `/ (root)`，保存。一两分钟后，应用出现在 `https://<你的用户名>.github.io/<仓库名>/`。

### 6. 装到手机和电脑上

- **iPhone**：用 Safari 打开网址 → 分享 → **添加到主屏幕**。之后从主屏幕图标打开，然后登录。
- **Android**：用 Chrome 打开 → 菜单 → **安装应用**。
- **电脑**：用 Chrome 或 Edge 打开，点地址栏右侧的安装图标；或者直接当网页用。

### 7. 把 Claude 版本里的记忆搬过来

在 Claude 版本的「导出」页下载记忆包，再到这里「备份」页的「导入」选择它。记忆、修改历史和录音照片原件都会搬过来。

---

## 它怎么同步

- 每段记忆先存在设备本地（IndexedDB），所以断网也能写，写完立刻能看到。
- 联网时自动同步：打开应用、切回前台、保存之后、以及每分钟一次。
- 两台设备改了同一段记忆：较新的写法成为正文，另一种写法进入「修改历史」，标注「另一台设备上的写法」。不会丢一个字。
- 一台设备删除、另一台同时修改：修改胜出。宁可多留，不可误删。
- 规则写在 [`sync.js`](sync.js)，由 [`tests/sync.test.js`](tests/sync.test.js) 验证。

## 备份

云端不等于备份。请每月在「备份」页导出一次记忆包，放进桌面的「另一个我」文件夹，再复制到移动硬盘。解压后在终端运行：

```
cd 另一个我 && shasum -a 256 -c MANIFEST.sha256
```

每一行都显示 OK，说明一个字节都没有丢。

## 开发

```
npm test        # 运行全部测试（需要 Node 20+）
node tools/icons.js   # 重新生成图标
```

没有构建步骤。`index.html` 加载 `core.js`（访谈、日期、导出）、`sync.js`（同步规则）、`app.js`（界面与存储）。修改应用文件后，记得把 `sw.js` 里的 `VERSION` 加一，让已安装的设备拿到新版本。

## 网络提示

在中国大陆，GitHub Pages 和 Supabase 的访问有时不稳定。应用本身装好后可以离线打开、离线写；同步要等网络通畅时自动完成。
