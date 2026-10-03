# UltraAgentbuilder 开发指南

公开分支是独立源码仓库，不依赖维护者的模型会话、Minecraft 世界或其他项目。以下命令仅用于源码构建和免费测试，不启动付费生成任务。

## 环境

完整候选 JAR 的打包当前要求 Windows x64、Node.js 22.19.0 和 Java 17 JDK。Node 安装目录必须包含上游 `LICENSE` 文件，打包会一并保留该许可。Gradle Wrapper 使用 8.12.1，Fabric Loom 首次构建需要联网下载依赖。

## 本地检查

在仓库根目录运行：

```powershell
npm ci --ignore-scripts
npm run check
npm test
npm run test:studio
```

`test:studio` 运行生成、Bridge 和设计的离线套件，使用模拟模型回答，不是免费调用真实模型。临时数据写入项目 `build` 目录；成功后清理本轮临时内容，失败日志保留。需要足够可用磁盘空间，建议至少预留 5 GiB。

## 构建模组

确认 `JAVA_HOME` 指向 Java 17 JDK，`node` 对应目标版本，然后运行：

```powershell
cd mod
.\gradlew.bat test build
```

输出位于 `mod/build/libs`。用户安装 remap 后的主 JAR，不安装 sources JAR，也不安装开发验收辅助 JAR。打包从源码生成内置 Bridge，并核对版本和协议，不读取本机账号或生成历史。

隔离游戏验收不在默认测试中自动运行。必须建立独立实例与新世界，明确实际安装的 JAR、成品资产、操作范围和玩家确认；不要用正式世界代替测试世界。

## 本地 Bridge 调试

如需单独调试，可运行：

```powershell
npm run studio:bridge -- --data-dir .studio-data
```

服务只允许精确的本机回环连接。连接文件含令牌，不得提交、截图或分享。启动服务本身不会授权真实模型调用或世界写入。
