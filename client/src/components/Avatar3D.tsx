import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

interface Avatar3DProps {
  character: "kelion" | "kira";
  emotion?: "neutral" | "happy" | "sad" | "thinking" | "excited" | "confused";
  isAnimating?: boolean;
  mouthOpen?: number; // 0-1 range for mouth control
  onReady?: () => void;
}

const Avatar3D: React.FC<Avatar3DProps> = ({
  character,
  emotion = "neutral",
  isAnimating = false,
  mouthOpen = 0,
  onReady,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const headBoneRef = useRef<THREE.Bone | null>(null);
  const meshesWithMorphRef = useRef<THREE.Mesh[]>([]);
  const mouthOpenRef = useRef(0);
  const [isLoading, setIsLoading] = useState(true);

  // Arm bone refs and rest quaternions
  const armBonesRef = useRef<{
    leftArm: THREE.Bone | null;
    rightArm: THREE.Bone | null;
    leftForeArm: THREE.Bone | null;
    rightForeArm: THREE.Bone | null;
  }>({ leftArm: null, rightArm: null, leftForeArm: null, rightForeArm: null });
  const armRestLeftRef = useRef<THREE.Quaternion | null>(null);
  const armRestRightRef = useRef<THREE.Quaternion | null>(null);

  // Keep mouthOpen ref in sync
  useEffect(() => {
    mouthOpenRef.current = mouthOpen;
  }, [mouthOpen]);

  const modelUrls: Record<string, string> = {
    kelion: "https://d2xsxph8kpxj0f.cloudfront.net/310519663494239902/fTDgTXExTnteU8v7gTpoiu/kelion-rpm_e27cb94d.glb",
    kira: "https://d2xsxph8kpxj0f.cloudfront.net/310519663494239902/fTDgTXExTnteU8v7gTpoiu/kira-rpm_54d82b66.glb",
  };

  // Apply relaxed pose
  const applyRelaxedPose = useCallback(() => {
    const { leftArm, rightArm } = armBonesRef.current;
    const restLeft = armRestLeftRef.current;
    const restRight = armRestRightRef.current;

    if (!leftArm || !rightArm || !restLeft || !restRight) return;

    const armLX = 27, armLY = -9, armLZ = -4;
    const armRX = 27, armRY = -9, armRZ = -4;

    const rxL = (armLX * Math.PI) / 180;
    const ryL = (armLY * Math.PI) / 180;
    const rzL = (armLZ * Math.PI) / 180;
    const deltaL = new THREE.Quaternion().setFromEuler(new THREE.Euler(rxL, -ryL, -rzL, "XYZ"));
    leftArm.quaternion.copy(restLeft).multiply(deltaL);

    const rxR = (armRX * Math.PI) / 180;
    const ryR = (armRY * Math.PI) / 180;
    const rzR = (armRZ * Math.PI) / 180;
    const deltaR = new THREE.Quaternion().setFromEuler(new THREE.Euler(rxR, ryR, rzR, "XYZ"));
    rightArm.quaternion.copy(restRight).multiply(deltaR);
  }, []);

  // Apply mouth morph targets
  const applyMouthMorph = useCallback(() => {
    const val = mouthOpenRef.current;
    for (const mesh of meshesWithMorphRef.current) {
      if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
      // Try common morph target names for jaw/mouth open
      const jawNames = ["jawOpen", "mouthOpen", "jaw_open", "viseme_aa", "viseme_O", "A"];
      for (const name of jawNames) {
        const idx = mesh.morphTargetDictionary[name];
        if (idx !== undefined) {
          mesh.morphTargetInfluences[idx] = val;
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    // Dark gradient background
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = 512;
    bgCanvas.height = 512;
    const bgCtx = bgCanvas.getContext('2d')!;
    const gradient = bgCtx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, '#0f172a');
    gradient.addColorStop(1, '#020617');
    bgCtx.fillStyle = gradient;
    bgCtx.fillRect(0, 0, 512, 512);
    scene.background = new THREE.CanvasTexture(bgCanvas);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      30,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      100
    );
    // Bust view: camera positioned to show head + shoulders + chest
    // Default position, will be overridden after model loads
    camera.position.set(0, 1.4, 2.8);
    camera.lookAt(0, 1.3, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Premium studio lighting
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

        // Center model in scene
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        // Center model on all axes except Y (keep feet grounded)
        model.position.x = -center.x;
        model.position.z = -center.z;
        model.position.y = -box.min.y; // feet at y=0

        // Camera: show full upper body with head clearly visible
        const modelHeight = size.y;
        const headTop = modelHeight; // top of head
        const waistY = modelHeight * 0.45; // waist level
        const centerY = (headTop + waistY) / 2; // center between head top and waist
        // Position camera to frame from waist to above head
        camera.position.set(0, centerY, 2.5);
        camera.lookAt(0, centerY, 0);
        camera.fov = 28; // tighter FOV for portrait framing
        camera.updateProjectionMatrix();

        model.castShadow = true;
        model.receiveShadow = true;
        scene.add(model);
        modelRef.current = model;

        // Find bones
        const allBones: THREE.Bone[] = [];
        const morphMeshes: THREE.Mesh[] = [];
        model.traverse((child: any) => {
          if (child.isBone) allBones.push(child);
          if (child.isMesh && child.morphTargetDictionary && child.morphTargetInfluences) {
            morphMeshes.push(child);
          }
        });
        meshesWithMorphRef.current = morphMeshes;

        function findBone(patterns: string[]): THREE.Bone | null {
          for (const p of patterns) {
            for (const b of allBones) {
              if (b.name === p) return b;
            }
          }
          const lowerPatterns = patterns.map((p) => p.toLowerCase());
          for (const lp of lowerPatterns) {
            for (const b of allBones) {
              if (b.name.toLowerCase() === lp) return b;
            }
          }
          return null;
        }

        headBoneRef.current = findBone(["Head", "head"]);

        const leftArm = findBone(["LeftArm", "LeftArm1", "Left_Arm", "upperarm_l", "upper_arm.L"]);
        const rightArm = findBone(["RightArm", "RightArm1", "Right_Arm", "upperarm_r", "upper_arm.R"]);
        const leftForeArm = findBone(["LeftForeArm", "LeftForeArm1", "Left_ForeArm", "lowerarm_l", "forearm.L"]);
        const rightForeArm = findBone(["RightForeArm", "RightForeArm1", "Right_ForeArm", "lowerarm_r", "forearm.R"]);

        armBonesRef.current = { leftArm, rightArm, leftForeArm, rightForeArm };

        if (leftArm) armRestLeftRef.current = leftArm.quaternion.clone();
        if (rightArm) armRestRightRef.current = rightArm.quaternion.clone();

        applyRelaxedPose();

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
    let animFrameId: number;
    const animate = () => {
      animFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      if (mixerRef.current) mixerRef.current.update(delta);
      applyRelaxedPose();
      applyMouthMorph();
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
      cancelAnimationFrame(animFrameId);
      if (containerRef.current && renderer.domElement.parentElement === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [character, onReady, applyRelaxedPose, applyMouthMorph]);

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
      className="w-full h-full rounded-lg overflow-hidden"
      style={{ minHeight: "100%" }}
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
