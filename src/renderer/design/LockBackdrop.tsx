import { useEffect, useRef } from 'react'

/**
 * What the lock screen sits on: "Cortex", an organic neural mesh in two
 * hemispheres. Nodes drift on noise at three depths, links rewire as they
 * move and bow instead of running straight, and signals wander the mesh,
 * lighting each node they reach. A HUD frames it.
 *
 * Chosen from the gallery in scripts/probes (see LOCK_SCREEN_NOTES.md),
 * where the other scenes live. Flat 2D on one canvas at ~30 fps, paused
 * while the window is hidden, one still frame under "reduce motion".
 */

const FRAME_MS = 1000 / 30

interface Rgb {
  r: number
  g: number
  b: number
}

function token(name: string, fallback: string): Rgb {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  const hex = /^#?([0-9a-f]{6})$/i.exec(raw)?.[1] ?? fallback.slice(1)
  const n = parseInt(hex, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

const rgba = (c: Rgb, a: number): string => `rgba(${c.r},${c.g},${c.b},${a})`
const pad = (n: number): string => String(n).padStart(2, '0')

/** A small seeded random, so the mesh is the same brain every time. */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** 2D gradient noise, for drift that wanders rather than jitters. */
const PERM = (() => {
  const r = seeded(99)
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  return p.concat(p)
})()
const GRAD = Array.from({ length: 256 }, (_, i) => [Math.cos((i / 256) * Math.PI * 2), Math.sin((i / 256) * Math.PI * 2)])
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
function noise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
  const g = (ix: number, iy: number, dx: number, dy: number): number => {
    const v = GRAD[PERM[(PERM[ix & 255] + iy) & 255]]
    return v[0] * dx + v[1] * dy
  }
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  return lerp(lerp(g(xi, yi, xf, yf), g(xi + 1, yi, xf - 1, yf), u), lerp(g(xi, yi + 1, xf, yf - 1), g(xi + 1, yi + 1, xf - 1, yf - 1), u), v)
}

interface Tendril {
  a: number
  l: number
}

interface Neuron {
  /** Home position, as a fraction of the window from its centre. */
  hx: number
  hy: number
  /** Depth, 0.45 (far) .. 1 (near): far nodes are smaller, dimmer, slower. */
  z: number
  x: number
  y: number
  ph: number
  glow: number
  size: number
  tend: Tendril[]
}

interface Signal {
  from: number
  to: number
  k: number
  sp: number
  life: number
}

function buildCortex(): Neuron[] {
  const r = seeded(3)
  const nodes: Neuron[] = []
  for (let i = 0; i < 170; i++) {
    // Two hemispheres either side of a fissure.
    const side = r() < 0.5 ? -1 : 1
    const a = r() * Math.PI * 2, d = Math.sqrt(r())
    let x = side * 0.12 + Math.cos(a) * d * 0.15
    const y = Math.sin(a) * d * 0.27
    if (Math.abs(x) < 0.012) x += side * 0.02
    const z = 0.45 + r() * 0.55
    nodes.push({
      hx: x, hy: y, z, x: 0, y: 0, ph: r() * 10, glow: 0,
      size: (1.2 + r() * 2.2) * z,
      tend: Array.from({ length: 2 + Math.floor(r() * 3) }, () => ({ a: r() * Math.PI * 2, l: (8 + r() * 22) * z }))
    })
  }
  return nodes
}

export function LockBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const accent = token('--nx-accent', '#69b48a')
    const bg = token('--nx-bg', '#0f110f')
    const A = (a: number): string => rgba(accent, a)
    const N = buildCortex()
    const signals: Signal[] = []
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let w = 0
    let h = 0
    const resize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    let lastSpawn = 0
    let edgeCount = 0

    const drawMesh = (t: number): void => {
      // Sits a little above centre, clear of the password strip.
      const cx = w * 0.5, cy = h * 0.44
      const R = Math.min(w, h) * 0.085
      const slow = t * 0.00004
      for (const p of N) {
        const flow = 16 * p.z
        const sway = Math.sin(t * 0.00012) * 14 * (p.z - 0.7)
        p.x = cx + p.hx * w + noise(p.hx * 3 + slow, p.ph) * flow + sway
        p.y = cy + p.hy * h + noise(p.ph, p.hy * 3 + slow) * flow
        p.glow *= 0.965
      }
      const edges: [number, number, number][] = []
      for (let i = 0; i < N.length; i++)
        for (let j = i + 1; j < N.length; j++) {
          const d = Math.hypot(N[i].x - N[j].x, N[i].y - N[j].y)
          if (d < R) edges.push([i, j, d])
        }
      edgeCount = edges.length
      const adj: number[][] = N.map(() => [])
      for (const [i, j] of edges) {
        adj[i].push(j)
        adj[j].push(i)
      }
      if (t - lastSpawn > 240) {
        lastSpawn = t
        const from = Math.floor(Math.random() * N.length)
        if (adj[from].length) signals.push({ from, to: adj[from][Math.floor(Math.random() * adj[from].length)], k: 0, sp: 0.014, life: 9 })
      }
      // Links bow on noise, so nothing is ruled straight.
      const curve = (a: Neuron, b: Neuron, i: number): [number, number] => {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y
        const bow = 0.22 * noise(i * 0.37, t * 0.00018)
        return [mx - dy * bow, my + dx * bow]
      }
      ctx.lineWidth = 1
      edges.forEach(([i, j, d], k) => {
        const a = N[i], b = N[j]
        ctx.strokeStyle = A(((1 - d / R) * 0.12 + Math.max(a.glow, b.glow) * 0.3) * Math.min(a.z, b.z))
        const [qx, qy] = curve(a, b, k)
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.quadraticCurveTo(qx, qy, b.x, b.y)
        ctx.stroke()
      })
      for (let s = signals.length - 1; s >= 0; s--) {
        const sg = signals[s]
        sg.k += sg.sp
        const a = N[sg.from], b = N[sg.to]
        if (sg.k >= 1) {
          signals.splice(s, 1)
          b.glow = 1
          const next = adj[sg.to].filter((x) => x !== sg.from)
          if (next.length && sg.life > 0) signals.push({ from: sg.to, to: next[Math.floor(Math.random() * next.length)], k: 0, sp: sg.sp, life: sg.life - 1 })
          continue
        }
        const [qx, qy] = curve(a, b, 0)
        const u = sg.k
        const x = (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * qx + u * u * b.x
        const y = (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * qy + u * u * b.y
        const halo = ctx.createRadialGradient(x, y, 0, x, y, 10)
        halo.addColorStop(0, A(0.7 * Math.min(a.z, b.z)))
        halo.addColorStop(1, A(0))
        ctx.fillStyle = halo
        ctx.fillRect(x - 10, y - 10, 20, 20)
      }
      for (const p of N) {
        // Dendrites: short curled branches that sway.
        ctx.strokeStyle = A((0.08 + p.glow * 0.3) * p.z)
        ctx.beginPath()
        for (const td of p.tend) {
          const a = td.a + noise(p.ph, t * 0.00025 + td.a) * 0.8
          ctx.moveTo(p.x, p.y)
          ctx.quadraticCurveTo(p.x + Math.cos(a + 0.6) * td.l * 0.5, p.y + Math.sin(a + 0.6) * td.l * 0.5, p.x + Math.cos(a) * td.l, p.y + Math.sin(a) * td.l)
        }
        ctx.stroke()
        if (p.glow > 0.05) {
          const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 16 * p.z)
          halo.addColorStop(0, A(0.4 * p.glow * p.z))
          halo.addColorStop(1, A(0))
          ctx.fillStyle = halo
          ctx.fillRect(p.x - 16, p.y - 16, 32, 32)
        }
        ctx.fillStyle = A((0.45 + p.glow * 0.55) * p.z)
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const drawHud = (t: number): void => {
      const inset = 24, arm = 26
      ctx.strokeStyle = A(0.45)
      ctx.lineWidth = 1
      ctx.beginPath()
      for (const [cx, cy, sx, sy] of [
        [inset, inset, 1, 1],
        [w - inset, inset, -1, 1],
        [inset, h - inset, 1, -1],
        [w - inset, h - inset, -1, -1]
      ]) {
        ctx.moveTo(cx + 0.5, cy + sy * arm)
        ctx.lineTo(cx + 0.5, cy + 0.5)
        ctx.lineTo(cx + sx * arm, cy + 0.5)
      }
      ctx.stroke()
      const now = new Date(), status = 'NEXUS // VAULT SEALED'
      ctx.font = '11px "IBM Plex Mono", monospace'
      ctx.fillStyle = A(0.6)
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      ctx.fillText(status, inset + 12, inset + 10)
      if (Math.floor(t / 600) % 2 === 0) ctx.fillRect(inset + 18 + ctx.measureText(status).width, inset + 10, 6, 11)
      ctx.textAlign = 'right'
      ctx.fillText(`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`, w - inset - 12, inset + 10)
      ctx.textBaseline = 'bottom'
      ctx.fillText(
        now.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase(),
        w - inset - 12,
        h - inset - 10
      )
      ctx.textAlign = 'left'
      ctx.fillStyle = A(0.4)
      ctx.fillText(`CORTEX · NODES ${N.length} · SYNAPSES ${edgeCount} · SIGNALS ${pad(signals.length)}`, inset + 12, h - inset - 10)
    }

    const draw = (t: number): void => {
      ctx.fillStyle = rgba(bg, 1)
      ctx.fillRect(0, 0, w, h)
      drawMesh(t)
      // Darken the edges, so the eye settles on the middle.
      const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75)
      v.addColorStop(0, rgba(bg, 0))
      v.addColorStop(1, rgba(bg, 0.65))
      ctx.fillStyle = v
      ctx.fillRect(0, 0, w, h)
      drawHud(t)
    }

    if (still) {
      for (let i = 0; i < 120; i++) drawMesh(i * FRAME_MS * 4)
      draw(0)
      return () => window.removeEventListener('resize', resize)
    }

    let raf = 0
    let last = 0
    const start = performance.now()
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop)
      if (document.hidden || now - last < FRAME_MS) return
      last = now
      draw(now - start)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={ref} className="nx-applock__backdrop" aria-hidden="true" />
}
