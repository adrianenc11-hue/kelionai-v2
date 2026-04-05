import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, Camera, CameraOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WebcamFeedProps {
  onFrameCapture?: (canvas: HTMLCanvasElement) => void;
  isActive?: boolean;
  onPermissionDenied?: () => void;
}

const WebcamFeed: React.FC<WebcamFeedProps> = ({
  onFrameCapture,
  isActive = true,
  onPermissionDenied,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const frameIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isActive) {
      stopCamera();
      return;
    }

    startCamera();
  }, [isActive]);

  const startCamera = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Request camera access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: false,
      });

      streamRef.current = stream;

      // Set video source
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setIsCameraActive(true);
          setIsLoading(false);

          // Start capturing frames
          if (onFrameCapture) {
            frameIntervalRef.current = setInterval(() => {
              captureFrame();
            }, 100); // Capture every 100ms (10 FPS)
          }
        };
      }
    } catch (err: any) {
      setIsLoading(false);
      const errorMessage = err.name === "NotAllowedError" 
        ? "Camera permission denied. Please allow camera access."
        : err.name === "NotFoundError"
        ? "No camera found on this device."
        : `Camera error: ${err.message}`;
      
      setError(errorMessage);
      onPermissionDenied?.();
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }

    setIsCameraActive(false);
  };

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    // Set canvas size to match video
    canvasRef.current.width = videoRef.current.videoWidth;
    canvasRef.current.height = videoRef.current.videoHeight;

    // Draw video frame to canvas
    ctx.drawImage(videoRef.current, 0, 0);

    // Send frame to parent component
    onFrameCapture?.(canvasRef.current);
  };

  const toggleCamera = () => {
    if (isCameraActive) {
      stopCamera();
    } else {
      startCamera();
    }
  };

  return (
    <div className="w-full space-y-2">
      {/* Video Feed */}
      <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-red-900/20 border border-red-500">
            <div className="text-center text-red-400">
              <AlertCircle className="w-8 h-8 mx-auto mb-2" />
              <p className="text-sm">{error}</p>
            </div>
          </div>
        ) : isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
            <div className="text-center text-gray-400">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mx-auto mb-2"></div>
              <p className="text-sm">Initializing camera...</p>
            </div>
          </div>
        ) : null}

        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          playsInline
          muted
          style={{ display: isLoading || error ? "none" : "block" }}
        />

        {/* Camera Status Indicator */}
        {isCameraActive && !error && (
          <div className="absolute top-2 right-2 flex items-center gap-2 bg-green-500/20 border border-green-500 rounded-lg px-2 py-1">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-xs text-green-400">Live</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex gap-2">
        <Button
          onClick={toggleCamera}
          variant={isCameraActive ? "destructive" : "default"}
          size="sm"
          className="flex-1"
        >
          {isCameraActive ? (
            <>
              <CameraOff className="w-4 h-4 mr-2" />
              Stop Camera
            </>
          ) : (
            <>
              <Camera className="w-4 h-4 mr-2" />
              Start Camera
            </>
          )}
        </Button>
      </div>

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default WebcamFeed;
