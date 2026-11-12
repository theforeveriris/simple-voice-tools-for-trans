# 桌面本地只读 API / CLI

桌面版（Tauri）可以把记录以只读 HTTP 接口暴露在**本机回环地址**，方便 R、Python、Jupyter 或脚本批量查询与导出。浏览器 / Android 版没有这个入口。

## 启动

1. 打开 **设置 → 数据 → 本地只读 API**；
2. 点「启动」；
3. 复制页面上的**地址**与 **Token**（每次启动重新生成）；
4. 锁定应用或关闭应用后服务自动停止。

服务只监听 `127.0.0.1:47821`，不对外网开放；端口被占用时会启动失败。

## 接口

所有接口都是 `GET`，都需要在请求头带 `Authorization: Bearer <token>`（也接受 `?token=`，不建议把 token 写进 shell 历史）。

| 路径 | 说明 |
| --- | --- |
| `/health` | 健康检查：`{"ok":true}` |
| `/records` | 当前资料库的完整记录快照（与「导出 JSON」同结构） |
| `/trends?since=YYYY-MM-DD&until=YYYY-MM-DD` | 按天聚合：次数、总时长、平均 F0 / CPPS / Jitter / Shimmer / HNR |
| `/export?format=csv&since=YYYY-MM-DD&until=YYYY-MM-DD` | 导出 CSV（默认）或 JSON；`since` / `until` 可省略，也接受 epoch 毫秒 |

示例：

```bash
curl -H "Authorization: Bearer $SVT_TOKEN" http://127.0.0.1:47821/records
curl -H "Authorization: Bearer $SVT_TOKEN" "http://127.0.0.1:47821/trends?since=2026-01-01"
curl -H "Authorization: Bearer $SVT_TOKEN" "http://127.0.0.1:47821/export?format=csv&since=2026-01-01" -o records.csv
```

## CLI

源码在 `src-tauri/src/bin/svt.rs`，构建：

```bash
cd src-tauri
cargo build --release --bin svt
# Windows: target/release/svt.exe
```

用法：

```bash
svt records --token <token>
svt trends --since 2026-01-01 --token <token>
svt export --since 2026-01-01 --format csv --token <token>
svt export --until 2026-06-30 --format json --url http://127.0.0.1:47821 --token <token>
```

也可以设置环境变量，避免在命令里重复：

```bash
export SVT_API_URL=http://127.0.0.1:47821
export SVT_API_TOKEN=<token>
svt trends --since 2026-01-01
```

## 安全边界

- **只读**：没有写入 / 删除接口，API 不能改动资料库；
- **仅本机**：绑定 `127.0.0.1`，并校验 `Host` 头，降低 DNS rebinding 风险；
- **Token**：随机生成，只存在当前桌面进程内存里；关闭应用即失效；
- **不返回音频**：接口只包含记录与统计，不提供原始音频下载；需要音频请用完整备份 ZIP；
- **不是加密**：能访问本机进程/存储的人仍可直接读取 IndexedDB，这个 API 只是避免手工点导出。
