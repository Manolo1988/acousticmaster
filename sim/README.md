# 声学仿真子页面打包说明

这个 `sim` 文件夹是给对方系统嵌入用的独立声学仿真模块。它不包含原来的优化配置侧栏，只提供一个“声学仿真结果”子页面和后端接口，适合放到对方系统的“声学仿真”标签页中用 iframe 打开。

## 文件结构

```text
sim/
  requirements.txt          Python 依赖
  README.md                 本说明文件
  opt/
    optimizer.py            声场估算、布点搜索、方案评价核心
    product_catalog.json    音箱产品库
    config.json             原优化器配置样例
  webapp/
    server.py               本地 HTTP 服务和 API
    index.html              自动跳转到 simulation.html
    simulation.html         可嵌入的仿真结果页面
    simulation.js           页面交互、postMessage 接收、Plotly 绘图
    styles.css              页面样式
    vendor/plotly.min.js    本地 Plotly 前端库
```

## 如何运行

建议使用 Python 3.11 或更新版本。

```bash
cd /home/zhao/Codes/top_sound/sim
pip install -r requirements.txt
python webapp/server.py
```

启动后访问：

```text
http://127.0.0.1:8080/simulation.html
```

如果直接访问 `http://127.0.0.1:8080/`，会自动跳转到仿真子页面。

## 已完成的功能

1. 新增独立仿真结果子页面 `simulation.html`。
2. 页面默认加载一个示例会议室方案，便于打开后立即看到效果。
3. 支持对方系统通过 `iframe.contentWindow.postMessage(...)` 传入方案数据。
4. 后端新增 `POST /api/simulate`，返回房间、测点、声压热图、音箱位置、SPL 指标和推荐方案。
5. 后端开启 CORS，方便对方系统跨域调用接口。
6. 页面显示三维房间、听音测点、SPL 热图、音箱位置、覆盖范围，并支持单个或全部隐藏覆盖范围。

## 对方系统嵌入方式

在对方“声学仿真”标签页里放一个 iframe：

```html
<iframe
  id="topSoundFrame"
  src="http://127.0.0.1:8080/simulation.html"
  style="width: 100%; height: 100%; border: 0;"
></iframe>
```

生成方案后，把方案数据传给 iframe：

```js
const iframe = document.getElementById("topSoundFrame");

iframe.contentWindow.postMessage({
  type: "TOP_SOUND_SIMULATE",
  payload: {
    room: {
      length: 20,
      width: 10,
      height: 8
    },
    listener: {
      frontMargin: 1.2,
      rearMargin: 0.8,
      sideMargin: 0.7,
      earHeight: 1.2
    },
    targets: {
      minSpl: 95,
      maxUniformity: 8,
      minHeadroom: 3
    },
    models: ["V8PRO", "CXD-60B"]
  }
}, "*");
```

仿真完成后，子页面会向父页面发送：

```js
{
  type: "TOP_SOUND_SIMULATION_DONE",
  summary: {
    model: "...",
    speakerCount: 0,
    minSpl: 0,
    avgSpl: 0,
    maxSpl: 0,
    nonuniformity: 0
  }
}
```

仿真失败时发送：

```js
{
  type: "TOP_SOUND_SIMULATION_ERROR",
  error: "错误原因"
}
```

## 后端接口

### `GET /api/products`

返回当前仿真模块内置的产品库。

### `POST /api/simulate`

进行声学仿真预估。请求体格式：

```json
{
  "room": {
    "length": 20,
    "width": 10,
    "height": 8
  },
  "listener": {
    "frontMargin": 1.2,
    "rearMargin": 0.8,
    "sideMargin": 0.7,
    "earHeight": 1.2
  },
  "targets": {
    "minSpl": 95,
    "maxUniformity": 8,
    "minHeadroom": 3
  },
  "models": ["V8PRO", "CXD-60B"],
  "geometry": null
}
```

返回体核心字段：

```json
{
  "config": {},
  "receivers": [],
  "grid": {
    "xs": [],
    "ys": [],
    "field": []
  },
  "best": {
    "feasible": true,
    "model": "V8PRO",
    "speakerCount": 2,
    "totalCost": 7600,
    "minSpl": 99.2,
    "avgSpl": 104.6,
    "maxSpl": 108.3,
    "nonuniformity": 7.3,
    "speakers": []
  },
  "ranking": []
}
```

## 后续从数据库需要查的数据

要让仿真结果贴近对方系统生成的方案，至少需要以下数据。

### 1. 房间数据

- 规则房间：长、宽、高。
- 不规则房间：封闭边界点、线、弧线、单位、大屏幕墙/主朝向。
- 如果有 CAD 或图片底图，也可以额外传给前端显示，但仿真计算需要结构化几何。

### 2. 听众区数据

- 前边距 `frontMargin`
- 后边距 `rearMargin`
- 侧边距 `sideMargin`
- 听音耳高 `earHeight`
- 如果有真实座席区多边形，后续可以替代简单边距模型。

### 3. 验收/筛选指标

- 最低声压级 `minSpl`
- 最大不均匀度 `maxUniformity`
- 系统余量 `minHeadroom`

这些指标后续可以按国标、项目类型或用户配置从数据库读取。

### 4. 方案设备明细

从方案明细表中至少读取：

- 设备分类
- 品牌
- 产品名称
- 型号规格
- 数量
- 单价

其中“音箱”类设备会进入声学仿真；功放、话筒、中控、矩阵等设备目前只影响系统方案成本，不参与声场计算。

### 5. 音箱产品声学参数

每个音箱型号需要：

- 灵敏度
- 连续声压级
- 最大声压级
- 水平覆盖角
- 垂直覆盖角
- 额定功率
- 频率范围
- 箱体尺寸
- 单价

当前 `product_catalog.json` 已内置一批测试产品；后续可以由对方数据库接口生成同样结构。

### 6. 安装布置信息

这是最关键的数据。如果对方方案已经决定了音箱位置，就应传入：

- 每只音箱的型号
- 安装坐标 `(x, y, z)`
- 瞄准点 `(x, y, z)`
- 角色，例如主扩、侧补、吸顶
- 增益 `gainDb`
- 安装方式，例如壁挂、吊挂、吸顶

如果数据库没有这些字段，本模块只能根据房间和型号重新自动布置，不能完全复现对方方案图里的真实摆位。

## 当前仿真模型说明

当前模块是快速工程预估工具，用直接声、覆盖角衰减、距离衰减、增益搜索和测点 SPL 分布评价来快速判断方案是否可能达标。它适合用于方案阶段筛选和前端可视化。

如果要做最终验收级仿真，还需要进一步接入更完整的房间声学模型，例如材料吸声、混响、早期反射、多频段响应，或者继续使用 PFFDTD 做高精度声学计算。
