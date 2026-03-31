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
  const headBoneRef = useRef<THREE.Bone | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Arm bone refs and rest quaternions (from original avatar.js)
  const armBonesRef = useRef<{
    leftArm: THREE.Bone | null;
    rightArm: THREE.Bone | null;
    leftForeArm: THREE.Bone | null;
    rightForeArm: THREE.Bone | null;
  }>({ leftArm: null, rightArm: null, leftForeArm: null, rightForeArm: null });
  const armRestLeftRef = useRef<THREE.Quaternion | null>(null);
  const armRestRightRef = useRef<THREE.Quaternion | null>(null);

  const modelUrls: Record<string, string> = {
    kelion:
      "https://d2xsxph8kpxj0f.cloudfront.net/310519663494239902/fTDgTXExTnteU8v7gTpoiu/kelion-rpm_e27cb94d.glb",
    kira: "https://d2xsxph8kpxj0f.cloudfront.net/310519663494239902/fTDgTXExTnteU8v7gTpoiu/kira-rpm_54d82b66.glb",
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    // Camera settings from original: FOV 24, position (0, 0, 2.8)
    const camera = new THREE.PerspectiveCamera(
      24,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      100
    );
    camera.position.set(0, 0.0, 2.8);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Premium studio lighting (from original)
    scene.add(new THREE.AmbientLight(0x404060, 0.4));

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.25);
    keyLight.position.set(2, 3, 4);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.5);
    fillLight.position.set(-2, 1, 2);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x00ccff, 0.8);
    rimLight.position.set(0, 2, -3);
    scene.add(rimLight);

    const bottomLight = new THREE.DirectionalLight(0x8855ff, 0.3);
    bottomLight.position.set(0, -2, 1);
    scene.add(bottomLight);

    // Load model
    const loader = new GLTFLoader();
    loader.load(
      modelUrls[character],
      (gltf: any) => {
        const model = gltf.scene;

        // From original: center model and scale to 1.2/maxDim
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        model.position.sub(center);
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) model.scale.setScalar(1.2 / maxDim);
        // Override Y with user-calibrated value from original
        model.position.y = -0.6;

        model.castShadow = true;
        model.receiveShadow = true;
        scene.add(model);
        modelRef.current = model;

        // Find bones (from original findArmBones + _findEyeAndSpineBones)
        const allBones: THREE.Bone[] = [];
        model.traverse((child: any) => {
          if (child.isBone) allBones.push(child);
        });

        function findBone(patterns: string[]): THREE.Bone | null {
          // Exact match first
          for (const p of patterns) {
            for (const b of allBones) {
              if (b.name === p) return b;
            }
          }
          // Case-insensitive fallback
          const lowerPatterns = patterns.map(p => p.toLowerCase());
          for (const lp of lowerPatterns) {
            for (const b of allBones) {
              if (b.name.toLowerCase() === lp) return b;
            }
          }
          return null;
        }

        // Head bone
        headBoneRef.current = findBone(["Head", "head"]);

        // Arm bones
        const leftArm = findBone(["LeftArm", "LeftArm1", "Left_Arm", "upperarm_l", "upper_arm.L"]);
        const rightArm = findBone(["RightArm", "RightArm1", "Right_Arm", "upperarm_r", "upper_arm.R"]);
        const leftForeArm = findBone(["LeftForeArm", "LeftForeArm1", "Left_ForeArm", "lowerarm_l", "forearm.L"]);
        const rightForeArm = findBone(["RightForeArm", "RightForeArm1", "Right_ForeArm", "lowerarm_r", "forearm.R"]);

        armBonesRef.current = { leftArm, rightArm, leftForeArm, rightForeArm };

        // Capture rest-pose quaternions ONCE (before applying pose)
        if (leftArm) armRestLeftRef.current = leftArm.quaternion.clone();
        if (rightArm) armRestRightRef.current = rightArm.quaternion.clone();

        // Apply relaxed arm pose (from original: _armL = {x:27, y:-9, z:-4})
        // This rotates arms from A-pose down to natural hanging position
        applyRelaxedPose();

        // Setup animations
        if (gltf.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(model);
          mixerRef.current = mixer;
          gltf.animations.forEach((clip: THREE.AnimationClip) => {
            mixer.clipAction(clip).play();
          });
        }

        setIsLoading(false);
        onReady?.();
      },
      undefined,
      (error: any) => {
        console.error(`Error loading ${character} model:`, error);
        setIsLoading(false);
      }
    );

    // Animation loop
    const clock = new THREE.Clock();
    const animate = () => {
      requestAnimationFrame(animate);

      const delta = clock.getDelta();

      if (mixerRef.current) {
        mixerRef.current.update(delta);
      }

      // Re-enforce arm pose every frame (animations may override it)
      applyRelaxedPose();

      renderer.render(scene, camera);
    };
    animate();

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

  // Apply relaxed pose from original code: _armL = {x:27, y:-9, z:-4}
  function applyRelaxedPose() {
    const { leftArm, rightArm } = armBonesRef.current;
    const restLeft = armRestLeftRef.current;
    const restRight = armRestRightRef.current;

    if (!leftArm || !rightArm || !restLeft || !restRight) return;

    // Original values: _armL = { x: 27, y: -9, z: -4 }
    const armLX = 27, armLY = -9, armLZ = -4;
    const armRX = 27, armRY = -9, armRZ = -4;

    // Left arm (from original _enforcePose)
    const rxL = (armLX * Math.PI) / 180;
    const ryL = (armLY * Math.PI) / 180;
    const rzL = (armLZ * Math.PI) / 180;
    const deltaL = new THREE.Quaternion().setFromEuler(new THREE.Euler(rxL, -ryL, -rzL, "XYZ"));
    leftArm.quaternion.copy(restLeft).multiply(deltaL);

    // Right arm (from original _enforcePose)
    const rxR = (armRX * Math.PI) / 180;
    const ryR = (armRY * Math.PI) / 180;
    const rzR = (armRZ * Math.PI) / 180;
    const deltaR = new THREE.Quaternion().setFromEuler(new THREE.Euler(rxR, ryR, rzR, "XYZ"));
    rightArm.quaternion.copy(restRight).multiply(deltaR);
  }

  // Apply emotion-based transformations
  useEffect(() => {
    if (!headBoneRef.current) return;
    const emotionTransforms: Record<string, { rotationX: number }> = {
      neutral: { rotationX: 0 },
      happy: { rotationX: 0.05 },
      sad: { rotationX: -0.08 },
      thinking: { rotationX: 0.1 },
      excited: { rotationX: 0.1 },
      confused: { rotationX: 0.08 },
    };
    const transform = emotionTransforms[emotion];
    if (transform && headBoneRef.current) {
      headBoneRef.current.rotation.x = transform.rotationX;
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
