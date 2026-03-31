import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

interface AvatarInteractionProps {
  character: "kelion" | "kira";
  isListening?: boolean;
  isSpeaking?: boolean;
  emotion?: "neutral" | "happy" | "sad" | "thinking" | "excited" | "confused";
  userPosition?: { x: number; y: number; z: number };
  onReady?: () => void;
}

const AvatarInteraction: React.FC<AvatarInteractionProps> = ({
  character,
  isListening = false,
  isSpeaking = false,
  emotion = "neutral",
  userPosition = { x: 0, y: 0, z: 5 },
  onReady,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const animationsRef = useRef<THREE.AnimationAction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const modelUrls = {
    kelion:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663494239902/fTDgTXExTnteU8v7gTpoiu/kelion-rpm_e27cb94d.glb",
    kira: "https://d2xsxph8kpxj0f.cloudfront.net/310519663494239902/fTDgTXExTnteU8v7gTpoiu/kira-rpm_54d82b66.glb",
  };

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 1, 3);
    camera.lookAt(0, 1, 0);
    cameraRef.current = camera;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
    directionalLight.position.set(5, 5, 5);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    const pointLight = new THREE.PointLight(0x8b5cf6, 0.6);
    pointLight.position.set(-5, 3, 3);
    scene.add(pointLight);

    // Load model
    const loader = new GLTFLoader();
    loader.load(
      modelUrls[character],
      (gltf: any) => {
        const model = gltf.scene;
        model.scale.set(1.5, 1.5, 1.5);
        model.position.y = 0;
        model.castShadow = true;
        model.receiveShadow = true;
        scene.add(model);
        modelRef.current = model;

        // Setup animations
        if (gltf.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(model);
          mixerRef.current = mixer;

          // Store all animations
          const actions = gltf.animations.map((clip: THREE.AnimationClip) => {
            return mixer.clipAction(clip);
          });
          animationsRef.current = actions;

          // Play idle animation
          if (actions.length > 0) {
            actions[0].play();
          }
        }

        setIsLoading(false);
        onReady?.();
      },
      undefined,
      (error: any) => {
        console.error(`Error loading ${character}:`, error);
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

      // Head tracking - look at user
      if (modelRef.current && userPosition) {
        const headBone = modelRef.current.getObjectByName("Head") || modelRef.current;
        const targetPosition = new THREE.Vector3(userPosition.x, userPosition.y, userPosition.z);
        const direction = targetPosition.clone().sub(headBone.position).normalize();

        // Smooth head rotation
        const targetQuaternion = new THREE.Quaternion();
        targetQuaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);

        headBone.quaternion.slerp(targetQuaternion, 0.05);
      }

      // Listening animation - subtle head movement
      if (isListening && modelRef.current) {
        const time = Date.now() / 1000;
        modelRef.current.position.y = Math.sin(time * 2) * 0.02;
      }

      // Speaking animation - mouth movement (simulated)
      if (isSpeaking && animationsRef.current.length > 1) {
        animationsRef.current[1].play();
      }

      renderer.render(scene, camera);
    };
    animate();

    // Handle resize
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
      if (containerRef.current?.contains(renderer.domElement)) {
        containerRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [character, userPosition, onReady]);

  // Apply emotion animations
  useEffect(() => {
    if (!modelRef.current || animationsRef.current.length === 0) return;

    // Stop all animations
    animationsRef.current.forEach((action) => action.stop());

    // Play emotion-specific animation
    const emotionAnimationIndex = {
      neutral: 0,
      happy: 1,
      sad: 2,
      thinking: 3,
      excited: 4,
      confused: 5,
    }[emotion];

    if (animationsRef.current[emotionAnimationIndex]) {
      animationsRef.current[emotionAnimationIndex].play();
    }
  }, [emotion]);

  // Apply listening state
  useEffect(() => {
    if (!modelRef.current) return;

    if (isListening) {
      // Add subtle glow when listening
      modelRef.current.traverse((child: any) => {
        if (child.isMesh) {
          child.material.emissive.setHex(0x4c1d95);
        }
      });
    } else {
      // Remove glow
      modelRef.current.traverse((child: any) => {
        if (child.isMesh) {
          child.material.emissive.setHex(0x000000);
        }
      });
    }
  }, [isListening]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full rounded-lg overflow-hidden bg-gradient-to-b from-purple-900 to-black"
      style={{ minHeight: "500px" }}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
          <div className="text-white text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
            <p>Loading {character}...</p>
          </div>
        </div>
      )}

      {/* Status indicators */}
      <div className="absolute top-4 right-4 z-20 space-y-2">
        {isListening && (
          <div className="flex items-center gap-2 bg-green-500/20 border border-green-500 rounded-lg px-3 py-2 text-sm text-green-400">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            Listening...
          </div>
        )}
        {isSpeaking && (
          <div className="flex items-center gap-2 bg-blue-500/20 border border-blue-500 rounded-lg px-3 py-2 text-sm text-blue-400">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            Speaking...
          </div>
        )}
      </div>
    </div>
  );
};

export default AvatarInteraction;
