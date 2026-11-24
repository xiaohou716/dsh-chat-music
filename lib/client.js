// dsh-chat-music — DeepSeek 唱片机（browser 半）
//
// 浮窗（shell.overlay，全窗口最上层），可拖动；把装有音乐的文件夹拖进导入区即可播放：
//   · 暂停键：鲜蓝圆 + 纯白图标，位于进度条上方，两侧是上一首 / 下一首
//   · 进度条：拖动定位
//   · 音频可视化：AudioContext + AnalyserNode 画在 canvas 上
// 全部本地完成：文件用 object URL 读取，不上传。
window.__ModuleLoader__.load({
  id: 'dsh-chat-music',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var React = require('react')

    var ENDPOINT = '/dsh-chat-music/api'
    var AUDIO_RE = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|weba|wma)$/i
    var POS_KEY = 'dsh-chat-music:pos'
    var COLLAPSED_KEY = 'dsh-chat-music:collapsed'
    var BLUE = '#1677ff'

    function h(tag, props) {
      var children = Array.prototype.slice.call(arguments, 2)
      return React.createElement.apply(React, [tag, props].concat(children))
    }

    function fmt(seconds) {
      if (!isFinite(seconds) || seconds < 0) return '0:00'
      var m = Math.floor(seconds / 60)
      var s = Math.floor(seconds % 60)
      return m + ':' + (s < 10 ? '0' + s : String(s))
    }

    function readEntry(entry) {
      return new Promise(function (resolve) {
        if (!entry) { resolve([]); return }
        if (entry.isFile) {
          entry.file(function (file) { resolve([file]) }, function () { resolve([]) })
          return
        }
        if (entry.isDirectory) {
          var reader = entry.createReader()
          var collected = []
          function readBatch() {
            reader.readEntries(function (batch) {
              if (!batch || batch.length === 0) {
                Promise.all(collected.map(readEntry)).then(function (groups) {
                  var flat = []
                  groups.forEach(function (group) { flat.push.apply(flat, group) })
                  resolve(flat)
                })
                return
              }
              collected.push.apply(collected, batch)
              readBatch()
            }, function () { resolve([]) })
          }
          readBatch()
          return
        }
        resolve([])
      })
    }

    async function collectFiles(dataTransfer) {
      var entries = []
      var plain = []
      if (dataTransfer.items && dataTransfer.items.length) {
        for (var i = 0; i < dataTransfer.items.length; i += 1) {
          var item = dataTransfer.items[i]
          var entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null
          if (entry) entries.push(entry)
          else if (item.kind === 'file') {
            var file = item.getAsFile()
            if (file) plain.push(file)
          }
        }
      } else if (dataTransfer.files) {
        for (var j = 0; j < dataTransfer.files.length; j += 1) plain.push(dataTransfer.files[j])
      }
      var groups = await Promise.all(entries.map(readEntry))
      groups.forEach(function (group) { plain.push.apply(plain, group) })
      return plain
    }

    function isAudio(file) {
      if (!file) return false
      if ((file.type || '').indexOf('audio/') === 0) return true
      return AUDIO_RE.test(file.name || '')
    }

    /** #rrggbb -> [r,g,b]，解析失败时退回品牌蓝。 */
    function hexToRgb(hex) {
      var value = String(hex || '').replace('#', '')
      if (value.length === 3) value = value[0] + value[0] + value[1] + value[1] + value[2] + value[2]
      if (!/^[0-9a-fA-F]{6}$/.test(value)) return [22, 119, 255]
      return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)]
    }

    /** 图片压缩成 data URL（最长边 1400，JPEG 0.82），便于存进 localStorage。 */
    function fileToBg(file) {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file)
        var image = new Image()
        image.onload = function () {
          try {
            var max = 1400
            var scale = Math.min(1, max / Math.max(image.width, image.height))
            var canvas = document.createElement('canvas')
            canvas.width = Math.max(1, Math.round(image.width * scale))
            canvas.height = Math.max(1, Math.round(image.height * scale))
            var context = canvas.getContext('2d')
            context.drawImage(image, 0, 0, canvas.width, canvas.height)
            var data = canvas.toDataURL('image/jpeg', 0.82)
            URL.revokeObjectURL(url)
            resolve(data)
          } catch (error) {
            URL.revokeObjectURL(url)
            reject(error)
          }
        }
        image.onerror = function () {
          URL.revokeObjectURL(url)
          reject(new Error('图片无法读取'))
        }
        image.src = url
      })
    }

    exports.inject = ['slots']
    exports.apply = function apply(ctx) {
      var slots = ctx.get('slots')
      if (slots === undefined) return

      function report(message) {
        try {
          fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'log', message: String(message) }),
          }).catch(function () {})
        } catch (e) {
          // 诊断失败不影响播放
        }
      }

      /** 上下两个滑块的「播放设置」图标。 */
      function SlidersIcon() {
        return h('svg', {
          viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true', focusable: 'false',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round',
        },
          h('path', { d: 'M2.5 4.2h11' }),
          h('circle', { cx: 6, cy: 4.2, r: 1.9, fill: 'currentColor', stroke: 'none' }),
          h('path', { d: 'M2.5 11.6h11' }),
          h('circle', { cx: 10.4, cy: 11.6, r: 1.9, fill: 'currentColor', stroke: 'none' }))
      }

      /** 照片图案的「背景设置」图标。 */
      function PhotoIcon() {
        return h('svg', {
          viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true', focusable: 'false',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
        },
          h('rect', { x: 2.4, y: 3.4, width: 11.2, height: 9.2, rx: 1.8 }),
          h('circle', { cx: 6, cy: 6.5, r: 1.1 }),
          h('path', { d: 'M3.4 11.6l3.1-3.1 2.1 2.1 2.2-2.2 2.4 2.4' }))
      }

      ctx.effect(function () {
        var style = document.createElement('style')
        style.textContent =
          '.cm-panel{position:fixed;z-index:2000;pointer-events:auto;width:340px;box-sizing:border-box;border-radius:16px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));background:var(--dsw-alias-bg-layer-1,#1b1d22);box-shadow:0 20px 60px rgba(0,0,0,.45);color:var(--dsw-alias-label-primary,#eee);font-family:inherit;overflow:hidden;user-select:none}' +
          '.cm-panel *{box-sizing:border-box}' +
          '.cm-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;cursor:move;touch-action:none;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08))}' +
          '.cm-title{font-size:12.5px;font-weight:600;letter-spacing:.02em;display:flex;align-items:center;gap:6px}' +
          '.cm-sub{font-size:11px;color:var(--dsw-alias-label-tertiary,#888);font-weight:400}' +
          '.cm-head-actions{display:flex;align-items:center;gap:2px}' +
          '.cm-icon-btn{border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#999);cursor:pointer;padding:4px;border-radius:7px;display:inline-flex;align-items:center}' +
          '.cm-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16));color:var(--dsw-alias-label-primary,#eee)}' +
          '.cm-body{padding:12px}' +
          '.cm-canvas{width:100%;height:56px;display:block;border-radius:10px;background:linear-gradient(180deg,rgba(22,119,255,.10),rgba(22,119,255,.02));margin-bottom:10px}' +
          '.cm-track{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px}' +
          '.cm-count{font-size:11px;color:var(--dsw-alias-label-tertiary,#888);margin-bottom:10px}' +
          '.cm-controls{display:flex;align-items:center;justify-content:center;gap:18px;margin-bottom:10px}' +
          '.cm-side{width:36px;height:36px;border-radius:50%;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#bbb);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}' +
          '.cm-side:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16));color:var(--dsw-alias-label-primary,#fff)}' +
          '.cm-side:disabled{opacity:.35;cursor:default}' +
          '.cm-play{width:48px;height:48px;border-radius:50%;border:0;background:' + BLUE + ';color:#fff;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(22,119,255,.35)}' +
          '.cm-play:hover:not(:disabled){background:#3a8dff}' +
          '.cm-play:disabled{opacity:.45;cursor:default;box-shadow:none}' +
          '.cm-play svg{width:20px;height:20px}' +
          '.cm-range{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:999px;background:var(--dsw-alias-border-l2,rgba(128,128,128,.35));outline:none;cursor:pointer;margin:0}' +
          '.cm-range::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:' + BLUE + ';border:2px solid #fff;cursor:pointer}' +
          '.cm-range::-moz-range-thumb{width:10px;height:10px;border-radius:50%;background:' + BLUE + ';border:2px solid #fff;cursor:pointer}' +
          '.cm-times{display:flex;justify-content:space-between;font-size:11px;color:var(--dsw-alias-label-tertiary,#888);margin:6px 0 10px;font-variant-numeric:tabular-nums}' +
          '.cm-tools{display:flex;align-items:center;justify-content:space-between;gap:8px}' +
          '.cm-seg{position:relative;display:flex;gap:2px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14));border-radius:8px;padding:2px;margin:6px 0;animation:cm-seg-in .2s cubic-bezier(.22,.61,.36,1)}' +
          '.cm-seg-thumb{position:absolute;top:2px;bottom:2px;left:2px;width:0;border-radius:6px;background:' + BLUE + ';box-shadow:0 2px 10px rgba(22,119,255,.35);transform:translateX(0);transition:transform .3s cubic-bezier(.22,.61,.36,1),width .3s cubic-bezier(.22,.61,.36,1);will-change:transform;pointer-events:none}' +
          '.cm-seg button{position:relative;z-index:1;flex:1;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#999);font:inherit;font-size:11px;padding:4px 6px;border-radius:6px;cursor:pointer;white-space:nowrap;transition:color .22s ease,transform .12s ease}' +
          '.cm-seg button.on{color:#fff}' +
          '.cm-seg button:active{transform:scale(.96)}' +
          '@keyframes cm-seg-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}' +
          '.cm-bg-pick{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#bbb);font:inherit;font-size:11px;padding:4px 8px;cursor:pointer;width:100%}' +
          '.cm-bg-pick:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}' +
          '.cm-bg-hint{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#888);margin-top:6px;line-height:1.5}' +
          '.cm-color-row{display:flex;align-items:center;gap:8px;margin-top:6px}' +
          '.cm-color{width:34px;height:24px;padding:0;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));border-radius:6px;background:transparent;cursor:pointer}' +
          '.cm-color-label{font-size:11px;color:var(--dsw-alias-label-tertiary,#888)}' +
          '.cm-bg{position:absolute;inset:0;background-size:cover;background-position:center;opacity:.34;pointer-events:none;z-index:0}' +
          '.cm-shell{position:relative;z-index:1}' +
          '.cm-drop{border:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:12px;padding:14px 12px;text-align:center;font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#999);transition:background .12s ease,border-color .12s ease}' +
          '.cm-drop.big{padding:26px 14px}' +
          '.cm-drop.over{border-color:' + BLUE + ';background:rgba(22,119,255,.12);color:var(--dsw-alias-label-primary,#fff)}' +
          '.cm-drop strong{color:var(--dsw-alias-label-secondary,#ccc);font-weight:600}' +
          '.cm-err{font-size:11.5px;color:var(--dsw-alias-state-error-primary,#e5484d);margin-top:8px;line-height:1.5}' +
          '.cm-ok{font-size:11.5px;color:var(--dsw-alias-state-success-primary,#30a46c);margin-top:8px;line-height:1.5}' +
          '.cm-hidden{display:none}'
        document.head.appendChild(style)
        return function () { style.remove() }
      }, 'dsh-chat-music: 样式')

      /** 分段滑块：高亮药丸用 transform 平滑滑到选中项（每个实例自己测量）。 */
      function SegmentedControl(props) {
        var segRef = React.useRef(null)
        var thumbRef = React.useRef(null)
        var count = props.options.length
        React.useEffect(function () {
          var seg = segRef.current
          var thumb = thumbRef.current
          if (!seg || !thumb || count <= 0) return
          var computed = window.getComputedStyle(seg)
          var padding = parseFloat(computed.paddingLeft) || 2
          var gap = parseFloat(computed.columnGap || computed.gap) || 2
          var inner = seg.clientWidth - padding * 2 - gap * (count - 1)
          if (inner <= 0) return
          var itemWidth = inner / count
          var active = Math.max(0, Math.min(props.activeIndex, count - 1))
          var firstPaint = thumb.style.width === ''
          if (firstPaint) thumb.style.transition = 'none'
          thumb.style.width = itemWidth + 'px'
          thumb.style.transform = 'translateX(' + (active * (itemWidth + gap)) + 'px)'
          if (firstPaint) {
            // 首次定位不播放动画，避免从 0 宽度“生长”；之后切换才滑动。
            void thumb.offsetWidth
            thumb.style.transition = ''
          }
        }, [count, props.activeIndex])
        var buttons = props.options.map(function (option, position) {
          return h('button', {
            key: option.value,
            type: 'button',
            className: position === props.activeIndex ? 'on' : '',
            onClick: function () { props.onSelect(option.value) },
          }, option.label)
        })
        return h('div', { className: 'cm-seg', ref: segRef },
          [h('span', { className: 'cm-seg-thumb', key: 'thumb', ref: thumbRef, 'aria-hidden': 'true' })].concat(buttons))
      }

      function RecordPlayer() {
        var itemsState = React.useState([])
        var items = itemsState[0], setItems = itemsState[1]
        var indexState = React.useState(0)
        var index = indexState[0], setIndex = indexState[1]
        var playingState = React.useState(false)
        var playing = playingState[0], setPlaying = playingState[1]
        var timeState = React.useState(0)
        var time = timeState[0], setTime = timeState[1]
        var durationState = React.useState(0)
        var duration = durationState[0], setDuration = durationState[1]
        var collapsedState = React.useState(false)
        var collapsed = collapsedState[0], setCollapsed = collapsedState[1]
        var posState = React.useState(null)
        var pos = posState[0], setPos = posState[1]
        var droppingState = React.useState(false)
        var dropping = droppingState[0], setDropping = droppingState[1]
        var errorState = React.useState(null)
        var error = errorState[0], setError = errorState[1]
        var noticeState = React.useState(null)
        var notice = noticeState[0], setNotice = noticeState[1]
        var draggingState = React.useState(false)
        var dragging = draggingState[0], setDragging = draggingState[1]
        var readyState = React.useState(false)
        var ready = readyState[0], setReady = readyState[1]
        var playModeState = React.useState('list')
        var playMode = playModeState[0], setPlayMode = playModeState[1]
        var bgModeState = React.useState('global')
        var bgMode = bgModeState[0], setBgMode = bgModeState[1]
        var globalBgState = React.useState(null)
        var globalBg = globalBgState[0], setGlobalBg = globalBgState[1]
        var trackBgsState = React.useState({})
        var trackBgs = trackBgsState[0], setTrackBgs = trackBgsState[1]
        var colorModeState = React.useState('global')
        var colorMode = colorModeState[0], setColorMode = colorModeState[1]
        var globalColorState = React.useState('#1677ff')
        var globalColor = globalColorState[0], setGlobalColor = globalColorState[1]
        var trackColorsState = React.useState({})
        var trackColors = trackColorsState[0], setTrackColors = trackColorsState[1]
        var colorRef = React.useRef([22, 119, 255])
        var toolsState = React.useState(null)
        var tools = toolsState[0], setTools = toolsState[1]
        var imageInputRef = React.useRef(null)
        var playModeRef = React.useRef('list')
        playModeRef.current = playMode

        var audioRef = React.useRef(null)
        var actxRef = React.useRef(null)
        var analyserRef = React.useRef(null)
        var canvasRef = React.useRef(null)
        var smoothingRef = React.useRef(null)
        var playingRef = React.useRef(false)
        var itemsRef = React.useRef([])
        var indexRef = React.useRef(0)
        var posRef = React.useRef(null)
        var dragOriginRef = React.useRef(null)

        playingRef.current = playing
        itemsRef.current = items
        indexRef.current = index
        posRef.current = pos

        // 初始位置与折叠状态
        React.useEffect(function () {
          var saved = null
          try {
            var raw = localStorage.getItem(POS_KEY)
            if (raw) {
              var parsed = JSON.parse(raw)
              if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number') saved = parsed
            }
          } catch (e) { /* 忽略 */ }
          if (!saved) {
            saved = {
              x: Math.max(12, window.innerWidth - 360),
              y: Math.max(12, window.innerHeight - 360),
            }
          }
          saved.x = Math.min(Math.max(6, saved.x), Math.max(6, window.innerWidth - 120))
          saved.y = Math.min(Math.max(6, saved.y), Math.max(6, window.innerHeight - 60))
          setPos(saved)
          try { setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1') } catch (e) { /* 忽略 */ }
          try {
            var storedPlayMode = localStorage.getItem('dsh-chat-music:play-mode')
            if (storedPlayMode === 'one' || storedPlayMode === 'list' || storedPlayMode === 'shuffle') setPlayMode(storedPlayMode)
            var storedBgMode = localStorage.getItem('dsh-chat-music:bg-mode')
            if (storedBgMode === 'global' || storedBgMode === 'track') setBgMode(storedBgMode)
            var storedGlobalBg = localStorage.getItem('dsh-chat-music:bg:global')
            if (storedGlobalBg) setGlobalBg(storedGlobalBg)
            var storedTrackBgs = localStorage.getItem('dsh-chat-music:bg:tracks')
            if (storedTrackBgs) {
              var parsedTrackBgs = JSON.parse(storedTrackBgs)
              if (parsedTrackBgs && typeof parsedTrackBgs === 'object') setTrackBgs(parsedTrackBgs)
            }
            var storedColorMode = localStorage.getItem('dsh-chat-music:color-mode')
            if (storedColorMode === 'global' || storedColorMode === 'track') setColorMode(storedColorMode)
            var storedGlobalColor = localStorage.getItem('dsh-chat-music:color:global')
            if (storedGlobalColor) setGlobalColor(storedGlobalColor)
            var storedTrackColors = localStorage.getItem('dsh-chat-music:color:tracks')
            if (storedTrackColors) {
              var parsedTrackColors = JSON.parse(storedTrackColors)
              if (parsedTrackColors && typeof parsedTrackColors === 'object') setTrackColors(parsedTrackColors)
            }
          } catch (e) { /* 忽略 */ }
          setReady(true)
        }, [])

        // 音频元素与基础事件
        React.useEffect(function () {
          var audio = new Audio()
          audio.preload = 'metadata'
          audioRef.current = audio
          function onMeta() { setDuration(isFinite(audio.duration) ? audio.duration : 0) }
          function onTime() { setTime(audio.currentTime) }
          function onEnded() {
            var list = itemsRef.current
            if (list.length === 0) return
            var mode = playModeRef.current
            if (mode === 'one') {
              try { audio.currentTime = 0 } catch (e) { /* 忽略 */ }
              var again = audio.play()
              if (again && again.catch) {
                again.catch(function () {
                  setPlaying(false)
                  setError('浏览器阻止了自动播放：请点一下暂停键继续')
                })
              }
              return
            }
            var target
            if (mode === 'shuffle' && list.length > 1) {
              do { target = Math.floor(Math.random() * list.length) } while (target === indexRef.current)
            } else {
              target = (indexRef.current + 1) % list.length
            }
            setIndex(target)
            setTime(0)
            setDuration(0)
          }
          function onError() {
            setError('这个文件无法播放（可能是不受支持的编码）')
            setPlaying(false)
          }
          audio.addEventListener('loadedmetadata', onMeta)
          audio.addEventListener('durationchange', onMeta)
          audio.addEventListener('timeupdate', onTime)
          audio.addEventListener('ended', onEnded)
          audio.addEventListener('error', onError)
          return function () {
            audio.removeEventListener('loadedmetadata', onMeta)
            audio.removeEventListener('durationchange', onMeta)
            audio.removeEventListener('timeupdate', onTime)
            audio.removeEventListener('ended', onEnded)
            audio.removeEventListener('error', onError)
            try { audio.pause() } catch (e) { /* 忽略 */ }
            audio.removeAttribute('src')
            try { audio.load() } catch (e) { /* 忽略 */ }
            if (actxRef.current && actxRef.current.close) {
              actxRef.current.close().catch(function () {})
              actxRef.current = null
              analyserRef.current = null
            }
          }
        }, [])

        function ensureGraph() {
          var audio = audioRef.current
          if (!audio) return
          var Ctx = window.AudioContext || window.webkitAudioContext
          if (!Ctx) return
          try {
            if (!actxRef.current) {
              var actx = new Ctx()
              var source = actx.createMediaElementSource(audio)
              var analyser = actx.createAnalyser()
              analyser.fftSize = 256
              analyser.smoothingTimeConstant = 0.8
              source.connect(analyser)
              analyser.connect(actx.destination)
              actxRef.current = actx
              analyserRef.current = analyser
            }
            if (actxRef.current.state === 'suspended') actxRef.current.resume().catch(function () {})
          } catch (e) {
            report('audio graph failed: ' + (e && e.message ? e.message : String(e)))
          }
        }

        function skip(delta) {
          var list = itemsRef.current
          if (list.length === 0) return
          var next = (indexRef.current + delta + list.length) % list.length
          setIndex(next)
          setTime(0)
          setDuration(0)
        }

        function toggle() {
          var audio = audioRef.current
          if (!audio || itemsRef.current.length === 0) return
          ensureGraph()
          if (playingRef.current) {
            audio.pause()
            setPlaying(false)
            return
          }
          var promise = audio.play()
          if (promise && promise.then) {
            promise.then(function () { setPlaying(true); setError(null) })
              .catch(function (e) {
                setPlaying(false)
                setError('浏览器阻止了播放，请再点一次播放键')
                report('play rejected: ' + (e && e.message ? e.message : String(e)))
              })
          } else {
            setPlaying(true)
          }
        }

        // 切歌：换 src；如果仍在播放就接着播
        React.useEffect(function () {
          var audio = audioRef.current
          if (!audio) return
          var item = items[index]
          if (!item) {
            audio.removeAttribute('src')
            try { audio.load() } catch (e) { /* 忽略 */ }
            setDuration(0)
            setTime(0)
            return
          }
          if (audio.src !== item.url) {
            audio.src = item.url
            try { audio.load() } catch (e) { /* 忽略 */ }
          }
          setTime(0)
          setDuration(0)
          if (playingRef.current) {
            var promise = audio.play()
            if (promise && promise.catch) {
              promise.catch(function () {
                setPlaying(false)
                setError('浏览器阻止了自动播放：请点一下暂停键继续')
              })
            }
          }
        }, [index, items])

        // 可视化
        React.useEffect(function () {
          var canvas = canvasRef.current
          if (!canvas) return
          var bins = 48
          var levels = new Array(bins)
          for (var i = 0; i < bins; i += 1) levels[i] = 0
          var raf = 0
          var resumeTick = 0
          function frame() {
            raf = requestAnimationFrame(frame)
            resumeTick += 1
            if (resumeTick % 60 === 0 && analyserRef.current && actxRef.current && actxRef.current.state === 'suspended') {
              actxRef.current.resume().catch(function () {})
            }
            var dpr = window.devicePixelRatio || 1
            var width = canvas.clientWidth || 300
            var height = canvas.clientHeight || 56
            if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
              canvas.width = Math.round(width * dpr)
              canvas.height = Math.round(height * dpr)
            }
            var g = canvas.getContext('2d')
            if (!g) return
            g.setTransform(dpr, 0, 0, dpr, 0, 0)
            g.clearRect(0, 0, width, height)
            var analyser = analyserRef.current
            var values = new Array(bins)
            if (analyser && playingRef.current) {
              var data = new Uint8Array(analyser.frequencyBinCount)
              analyser.getByteFrequencyData(data)
              var step = Math.max(1, Math.floor(data.length / bins))
              for (var b = 0; b < bins; b += 1) values[b] = (data[b * step] || 0) / 255
            } else {
              for (var z = 0; z < bins; z += 1) values[z] = 0
            }
            var barWidth = width / bins
            var rgb = colorRef.current || [22, 119, 255]
            for (var k = 0; k < bins; k += 1) {
              levels[k] = Math.max(values[k], levels[k] * 0.86)
              var barHeight = Math.max(2, levels[k] * (height - 8))
              var x = k * barWidth + 1
              g.fillStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (0.30 + levels[k] * 0.70).toFixed(3) + ')'
              g.beginPath()
              var radius = Math.min(2, barWidth / 3)
              var y = height - barHeight - 3
              g.moveTo(x + radius, y)
              g.arcTo(x + barWidth - 2, y, x + barWidth - 2, y + barHeight, radius)
              g.arcTo(x + barWidth - 2, y + barHeight, x, y + barHeight, radius)
              g.arcTo(x, y + barHeight, x, y, radius)
              g.arcTo(x, y, x + barWidth - 2, y, radius)
              g.closePath()
              g.fill()
            }
          }
          frame()
          return function () { cancelAnimationFrame(raf) }
        }, [collapsed, ready])

        // 拖动浮窗
        React.useEffect(function () {
          if (!dragging) return
          function move(event) {
            var origin = dragOriginRef.current
            if (!origin) return
            var x = Math.min(Math.max(6, event.clientX - origin.dx), Math.max(6, window.innerWidth - 140))
            var y = Math.min(Math.max(6, event.clientY - origin.dy), Math.max(6, window.innerHeight - 60))
            setPos({ x: x, y: y })
          }
          function stop() {
            dragOriginRef.current = null
            setDragging(false)
            var current = posRef.current
            if (current) {
              try { localStorage.setItem(POS_KEY, JSON.stringify(current)) } catch (e) { /* 忽略 */ }
            }
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', stop)
          window.addEventListener('pointercancel', stop)
          return function () {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', stop)
            window.removeEventListener('pointercancel', stop)
          }
        }, [dragging])

        function startDrag(event) {
          if (event.button !== undefined && event.button !== 0) return
          var base = pos || { x: 24, y: 24 }
          if (!pos) setPos(base)
          dragOriginRef.current = { dx: event.clientX - base.x, dy: event.clientY - base.y }
          setDragging(true)
          event.preventDefault()
        }

        function handleDrop(event) {
          event.preventDefault()
          event.stopPropagation()
          setDropping(false)
          var dt = event.dataTransfer
          if (!dt) return
          setError(null)
          setNotice(null)
          // 在用户手势里同步建立音频图：否则拖放自动播放时没有 AnalyserNode，频谱只能是平的。
          ensureGraph()
          collectFiles(dt).then(function (files) {
            var audioFiles = files.filter(isAudio)
            if (audioFiles.length === 0) {
              setError('这个文件夹里没有可播放的音频（支持 mp3 / m4a / wav / flac / ogg / opus / aac）')
              return
            }
            var incoming = audioFiles.map(function (file) {
              return { name: file.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(file) }
            })
            incoming.sort(function (a, b) { return a.name.localeCompare(b.name, 'zh-Hans-CN') })

            // 去重：已有的曲名优先保留，新导入的重复项直接丢弃（并释放它的 object URL）。
            var known = {}
            itemsRef.current.forEach(function (item) { known[item.name] = true })
            var fresh = []
            var skipped = 0
            incoming.forEach(function (item) {
              if (known[item.name]) {
                skipped += 1
                try { URL.revokeObjectURL(item.url) } catch (e) { /* 忽略 */ }
                return
              }
              known[item.name] = true
              fresh.push(item)
            })

            if (fresh.length === 0) {
              setNotice(null)
              setError('这 ' + skipped + ' 首都已经在播放列表里了，没有新增（保留原有的）')
              return
            }

            var startAt = itemsRef.current.length
            setItems(function (current) { return current.concat(fresh) })
            setIndex(startAt)
            setTime(0)
            setDuration(0)
            setPlaying(true)
            setError(null)
            setNotice('新增 ' + fresh.length + ' 首' + (skipped > 0 ? '，跳过 ' + skipped + ' 首重复（保留原有的）' : ''))
          }).catch(function (e) {
            setError('读取拖入的文件失败：' + (e && e.message ? e.message : String(e)))
            report('drop failed: ' + (e && e.message ? e.message : String(e)))
          })
        }

        function seek(event) {
          var audio = audioRef.current
          if (!audio) return
          var value = Number(event.target.value)
          if (!isFinite(value)) return
          try { audio.currentTime = value } catch (e) { /* 忽略 */ }
          setTime(value)
        }

        if (!ready || !pos) {
          return h('div', { className: 'cm-panel', style: { left: '12px', top: '12px', padding: '10px 12px', fontSize: '12px' } },
            '唱片机准备中…')
        }

        var current = items[index]
        var hasItems = items.length > 0

        function choosePlayMode(value) {
          setPlayMode(value)
          try { localStorage.setItem('dsh-chat-music:play-mode', value) } catch (e) { /* 忽略 */ }
        }

        function chooseBgMode(value) {
          setBgMode(value)
          try { localStorage.setItem('dsh-chat-music:bg-mode', value) } catch (e) { /* 忽略 */ }
        }

        function chooseColorMode(value) {
          setColorMode(value)
          try { localStorage.setItem('dsh-chat-music:color-mode', value) } catch (e) { /* 忽略 */ }
        }

        function onPickColor(event) {
          var value = event.target.value
          if (!value) return
          if (colorMode === 'track') {
            var name = current ? current.name : null
            if (!name) { setError('先选一首歌，再设置单曲颜色'); return }
            var next = {}
            Object.keys(trackColors).forEach(function (key) { next[key] = trackColors[key] })
            next[name] = value
            setTrackColors(next)
            try { localStorage.setItem('dsh-chat-music:color:tracks', JSON.stringify(next)) } catch (e) { report('track color save failed: ' + e.message) }
          } else {
            setGlobalColor(value)
            try { localStorage.setItem('dsh-chat-music:color:global', value) } catch (e) { report('color save failed: ' + e.message) }
          }
        }

        function pickBackground() {
          if (imageInputRef.current) imageInputRef.current.click()
        }

        function onPickImage(event) {
          var file = event.target.files && event.target.files[0]
          event.target.value = ''
          if (!file) return
          if (!/^image\//.test(file.type || '')) { setError('请选择图片文件'); return }
          var forTrack = bgMode === 'track'
          var trackName = current ? current.name : null
          if (forTrack && !trackName) { setError('先选一首歌，再设置单曲背景'); return }
          fileToBg(file).then(function (dataUrl) {
            if (forTrack) {
              var next = {}
              Object.keys(trackBgs).forEach(function (key) { next[key] = trackBgs[key] })
              next[trackName] = dataUrl
              setTrackBgs(next)
              try { localStorage.setItem('dsh-chat-music:bg:tracks', JSON.stringify(next)) } catch (e) { report('track bg save failed: ' + e.message) }
            } else {
              setGlobalBg(dataUrl)
              try { localStorage.setItem('dsh-chat-music:bg:global', dataUrl) } catch (e) { report('bg save failed: ' + e.message) }
            }
            setError(null)
            setTools(null)
          }).catch(function (e) { setError('背景图读取失败：' + (e && e.message ? e.message : String(e))) })
        }

        var bgUrl = bgMode === 'track'
          ? (current ? (trackBgs[current.name] || null) : null)
          : globalBg

        var vizColor = colorMode === 'track'
          ? (current ? (trackColors[current.name] || globalColor) : globalColor)
          : globalColor
        colorRef.current = hexToRgb(vizColor)

        function bgLayer() {
          return bgUrl
            ? h('div', { className: 'cm-bg', key: 'bg', style: { backgroundImage: 'url("' + bgUrl + '")' } })
            : null
        }

        var header = h('div', { className: 'cm-head', onPointerDown: startDrag },
          h('div', { className: 'cm-title' },
            h('span', null, '♪ DeepSeek 唱片机'),
            hasItems ? h('span', { className: 'cm-sub' }, items.length + ' 首') : null),
          h('div', { className: 'cm-head-actions' },
            h('button', {
              type: 'button', className: 'cm-icon-btn', title: collapsed ? '展开' : '收起',
              onPointerDown: function (event) { event.stopPropagation() },
              onClick: function () {
                setCollapsed(function (value) {
                  var next = !value
                  try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0') } catch (e) { /* 忽略 */ }
                  return next
                })
              },
            }, collapsed ? '▸' : '▾')))

        if (collapsed) {
          return h('div', {
            className: 'cm-panel',
            style: { left: pos.x + 'px', top: pos.y + 'px' },
            onDragOver: function (event) { event.preventDefault(); setDropping(true) },
            onDragLeave: function () { setDropping(false) },
            onDrop: handleDrop,
          }, [bgLayer(), h('div', { className: 'cm-shell', key: 'shell' }, header)])
        }

        var body = h('div', { className: 'cm-body' },
          h('canvas', { className: 'cm-canvas', ref: canvasRef }),
          h('div', { className: 'cm-track' }, current ? current.name : '还没有音乐'),
          h('div', { className: 'cm-count' },
            hasItems ? (index + 1) + ' / ' + items.length + ' · ' + (playing ? '播放中' : '已暂停') : '把音乐文件夹拖进来'),

          h('div', { className: 'cm-controls' },
            h('button', {
              type: 'button', className: 'cm-side', title: '上一首', 'aria-label': '上一首',
              disabled: !hasItems,
              onClick: function () { skip(-1) },
            }, h('svg', { viewBox: '0 0 24 24', width: 18, height: 18, fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false' },
              h('path', { d: 'M6 5h2v14H6z' }),
              h('path', { d: 'M18 5v14l-9-7z' }))),

            h('button', {
              type: 'button', className: 'cm-play', title: playing ? '暂停' : '播放', 'aria-label': playing ? '暂停' : '播放',
              disabled: !hasItems,
              onClick: toggle,
            }, playing
              ? h('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: '#ffffff', 'aria-hidden': 'true', focusable: 'false' },
                h('rect', { x: 7, y: 5, width: 3.6, height: 14, rx: 1 }),
                h('rect', { x: 13.4, y: 5, width: 3.6, height: 14, rx: 1 }))
              : h('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: '#ffffff', 'aria-hidden': 'true', focusable: 'false' },
                h('path', { d: 'M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2z' }))),

            h('button', {
              type: 'button', className: 'cm-side', title: '下一首', 'aria-label': '下一首',
              disabled: !hasItems,
              onClick: function () { skip(1) },
            }, h('svg', { viewBox: '0 0 24 24', width: 18, height: 18, fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false' },
              h('path', { d: 'M16 5h2v14h-2z' }),
              h('path', { d: 'M6 5l9 7-9 7z' })))),

          h('input', {
            className: 'cm-range', type: 'range', min: 0, max: duration > 0 ? duration : 0, step: 0.1,
            value: Math.min(time, duration > 0 ? duration : 0),
            disabled: !hasItems || duration <= 0,
            'aria-label': '进度条',
            onChange: seek,
          }),
          h('div', { className: 'cm-times' },
            h('span', null, fmt(time)),
            h('span', null, duration > 0 ? fmt(duration) : '0:00')),

          h('div', { className: 'cm-tools' },
            h('button', {
              type: 'button', className: 'cm-icon-btn', title: '播放设置', 'aria-label': '播放设置',
              onClick: function () { setTools(tools === 'play' ? null : 'play') },
            }, SlidersIcon()),
            h('button', {
              type: 'button', className: 'cm-icon-btn', title: '背景设置', 'aria-label': '背景设置',
              onClick: function () { setTools(tools === 'bg' ? null : 'bg') },
            }, PhotoIcon())),

          tools === 'play'
            ? h(SegmentedControl, {
              key: 'play-modes',
              options: [
                { label: '单曲循环', value: 'one' },
                { label: '列表循环', value: 'list' },
                { label: '随机播放', value: 'shuffle' },
              ],
              activeIndex: playMode === 'one' ? 0 : (playMode === 'list' ? 1 : 2),
              onSelect: choosePlayMode,
            })
            : null,

          tools === 'bg'
            ? h('div', null,
              h(SegmentedControl, {
                key: 'bg-modes',
                options: [
                  { label: '全歌背景', value: 'global' },
                  { label: '单独背景', value: 'track' },
                ],
                activeIndex: bgMode === 'global' ? 0 : 1,
                onSelect: chooseBgMode,
              }),
              h('button', { type: 'button', className: 'cm-bg-pick', onClick: pickBackground },
                bgMode === 'global'
                  ? (globalBg ? '更换全歌背景图…' : '选择全歌背景图…')
                  : (bgUrl ? '更换本曲背景图…' : '为本曲选择背景图…')),
              h('div', { className: 'cm-bg-hint' },
                bgMode === 'track'
                  ? '每首歌单独一张背景；没设置的曲目保持纯色'
                  : '所有曲目共用这一张背景'),
              h('div', { className: 'cm-bg-hint', style: { marginTop: '10px' } }, '可视化颜色'),
              h(SegmentedControl, {
                key: 'color-modes',
                options: [
                  { label: '全曲颜色', value: 'global' },
                  { label: '单曲颜色', value: 'track' },
                ],
                activeIndex: colorMode === 'global' ? 0 : 1,
                onSelect: chooseColorMode,
              }),
              h('div', { className: 'cm-color-row' },
                h('input', {
                  type: 'color', className: 'cm-color', value: vizColor, 'aria-label': '可视化颜色',
                  onChange: onPickColor,
                }),
                h('span', { className: 'cm-color-label' },
                  colorMode === 'track'
                    ? (current
                      ? (trackColors[current.name] ? '本曲颜色' : '本曲颜色（未设，用全曲色）')
                      : '先选一首歌')
                    : '全曲颜色')),
              h('input', {
                ref: imageInputRef, type: 'file', accept: 'image/*', className: 'cm-hidden',
                onChange: onPickImage,
              }))
            : null,

          h('div', {
            className: 'cm-drop' + (hasItems ? '' : ' big') + (dropping ? ' over' : ''),
            onDragOver: function (event) { event.preventDefault(); setDropping(true) },
            onDragLeave: function () { setDropping(false) },
            onDrop: handleDrop,
          }, dropping
            ? h('span', null, '松手即可导入')
            : (hasItems
              ? h('span', null, '＋ 把另一个文件夹拖到这里')
              : h('span', null,
                h('strong', null, '导入区域'),
                h('br'),
                '把装有音乐的文件夹拖到这里',
                h('br'),
                '支持 mp3 / m4a / wav / flac / ogg / opus / aac'))),

          error ? h('div', { className: 'cm-err' }, error) : null,
          notice && !error ? h('div', { className: 'cm-ok' }, notice) : null)

        return h('div', {
          className: 'cm-panel',
          style: { left: pos.x + 'px', top: pos.y + 'px' },
          onDragOver: function (event) { event.preventDefault(); setDropping(true) },
          onDragLeave: function () { setDropping(false) },
          onDrop: handleDrop,
        }, [bgLayer(), h('div', { className: 'cm-shell', key: 'shell' }, header, body)])
      }

      ctx.effect(function () {
        return slots.inject('shell.overlay', function () {
          return slots.register(
            { name: 'shell.overlay', id: 'chat-music-player', order: 100, label: 'DeepSeek 唱片机' },
            RecordPlayer,
          )
        })
      }, 'dsh-chat-music: 唱片机浮窗')
    }

    return module.exports
  },
})
