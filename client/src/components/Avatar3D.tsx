import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

interface Avatar3DProps {
  character: "kelion" | "kira";
  emotion?: "neutral" | "happy" | "sad" | "thinking" | "excited" | "confused";
  isAnimating?: boolean;
  onReady?: () => void;
}

const Avatar3D: React.FC<Avatar3DProps> = ({
  character,
  emotion = "neutral",
  isAnimating = false,
  onReady,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const modelUrls: Record<string, string> = {
    kelion:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663494239902/fTDgTXExTnteU8v7gTpoiu/kelion-rpm_e27cb94d.glb",
    kira: "https://d2xsxph8kpxj0f.cloudfront.net/310519663494239902/fTDgTXExTnteU8v7gTpoiu/kira-rpm_54d82b66.glb",
  };

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    // Initialize camera
    const camera = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.z = 3;
    cameraRef.current = camera;

    // Initialize renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    const pointLight = new THREE.PointLight(0x8b5cf6, 0.5);
    pointLight.position.set(-5, 3, 3);
    scene.add(pointLight);

    // Load model
    const loader = new GLTFLoader();
    loader.load(
      modelUrls[character],
      (gltf: any) => {
        const model = gltf.scene;
        model.scale.set(1.5, 1.5, 1.5);
        model.position.y = -0.5;
        scene.add(model);
        modelRef.current = model;

        // Setup animations
        if (gltf.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(model);
          mixerRef.current = mixer;

          // Play idle animation
          const idleAction = mixer.clipAction(gltf.animations[0]);
          idleAction.play();
        }

        setIsLoading(false);
        onReady?.();
      },
      (progress: any) => {
        console.log(`Loading ${character}: ${(progress.loaded / progress.total) * 100}%`);
      },
      (error: any) => {
        console.error(`Error loading ${character} model:`, error);
        setIsLoading(false);
      }
    );

    // Animation loop
    const clock = new THREE.Clock();
    const animate = () => {
      requestAnimationFrame(animate);

      if (mixerRef.current) {
        mixerRef.current.update(clock.getDelta());
      }

      // Subtle rotation for visual interest
      if (modelRef.current && !isAnimating) {
        modelRef.current.rotation.y += 0.005;
      }

      renderer.render(scene, camera);
    };
    animate();

    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current) return;

      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (containerRef.current && renderer.domElement.parentElement === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [character, onReady]);

  // Apply emotion-based transformations
  useEffect(() => {
    if (!modelRef.current) return;

    const emotionTransforms = {
      neutral: { rotationX: 0, rotationY: 0, scale: 1 },
      happy: { rotationX: 0.1, rotationY: 0, scale: 1.05 },
      sad: { rotationX: -0.1, rotationY: 0, scale: 0.95 },
      thinking: { rotationX: 0.05, rotationY: 0.2, scale: 1 },
      excited: { rotationX: 0.15, rotationY: 0.1, scale: 1.1 },
      confused: { rotationX: 0.1, rotationY: -0.1, scale: 1 },
    };

    const transform = emotionTransforms[emotion];
    if (transform) {
      modelRef.current.rotation.x = transform.rotationX;
      modelRef.current.rotation.y = transform.rotationY;
      modelRef.current.scale.set(transform.scale, transform.scale, transform.scale);
    }
  }, [emotion]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full rounded-lg overflow-hidden bg-gradient-to-b from-purple-900 to-black"
      style={{ minHeight: "400px" }}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
          <div className="text-white text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
            <p>Loading {character}...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Avatar3D;
