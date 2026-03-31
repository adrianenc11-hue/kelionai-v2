import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";

interface Avatar3DProps {
  character: "kelion" | "kira";
  isAnimating?: boolean;
  emotion?: "neutral" | "happy" | "thinking" | "excited";
}

/**
 * 3D Avatar Component
 * Renders a simple 3D avatar using Canvas and basic geometry
 * In production, this would integrate with Three.js or Babylon.js for advanced rendering
 */
export function Avatar3D({ character, isAnimating = false, emotion = "neutral" }: Avatar3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    canvas.width = 400;
    canvas.height = 400;

    // Clear canvas
    ctx.fillStyle = "transparent";
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw avatar based on character
    if (character === "kelion") {
      drawKelion(ctx, canvas.width, canvas.height, emotion, isAnimating);
    } else {
      drawKira(ctx, canvas.width, canvas.height, emotion, isAnimating);
    }
  }, [character, emotion, isAnimating]);

  return (
    <Card className="bg-purple-900/20 border border-purple-500/20 p-4 flex items-center justify-center">
      <canvas
        ref={canvasRef}
        className="rounded-lg"
        style={{ maxWidth: "100%", height: "auto" }}
      />
    </Card>
  );
}

function drawKelion(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  emotion: string,
  isAnimating: boolean
) {
  const centerX = width / 2;
  const centerY = height / 2;
  const time = isAnimating ? Date.now() / 1000 : 0;

  // Head
  ctx.fillStyle = "#8b5cf6";
  ctx.beginPath();
  ctx.arc(centerX, centerY - 20, 60, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(centerX - 25, centerY - 35, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(centerX + 25, centerY - 35, 12, 0, Math.PI * 2);
  ctx.fill();

  // Pupils
  const pupilOffset = isAnimating ? Math.sin(time * 2) * 3 : 0;
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.arc(centerX - 25 + pupilOffset, centerY - 35, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(centerX + 25 + pupilOffset, centerY - 35, 6, 0, Math.PI * 2);
  ctx.fill();

  // Mouth based on emotion
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
  ctx.beginPath();

  if (emotion === "happy") {
    ctx.arc(centerX, centerY + 10, 20, 0, Math.PI);
    ctx.stroke();
  } else if (emotion === "excited") {
    ctx.arc(centerX, centerY + 15, 25, 0, Math.PI);
    ctx.stroke();
  } else if (emotion === "thinking") {
    ctx.moveTo(centerX - 15, centerY + 10);
    ctx.lineTo(centerX + 15, centerY + 10);
    ctx.stroke();
  } else {
    // neutral
    ctx.moveTo(centerX - 15, centerY + 5);
    ctx.lineTo(centerX + 15, centerY + 5);
    ctx.stroke();
  }

  // Body
  ctx.fillStyle = "#a78bfa";
  ctx.fillRect(centerX - 40, centerY + 40, 80, 60);

  // Arms with animation
  ctx.fillStyle = "#8b5cf6";
  const armRotation = isAnimating ? Math.sin(time * 1.5) * 0.3 : 0;
  ctx.save();
  ctx.translate(centerX - 40, centerY + 50);
  ctx.rotate(armRotation);
  ctx.fillRect(0, 0, -40, 15);
  ctx.restore();

  ctx.save();
  ctx.translate(centerX + 40, centerY + 50);
  ctx.rotate(-armRotation);
  ctx.fillRect(0, 0, 40, 15);
  ctx.restore();
}

function drawKira(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  emotion: string,
  isAnimating: boolean
) {
  const centerX = width / 2;
  const centerY = height / 2;
  const time = isAnimating ? Date.now() / 1000 : 0;

  // Head
  ctx.fillStyle = "#ec4899";
  ctx.beginPath();
  ctx.arc(centerX, centerY - 20, 60, 0, Math.PI * 2);
  ctx.fill();

  // Hair/Ears
  ctx.fillStyle = "#db2777";
  ctx.beginPath();
  ctx.arc(centerX - 50, centerY - 50, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(centerX + 50, centerY - 50, 20, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(centerX - 25, centerY - 35, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(centerX + 25, centerY - 35, 14, 0, Math.PI * 2);
  ctx.fill();

  // Pupils with animation
  const pupilOffset = isAnimating ? Math.sin(time * 2.5) * 4 : 0;
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.arc(centerX - 25 + pupilOffset, centerY - 35, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(centerX + 25 + pupilOffset, centerY - 35, 7, 0, Math.PI * 2);
  ctx.fill();

  // Mouth based on emotion
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.5;
  ctx.beginPath();

  if (emotion === "happy") {
    ctx.arc(centerX, centerY + 15, 22, 0, Math.PI);
    ctx.stroke();
  } else if (emotion === "excited") {
    ctx.arc(centerX, centerY + 20, 28, 0, Math.PI);
    ctx.stroke();
  } else if (emotion === "thinking") {
    ctx.arc(centerX, centerY + 10, 15, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // neutral
    ctx.moveTo(centerX - 18, centerY + 8);
    ctx.lineTo(centerX + 18, centerY + 8);
    ctx.stroke();
  }

  // Body
  ctx.fillStyle = "#f472b6";
  ctx.fillRect(centerX - 40, centerY + 40, 80, 60);

  // Arms with animation
  ctx.fillStyle = "#ec4899";
  const armRotation = isAnimating ? Math.sin(time * 1.8) * 0.35 : 0;
  ctx.save();
  ctx.translate(centerX - 40, centerY + 50);
  ctx.rotate(armRotation);
  ctx.fillRect(0, 0, -42, 16);
  ctx.restore();

  ctx.save();
  ctx.translate(centerX + 40, centerY + 50);
  ctx.rotate(-armRotation);
  ctx.fillRect(0, 0, 42, 16);
  ctx.restore();
}
