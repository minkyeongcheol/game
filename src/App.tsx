
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import './App.css'
import './App.mobile.css'

type AgentKind = 'human' | 'zombie'

type Agent = {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  kind: AgentKind
  hp: number
  infectedAt: number
  panic: number
  wander: number
  orderX?: number
  orderY?: number
}

type Building = {
  x: number
  y: number
  w: number
  h: number
  type: 'house' | 'shop' | 'hospital' | 'police' | 'office' | 'park'
  name: string
}

type Upgrade = {
  id: string
  name: string
  description: string
  cost: number
  level: number
  max: number
  icon: string
}

type SelectionBox = {
  x: number
  y: number
  w: number
  h: number
}

const WORLD_W = 2200
const WORLD_H = 1600
const TILE = 40

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v))

const rand = (min: number, max: number) =>
  min + Math.random() * (max - min)

function createCity(): Building[] {
  const result: Building[] = []
  const types: Building['type'][] = [
    'house', 'house', 'shop', 'office', 'house', 'park',
  ]

  let index = 0

  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 9; col++) {
      const x = 105 + col * 225
      const y = 95 + row * 205

      if (
        (col === 4 && row !== 3) ||
        (row === 3 && col > 1 && col < 7)
      ) continue

      let type = types[(row * 7 + col * 3) % types.length]

      if (col === 1 && row === 1) type = 'hospital'
      if (col === 7 && row === 4) type = 'police'
      if (col === 2 && row === 5) type = 'shop'
      if (col === 5 && row === 1) type = 'park'

      const w = type === 'park' ? 142 : rand(105, 145)
      const h = type === 'park' ? 118 : rand(82, 122)

      result.push({
        x, y, w, h, type,
        name: `${type}-${index++}`,
      })
    }
  }

  return result
}

function createAgents(): Agent[] {
  return Array.from({ length: 112 }, (_, i) => {
    const x = rand(80, WORLD_W - 80)
    const y = rand(80, WORLD_H - 80)
    const isZombie = i < 5
    const angle = rand(0, Math.PI * 2)
    const speed = isZombie ? 22 : 30

    return {
      id: i,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      kind: isZombie ? 'zombie' : 'human',
      hp: 100,
      infectedAt: 0,
      panic: 0,
      wander: rand(0.3, 2.5),
    }
  })
}

