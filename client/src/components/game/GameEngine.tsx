import React, { useRef, useEffect, useState } from 'react';
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
}
interface Food {
  x: number;
  y: number;
  color: string;
  size: number;
  value: number;
}

// --- Constants ---
const WORLD_SIZE = 4000;
const INITIAL_SNAKE_LENGTH = 20;
const BASE_SPEED = 4;
const BOOST_SPEED = 7;
const TURN_SPEED = 0.08;
const COLORS = ['#22c55e', '#a855f7', '#06b6d4', '#f43f5e', '#eab308'];

export function GameEngine({ 
  playerName, 
  onGameOver,
  onScoreUpdate 
}: { 
  playerName: string; 
  onGameOver: (score: number) => void; 
  onScoreUpdate: (score: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { width, height } = useWindowSize();
  const socketRef = useRef<WebSocket | null>(null);
  
  // Game State Refs
  const gameState = useRef({
    player: createSnake('player', playerName, false, WORLD_SIZE/2, WORLD_SIZE/2),
    otherSnakes: new Map<string, Snake>(),
    food: [] as Food[],
    camera: { x: 0, y: 0 },
    mouse: { x: 0, y: 0 },
    boosting: false,
    gameOver: false,
    frameCount: 0
  });

  const isTestMode = sessionStorage.getItem("slither_is_test") === "true";

  function createSnake(id: string, name: string, isBot: boolean, x: number, y: number): Snake {
    const body: Point[] = [];
    for(let i=0; i<INITIAL_SNAKE_LENGTH; i++) {
      body.push({ x: x - i * 5, y: y });
    }
    return {
      id,
      name,
      body,
      angle: Math.random() * Math.PI * 2,
      color: isBot ? COLORS[Math.floor(Math.random() * COLORS.length)] : '#a855f7',
      isBot,
      score: 0,
      width: 20,
      speed: BASE_SPEED,
      boosting: false
    };
  }

  function spawnFood(count: number) {
    // Food is now managed by the server
  }

  // WebSocket Setup
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    socketRef.current = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: 'join',
        payload: {
          id: gameState.current.player.id,
          name: gameState.current.player.name,
          segments: gameState.current.player.body,
          color: gameState.current.player.color
        }
      }));
    };

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'food-update') {
        gameState.current.food = msg.payload;
      } else if (msg.type === 'food-eaten') {
        gameState.current.food = gameState.current.food.filter(f => f.id !== msg.payload.id);
        if (msg.payload.playerId === gameState.current.player.id) {
           gameState.current.player.score += 10;
           onScoreUpdate(gameState.current.player.score);
        }
      } else if (msg.type === 'player-joined' || msg.type === 'player-moved') {
        if (msg.payload.id !== gameState.current.player.id) {
          const s = gameState.current.otherSnakes.get(msg.payload.id) || createSnake(msg.payload.id, msg.payload.name, false, 0, 0);
          s.body = msg.payload.segments;
          if (msg.payload.name) s.name = msg.payload.name;
          if (msg.payload.color) s.color = msg.payload.color;
          gameState.current.otherSnakes.set(msg.payload.id, s);
        }
      } else if (msg.type === 'player-left' || msg.type === 'player-died') {
        gameState.current.otherSnakes.delete(msg.payload.id);
      }
    };

    return () => socket.close();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // spawnFood(500); // Removed, server sends food

    let animationFrameId: number;

    const render = () => {
      if (gameState.current.gameOver) return;

      gameState.current.frameCount++;
      const { player, otherSnakes, food, camera, mouse, boosting } = gameState.current;

      // Update Player
      player.boosting = boosting;
      player.speed = boosting ? BOOST_SPEED : BASE_SPEED;
      
      const targetAngle = Math.atan2(mouse.y - height/2, mouse.x - width/2);
      let diff = targetAngle - player.angle;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      player.angle += Math.sign(diff) * Math.min(Math.abs(diff), TURN_SPEED);

      const head = player.body[0];
      const newHead = {
        x: head.x + Math.cos(player.angle) * player.speed,
        y: head.y + Math.sin(player.angle) * player.speed
      };

      if(newHead.x < 0 || newHead.x > WORLD_SIZE || newHead.y < 0 || newHead.y > WORLD_SIZE) {
        handleGameOver();
        return;
      }

      player.body.unshift(newHead);
      const desiredLength = INITIAL_SNAKE_LENGTH + Math.floor(player.score / 50);
      while(player.body.length > desiredLength) player.body.pop();

      camera.x = newHead.x - width / 2;
      camera.y = newHead.y - height / 2;

      // Send update
      if (socketRef.current?.readyState === WebSocket.OPEN && gameState.current.frameCount % 2 === 0) {
        socketRef.current.send(JSON.stringify({
          type: 'move',
          payload: { id: player.id, segments: player.body }
        }));
      }

      // Collisions (Food)
      for(let i = food.length - 1; i >= 0; i--) {
        const f = food[i];
        const dx = newHead.x - f.x;
        const dy = newHead.y - f.y;
        if(Math.sqrt(dx*dx + dy*dy) < player.width/2 + f.size) {
          player.score += f.value;
          onScoreUpdate(player.score);
          food.splice(i, 1);
          spawnFood(1);
        }
      }

      // Collisions (Tail) - Fixed: KILL logic
      let died = false;
      otherSnakes.forEach(other => {
        // Skip head-to-head for simplicity, focus on hitting tail
        for(let j=1; j<other.body.length; j++) {
          const pt = other.body[j];
          const dx = newHead.x - pt.x;
          const dy = newHead.y - pt.y;
          if(Math.sqrt(dx*dx + dy*dy) < player.width/2 + 5) {
            died = true;
          }
        }
      });
      if(died) {
        handleGameOver();
        return;
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

      otherSnakes.forEach(s => drawSnake(ctx, s));
      drawSnake(ctx, player, true);

      ctx.restore();
      animationFrameId = requestAnimationFrame(render);
    };

    function drawSnake(ctx: CanvasRenderingContext2D, snake: Snake, isPlayer = false) {
      if(snake.body.length === 0) return;
      const head = snake.body[0];
      
      // Shadow for better design
      ctx.shadowColor = snake.color;
      ctx.shadowBlur = isPlayer ? 15 : 5;

      // Draw Body with gradient-like segments
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = snake.width;
      ctx.strokeStyle = snake.color;
      
      ctx.beginPath();
      ctx.moveTo(head.x, head.y);
      for(let i=1; i<snake.body.length; i++) {
        ctx.lineTo(snake.body[i].x, snake.body[i].y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Eyes on head
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(head.x, head.y, snake.width * 0.6, 0, Math.PI * 2); ctx.fill();
      
      ctx.fillStyle = '#000';
      const eyeOffset = snake.width * 0.3;
      ctx.beginPath(); ctx.arc(head.x + Math.cos(snake.angle+0.5)*eyeOffset, head.y + Math.sin(snake.angle+0.5)*eyeOffset, 2, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(head.x + Math.cos(snake.angle-0.5)*eyeOffset, head.y + Math.sin(snake.angle-0.5)*eyeOffset, 2, 0, Math.PI*2); ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px Exo 2';
      ctx.textAlign = 'center';
      ctx.fillText(snake.name, head.x, head.y - 25);
    }

    function handleGameOver() {
      gameState.current.gameOver = true;
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'die', payload: { id: gameState.current.player.id } }));
      }
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      onGameOver(gameState.current.player.score);
    }

    render();
    return () => cancelAnimationFrame(animationFrameId);
  }, [width, height, onGameOver, onScoreUpdate]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => { gameState.current.mouse = { x: e.clientX, y: e.clientY }; };
    const handleMouseDown = () => { gameState.current.boosting = true; };
    const handleMouseUp = () => { gameState.current.boosting = false; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return <canvas ref={canvasRef} width={width} height={height} className="fixed inset-0 cursor-crosshair" />;
}
