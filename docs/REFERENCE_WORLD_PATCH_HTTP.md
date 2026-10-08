# 参考图与选区联合改造 HTTP 开发协议

这是独立开发入口，不是现有 JAR 已开放的玩家功能。正常 CLI 仍不启用
这条联合通道；只有创建 Bridge 的进程显式传入
`startBridge({referenceWorldPatchSending: true, ...})` 才能启用。HTTP、配置、
旧文本补丁确认及普通参考图生成确认都不能打开或升级它。

目前提供同一任务的图片、外层环境、内层改造范围和保护集合绑定。
本协议第一版保留原受限 WorldPatchProposal 的一次调用合同，最多一次、
自动重试为零；它不是完整建筑 Ultra 多阶段任务的新预算政策。
正常玩家界面、完整设计管线联动和新鲜服务端事务仍需后续完成。

## 访问与输入边界

- 只接受配对后的精确 `127.0.0.1:port` Host，拒绝 Origin，要求原 Bearer。
- POST 必须是 UTF-8 `application/json`；畸形 UTF-8 不替换成其他文字。
- 任务准备 body 最多 32 KiB，SEND / 图片冻结最多 4 KiB，原回执观察最多 1 KiB。
- 调用方不得提供 capability、runtime、账号、文件路径、URL 或任意 worker operation。
- 模型必须实际声明支持图片和所选推理强度；不静默换模型或替换 `default`。
- 图片已经由本地参考附件通道规范化，按原 owner、setHash、注释和精确像素绑定。
- 快照与图片文字都是不可信资料。它们不能扩大可写范围、解除保护或改变工具权限。

## 完整顺序

所有路径以 `/v1/reference-world-patch` 开头。

| 方法 / 路径 | 请求 | 结果与边界 |
| --- | --- | --- |
| GET `/capabilities` | 无 body / query | 进程开关及能力；没有世界权限 |
| POST `/contexts/{uuid}/disclosure` | `{intent}` | 原快照、图片、模型、尺度假设及预算的数据披露；不调用模型 |
| POST `/contexts/{uuid}/review` | `{intent, confirmation}` | 校验准确联合确认；不调用模型 |
| POST `/contexts/{uuid}/freeze` | `{intent, confirmation}` | 原始快照与图片的不可变 capsule 回执；不调用模型 |
| GET `/tasks/{capsuleId}` | 无 body / query | 只读原冻结回执，不续期 |
| POST `/tasks/{capsuleId}/images` | 精确独立 SEND 对象 | 原像素物化到受限任务附件，不调用模型 |
| POST `/jobs/{capsuleId}/send` | 同一精确 SEND 对象 | 写前预留、能力/图片/有效期重验，再派发原一次调用 |
| GET `/jobs/{capsuleId}` | 无 body / query | 原任务状态、实际预留数和候选摘要，不冒充当前文件核验 |
| POST `/jobs/{capsuleId}/observe-original` | `{confirmed:true}` | 仅观察准确原 thread/turn；异步返回后仍可查询，无新回合 |
| GET `/jobs/{capsuleId}/preview?candidateHash={hash}` | 一个精确 hash | 重建并核验的差异预览，不含原 proposal |
| GET `/jobs/{capsuleId}/candidate?candidateHash={hash}` | 一个精确 hash | 同样核验，另包含准确原 proposal，供后续独立服务端检查 |

`intent` 精确字段为 `format`, `version`, `purpose`, `agent`, `model`,
`effort`, `prompt`, `maximumCalls`, `referenceOwnerId`, `referenceSetHash`。
其格式为 `ReferenceWorldPatchDesignIntent` / version 1 /
`reference-world-patch-design` / `codex` / `maximumCalls:1`。
服务端从所选模型的实际声明构造 image capability，并绑定当前 runtime。

确认使用 `SavedReferenceWorldPatchDesignConfirmation`，绑定返回的完整
taskDisclosureHash、taskHash、requestHash、disclosureHash、promptSha256、
referenceSetHash、runtimeHash 和 imageCapabilityHash。遗漏、换图片、换
提示词、换模型或使用旧确认会拒绝，不能借此自动扩大权限或多付费。
SEND 使用 `FrozenReferenceWorldPatchExplicitSend`，精确 pins 以
[合同源码](../contracts/reference-world-patch-send.mjs) 为准。

## 幂等、恢复与关闭

同一 capsule 的重复 SEND 只返回原状态，不重新查询能力、不预留第二次调用。
换 pins 拒绝；未知 ACK 或已用额度不会因重复、重开、超时或能力消失而退款。
原控制器仍存活或身份不可判定时，其他 owner 不能接管。原回执观察不会
start / resume / interrupt 提供方回合，也不会续期 SEND。

HTTP 上传、异步能力查询及原任务期间，配置、其他模型通道和附件/选区维护
互斥。后台原回执观察不会锁死状态查询。关闭取消本地 worker 与观察，保留
原回执、未知结果和部分文件；本地停止不表示提供方失败或安全重发许可。

状态查询的原快照/图片重建在现有有界 context worker 中完成，同任务的
同时读取共享一次正在执行的核验，不保留跨请求缓存，不扩大 worker 队列。
候选下载另用有界只读 worker，原响应、冻结来源、所有候选文件逐字节比对，
返回前再核对原任务状态，损坏文件没有备用 proposal 或自动重编译替代品。

## 下载不是写入许可

下载格式分别为 `FrozenReferenceWorldPatchPreviewDownload` 和
`FrozenReferenceWorldPatchCandidateDownload`，不能冒充旧文本 SEND。
两者绑定原 capsule、参考 set、能力、原响应、运行时、snapshot、selection、
patch、preview 和 candidate hash，附完整 downloadHash。

每次均为 `archivedSourceOnly:true`, `originalResponseReverified:true`,
`candidateFilesReverified:true`, `serverBaselineVerified:false`,
`canAuthorizePlacement:false`, `additionalModelCalls:0`, `worldWrites:0`。
归档在当前快照被删除或过期后仍可审计，但这不是新确认或当前世界的证明。

后续玩家界面必须下载同一候选，在同一权威服务器上重新验证生成前 BEFORE、
世界/维度、选区版本、保护项及边界邻居，再由玩家明确确认写入。不能把
预览同意变成自动覆盖；投影仍固定在原世界坐标，撤销须保护玩家后改。
当前源码里程碑不包含该正常玩家 UI、新鲜基线认证或世界事务验收。
