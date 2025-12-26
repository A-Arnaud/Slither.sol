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
  
  // Game State Refs (avoid re-renders for game loop)
  const gameState = useRef({
    player: createSnake('player', playerName, false, WORLD_SIZE/2, WORLD_SIZE/2),
    bots: [] as Snake[],
    food: [] as Food[],
    particles: [] as any[],
    camera: { x: 0, y: 0 },
    mouse: { x: 0, y: 0 },
    boosting: false,
    gameOver: false,
    frameCount: 0
  });

  // --- Helpers ---
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
      color: isBot ? COLORS[Math.floor(Math.random() * COLORS.length)] : '#a855f7', // Player is purple
      isBot,
      score: 0,
      width: 20,
      speed: BASE_SPEED,
      boosting: false
    };
  }

  function spawnFood(count: number) {
    for(let i=0; i<count; i++) {
      gameState.current.food.push({
        x: Math.random() * WORLD_SIZE,
        y: Math.random() * WORLD_SIZE,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        size: Math.random() * 5 + 3,
        value: 10
      });
    }
  }

  // --- Game Loop ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Initialize Bots
    for(let i=0; i<20; i++) {
      gameState.current.bots.push(createSnake(
        `bot-${i}`, 
        `Bot ${i+1}`, 
        true, 
        Math.random() * WORLD_SIZE, 
        Math.random() * WORLD_SIZE
      ));
    }
    spawnFood(500);

    let animationFrameId: number;

    const render = () => {
      if (gameState.current.gameOver) return;

      gameState.current.frameCount++;
      const { player, bots, food, camera, mouse, boosting } = gameState.current;

      // Update Player Logic
      player.boosting = boosting;
      player.speed = boosting ? BOOST_SPEED : BASE_SPEED;
      
      // Calculate angle to mouse (relative to center of screen)
      const targetAngle = Math.atan2(mouse.y - height/2, mouse.x - width/2);
      
      // Smooth turning
      let diff = targetAngle - player.angle;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      player.angle += Math.sign(diff) * Math.min(Math.abs(diff), TURN_SPEED);

      // Move Player
      const head = player.body[0];
      const newHead = {
        x: head.x + Math.cos(player.angle) * player.speed,
        y: head.y + Math.sin(player.angle) * player.speed
      };

      // Boundary check
      if(newHead.x < 0 || newHead.x > WORLD_SIZE || newHead.y < 0 || newHead.y > WORLD_SIZE) {
        handleGameOver();
        return;
      }

      player.body.unshift(newHead);
      
      // Growth/Shrink logic
      // Calculate desired length based on score. 
      // Base length 20 + 1 segment per 50 score
      const desiredLength = INITIAL_SNAKE_LENGTH + Math.floor(player.score / 50);
      while(player.body.length > desiredLength) {
        player.body.pop();
      }

      // Update Camera to follow player
      camera.x = newHead.x - width / 2;
      camera.y = newHead.y - height / 2;

      // Update Bots
      bots.forEach(bot => {
        // Simple bot AI: Move randomly but tend towards center if too far out
        if (Math.random() < 0.05) {
            bot.angle += (Math.random() - 0.5);
        }
        
        // Avoid walls
        const botHead = bot.body[0];
        if (botHead.x < 100) bot.angle = 0;
        if (botHead.x > WORLD_SIZE - 100) bot.angle = Math.PI;
        if (botHead.y < 100) bot.angle = Math.PI/2;
        if (botHead.y > WORLD_SIZE - 100) bot.angle = -Math.PI/2;

        const bx = botHead.x + Math.cos(bot.angle) * bot.speed;
        const by = botHead.y + Math.sin(bot.angle) * bot.speed;
        
        bot.body.unshift({ x: bx, y: by });
        const botDesiredLength = INITIAL_SNAKE_LENGTH + Math.floor(bot.score / 50);
        while(bot.body.length > botDesiredLength) bot.body.pop();
      });

      // Collision Detection (Player vs Food)
      for(let i = food.length - 1; i >= 0; i--) {
        const f = food[i];
        const dx = newHead.x - f.x;
        const dy = newHead.y - f.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        if(dist < player.width + f.size) {
          player.score += f.value;
          onScoreUpdate(player.score);
          food.splice(i, 1);
          // Spawn new food
          spawnFood(1);
        }
      }

      // Collision Detection (Player vs Bots)
      let crashed = false;
      bots.forEach(bot => {
        // Check if player hit bot body
        for(let pt of bot.body) {
           const dx = newHead.x - pt.x;
           const dy = newHead.y - pt.y;
           if(Math.sqrt(dx*dx + dy*dy) < player.width/2 + 10) { // 10 is approx bot radius
             crashed = true;
           }
        }
      });
      if(crashed) {
        handleGameOver();
        return;
      }

      // --- Drawing ---
      // Clear Background
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, width, height);

      // Save context for camera transform
      ctx.save();
      ctx.translate(-camera.x, -camera.y);

      // Draw Grid
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.1)';
      ctx.lineWidth = 1;
      const gridSize = 100;
      
      const startX = Math.floor(camera.x / gridSize) * gridSize;
      const startY = Math.floor(camera.y / gridSize) * gridSize;

      ctx.beginPath();
      for(let x = startX; x < camera.x + width; x += gridSize) {
        ctx.moveTo(x, camera.y);
        ctx.lineTo(x, camera.y + height);
      }
      for(let y = startY; y < camera.y + height; y += gridSize) {
        ctx.moveTo(camera.x, y);
        ctx.lineTo(camera.x + width, y);
      }
      ctx.stroke();

      // Draw World Bounds
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 5;
      ctx.strokeRect(0, 0, WORLD_SIZE, WORLD_SIZE);

      // Draw Food
      food.forEach(f => {
        // Optimization: only draw if in view
        if(f.x > camera.x && f.x < camera.x + width && f.y > camera.y && f.y < camera.y + height) {
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
          ctx.fillStyle = f.color;
          ctx.shadowColor = f.color;
          ctx.shadowBlur = 10;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      });

      // Draw Bots
      bots.forEach(bot => drawSnake(ctx, bot));

      // Draw Player
      drawSnake(ctx, player, true);

      ctx.restore();
      animationFrameId = requestAnimationFrame(render);
    };

    function drawSnake(ctx: CanvasRenderingContext2D, snake: Snake, isPlayer = false) {
      // Optimization check
      const head = snake.body[0];
      if(!isPlayer && (head.x < gameState.current.camera.x - 100 || head.x > gameState.current.camera.x + width + 100)) return;

      // Draw Body
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = snake.width;
      ctx.strokeStyle = snake.color;
      
      if(isPlayer) {
          ctx.shadowColor = snake.color;
          ctx.shadowBlur = 20;
      }

      ctx.beginPath();
      if (snake.body.length > 0) {
        ctx.moveTo(snake.body[0].x, snake.body[0].y);
        for(let i=1; i<snake.body.length; i++) {
            // Smooth curve through points
            // Simplified: just lines for MVP performance
            ctx.lineTo(snake.body[i].x, snake.body[i].y);
        }
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Draw Head
      ctx.fillStyle = isPlayer ? '#fff' : '#ddd';
      ctx.beginPath();
      ctx.arc(head.x, head.y, snake.width * 0.6, 0, Math.PI * 2);
      ctx.fill();

      // Draw Name
      ctx.fillStyle = '#fff';
      ctx.font = '12px Exo 2';
      ctx.textAlign = 'center';
      ctx.fillText(snake.name, head.x, head.y - 20);
    }

    function handleGameOver() {
      gameState.current.gameOver = true;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      onGameOver(gameState.current.player.score);
    }

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [width, height, onGameOver, onScoreUpdate]);

  // Input Listeners
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      gameState.current.mouse = { x: e.clientX, y: e.clientY };
    };
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

  return (
    <canvas 
      ref={canvasRef}
      width={width}
      height={height}
      className="fixed inset-0 cursor-crosshair"
    />
  );
}
