// dsh-chat-music — DeepSeek 唱片机（Host 半）
//
// 播放器完全在浏览器里跑（本地文件用 object URL 读取，不经网络）。Host 侧只做两件事：
//   1. 提供一条诊断接口，让客户端把运行期异常写到文件里，便于排查；
//   2. 无其它依赖，plugins 群里即使没有 webServer 也能正常激活。
import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-chat-music'

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function readBody(req, limit = 200000) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        try { req.destroy() } catch { /* 已销毁 */ }
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, code, payload) {
  try {
    res.statusCode = code
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify(payload))
  } catch {
    // 响应已发出
  }
}

export function apply(ctx) {
  ctx.inject(['webServer'], (child) => {
    child.effect(
      () =>
        child.webServer.register({
          kind: 'exact',
          path: '/dsh-chat-music/api',
          handler: async (req, res) => {
            try {
              if (req.method !== 'POST') {
                sendJson(res, 405, { ok: false, error: '仅支持 POST' })
                return
              }
              let patch
              try {
                patch = JSON.parse((await readBody(req)) || '{}')
              } catch {
                sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' })
                return
              }
              if (patch && patch.action === 'log') {
                try {
                  await mkdir(join(dshHome(), 'chat-music'), { recursive: true })
                  await appendFile(
                    join(dshHome(), 'chat-music', 'client-errors.log'),
                    new Date().toISOString() + ' ' + String(patch.message || '') + '\n',
                    'utf8',
                  )
                } catch {
                  // 诊断写入失败不影响播放器
                }
              }
              sendJson(res, 200, { ok: true })
            } catch (error) {
              sendJson(res, 500, { ok: false, error: error && error.message ? error.message : String(error) })
            }
          },
        }),
      'dsh-chat-music: 诊断接口',
    )
  })

  console.log('dsh-chat-music: 已激活（DeepSeek 唱片机）')
}
