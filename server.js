// xbJL LLM Proxy —— 部署在抖音云托管的极简代理
// 职责：接收腾讯云 server.js 的请求 → 走抖音云内网调豆包推理接入点 → 返回结果
// 链路：腾讯云 --HTTPS+token--> 本服务 --内网免鉴权--> ark-vg.dyc.ivolces.com --> doubao-seed-2-0-lite
const http = require('http');

const ARK_URL = process.env.ARK_URL || 'http://ark-vg.dyc.ivolces.com/api/v3/chat/completions';
// 接入点 ID：抖音云会按 MEP_{接入点大写名称} 自动注入环境变量（xbjl -> MEP_XBJL）；
// 兜底允许部署时手工配置 XBJL_EP_ID。两个都没有则启动报错提示。
const EP_ID = process.env.MEP_XBJL || process.env.XBJL_EP_ID || '';
// 简易鉴权：腾讯云侧请求必须带 x-token 头，防止代理被陌生人扫到白嫖
const TOKEN = process.env.XBJL_TOKEN || '';

if (!EP_ID) {
  console.error('[proxy] 缺少推理接入点ID：期望环境变量 MEP_XBJL（自动注入）或 XBJL_EP_ID（手工配置）');
  console.error('[proxy] 可用环境变量参考:', Object.keys(process.env).filter(k => k.startsWith('MEP_')).join(', ') || '（无 MEP_ 开头变量）');
}
if (!TOKEN) console.error('[proxy] 警告：未设置 XBJL_TOKEN，鉴权关闭（仅调试用）');

function callArk(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: EP_ID,
      messages: payload.messages,
      max_tokens: payload.max_tokens || 100,
      temperature: typeof payload.temperature === 'number' ? payload.temperature : 0.9,
      stream: false,
    });
    const u = new URL(ARK_URL);
    const req = http.request({
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 60000, // LLM 最长 60s（与前端 65s/nginx 300s 对齐）
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
        catch (e) { reject(new Error('响应解析失败: ' + data.slice(0, 200))); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('ARK 请求超时(60s)')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  // 健康检查（抖音云托管探活用）
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, ep: EP_ID ? EP_ID.slice(0, 8) + '...' : 'MISSING', env: process.env.CLOUD_ENV || 'unknown' }));
  }
  // 业务入口：POST /chat
  if (req.method === 'POST' && req.url === '/chat') {
    if (TOKEN && req.headers['x-token'] !== TOKEN) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'forbidden' }));
    }
    if (!EP_ID) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'missing endpoint id (MEP_XBJL/XBJL_EP_ID)' }));
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      try {
        const payload = JSON.parse(raw);
        if (!Array.isArray(payload.messages) || !payload.messages.length) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'messages required' }));
        }
        const { status, json } = await callArk(payload);
        res.writeHead(status === 200 ? 200 : 502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      } catch (e) {
        console.error('[proxy] error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

const PORT = Number(process.env.PORT) || 8000;
server.listen(PORT, () => {
  console.log(`[proxy] listening on :${PORT}, env=${process.env.CLOUD_ENV || '?'}, ep=${EP_ID || 'MISSING'}`);
});