const initialUpgrades: Upgrade[] = [
  {
    id: 'spread',
    name: '전염력 강화',
    description: '감염 전파 범위와 전환 속도 증가',
    cost: 25,
    level: 0,
    max: 5,
    icon: '✳',
  },
  {
    id: 'speed',
    name: '이동 속도',
    description: '좀비 군단의 이동 속도 증가',
    cost: 35,
    level: 0,
    max: 5,
    icon: '➤',
  },
  {
    id: 'resist',
    name: '변이 내성',
    description: '인간의 저항에 더 오래 버팀',
    cost: 50,
    level: 0,
    max: 5,
    icon: '⬡',
  },
]

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const gameRef = useRef({
    agents: createAgents(),
    buildings: createCity(),
    time: 0,
    running: true,
    speed: 1,
    cameraX: 0,
    cameraY: 0,
    zoom: 0.72,
    dragging: false,
    lastX: 0,
    lastY: 0,
    nextId: 112,
    points: 45,
    totalPopulation: 500,
    infectionPower: 1,
    zombieSpeed: 1,
    resistance: 1,
    selectedZone: '전체 도시',
    lastSpawn: 0,

    selectedIds: [] as number[],
    selectionBox: null as SelectionBox | null,
    pointerStart: null as { x: number; y: number } | null,
    pointerMoved: false,
    touchPoints: {} as Record<number, { x: number; y: number }>,
    pinching: false,
    pinchStartDistance: 0,
    pinchStartZoom: 0,
    pinchWorldX: 0,
    pinchWorldY: 0,
    touchCameraX: 0,
    touchCameraY: 0,
    commandX: null as number | null,
    commandY: null as number | null,
  })

  const [stats, setStats] = useState({
    zombies: 5,
    survivors: 495,
    infected: 1,
    points: 45,
    day: 1,
  })

  const [running, setRunning] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [activeTab, setActiveTab] = useState<
    'overview' | 'evolution' | 'zones'
  >('overview')
  const [upgrades, setUpgrades] = useState(initialUpgrades)
  const [notice, setNotice] = useState(
    '첫 감염자가 발견되었습니다. 도시를 감염시키세요.',
  )
  const [showIntro, setShowIntro] = useState(true)
  const [selectedCount, setSelectedCount] = useState(0)

  const buyUpgrade = useCallback((id: string) => {
    const game = gameRef.current
    const upgrade = upgrades.find(item => item.id === id)

    if (
      !upgrade ||
      upgrade.level >= upgrade.max ||
      game.points < upgrade.cost
    ) return

    game.points -= upgrade.cost

    if (id === 'spread') game.infectionPower += 0.35
    if (id === 'speed') game.zombieSpeed += 0.18
    if (id === 'resist') game.resistance += 0.2

    setUpgrades(current =>
      current.map(item =>
        item.id === id
          ? {
              ...item,
              level: item.level + 1,
              cost: Math.round(item.cost * 1.55),
            }
          : item,
      ),
    )

    setNotice(`${upgrade.name} 연구 완료. 바이러스가 진화했습니다.`)
    setStats(current => ({ ...current, points: game.points }))
  }, [upgrades])

  const toggleRunning = () => {
    gameRef.current.running = !gameRef.current.running
    setRunning(gameRef.current.running)
  }

  const changeSpeed = (value: number) => {
    gameRef.current.speed = value
    setSpeed(value)
  }

  // 화면 좌표를 캔버스 내부 좌표로 변환
  const getCanvasPoint = (
    event: ReactPointerEvent<HTMLCanvasElement> |
      ReactWheelEvent<HTMLCanvasElement>,
  ) => {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()

    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  // 화면 좌표를 실제 도시 좌표로 변환
  const screenToWorld = (x: number, y: number) => {
    const game = gameRef.current

    return {
      x: x / game.zoom + game.cameraX,
      y: y / game.zoom + game.cameraY,
    }
  }

  // 좀비 선택 상태 갱신
  const updateSelection = (ids: number[]) => {
    const game = gameRef.current
    const validIds = ids.filter(id =>
      game.agents.some(a => a.id === id && a.kind === 'zombie'),
    )

    game.selectedIds = [...new Set(validIds)]
    setSelectedCount(game.selectedIds.length)
  }

  // 선택한 좀비에게 이동 명령
  const issueMoveCommand = (screenX: number, screenY: number) => {
    const game = gameRef.current

    if (game.selectedIds.length === 0) {
      setNotice('먼저 이동시킬 좀비를 선택하세요.')
      return
    }

    const world = screenToWorld(screenX, screenY)

    const x = clamp(world.x, 20, WORLD_W - 20)
    const y = clamp(world.y, 20, WORLD_H - 20)

    game.commandX = x
    game.commandY = y

    for (const agent of game.agents) {
      if (
        agent.kind === 'zombie' &&
        game.selectedIds.includes(agent.id)
      ) {
        agent.orderX = x + rand(-24, 24)
        agent.orderY = y + rand(-24, 24)
      }
    }

    setNotice(
      `${game.selectedIds.length}마리의 좀비에게 이동 명령을 내렸습니다.`,
    )
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')

    if (!canvas || !ctx) return

    let raf = 0
    let last = performance.now()
    let statTimer = 0

    const drawBuilding = (b: Building) => {
      const g = ctx

      if (b.type === 'park') {
        g.fillStyle = '#294b3c'
        g.fillRect(b.x, b.y, b.w, b.h)

        g.fillStyle = '#37634b'

        for (let i = 0; i < 9; i++) {
          const tx = b.x + 15 + (i % 3) * 39
          const ty = b.y + 16 + Math.floor(i / 3) * 30

          g.fillRect(tx, ty, 15, 15)
          g.fillStyle = '#477b57'
          g.fillRect(tx + 3, ty + 3, 9, 9)
          g.fillStyle = '#37634b'
        }

        g.fillStyle = '#b3a77c'
        g.fillRect(b.x + b.w / 2 - 4, b.y, 8, b.h)
        return
      }

      const palette: Record<
        Exclude<Building['type'], 'park'>,
        [string, string, string]
      > = {
        house: ['#697b78', '#9aaba0', '#465b59'],
        shop: ['#78634f', '#c3a47a', '#51483e'],
        hospital: ['#7c8887', '#c8d2cb', '#4d6261'],
        police: ['#566b7c', '#8ea3b3', '#394c5e'],
        office: ['#596b70', '#879b9d', '#394a50'],
      }

      const [wall, roof, shadow] = palette[b.type]

      g.fillStyle = 'rgba(0,0,0,.24)'
      g.fillRect(b.x + 7, b.y + 8, b.w, b.h)

      g.fillStyle = shadow
      g.fillRect(b.x, b.y, b.w, b.h)

      g.fillStyle = wall
      g.fillRect(b.x + 5, b.y + 5, b.w - 10, b.h - 10)

      g.fillStyle = roof
      g.fillRect(b.x + 10, b.y + 10, b.w - 20, 12)

      g.fillStyle = 'rgba(20,31,32,.55)'

      for (let x = b.x + 18; x < b.x + b.w - 12; x += 27) {
        for (let y = b.y + 34; y < b.y + b.h - 12; y += 25) {
          g.fillRect(x, y, 11, 12)
        }
      }

      if (
        b.type === 'hospital' ||
        b.type === 'police' ||
        b.type === 'shop'
      ) {
        g.fillStyle =
          b.type === 'hospital'
            ? '#e7eee5'
            : b.type === 'police'
              ? '#b8d5e4'
              : '#f1d4a4'

        g.fillRect(b.x + b.w / 2 - 10, b.y + 13, 20, 8)

        if (b.type === 'hospital') {
          g.fillStyle = '#d95c5c'
          g.fillRect(b.x + b.w / 2 - 2, b.y + 8, 4, 18)
          g.fillRect(b.x + b.w / 2 - 9, b.y + 15, 18, 4)
        } else {
          g.fillStyle = '#26383b'
          g.font = 'bold 9px monospace'
          g.textAlign = 'center'
          g.fillText(
            b.type === 'police' ? 'POLICE' : 'MART',
            b.x + b.w / 2,
            b.y + 20,
          )
        }
      }
    }

    const draw = (now: number) => {
      const game = gameRef.current
      const dt = Math.min((now - last) / 1000, 0.05) * game.speed

      last = now

      if (game.running) {
        game.time += dt

        const spreadLevel = game.infectionPower
        const moveFactor = game.zombieSpeed
        const agents = game.agents

        for (const a of agents) {
          a.wander -= dt

          if (a.kind === 'human') {
            const nearest = agents.reduce<Agent | null>((best, other) => {
              if (other.kind !== 'zombie') return best

              const d = Math.hypot(other.x - a.x, other.y - a.y)

              return d < 170 &&
                (!best || d < Math.hypot(best.x - a.x, best.y - a.y))
                ? other
                : best
            }, null)

            if (nearest) {
              const dx = a.x - nearest.x
              const dy = a.y - nearest.y
              const d = Math.max(1, Math.hypot(dx, dy))

              a.vx += (dx / d) * 38 * dt
              a.vy += (dy / d) * 38 * dt
              a.panic = 1
            } else {
              a.panic = Math.max(0, a.panic - dt)

              if (a.wander <= 0) {
                const angle = rand(0, Math.PI * 2)

                a.vx += Math.cos(angle) * 15
                a.vy += Math.sin(angle) * 15
                a.wander = rand(1, 3)
              }
            }
          } else {
            // 직접 이동 명령이 있으면 명령 위치를 우선 추적
            if (a.orderX !== undefined && a.orderY !== undefined) {
              const dx = a.orderX - a.x
              const dy = a.orderY - a.y
              const d = Math.max(1, Math.hypot(dx, dy))

              if (d < 18) {
                delete a.orderX
                delete a.orderY
                a.vx *= 0.5
                a.vy *= 0.5
              } else {
                a.vx += (dx / d) * 45 * moveFactor * dt
                a.vy += (dy / d) * 45 * moveFactor * dt
              }
            } else {
              const target = agents.reduce<Agent | null>((best, other) => {
                if (other.kind !== 'human') return best

                const d = Math.hypot(other.x - a.x, other.y - a.y)

                return d < 260 &&
                  (!best || d < Math.hypot(best.x - a.x, best.y - a.y))
                  ? other
                  : best
              }, null)

              if (target) {
                const dx = target.x - a.x
                const dy = target.y - a.y
                const d = Math.max(1, Math.hypot(dx, dy))

                a.vx += (dx / d) * 27 * moveFactor * dt
                a.vy += (dy / d) * 27 * moveFactor * dt
              }
            }
          }

          const maxSpeed =
            a.kind === 'zombie'
              ? 36 * moveFactor
              : a.panic
                ? 64
                : 26

          const v = Math.hypot(a.vx, a.vy)

          if (v > maxSpeed) {
            a.vx = (a.vx / v) * maxSpeed
            a.vy = (a.vy / v) * maxSpeed
          }

          a.x += a.vx * dt
          a.y += a.vy * dt

          if (a.x < 25 || a.x > WORLD_W - 25) a.vx *= -1
          if (a.y < 25 || a.y > WORLD_H - 25) a.vy *= -1

          a.x = clamp(a.x, 25, WORLD_W - 25)
          a.y = clamp(a.y, 25, WORLD_H - 25)
        }

        // 좀비와 인간이 가까워지면 감염
        for (const z of agents) {
          if (z.kind !== 'zombie') continue

          for (const h of agents) {
            if (h.kind !== 'human') continue

            if (Math.hypot(z.x - h.x, z.y - h.y) < 13 * spreadLevel) {
              h.infectedAt += dt

              if (
                h.infectedAt >
                Math.max(0.55, 1.6 / spreadLevel)
              ) {
                h.kind = 'zombie'
                h.infectedAt = 0
                h.panic = 0
                h.vx *= 0.55
                h.vy *= 0.55
                game.points += 3
              }
            }
          }
        }

        // 도시 인구 유입
        if (
          game.time - game.lastSpawn > 13 &&
          game.agents.length < 230
        ) {
          game.lastSpawn = game.time

          const angle = rand(0, Math.PI * 2)
          const x = clamp(
            WORLD_W / 2 + Math.cos(angle) * rand(300, 750),
            30,
            WORLD_W - 30,
          )
          const y = clamp(
            WORLD_H / 2 + Math.sin(angle) * rand(250, 550),
            30,
            WORLD_H - 30,
          )

          game.agents.push({
            id: game.nextId++,
            x,
            y,
            vx: rand(-20, 20),
            vy: rand(-20, 20),
            kind: 'human',
            hp: 100,
            infectedAt: 0,
            panic: 0,
            wander: 1,
          })
        }
      }

      const w = canvas.width
      const h = canvas.height

      ctx.clearRect(0, 0, w, h)
      ctx.save()

      ctx.scale(game.zoom, game.zoom)
      ctx.translate(-game.cameraX, -game.cameraY)

      ctx.fillStyle = '#263b35'
      ctx.fillRect(0, 0, WORLD_W, WORLD_H)

      // 바닥 텍스처
      for (let y = 0; y < WORLD_H; y += TILE) {
        for (let x = 0; x < WORLD_W; x += TILE) {
          ctx.fillStyle =
            ((x / TILE + y / TILE) % 2 === 0)
              ? '#2b4038'
              : '#2d423a'

          ctx.fillRect(x, y, TILE, TILE)

          if ((x * 7 + y * 3) % 11 === 0) {
            ctx.fillStyle = 'rgba(128,154,117,.10)'
            ctx.fillRect(x + 8, y + 11, 3, 3)
          }
        }
      }

      // 도로
      ctx.fillStyle = '#343c3d'

      for (let x = 0; x < WORLD_W; x += 450) {
        ctx.fillRect(x, 0, 78, WORLD_H)
      }

      for (let y = 0; y < WORLD_H; y += 410) {
        ctx.fillRect(0, y, WORLD_W, 72)
      }

      ctx.fillStyle = '#68716a'

      for (let x = 0; x < WORLD_W; x += 450) {
        for (let y = 0; y < WORLD_H; y += 58) {
          ctx.fillRect(x + 37, y + 10, 3, 22)
        }
      }

      for (let y = 0; y < WORLD_H; y += 410) {
        for (let x = 0; x < WORLD_W; x += 58) {
          ctx.fillRect(x + 10, y + 34, 22, 3)
        }
      }

      // 인도
      ctx.strokeStyle = 'rgba(173,177,148,.16)'
      ctx.lineWidth = 3

      for (let x = 0; x < WORLD_W; x += 450) {
        ctx.strokeRect(x + 4, 4, 70, WORLD_H - 8)
      }

      for (let y = 0; y < WORLD_H; y += 410) {
        ctx.strokeRect(4, y + 4, WORLD_W - 8, 64)
      }

      game.buildings.forEach(drawBuilding)

      // 가로등
      for (let x = 90; x < WORLD_W; x += 225) {
        for (let y = 75; y < WORLD_H; y += 205) {
          ctx.fillStyle = '#202c2b'
          ctx.fillRect(x, y, 4, 4)

          ctx.fillStyle = 'rgba(246,216,137,.55)'
          ctx.fillRect(x - 2, y - 2, 8, 8)
        }
      }

      // 인간과 좀비
      for (const a of game.agents) {
        ctx.fillStyle = 'rgba(0,0,0,.35)'
        ctx.fillRect(a.x - 5, a.y + 5, 12, 5)

        if (a.kind === 'human') {
          ctx.fillStyle = a.panic > 0 ? '#e7c56c' : '#c5d5c8'
          ctx.fillRect(a.x - 4, a.y - 7, 8, 10)

          ctx.fillStyle = '#d9a77d'
          ctx.fillRect(a.x - 3, a.y - 12, 6, 5)

          ctx.fillStyle = '#526a70'
          ctx.fillRect(a.x - 5, a.y + 2, 4, 5)
          ctx.fillRect(a.x + 1, a.y + 2, 4, 5)

          if (a.infectedAt > 0) {
            ctx.fillStyle = '#e65d5d'
            ctx.fillRect(
              a.x - 7,
              a.y - 17,
              14 * Math.min(1, a.infectedAt / 1.6),
              2,
            )
          }
        } else {
          ctx.fillStyle = '#6dba76'
          ctx.fillRect(a.x - 5, a.y - 8, 10, 13)

          ctx.fillStyle = '#a8d17c'
          ctx.fillRect(a.x - 4, a.y - 13, 8, 6)

          ctx.fillStyle = '#273c30'
          ctx.fillRect(a.x - 2, a.y - 10, 2, 2)
          ctx.fillRect(a.x + 2, a.y - 10, 2, 2)

          ctx.fillStyle = '#456d4c'
          ctx.fillRect(a.x - 6, a.y + 4, 5, 4)
          ctx.fillRect(a.x + 1, a.y + 4, 5, 4)

          ctx.fillStyle = 'rgba(112,220,120,.16)'
          ctx.fillRect(a.x - 10, a.y - 17, 20, 2)

          // 선택된 좀비 표시
          if (game.selectedIds.includes(a.id)) {
            ctx.strokeStyle = '#8cff8c'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(a.x, a.y - 2, 13, 0, Math.PI * 2)
            ctx.stroke()

            ctx.fillStyle = '#a4ff9b'
            ctx.fillRect(a.x - 2, a.y - 23, 4, 3)
          }

          // 이동 명령 표시
          if (
            a.orderX !== undefined &&
            a.orderY !== undefined &&
            game.selectedIds.includes(a.id)
          ) {
            ctx.strokeStyle = 'rgba(140,255,140,.35)'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(a.orderX, a.orderY)
            ctx.stroke()
          }
        }
      }

      // 도시 이름
      ctx.font = 'bold 16px monospace'
      ctx.fillStyle = 'rgba(227,232,211,.62)'
      ctx.fillText('OLD TOWN', 110, 55)
      ctx.fillText('RIVERSIDE DISTRICT', 1120, 55)
      ctx.fillText('CENTRAL AVENUE', 930, 820)

      // 이동 목적지 마커
      if (game.commandX !== null && game.commandY !== null) {
        const activeOrders = game.agents.some(
          a =>
            game.selectedIds.includes(a.id) &&
            a.orderX !== undefined,
        )

        if (activeOrders) {
          const pulse = 13 + Math.sin(now / 180) * 3

          ctx.strokeStyle = '#9cff85'
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.arc(game.commandX, game.commandY, pulse, 0, Math.PI * 2)
          ctx.stroke()

          ctx.fillStyle = '#b4ff9c'
          ctx.fillRect(game.commandX - 2, game.commandY - 2, 4, 4)
        }
      }

      ctx.restore()

      // 화면 좌표 기준 드래그 선택 박스
      if (game.selectionBox) {
        const box = game.selectionBox

        ctx.fillStyle = 'rgba(110,255,130,.12)'
        ctx.fillRect(box.x, box.y, box.w, box.h)

        ctx.strokeStyle = '#8cff8c'
        ctx.lineWidth = 1.5
        ctx.setLineDash([6, 4])
        ctx.strokeRect(box.x, box.y, box.w, box.h)
        ctx.setLineDash([])
      }

      statTimer += dt

      if (statTimer > 0.2) {
        statTimer = 0

        const zombies = game.agents.filter(
          a => a.kind === 'zombie',
        ).length

        const survivors = Math.max(
          0,
          game.totalPopulation - zombies,
        )

        const infected = Math.round(
          (zombies / game.totalPopulation) * 100,
        )

        setStats({
          zombies,
          survivors,
          infected,
          points: Math.floor(game.points),
          day: Math.floor(game.time / 45) + 1,
        })
      }

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)

    return () => cancelAnimationFrame(raf)
  }, [])

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault()

    const game = gameRef.current
    const point = getCanvasPoint(event)

    const before = game.zoom
    const next = clamp(
      before * (event.deltaY < 0 ? 1.12 : 0.89),
      0.42,
      1.5,
    )

    game.cameraX += point.x / next - point.x / before
    game.cameraY += point.y / next - point.y / before
    game.zoom = next

    game.cameraX = clamp(
      game.cameraX,
      0,
      WORLD_W - event.currentTarget.width / next,
    )

    game.cameraY = clamp(
      game.cameraY,
      0,
      WORLD_H - event.currentTarget.height / next,
    )
  }
  const onPointerDown = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    if (event.pointerType !== 'touch' && event.button !== 0) return

    const game = gameRef.current
    const point = getCanvasPoint(event)

    event.currentTarget.setPointerCapture(event.pointerId)

    if (event.pointerType === 'touch') {
      game.touchPoints[event.pointerId] = point
      const touches = Object.values(game.touchPoints)

      if (touches.length >= 2) {
        const [a, b] = touches
        const midX = (a.x + b.x) / 2
        const midY = (a.y + b.y) / 2

        game.pinching = true
        game.dragging = false
        game.pointerStart = null
        game.pointerMoved = false
        game.selectionBox = null
        game.pinchStartDistance = Math.hypot(b.x - a.x, b.y - a.y)
        game.pinchStartZoom = game.zoom
        game.pinchWorldX = midX / game.zoom + game.cameraX
        game.pinchWorldY = midY / game.zoom + game.cameraY
        return
      }

      game.touchCameraX = game.cameraX
      game.touchCameraY = game.cameraY
    }

    game.dragging = true
    game.pointerStart = point
    game.pointerMoved = false
    game.lastX = event.clientX
    game.lastY = event.clientY
    game.selectionBox = null
  }

  const onPointerMove = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    const game = gameRef.current
    const point = getCanvasPoint(event)

    if (event.pointerType === 'touch') {
      if (game.touchPoints[event.pointerId]) {
        game.touchPoints[event.pointerId] = point
      }

      const touches = Object.values(game.touchPoints)

      if (game.pinching && touches.length >= 2) {
        const [a, b] = touches
        const distance = Math.hypot(b.x - a.x, b.y - a.y)
        const midX = (a.x + b.x) / 2
        const midY = (a.y + b.y) / 2
        const canvas = event.currentTarget
        const nextZoom = clamp(
          game.pinchStartZoom * (distance / Math.max(1, game.pinchStartDistance)),
          0.42,
          1.5,
        )

        game.zoom = nextZoom
        game.cameraX = clamp(
          game.pinchWorldX - midX / nextZoom,
          0,
          Math.max(0, WORLD_W - canvas.width / nextZoom),
        )
        game.cameraY = clamp(
          game.pinchWorldY - midY / nextZoom,
          0,
          Math.max(0, WORLD_H - canvas.height / nextZoom),
        )
        return
      }

      if (game.dragging && game.pointerStart && touches.length === 1) {
        const dx = point.x - game.pointerStart.x
        const dy = point.y - game.pointerStart.y

        if (Math.hypot(dx, dy) > 6) game.pointerMoved = true

        if (game.pointerMoved) {
          const canvas = event.currentTarget
          game.cameraX = clamp(
            game.touchCameraX - dx / game.zoom,
            0,
            Math.max(0, WORLD_W - canvas.width / game.zoom),
          )
          game.cameraY = clamp(
            game.touchCameraY - dy / game.zoom,
            0,
            Math.max(0, WORLD_H - canvas.height / game.zoom),
          )
        }
        return
      }
    }

    if (!game.dragging || !game.pointerStart) return

    const dx = point.x - game.pointerStart.x
    const dy = point.y - game.pointerStart.y

    if (Math.hypot(dx, dy) > 6) game.pointerMoved = true

    if (game.pointerMoved) {
      game.selectionBox = {
        x: Math.min(game.pointerStart.x, point.x),
        y: Math.min(game.pointerStart.y, point.y),
        w: Math.abs(dx),
        h: Math.abs(dy),
      }
    }

    game.lastX = event.clientX
    game.lastY = event.clientY
  }

  const onPointerUp = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    const game = gameRef.current

    if (event.pointerType === 'touch') {
      delete game.touchPoints[event.pointerId]

      if (game.pinching) {
        if (Object.keys(game.touchPoints).length < 2) {
          game.pinching = false
          game.dragging = false
          game.pointerStart = null
          game.pointerMoved = false
          game.selectionBox = null
        }
        return
      }
    }

    if (!game.dragging) return

    const point = getCanvasPoint(event)
    const start = game.pointerStart

    if (start) {
      if (game.pointerMoved && game.selectionBox && event.pointerType !== 'touch') {
        const box = game.selectionBox
        const topLeft = screenToWorld(box.x, box.y)
        const bottomRight = screenToWorld(box.x + box.w, box.y + box.h)
        const found = game.agents
          .filter(a =>
            a.kind === 'zombie' &&
            a.x >= topLeft.x && a.x <= bottomRight.x &&
            a.y >= topLeft.y && a.y <= bottomRight.y,
          )
          .map(a => a.id)

        updateSelection(
          event.ctrlKey || event.metaKey
            ? [...game.selectedIds, ...found]
            : found,
        )
        setNotice(
          found.length > 0
            ? `${found.length}마리의 좀비를 선택했습니다.`
            : '선택 영역에 좀비가 없습니다.',
        )
      } else if (!game.pointerMoved) {
        const world = screenToWorld(point.x, point.y)
        const nearest = game.agents
          .filter(a => a.kind === 'zombie')
          .map(a => ({
            id: a.id,
            distance: Math.hypot(a.x - world.x, a.y - world.y),
          }))
          .filter(a => a.distance < 24 / game.zoom)
          .sort((a, b) => a.distance - b.distance)[0]

        if (nearest) {
          const next = event.pointerType === 'touch'
            ? [...game.selectedIds, nearest.id]
            : event.ctrlKey || event.metaKey
              ? [...game.selectedIds, nearest.id]
              : [nearest.id]
          updateSelection(next)
          setNotice(`${game.selectedIds.length}마리의 좀비를 선택했습니다.`)
        } else if (event.pointerType === 'touch' && game.selectedIds.length > 0) {
          issueMoveCommand(point.x, point.y)
        } else if (!event.ctrlKey && !event.metaKey) {
          updateSelection([])
        }
      }
    }

    game.dragging = false
    game.pointerStart = null
    game.pointerMoved = false
    game.selectionBox = null
  }

  const handleContextMenu = (
    event: React.MouseEvent<HTMLCanvasElement>,
  ) => {
    event.preventDefault()

    const rect = event.currentTarget.getBoundingClientRect()

    const x =
      (event.clientX - rect.left) *
      (event.currentTarget.width / rect.width)

    const y =
      (event.clientY - rect.top) *
      (event.currentTarget.height / rect.height)

    issueMoveCommand(x, y)
  }

  const progress = useMemo(
    () => Math.min(100, stats.infected),
    [stats.infected],
  )

  return (
    <main className="game-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><span>☣</span></div>
          <div>
            <div className="brand-name">ZOMBIE <b>WORLD</b></div>
            <div className="brand-sub">
              OUTBREAK SIMULATION // BUILD 0.2
            </div>
          </div>
        </div>

        <div className="top-status">
          <span className="live-dot" /> SIMULATION ACTIVE
          <i /> DAY {String(stats.day).padStart(2, '0')}
        </div>

        <button className="icon-button" title="설정">
          <span>⚙</span>
        </button>
      </header>

      <section className="stats-strip">
        <div className="stat-card">
          <span className="stat-icon green">☣</span>
          <div>
            <small>도시 감염률</small>
            <strong>{stats.infected}<em>%</em></strong>
          </div>
          <div className="mini-progress">
            <i style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="stat-card">
          <span className="stat-icon red">♟</span>
          <div>
            <small>감염된 좀비</small>
            <strong>{stats.zombies.toLocaleString()}<em> 명</em></strong>
          </div>
        </div>

        <div className="stat-card">
          <span className="stat-icon blue">♙</span>
          <div>
            <small>생존 시민</small>
            <strong>{stats.survivors.toLocaleString()}<em> 명</em></strong>
          </div>
        </div>

        <div className="stat-card">
          <span className="stat-icon gold">✧</span>
          <div>
            <small>진화 포인트</small>
            <strong>{stats.points.toLocaleString()}<em> EP</em></strong>
          </div>
        </div>
      </section>

      <section className="main-layout">
        <div className="map-panel">
          <div className="map-heading">
            <div>
              <span className="eyebrow">WORLD MAP / SOUTH KOREA</span>
              <h1>그레이우드 <span>GREYWOOD</span></h1>
            </div>

            <div className="map-coords">
              <span className="live-dot" /> LIVE MAP
              <small>SECTOR 01-A</small>
            </div>
          </div>

          <div className="canvas-wrap">
            <canvas
              ref={canvasRef}
              width={1100}
              height={720}
              onWheel={handleWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onContextMenu={handleContextMenu}
            />

            <div className="map-legend">
              <span><i className="legend-human" /> 생존자</span>
              <span><i className="legend-zombie" /> 감염자</span>
              <span><i className="legend-building" /> 건물</span>
              <span><i style={{
                display: 'inline-block',
                width: 9,
                height: 9,
                border: '2px solid #8cff8c',
                borderRadius: '50%',
              }} /> 선택된 좀비</span>
            </div>

            <div className="map-zoom">
              <button onClick={() => {
                gameRef.current.zoom = clamp(
                  gameRef.current.zoom * 1.15, 0.42, 1.5,
                )
              }}>＋</button>

              <button onClick={() => {
                gameRef.current.zoom = clamp(
                  gameRef.current.zoom / 1.15, 0.42, 1.5,
                )
              }}>－</button>

              <button onClick={() => {
                gameRef.current.cameraX = 0
                gameRef.current.cameraY = 0
                gameRef.current.zoom = 0.72
              }}>⌂</button>
            </div>

            <div className="map-north">N<br />▲</div>

            <div style={{
              position: 'absolute',
              left: 12,
              bottom: 12,
              padding: '7px 11px',
              background: 'rgba(8,18,14,.85)',
              border: '1px solid rgba(140,255,140,.25)',
              borderRadius: 5,
              color: '#b7d9bb',
              fontSize: 11,
              pointerEvents: 'none',
            }} className="mobile-map-help">
              선택된 좀비: <b style={{ color: '#9cff85' }}>
                {selectedCount}
              </b>
              {' '}마리
              {'  ·  '}좌클릭 선택
              {'  ·  '}드래그 다중 선택
              {'  ·  '}우클릭 이동 명령
            </div>
          </div>

          <div className="map-footer">
            <span><i className="live-dot" /> 실시간 시뮬레이션</span>
            <span className="desktop-help">드래그: 선택 / 지도 이동&nbsp; · &nbsp;휠: 확대 / 축소</span>
            <span className="mobile-help">한 손가락: 지도 이동 · 좀비 터치: 선택 · 두 손가락: 확대/축소</span>
            <span>GREYWOOD CITY <b>2.4 km²</b></span>
          </div>
        </div>

        <aside className="control-panel">
          <div className="panel-tabs">
            <button
              className={activeTab === 'overview' ? 'active' : ''}
              onClick={() => setActiveTab('overview')}
            >상황판</button>

            <button
              className={activeTab === 'evolution' ? 'active' : ''}
              onClick={() => setActiveTab('evolution')}
            >바이러스 진화</button>

            <button
              className={activeTab === 'zones' ? 'active' : ''}
              onClick={() => setActiveTab('zones')}
            >구역 정보</button>
          </div>

          {activeTab === 'overview' && (
            <div className="tab-content">
              <div className="section-title">
                <span className="section-dot red-dot" />
                OUTBREAK STATUS <b>● LIVE</b>
              </div>

              <div className="alert-box">
                <span className="alert-symbol">!</span>
                <div>
                  <strong>감염 확산 진행 중</strong>
                  <small>{notice}</small>
                </div>
              </div>

              <div className="section-title spaced">
                <span className="section-dot" /> 감염 현황
              </div>

              <div className="infection-meter">
                <div className="meter-label">
                  <span>도시 감염 진행도</span>
                  <b>{stats.infected}%</b>
                </div>

                <div className="meter-track">
                  <i style={{ width: `${progress}%` }} />
                </div>

                <div className="meter-scale">
                  <span>0%</span><span>100%</span>
                </div>
              </div>

              <div className="section-title spaced">
                <span className="section-dot" /> 시뮬레이션 제어
              </div>

              <div className="simulation-controls">
                <button
                  className={`pause-button ${running ? '' : 'paused'}`}
                  onClick={toggleRunning}
                >
                  {running ? 'Ⅱ  일시정지' : '▶  시뮬레이션 재개'}
                </button>

                <div className="speed-control">
                  {[1, 2, 3].map(value => (
                    <button
                      key={value}
                      className={speed === value ? 'selected' : ''}
                      onClick={() => changeSpeed(value)}
                    >
                      {value}x
                    </button>
                  ))}
                </div>
              </div>

              <div className="section-title spaced">
                <span className="section-dot" /> 군단 지휘
              </div>

              <div className="zone-summary">
                <div>
                  <small>선택된 좀비</small>
                  <strong>{selectedCount}마리</strong>
                </div>
                <div>
                  <small>지휘 상태</small>
                  <strong className="status-danger">
                    {selectedCount > 0 ? '명령 대기 가능' : '선택 필요'}
                  </strong>
                </div>
              </div>

              <button
                className="pause-button"
                style={{ width: '100%', marginTop: 10 }}
                disabled={selectedCount === 0}
                onClick={() => {
                  updateSelection([])
                  setNotice('좀비 선택을 모두 해제했습니다.')
                }}
              >
                선택 해제
              </button>

              <div className="section-title spaced">
                <span className="section-dot" /> 도시 정보
              </div>

              <div className="zone-summary">
                <div>
                  <small>현재 감염 구역</small>
                  <strong>그레이우드 전역</strong>
                </div>
                <div>
                  <small>도시 상태</small>
                  <strong className="status-danger">초기 확산 단계</strong>
                </div>
              </div>

              <div className="objective">
                <div className="objective-icon">◎</div>
                <div>
                  <strong>현재 목표</strong>
                  <small>도시 인구의 25%를 감염시키세요.</small>
                  <div className="objective-track">
                    <i style={{
                      width: `${Math.min(100, stats.infected * 4)}%`,
                    }} />
                  </div>
                </div>
                <b>{stats.infected}/25%</b>
              </div>
            </div>
          )}

          {activeTab === 'evolution' && (
            <div className="tab-content">
              <div className="section-title">
                <span className="section-dot green-dot" />
                VIRUS EVOLUTION
              </div>

              <div className="evolution-intro">
                <div className="virus-orb">☣</div>
                <div>
                  <strong>바이러스 연구소</strong>
                  <small>진화 포인트를 사용해 감염 능력을 강화하세요.</small>
                </div>
              </div>

              <div className="ep-balance">
                <span>보유 진화 포인트</span>
                <b>✧ {stats.points} EP</b>
              </div>

              <div className="upgrade-list">
                {upgrades.map(upgrade => (
                  <div className="upgrade-card" key={upgrade.id}>
                    <div className="upgrade-icon">{upgrade.icon}</div>

                    <div className="upgrade-info">
                      <strong>{upgrade.name}</strong>
                      <small>{upgrade.description}</small>

                      <div className="level-row">
                        <span>LEVEL {upgrade.level}/{upgrade.max}</span>
                        <div>
                          {Array.from(
                            { length: upgrade.max },
                            (_, i) => (
                              <i
                                key={i}
                                className={i < upgrade.level ? 'filled' : ''}
                              />
                            ),
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      disabled={
                        upgrade.level >= upgrade.max ||
                        stats.points < upgrade.cost
                      }
                      onClick={() => buyUpgrade(upgrade.id)}
                    >
                      {upgrade.level >= upgrade.max
                        ? 'MAX'
                        : `✧ ${upgrade.cost}`}
                    </button>
                  </div>
                ))}
              </div>

              <div className="research-note">
                연구를 완료하면 해당 효과가 시뮬레이션에 즉시 적용됩니다.
              </div>
            </div>
          )}

          {activeTab === 'zones' && (
            <div className="tab-content">
              <div className="section-title">
                <span className="section-dot" />
                DISTRICT INTELLIGENCE
              </div>

              <div className="zone-card selected-zone">
                <div className="zone-top">
                  <strong>01. 올드타운</strong>
                  <span>현재 구역</span>
                </div>
                <small>주거 밀집 지역 · 감염 확산의 시작점</small>
                <div className="zone-data">
                  <span>인구 1,200명</span>
                  <b>감염 추적 중</b>
                </div>
              </div>

              <div className="zone-card">
                <div className="zone-top">
                  <strong>02. 센트럴 애비뉴</strong>
                  <span className="locked">잠금 해제 예정</span>
                </div>
                <small>상업 및 업무 중심지</small>
                <div className="zone-data">
                  <span>인구 2,800명</span>
                  <b>미확인</b>
                </div>
              </div>

              <div className="zone-card">
                <div className="zone-top">
                  <strong>03. 리버사이드</strong>
                  <span className="locked">잠금 해제 예정</span>
                </div>
                <small>강변 주거 및 공원 지구</small>
                <div className="zone-data">
                  <span>인구 950명</span>
                  <b>미확인</b>
                </div>
              </div>

              <div className="zone-unlock">
                도시 감염률 25% 달성 시 다음 구역의 정보가 공개됩니다.
              </div>
            </div>
          )}

          <div className="panel-bottom">
            <span>☣ BIOHAZARD CONTROL</span>
            <span>v0.2.0 ALPHA</span>
          </div>
        </aside>
      </section>

      <footer className="bottom-bar">
        <div>
          <span className="footer-pulse" />
          GLOBAL OUTBREAK NETWORK <b>CONNECTED</b>
        </div>

        <div>
          GREYWOOD REGION <i /> POPULATION 500 <i />
          THREAT LEVEL: <b className="threat">LOW</b>
        </div>

        <div>© ZOMBIE WORLD PROJECT</div>
      </footer>

      {showIntro && (
        <div className="intro-overlay">
          <div className="intro-card">
            <div className="intro-emblem">☣</div>
            <div className="intro-kicker">
              CLASSIFIED // BIOLOGICAL INCIDENT
            </div>

            <h2>
              인류의 마지막 날이<br />
              <span>시작되었습니다.</span>
            </h2>

            <p>
              그레이우드에서 정체불명의 감염이 보고되었습니다.<br />
              바이러스를 진화시키고, 도시를 감염시키세요.
            </p>

            <button onClick={() => setShowIntro(false)}>
              시뮬레이션 시작 <span>→</span>
            </button>

            <small>FICTIONAL OUTBREAK SIMULATION</small>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
