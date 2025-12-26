import React, { useRef, useEffect } from 'react';
import { useWindowSize } from 'react-use';

// --- Types ---
interface Point { x: number; y: number; }
interface Snake {
  id: string;
  body: Point[];
  angle: number;
  color: string;
  name: string;
  isBot: boolean;
  score: number;
  width: number;
  speed: number;
  boosting: boolean;
  boostEnergy?: number;
}
interface Food {
  id: string;
  x: number;
  y: number;
  color: string;
  size: number;
  value: number;
  isLoot: boolean;
}

// --- Constants ---
const WORLD_SIZE = 4000;
const INITIAL_SNAKE_LENGTH = 20;
const BASE_SPEED = 6.5;
const BOOST_SPEED = 13.5;
const TURN_SPEED = 0.14;
const INTERPOLATION_MS = 40;
const COLORS = ['#22c55e', '#a855f7', '#06b6d4', '#f43f5e', '#eab308'];

let sharedSocket: WebSocket | null = null;
let sharedUsers = 0;
let sharedPlayerId: string | null = null;

export function GameEngine({ 
  playerName, 
  onGameOver,
  onScoreUpdate,
  onServerReject 
}: { 
  playerName: string; 
  onGameOver: (score: number) => void; 
  onScoreUpdate: (score: number) => void;
  onServerReject?: (message: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { width, height } = useWindowSize();
  const socketRef = useRef<WebSocket | null>(null);
  const playerIdRef = useRef(`p-${Math.random().toString(36).slice(2)}`);
  const playerColorRef = useRef(COLORS[Math.floor(Math.random() * COLORS.length)]);
  const lastInputAt = useRef(0);
  const lastScoreRef = useRef(0);
  const snapshotQueueRef = useRef<any[]>([]);
  const serverOffsetRef = useRef<number | null>(null);
  const onGameOverRef = useRef(onGameOver);
  const onScoreUpdateRef = useRef(onScoreUpdate);
  const onServerRejectRef = useRef(onServerReject);

  // Game State Refs
  const gameState = useRef({
    players: new Map<string, Snake>(),
    food: [] as Food[],
    camera: { x: 0, y: 0 },
    mouse: { x: 0, y: 0 },
    boosting: false,
    gameOver: false
  });

  const isTestMode = sessionStorage.getItem("slither_is_test") === "true";
  const userId = sessionStorage.getItem("slither_user_id");
  const walletAddress = sessionStorage.getItem("slither_wallet");
  const stakeLamports = Number(sessionStorage.getItem("slither_stake") || "0");
  const accessKey = localStorage.getItem("slither_access_key") || "";
  const joinToken = sessionStorage.getItem("slither_join_token") || "";

  useEffect(() => {
    onGameOverRef.current = onGameOver;
    onScoreUpdateRef.current = onScoreUpdate;
    onServerRejectRef.current = onServerReject;
  }, [onGameOver, onScoreUpdate, onServerReject]);

  function createSnake(id: string, name: string, isBot: boolean, x: number, y: number, color?: string): Snake {
    const body: Point[] = [];
    for(let i=0; i<INITIAL_SNAKE_LENGTH; i++) {
      body.push({ x: x - i * 5, y: y });
    }
    return {
      id,
      name,
      body,
      angle: Math.random() * Math.PI * 2,
      color: color || (isBot ? COLORS[Math.floor(Math.random() * COLORS.length)] : '#a855f7'),
      isBot,
      score: 0,
      width: 20,
      speed: BASE_SPEED,
      boosting: false
    };
  }


  // WebSocket Setup
  useEffect(() => {
    const joinedName = sessionStorage.getItem("slither_username") || playerName;
    const joinedIsTest = sessionStorage.getItem("slither_is_test") === "true";
    const joinedUserId = sessionStorage.getItem("slither_user_id");
    const joinedWallet = sessionStorage.getItem("slither_wallet") || "";
    const joinedStake = Number(sessionStorage.getItem("slither_stake") || "0");

    if (!sharedSocket || sharedSocket.readyState === WebSocket.CLOSED) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      sharedSocket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      sharedPlayerId = null;
    }
    sharedUsers += 1;
    const socket = sharedSocket;
    socketRef.current = socket;

    const sendJoin = () => {
      if (sharedPlayerId === playerIdRef.current) return;
      socket.send(JSON.stringify({
        type: 'join',
        payload: {
          id: playerIdRef.current,
          name: joinedName,
          color: playerColorRef.current,
          mode: joinedIsTest ? "test" : "pvp",
          isTestMode: joinedIsTest,
          userId: joinedUserId ? Number(joinedUserId) : 0,
          walletAddress: joinedWallet,
          stakeLamports: joinedStake,
          accessKey,
          joinToken
        }
      }));
      sharedPlayerId = playerIdRef.current;
    };

    if (socket.readyState === WebSocket.OPEN) {
      sendJoin();
    } else {
      socket.addEventListener("open", sendJoin, { once: true });
    }

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "snapshot") {
        const receivedAt = Date.now();
        const serverTs = Number(msg.payload?.ts) || receivedAt;
        const sampleOffset = serverTs - receivedAt;
        serverOffsetRef.current = serverOffsetRef.current === null
          ? sampleOffset
          : serverOffsetRef.current * 0.9 + sampleOffset * 0.1;
        snapshotQueueRef.current.push({
          serverTs,
          players: msg.payload.players,
          food: msg.payload.food,
        });
        if (snapshotQueueRef.current.length > 10) {
          snapshotQueueRef.current.shift();
        }

        // Update scores from latest snapshot.
        const me = msg.payload.players.find((p: any) => p.id === playerIdRef.current);
        if (me && me.score !== lastScoreRef.current) {
          lastScoreRef.current = me.score;
          onScoreUpdateRef.current(me.score);
        }
      } else if (msg.type === "dead") {
        const player = gameState.current.players.get(playerIdRef.current);
        const score = player ? player.score : 0;
        gameState.current.gameOver = true;
        onGameOverRef.current(score);
      } else if (msg.type === "full" || msg.type === "reject") {
        if (onServerRejectRef.current) {
          onServerRejectRef.current(msg.payload?.message || "Unable to join world");
        }
        socket.close();
      }
    };

    return () => {
      sharedUsers -= 1;
      if (sharedUsers <= 0) {
        sharedPlayerId = null;
        if (sharedSocket && sharedSocket.readyState === WebSocket.OPEN) {
          sharedSocket.close();
        }
        sharedSocket = null;
      }
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const render = () => {
      if (gameState.current.gameOver) return;

      const now = Date.now();
      const offset = serverOffsetRef.current ?? 0;
      const renderTime = now + offset - INTERPOLATION_MS;
      const existingPlayers = gameState.current.players;

      // Build interpolated snapshot using buffered server updates.
      const queue = snapshotQueueRef.current;
      while (queue.length > 2 && queue[1].serverTs <= renderTime) {
        queue.shift();
      }

      if (queue.length >= 1) {
        const from = queue[0];
        const to = queue.length > 1 ? queue[1] : queue[0];
        const span = Math.max(1, to.serverTs - from.serverTs);
        const alpha = Math.min(1, Math.max(0, (renderTime - from.serverTs) / span));

        const nextPlayers = new Map<string, Snake>();
        const toById = new Map<string, any>();
        to.players.forEach((tp: any) => {
          toById.set(tp.id, tp);
        });
        const fromById = new Map<string, any>();
        from.players.forEach((fp: any) => {
          fromById.set(fp.id, fp);
        });
        const allIds = new Set<string>([...fromById.keys(), ...toById.keys()]);
        allIds.forEach((id) => {
          const p = fromById.get(id) || toById.get(id);
          const match = toById.get(id) || p;
          const existing = existingPlayers.get(p.id);
          const snake = existing || createSnake(p.id, p.name, false, 0, 0, p.color);
          snake.name = match.name;
          snake.color = match.color;
          snake.score = match.score;
          snake.boostEnergy = match.boostEnergy ?? snake.boostEnergy ?? 100;

          const maxLen = Math.max(p.segments.length, match.segments.length);
          const interpolated: Point[] = [];
          for (let i = 0; i < maxLen; i += 1) {
            const a = p.segments[i] || p.segments[p.segments.length - 1];
            const b = match.segments[i] || match.segments[match.segments.length - 1];
            if (!a || !b) continue;
            interpolated.push({
              x: a.x + (b.x - a.x) * alpha,
              y: a.y + (b.y - a.y) * alpha,
            });
          }
          snake.body = interpolated;
          if (snake.body.length > 1) {
            const head = snake.body[0];
            const neck = snake.body[1];
            snake.angle = Math.atan2(head.y - neck.y, head.x - neck.x);
          }
          nextPlayers.set(p.id, snake);
        });

        gameState.current.players = nextPlayers;
        gameState.current.food = to.food;
      }

      const players = gameState.current.players;
      const food = gameState.current.food;
      const camera = gameState.current.camera;
      const player = players.get(playerIdRef.current);
      if (player && player.body.length > 0) {
        const head = player.body[0];
        camera.x = head.x - width / 2;
        camera.y = head.y - height / 2;
      }

      // Draw
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.translate(-camera.x, -camera.y);

      // Grid
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.1)';
      ctx.lineWidth = 1;
      for(let x = Math.floor(camera.x/100)*100; x < camera.x+width; x+=100) {
        ctx.beginPath(); ctx.moveTo(x, camera.y); ctx.lineTo(x, camera.y+height); ctx.stroke();
      }
      for(let y = Math.floor(camera.y/100)*100; y < camera.y+height; y+=100) {
        ctx.beginPath(); ctx.moveTo(camera.x, y); ctx.lineTo(camera.x+width, y); ctx.stroke();
      }

      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 5;
      ctx.strokeRect(0, 0, WORLD_SIZE, WORLD_SIZE);

      food.forEach(f => {
        if(f.x > camera.x && f.x < camera.x + width && f.y > camera.y && f.y < camera.y + height) {
          ctx.beginPath(); ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
          ctx.fillStyle = f.color; ctx.shadowColor = f.color; ctx.shadowBlur = 10; ctx.fill(); ctx.shadowBlur = 0;
        }
      });

      players.forEach((s) => {
        drawSnake(ctx, s, s.id === playerIdRef.current);
      });

      ctx.restore();
      const me = players.get(playerIdRef.current);
      if (me && typeof me.boostEnergy === "number") {
        const gaugeWidth = 200;
        const gaugeHeight = 10;
        const gaugeX = width / 2 - gaugeWidth / 2;
        const gaugeY = height - 36;
        const pct = Math.max(0, Math.min(100, me.boostEnergy)) / 100;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(gaugeX, gaugeY, gaugeWidth, gaugeHeight);

        ctx.fillStyle = me.boostEnergy > 20 ? '#00ffff' : '#ff3333';
        ctx.fillRect(gaugeX, gaugeY, gaugeWidth * pct, gaugeHeight);

        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.strokeRect(gaugeX, gaugeY, gaugeWidth, gaugeHeight);
      }
      animationFrameId = requestAnimationFrame(render);
    };

    function drawSnake(ctx: CanvasRenderingContext2D, snake: Snake, isPlayer = false) {
      if (snake.body.length === 0) return;
      const head = snake.body[0];

      // Draw shadow/glow
      ctx.shadowBlur = isPlayer ? 15 : 5;
      ctx.shadowColor = snake.color;

      // Draw segments from tail to head for proper overlapping
      for (let i = snake.body.length - 1; i >= 0; i--) {
        const segment = snake.body[i];

        // Calculate size: head is slightly larger, tapering towards tail
        const baseSize = snake.width / 2;
        const size = baseSize * (0.8 + (1 - i / snake.body.length) * 0.4);

        ctx.beginPath();

        if (i === 0) {
          // Head
          ctx.fillStyle = snake.color;
          ctx.arc(segment.x, segment.y, size * 1.2, 0, Math.PI * 2);
          ctx.fill();

          // Eyes
          const angle = snake.angle || 0;
          const eyeOffset = size * 0.7;
          const eyeSize = size * 0.35;

          ctx.fillStyle = 'white';
          // Left eye
          ctx.beginPath();
          ctx.arc(
            segment.x + Math.cos(angle - 0.5) * eyeOffset,
            segment.y + Math.sin(angle - 0.5) * eyeOffset,
            eyeSize, 0, Math.PI * 2
          );
          ctx.fill();
          // Right eye
          ctx.beginPath();
          ctx.arc(
            segment.x + Math.cos(angle + 0.5) * eyeOffset,
            segment.y + Math.sin(angle + 0.5) * eyeOffset,
            eyeSize, 0, Math.PI * 2
          );
          ctx.fill();

          // Pupils
          ctx.fillStyle = 'black';
          ctx.beginPath();
          ctx.arc(
            segment.x + Math.cos(angle - 0.5) * (eyeOffset + 1),
            segment.y + Math.sin(angle - 0.5) * (eyeOffset + 1),
            eyeSize * 0.5, 0, Math.PI * 2
          );
          ctx.fill();
          ctx.beginPath();
          ctx.arc(
            segment.x + Math.cos(angle + 0.5) * (eyeOffset + 1),
            segment.y + Math.sin(angle + 0.5) * (eyeOffset + 1),
            eyeSize * 0.5, 0, Math.PI * 2
          );
          ctx.fill();
        } else {
          // Body segments with gradient/pattern
          const gradient = ctx.createRadialGradient(
            segment.x, segment.y, 0,
            segment.x, segment.y, size
          );

          gradient.addColorStop(0, snake.color);
          gradient.addColorStop(1, 'rgba(0,0,0,0.3)');

          ctx.fillStyle = gradient;
          ctx.arc(segment.x, segment.y, size, 0, Math.PI * 2);
          ctx.fill();

          // Decorative shine
          if (i % 3 === 0) {
            ctx.beginPath();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.arc(segment.x - size * 0.3, segment.y - size * 0.3, size * 0.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      ctx.shadowBlur = 0;

      // Draw Name
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px Exo 2';
      ctx.textAlign = 'center';
      ctx.fillText(snake.name, head.x, head.y - 25);
    }

    render();
    return () => cancelAnimationFrame(animationFrameId);
  }, [width, height, onGameOver, onScoreUpdate]);

  useEffect(() => {
    const sendInput = () => {
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
      const now = performance.now();
      if (now - lastInputAt.current < 50) return;
      lastInputAt.current = now;
      const { mouse, boosting } = gameState.current;
      const angle = Math.atan2(mouse.y - height / 2, mouse.x - width / 2);
      socketRef.current.send(JSON.stringify({
        type: "input",
        payload: { angle, boosting }
      }));
    };

    const handleMouseMove = (e: MouseEvent) => {
      gameState.current.mouse = { x: e.clientX, y: e.clientY };
      sendInput();
    };
    const handleMouseDown = () => {
      gameState.current.boosting = true;
      sendInput();
    };
    const handleMouseUp = () => {
      gameState.current.boosting = false;
      sendInput();
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [height, width]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
      const { mouse, boosting } = gameState.current;
      const angle = Math.atan2(mouse.y - height / 2, mouse.x - width / 2);
      socketRef.current.send(JSON.stringify({
        type: "input",
        payload: { angle, boosting }
      }));
    }, 20);

    return () => window.clearInterval(intervalId);
  }, [height, width]);

  return <canvas ref={canvasRef} width={width} height={height} className="fixed inset-0 cursor-crosshair" />;
}
